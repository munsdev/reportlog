/**
 * Vetted access: asking for it, and the owner deciding (J7a, J7b, J7, J13).
 *
 * THE ONLY FILE IN THIS FOLDER THAT GRANTS ANYTHING. Being on the alert list
 * grants nothing (list.ts); an access request grants nothing either, until
 * the owner, an administrator or an Access Manager presses Approve (decision
 * 80). There is no automatic approval, no timer and no other path:
 * `setSystemRole` refuses to grant 'journalist' (identity/accessRoutes.ts).
 *
 * WHAT A REQUEST HOLDS. Outlet, role, links to published work, and an
 * optional press card number and issuer: text and links only. It is
 * encrypted under the subscriber's own key, beside the name and address it
 * belongs to. A rejected request stays as a row marked 'rejected' with what
 * they wrote wiped, so the person can see it was not approved and may apply
 * again (decision 80); they stay on the alert list. An approval is recorded with who and when, here and in the
 * append-only role_audit.
 *
 * REVOKING (J13) sets the account back to no role. The role is read from the
 * database on every request (identity/sessions.ts), so the journalist's very
 * next request is refused, whatever session they hold.
 */
import type { AccessLink, AccessRequestBody, AccessRequestView } from '@reportlog/contracts';
import { placeLabel } from '@reportlog/fields';
import type { SystemRole } from '@reportlog/access';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.gen.ts';
import { emailDigests, openWithDek, wrapDek } from '../filing/contactKeys.ts';
import { HttpError } from '../http/errors.ts';
import { hasAccepted, newestText } from '../moderation/agreement.ts';
import { partlyHidden } from '../identity/digestStop.ts';
import { addressFrom } from '../identity/http.ts';
import { changeSystemRole, recordRoleChange } from '../identity/roles.ts';
import { sha256Hex } from '../identity/secrets.ts';
import { dekOf, issueLink, type ListDeps } from './list.ts';
import { type Details, writeRequest } from './request.ts';

const TOKEN = /^[a-f0-9]{64}$/;

export const accessLinkFor = (siteOrigin: string, token: string) =>
  `${siteOrigin}/journalists/access/${token}`;
export const deskLinkFor = (siteOrigin: string) => `${siteOrigin}/desk`;
/** Where an approved journalist starts: sign in, and the desk is where they land. */
export const deskSignInLinkFor = (siteOrigin: string) =>
  `${siteOrigin}/access/sign-in?next=%2Fdesk`;

export function accessLinkEmail(link: string): { subject: string; text: string } {
  return {
    subject: 'Your link to ask for access to the journalist desk',
    text: [
      'Somebody asked for a link to request access to the journalist desk for this address.',
      '',
      'To ask, open this link and fill in the form:',
      link,
      '',
      'The people who run this site read every request. Nothing is approved automatically.',
      'If it was not you, ignore this email.',
    ].join('\n'),
  };
}

export function approvedEmail(
  desk: string,
  agreementAccepted = false,
): { subject: string; text: string } {
  return {
    subject: 'Your access to the journalist desk was approved',
    text: [
      'Your request for access to the journalist desk was approved.',
      '',
      agreementAccepted
        ? 'You have already accepted the journalist agreement, so the desk opens when you sign in.'
        : 'When you sign in, the first thing you see is the journalist agreement. Read and accept it, and the desk opens.',
      '',
      'Open the desk. If you are asked, type this email address and then the six-digit code we send you:',
      desk,
      '',
      'A second factor is optional for journalists, and you can add one under Account and security.',
    ].join('\n'),
  };
}

export const endedEmail = () => ({
  subject: 'Your desk access has ended',
  text: [
    'Your access to the journalist desk has ended.',
    'You are still on the alert list if you were on it. You can ask for desk access again from your account.',
  ].join('\n'),
});

export const rejectedEmail = () => ({
  subject: 'Your request for access to the journalist desk',
  text: [
    'Your request for access to the journalist desk was not approved.',
    'What you wrote in it has been deleted. You are still on the alert list, and you can ask again from your account.',
  ].join('\n'),
});

/**
 * Email the request link to an address on the alert list. The answer is the
 * same whether or not the address is listed, so the form cannot be used to
 * learn who is.
 */
export async function askForLink(deps: ListDeps, rawEmail: string): Promise<void> {
  const email = addressFrom(rawEmail);
  const row = await deps.db
    .selectFrom('journalist_subscribers')
    .select('id')
    .where('email_hmac', 'in', emailDigests(deps.ring, email))
    .where('status', '=', 'active')
    .executeTakeFirst();
  if (!row) return;
  const token = await issueLink(deps.db, row.id, 'request');
  try {
    await deps.mailer.send({
      to: email,
      ...accessLinkEmail(accessLinkFor(deps.siteOrigin, token)),
    });
  } catch {
    throw new HttpError(
      503,
      'mail_failed',
      'We could not send the email just now. Please try again later.',
    );
  }
}

async function requestLink(db: Kysely<DB>, token: string) {
  if (!TOKEN.test(token)) return null;
  return db
    .selectFrom('journalist_links as l')
    .innerJoin('journalist_subscribers as s', 's.id', 'l.subscriber_id')
    .leftJoin('journalist_access_requests as q', 'q.subscriber_id', 's.id')
    .select(['l.token_hash', 's.id', 's.email_enc', 's.dek_wrapped', 'q.status'])
    .where('l.token_hash', '=', sha256Hex(token))
    .where('l.purpose', '=', 'request')
    .where('s.status', '=', 'active')
    .where('l.expires_at', '>', new Date())
    .executeTakeFirst();
}

type RequestLinkRow = NonNullable<Awaited<ReturnType<typeof requestLink>>>;

function linkState(deps: ListDeps, row: RequestLinkRow): AccessLink {
  const address = partlyHidden(openWithDek(dekOf(deps.ring, row.dek_wrapped), row.email_enc));
  if (row.status === 'pending') return { state: 'pending', address };
  if (row.status === 'approved') return { state: 'approved', address };
  return { state: 'open', address };
}

/** What a request link would do. Reads only. */
export async function describeAccess(deps: ListDeps, token: string): Promise<AccessLink> {
  const row = await requestLink(deps.db, token);
  return row ? linkState(deps, row) : { state: 'gone' };
}

/**
 * Send the request. One per subscriber: one waiting or approved is not
 * replaced; one revoked may be asked again.
 */
export async function submitRequest(
  deps: ListDeps,
  token: string,
  input: AccessRequestBody,
): Promise<AccessLink> {
  const row = await requestLink(deps.db, token);
  if (!row) return { state: 'gone' };
  if (row.status === 'pending' || row.status === 'approved') return linkState(deps, row);
  const dek = dekOf(deps.ring, row.dek_wrapped);
  await deps.db.transaction().execute(async (trx) => {
    await writeRequest(trx, row.id, dek, input);
    await trx
      .updateTable('journalist_links')
      .set({ used_at: new Date() })
      .where('token_hash', '=', row.token_hash)
      .execute();
  });
  return linkState(deps, { ...row, status: 'pending' });
}

// ── the owner's queue ────────────────────────────────────────────────────

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export async function requestsForOwner(deps: ListDeps): Promise<AccessRequestView[]> {
  const rows = await deps.db
    .selectFrom('journalist_access_requests as q')
    .innerJoin('journalist_subscribers as s', 's.id', 'q.subscriber_id')
    .select([
      'q.id',
      'q.details_enc',
      'q.status',
      'q.created_at',
      'q.decided_at',
      'q.decided_by',
      'q.revoked_at',
      's.dek_wrapped',
      's.email_enc',
      's.name_enc',
      's.states',
    ])
    // A request made while signing up waits for the address to be confirmed
    // (owner decision 69): until then it may not even be theirs.
    .where('s.status', '=', 'active')
    // A rejected request holds nothing to show: its words were wiped.
    .where('q.status', '<>', 'rejected')
    // Waiting first, then the approved, then the revoked.
    .orderBy((eb) =>
      eb
        .case()
        .when('q.status', '=', 'pending')
        .then(0)
        .when('q.status', '=', 'approved')
        .then(1)
        .else(2)
        .end(),
    )
    .orderBy('q.id', 'desc')
    .execute();
  return rows.map((r) => {
    const dek = dekOf(deps.ring, r.dek_wrapped);
    const d = JSON.parse(openWithDek(dek, r.details_enc)) as Details;
    return {
      id: r.id,
      name: openWithDek(dek, r.name_enc),
      address: partlyHidden(openWithDek(dek, r.email_enc)),
      outlet: d.outlet,
      role: d.role,
      about: d.about ?? null,
      links: d.links ?? [],
      press_card_number: d.press_card_number ?? null,
      press_card_issuer: d.press_card_issuer ?? null,
      states: r.states.map(placeLabel),
      status: r.status as AccessRequestView['status'],
      requested_at: r.created_at.toISOString(),
      decided_at: iso(r.decided_at),
      decided_by: r.decided_by,
      revoked_at: iso(r.revoked_at),
    };
  });
}

async function requestRow(db: Kysely<DB>, id: number) {
  const row = await db
    .selectFrom('journalist_access_requests as q')
    .innerJoin('journalist_subscribers as s', 's.id', 'q.subscriber_id')
    .select(['q.id', 'q.status', 'q.user_id', 's.dek_wrapped', 's.email_enc'])
    .where('q.id', '=', id)
    .where('s.status', '=', 'active')
    .executeTakeFirst();
  if (!row)
    throw new HttpError(404, 'not_found', 'There is no such request. It may have been withdrawn.');
  return row;
}

const notWaiting = () =>
  new HttpError(409, 'not_waiting', 'That request is not waiting for a decision any more.');

/** Only a decider reaches this (the route's scope). Recorded with who and when. */
export async function approve(deps: ListDeps, id: number, by: string): Promise<void> {
  const row = await requestRow(deps.db, id);
  if (row.status !== 'pending') throw notWaiting();
  const email = openWithDek(dekOf(deps.ring, row.dek_wrapped), row.email_enc);
  await deps.db.transaction().execute(async (trx) => {
    const existing = await trx
      .selectFrom('users')
      .select('roles')
      .where('email', '=', email)
      .forUpdate()
      .executeTakeFirst();
    // Somebody who already holds a role here keeps it: approving a request
    // must never quietly turn a moderator into a journalist.
    if (existing && existing.roles.length > 0) {
      throw new HttpError(
        409,
        'has_role',
        'That address already has a role on this site. Change it on the Access page first if you mean to.',
      );
    }
    const user = await trx
      .insertInto('users')
      .values({ email, roles: ['journalist'] })
      .onConflict((oc) =>
        oc.column('email').doUpdateSet({ roles: ['journalist'], updated_at: new Date() }),
      )
      .returning('id')
      .executeTakeFirstOrThrow();
    const done = await trx
      .updateTable('journalist_access_requests')
      .set({ status: 'approved', decided_at: new Date(), decided_by: by, user_id: user.id })
      .where('id', '=', id)
      .where('status', '=', 'pending')
      .executeTakeFirst();
    if (!done.numUpdatedRows) throw notWaiting();
    await recordRoleChange(trx, {
      actorEmail: by,
      subjectEmail: email,
      axis: 'system',
      action: 'grant',
      detail: 'journalist',
    });
  });
  // After the commit: a failed email does not undo an approval.
  const newest = await newestText(deps.db, 'journalist');
  const accepted = newest !== undefined && (await hasAccepted(deps.db, 'journalist', email));
  await deps.mailer
    .send({ to: email, ...approvedEmail(deskLinkFor(deps.siteOrigin), accepted) })
    .catch(() => undefined);
}

/**
 * The request stays as "not approved" and what it said is wiped; the
 * subscription stays (decision 80). The person may apply again.
 */
export async function reject(deps: ListDeps, id: number, by: string): Promise<void> {
  const row = await requestRow(deps.db, id);
  if (row.status !== 'pending') throw notWaiting();
  const dek = dekOf(deps.ring, row.dek_wrapped);
  const email = openWithDek(dek, row.email_enc);
  const done = await deps.db
    .updateTable('journalist_access_requests')
    .set({
      status: 'rejected',
      decided_at: new Date(),
      decided_by: by,
      details_enc: wrapDek(dek, Buffer.from('{}', 'utf8')),
    })
    .where('id', '=', id)
    .where('status', '=', 'pending')
    .executeTakeFirst();
  if (!done.numUpdatedRows) throw notWaiting();
  await deps.mailer.send({ to: email, ...rejectedEmail() }).catch(() => undefined);
}

/** J13. Effective on the journalist's next request. */
export async function revoke(
  deps: ListDeps,
  id: number,
  actor: { email: string; roles: readonly SystemRole[] },
): Promise<void> {
  const row = await requestRow(deps.db, id);
  if (row.status !== 'approved') {
    throw new HttpError(
      409,
      'not_approved',
      'Only an approved journalist can have access taken away.',
    );
  }
  const email = openWithDek(dekOf(deps.ring, row.dek_wrapped), row.email_enc);
  const current = await deps.db
    .selectFrom('users')
    .select('roles')
    .where('email', '=', email)
    .executeTakeFirst();
  // The same path every role change takes, so the revoke is in role_audit.
  if (current?.roles.includes('journalist')) {
    const out = await changeSystemRole(deps.db, {
      actor,
      email,
      role: 'journalist',
      action: 'revoke',
    });
    if (!out.ok) throw new HttpError(403, 'forbidden', 'That account cannot be changed here.');
  }
  await deps.db
    .updateTable('journalist_access_requests')
    .set({ status: 'revoked', revoked_at: new Date(), revoked_by: actor.email })
    .where('id', '=', id)
    .execute();
  await deps.mailer.send({ to: email, ...endedEmail() }).catch(() => undefined);
}
