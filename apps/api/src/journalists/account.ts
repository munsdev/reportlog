/**
 * A signed-in account and the journalist list (owner decision 80).
 *
 * Signing in already proves the address (a six-digit code), so an account
 * joins the alerts without the confirmation link and asks for the desk in one
 * step that includes the agreement. THE SUBSCRIBER IS ALWAYS THE ACCOUNT'S OWN
 * ADDRESS, read from the session and never from the request, so an approval
 * lands on the account that asked. The data model is unchanged: one
 * subscriber row per address, one request per subscriber.
 *
 * Nothing here grants anything. Only a decider pressing Approve does
 * (vetting.ts). Applying writes a pending request and the agreement
 * acceptance; the deciders are told that one is waiting, and nothing about who.
 */
import { STAFF_ROLES } from '@reportlog/access';
import type { AlertSettingsBody, ApplyBody, DeskStatus, MyJournalist } from '@reportlog/contracts';
import { placeLabel } from '@reportlog/fields';
import { sql, type Kysely } from 'kysely';
import { randomBytes } from 'node:crypto';
import type { DB } from '../db/schema.gen.ts';
import type { Mailer } from '../email/mailer.ts';
import { emailDigest, emailDigests, wrapDek } from '../filing/contactKeys.ts';
import { HttpError } from '../http/errors.ts';
import type { SignedIn } from '../identity/sessions.ts';
import { accept, hasAccepted, newestText } from '../moderation/agreement.ts';
import {
  checkedStates,
  dekOf,
  issueLink,
  settingsLinkFor,
  stopLinkFor,
  writeSettings,
  type ListDeps,
} from './list.ts';
import { writeRequest } from './request.ts';

const isStaff = (user: SignedIn) =>
  user.roles.some((r) => (STAFF_ROLES as readonly string[]).includes(r));

const seal = (dek: Buffer, text: string) => wrapDek(dek, Buffer.from(text, 'utf8'));

const DESK_OF_REQUEST: Record<string, DeskStatus> = {
  pending: 'pending',
  approved: 'approved',
  rejected: 'not_approved',
  revoked: 'ended',
};

/** Where the account stands. Reads only. */
export async function mine(deps: ListDeps, user: SignedIn): Promise<MyJournalist> {
  const { db, ring } = deps;
  const agreement = (await newestText(db, 'journalist')) !== undefined;
  const row = await db
    .selectFrom('journalist_subscribers as s')
    .leftJoin('journalist_access_requests as q', 'q.subscriber_id', 's.id')
    .select(['s.states', 's.alerts_paused_at', 'q.status as request', 'q.created_at as requested'])
    .where('s.email_hmac', 'in', emailDigests(ring, user.email))
    .where('s.status', '=', 'active')
    .executeTakeFirst();
  const staff = isStaff(user);
  const desk: DeskStatus = staff ? 'staff' : (DESK_OF_REQUEST[row?.request ?? ''] ?? 'none');
  return {
    listed: row !== undefined,
    alerts: row && !row.alerts_paused_at ? 'on' : 'off',
    states: row?.states ?? [],
    desk,
    requested_at: desk === 'pending' && row?.requested ? row.requested.toISOString() : null,
    agreement,
  };
}

/**
 * The account's subscriber row, made if there is none. A row left pending by
 * a sign-up that was never confirmed is confirmed here: they have signed in
 * as that address. A new row has alerts off and no states (decision 69
 * allows it) unless the caller says otherwise.
 */
async function ensureSubscriber(
  trx: Kysely<DB>,
  deps: ListDeps,
  email: string,
  fresh: { states: string[]; paused: boolean },
): Promise<{ id: number; dek: Buffer }> {
  const { ring } = deps;
  const now = new Date();
  const find = () =>
    trx
      .selectFrom('journalist_subscribers')
      .select(['id', 'status', 'dek_wrapped'])
      .where('email_hmac', 'in', emailDigests(ring, email))
      .forUpdate()
      .executeTakeFirst();
  let row = await find();
  if (!row) {
    const dek = randomBytes(32);
    await trx
      .insertInto('journalist_subscribers')
      .values({
        dek_wrapped: wrapDek(ring.wrapKey, dek),
        email_hmac: emailDigest(ring, email),
        email_enc: seal(dek, email),
        // Not known: an account has an address and nothing else. Applying asks for a name.
        name_enc: seal(dek, ''),
        outlet_enc: seal(dek, ''),
        states: fresh.states,
        status: 'active',
        confirmed_at: now,
        // The first window starts now: a new subscriber is not sent a backlog.
        last_sent_at: now,
        ...(fresh.paused ? { alerts_paused_at: now } : {}),
      })
      .onConflict((oc) => oc.column('email_hmac').doNothing())
      .execute();
    row = await find();
  } else if (row.status === 'pending') {
    await trx
      .updateTable('journalist_subscribers')
      .set({ status: 'active', confirmed_at: now, last_sent_at: now })
      .where('id', '=', row.id)
      .execute();
  }
  if (!row)
    throw new HttpError(
      409,
      'try_again',
      'Something else changed this at the same time. Try again.',
    );
  return { id: row.id, dek: dekOf(ring, row.dek_wrapped) };
}

export function alertsChangedEmail(
  body: { alerts: 'on' | 'off'; states: readonly string[] },
  links: { settings: string; stop: string },
): { subject: string; text: string } {
  return {
    subject: 'Your alerts changed',
    text: [
      'The alerts for this address on the journalist alert list were changed from your account.',
      '',
      body.alerts === 'on'
        ? `Alerts are on, for: ${body.states.map(placeLabel).join(', ')}.`
        : 'Alerts are off. You are still on the list.',
      '',
      'Change them again:',
      links.settings,
      '',
      'Turn them off in one click:',
      links.stop,
      '',
      'If this was not you, use the second link and tell whoever runs this site.',
    ].join('\n'),
  };
}

/** Join the alert list, or change the settings, as the signed-in account. */
export async function changeMine(
  deps: ListDeps,
  user: SignedIn,
  body: AlertSettingsBody,
): Promise<MyJournalist> {
  const { db, ring } = deps;
  const states = checkedStates(body.states, body.alerts);
  const { id } = await db.transaction().execute(async (trx) => {
    const sub = await ensureSubscriber(trx, deps, user.email, {
      states,
      paused: body.alerts === 'off',
    });
    // The same write the links use, so turning alerts back on restarts the window.
    await writeSettings(trx, ring, sub.id, body);
    return sub;
  });
  const token = await issueLink(db, id, 'stop');
  // After the commit: a failed email does not undo a change they asked for.
  await deps.mailer
    .send({
      to: user.email,
      ...alertsChangedEmail(
        { alerts: body.alerts, states },
        {
          settings: settingsLinkFor(deps.siteOrigin, token),
          stop: stopLinkFor(deps.siteOrigin, token),
        },
      ),
    })
    .catch(() => undefined);
  return mine(deps, user);
}

export const requestReceivedEmail = () => ({
  subject: 'Your request for the journalist desk was received',
  text: [
    'We received your request for access to the journalist desk, and your acceptance of the journalist agreement.',
    '',
    'The people who run this site read every request. Nothing is approved automatically.',
    'We will email you when it has been decided. You can also see where it stands after you sign in, under Journalists.',
  ].join('\n'),
});

export const requestWaitingEmail = (queue: string) => ({
  subject: 'A journalist desk request is waiting',
  text: ['A request for access to the journalist desk is waiting for a decision.', '', queue].join(
    '\n',
  ),
});

/** Everyone who may decide: the owner, administrators and Access Managers. */
export async function deciders(db: Kysely<DB>): Promise<string[]> {
  const rows = await db
    .selectFrom('users')
    .select('email')
    .where(sql<boolean>`roles && ARRAY['owner', 'admin', 'access_manager']::text[]`)
    .execute();
  return rows.map((r) => r.email);
}

/**
 * Ask for the desk as the signed-in account: one step that includes accepting
 * the journalist agreement. Refused for staff, with no agreement published,
 * with a stale digest, or while a request is waiting or approved. A rejected
 * or ended one may be asked again.
 */
export async function applyMine(
  deps: ListDeps,
  user: SignedIn,
  body: ApplyBody,
): Promise<MyJournalist> {
  const { db } = deps;
  if (isStaff(user)) {
    throw new HttpError(
      403,
      'staff_account',
      'Desk access is not available to staff accounts. A journalist cannot also hold a staff role.',
    );
  }
  const text = await newestText(db, 'journalist');
  if (!text) {
    throw new HttpError(
      409,
      'no_agreement',
      'Applications open once the journalist agreement is published.',
    );
  }
  if (body.agreement_digest !== text.digest) {
    throw new HttpError(
      409,
      'agreement_changed',
      'The agreement changed while you were reading it. Read the new one and accept it again.',
    );
  }
  await db.transaction().execute(async (trx) => {
    const sub = await ensureSubscriber(trx, deps, user.email, { states: [], paused: true });
    const current = await trx
      .selectFrom('journalist_access_requests')
      .select('status')
      .where('subscriber_id', '=', sub.id)
      .forUpdate()
      .executeTakeFirst();
    if (current?.status === 'pending' || current?.status === 'approved') {
      throw new HttpError(
        409,
        'already_asked',
        current.status === 'pending'
          ? 'Your request is already waiting for a decision.'
          : 'You already have access to the journalist desk.',
      );
    }
    await trx
      .updateTable('journalist_subscribers')
      .set({ name_enc: seal(sub.dek, body.name), outlet_enc: seal(sub.dek, body.outlet) })
      .where('id', '=', sub.id)
      .execute();
    await writeRequest(trx, sub.id, sub.dek, body);
    // Same rows the accept route writes; skipped when this very text was already accepted.
    if (!(await hasAccepted(trx, 'journalist', user.email))) {
      await accept(trx, 'journalist', user.email, body.agreement_digest);
    }
  });
  // After the commit: a failed email does not undo a request.
  await sendQuietly(deps.mailer, user.email, requestReceivedEmail());
  const queue = `${deps.siteOrigin}/access/journalists`;
  for (const to of await deciders(db))
    await sendQuietly(deps.mailer, to, requestWaitingEmail(queue));
  return mine(deps, user);
}

async function sendQuietly(
  mailer: Mailer,
  to: string,
  message: { subject: string; text: string },
): Promise<void> {
  await mailer.send({ to, ...message }).catch(() => undefined);
}
