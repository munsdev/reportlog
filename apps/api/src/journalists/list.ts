/**
 * The journalist alert list: who is on it, and how they get on and off.
 *
 * WHAT IS KEPT, AND HOW. A name, an outlet (empty for somebody not asking
 * for desk access), an address and the states covered, nothing else. The first three are encrypted under a key of the
 * row's own, wrapped by CONTACT_KEY, exactly as a reporter's contact details
 * are (filing/contactKeys.ts). The keyed digest of the address finds a
 * subscriber and keeps one address from being listed twice, so nothing needs
 * the address in the clear except sending an email to it. Nothing here logs
 * or returns an address, and no moderator screen reads this table: a
 * subscriber's details are not part of any report.
 *
 * DOUBLE OPT-IN. A signup makes a `pending` row and emails a link. The row is
 * only on the list (`active`, and so only emailed alerts) after the BUTTON on
 * the link's page is pressed. Opening the link changes nothing: mail
 * scanners open every link in a message.
 *
 * ONE ANSWER FOR EVERY SIGNUP. Whether the address was new, pending, or
 * already listed, the visitor is told the same thing, so the form cannot be
 * used to learn who is on the list.
 *
 * ALERTS ARE A SETTING, LEAVING IS SEPARATE (owner decision 47). The link in
 * an alert, and the desk, change the states and turn alerts off or on
 * (`alerts_paused_at`). Paused is not pending: `status` stays `active`, so a
 * paused subscriber keeps their access request and their desk. Only removing
 * yourself from the list entirely (`removeSubscribers`) ends those.
 *
 * ONE SIGN-UP FOR ALERTS, DESK ACCESS, OR BOTH (owner decision 69). The
 * form may carry a request for desk access; it is written with the pending
 * row, under the row's key, and the owner sees it only once the address is
 * confirmed (vetting.ts asks). Somebody who wants only the desk signs up
 * with alerts off, and so may cover no states.
 *
 * BEING LISTED GRANTS NOTHING. No role, session or permission is created
 * here, and nothing outside this folder reads the table to decide access.
 */
import { isSubdivisionCode, placeLabel } from '@reportlog/fields';
import type {
  AccessRequestBody,
  AlertLink,
  AlertSettings,
  AlertSettingsBody,
  JournalistSignup,
} from '@reportlog/contracts';
import { sql, type Kysely } from 'kysely';
import { randomBytes } from 'node:crypto';
import type { DB } from '../db/schema.gen.ts';
import type { Mailer } from '../email/mailer.ts';
import {
  emailDigest,
  emailDigests,
  openWithDek,
  tryUnwrap,
  wrapDek,
  type ContactKeyring,
} from '../filing/contactKeys.ts';
import { HttpError } from '../http/errors.ts';
import { partlyHidden } from '../identity/digestStop.ts';
import { addressFrom } from '../identity/http.ts';
import { recordRoleChange } from '../identity/roles.ts';
import { randomToken, sha256Hex } from '../identity/secrets.ts';
import { deskFrom, deskOf, writeRequest } from './request.ts';

export const CONFIRM_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const STOP_LINK_TTL_MS = 90 * 24 * 60 * 60 * 1000;

const TOKEN = /^[a-f0-9]{64}$/;

/** 'request' opens the access request form (vetting.ts). */
export type LinkPurpose = 'confirm' | 'stop' | 'request';

export interface ListDeps {
  db: Kysely<DB>;
  mailer: Mailer;
  siteOrigin: string;
  ring: ContactKeyring;
}

/** The thread key of one row, under the current wrapping key or, mid-rotation, the previous. */
export function dekOf(ring: ContactKeyring, wrapped: Buffer): Buffer {
  const dek =
    tryUnwrap(ring.wrapKey, wrapped) ??
    (ring.previous ? tryUnwrap(ring.previous.wrapKey, wrapped) : null);
  if (!dek) throw new Error('A subscriber key opens under no CONTACT_KEY this site has.');
  return dek;
}

/** Encrypt a short text under a row's own key (the same AES-GCM the contact details use). */
const seal = (dek: Buffer, text: string) => wrapDek(dek, Buffer.from(text, 'utf8'));

export async function issueLink(
  db: Kysely<DB>,
  subscriberId: number,
  purpose: LinkPurpose,
): Promise<string> {
  const token = randomToken();
  await db
    .insertInto('journalist_links')
    .values({
      token_hash: sha256Hex(token),
      subscriber_id: subscriberId,
      purpose,
      expires_at: new Date(
        Date.now() + (purpose === 'stop' ? STOP_LINK_TTL_MS : CONFIRM_LINK_TTL_MS),
      ),
    })
    .execute();
  return token;
}

export const confirmLinkFor = (siteOrigin: string, token: string) =>
  `${siteOrigin}/journalists/confirm/${token}`;
export const stopLinkFor = (siteOrigin: string, token: string) =>
  `${siteOrigin}/journalists/stop/${token}`;
/* The change page takes the same token as the stop link: it can do no more
   than the stop page already offers, and every stop link ever emailed then
   opens it too. */
export const settingsLinkFor = (siteOrigin: string, token: string) =>
  `${siteOrigin}/journalists/settings/${token}`;

export function confirmationEmail(
  link: string,
  asksAccess = false,
): { subject: string; text: string } {
  return {
    subject: 'Confirm your place on the journalist alert list',
    text: [
      'Somebody asked for this address to be added to the journalist alert list.',
      '',
      'To be added, open this link and press the button on the page:',
      link,
      '',
      ...(asksAccess
        ? [
            'Pressing it also sends your request for access to the journalist desk to the owner of this site, who reads every request.',
            '',
          ]
        : []),
      'Nothing happens until you press it. If it was not you, ignore this email and the address is never added.',
    ].join('\n'),
  };
}

/**
 * TAKE SUBSCRIBERS OFF THE LIST, and with them any desk access (owner
 * decision 46). Every delete of a subscriber goes through here, so no path
 * can leave an approved journalist reading the desk after leaving the list.
 *
 * NOT `setSystemRole`. That refuses anyone but the owner for `journalist`,
 * and must keep refusing: loosening it for this caller loosens it for all.
 * This can do exactly one thing, journalist taken off the roles, for the account an
 * approved request names, and the WHERE says so: it cannot touch any other
 * role. role_audit records it as the owner's revoke is recorded, `revoke`
 * of `journalist`, with the journalist's own address as the actor, because
 * leaving is theirs (the stop link was emailed to them).
 *
 * The request itself goes with the row (ON DELETE CASCADE).
 */
export async function removeSubscribers(db: Kysely<DB>, ids: readonly number[]): Promise<void> {
  if (!ids.length) return;
  await db.transaction().execute(async (trx) => {
    const ended = await trx
      .updateTable('users')
      .set({
        roles: sql<string[]>`array_remove(roles, 'journalist')`,
        updated_at: new Date(),
      })
      .where(sql<boolean>`roles @> ARRAY['journalist']::text[]`)
      .where('id', 'in', (q) =>
        q
          .selectFrom('journalist_access_requests')
          .select('user_id')
          .where('subscriber_id', 'in', ids)
          .where('status', '=', 'approved')
          .where('user_id', 'is not', null)
          .$narrowType<{ user_id: number }>(),
      )
      .returning('email')
      .execute();
    for (const { email } of ended) {
      await recordRoleChange(trx, {
        actorEmail: email,
        subjectEmail: email,
        axis: 'system',
        action: 'revoke',
        detail: 'journalist',
      });
    }
    await trx.deleteFrom('journalist_subscribers').where('id', 'in', ids).execute();
  });
}

/**
 * Place codes the form may send: US states, once each. At least one while
 * alerts are on; with alerts off there may be none (decision 69).
 */
export function checkedStates(states: readonly string[], alerts: 'on' | 'off' = 'on'): string[] {
  const unique = [...new Set(states.map((s) => s.trim().toUpperCase()))];
  if ((alerts === 'on' && !unique.length) || unique.some((s) => !isSubdivisionCode(s))) {
    throw new HttpError(400, 'bad_states', 'Choose at least one state from the list.');
  }
  return unique.sort();
}

/**
 * What the sign-up did, for the route. `listed` is an address already on the
 * list: the visitor is told the same as anyone, and the route emails it the
 * access request link if the form asked for access.
 */
export type SignUpResult = 'new' | 'listed';

export async function signUp(deps: ListDeps, input: JournalistSignup): Promise<SignUpResult> {
  const email = addressFrom(input.email);
  const alerts = input.alerts ?? 'on';
  const states = checkedStates(input.states, alerts);
  const outlet = input.outlet?.trim() ?? '';
  if (alerts === 'off' && !input.access) {
    throw new HttpError(
      400,
      'nothing_asked',
      'Choose alerts, access to the journalist desk, or both.',
    );
  }
  if (input.access && !outlet) {
    throw new HttpError(400, 'no_outlet', 'Say which outlet you work for, to ask for desk access.');
  }
  const { db, ring } = deps;

  const known = await db
    .selectFrom('journalist_subscribers')
    .select(['id', 'status'])
    .where('email_hmac', 'in', emailDigests(ring, email))
    .executeTakeFirst();
  // Already listed: say nothing different. Pending: the new details replace the old.
  if (known?.status === 'active') return 'listed';
  if (known) await removeSubscribers(db, [known.id]);

  const dek = randomBytes(32);
  const row = await db.transaction().execute(async (trx) => {
    const inserted = await trx
      .insertInto('journalist_subscribers')
      .values({
        dek_wrapped: wrapDek(ring.wrapKey, dek),
        email_hmac: emailDigest(ring, email),
        email_enc: seal(dek, email),
        name_enc: seal(dek, input.name.trim()),
        outlet_enc: seal(dek, outlet),
        states,
        // Paused from the start: confirming keeps it so (the migration of decision 69).
        ...(alerts === 'off' ? { alerts_paused_at: new Date() } : {}),
      })
      .onConflict((oc) => oc.column('email_hmac').doNothing())
      .returning('id')
      .executeTakeFirst();
    // Written now and shown to the owner only once the address is confirmed.
    if (inserted && input.access) {
      await writeRequest(trx, inserted.id, dek, { ...input.access, outlet });
    }
    return inserted;
  });
  if (!row) return 'new'; // a second request for the same address got there first
  const token = await issueLink(db, row.id, 'confirm');
  try {
    await deps.mailer.send({
      to: email,
      ...confirmationEmail(confirmLinkFor(deps.siteOrigin, token), Boolean(input.access)),
    });
  } catch {
    await removeSubscribers(db, [row.id]);
    throw new HttpError(
      503,
      'mail_failed',
      'We could not send the confirmation email just now. Please try again later.',
    );
  }
  return 'new';
}

async function linkOf(db: Kysely<DB>, token: string, purpose: LinkPurpose) {
  if (!TOKEN.test(token)) return null;
  return db
    .selectFrom('journalist_links as l')
    .innerJoin('journalist_subscribers as s', 's.id', 'l.subscriber_id')
    .leftJoin('journalist_access_requests as q', 'q.subscriber_id', 's.id')
    .select([
      'l.token_hash',
      's.id',
      's.status',
      's.states',
      's.email_enc',
      's.dek_wrapped',
      's.alerts_paused_at',
      'q.status as request_status',
    ])
    .where('l.token_hash', '=', sha256Hex(token))
    .where('l.purpose', '=', purpose)
    .where('l.expires_at', '>', new Date())
    .executeTakeFirst();
}

type LinkRow = NonNullable<Awaited<ReturnType<typeof linkOf>>>;

const addressOf = (ring: ContactKeyring, row: LinkRow) =>
  partlyHidden(openWithDek(dekOf(ring, row.dek_wrapped), row.email_enc));

const namesOf = (states: readonly string[]) => states.map(placeLabel);

/** What a confirmation link would do. Reads only. */
export async function describeConfirm(
  db: Kysely<DB>,
  ring: ContactKeyring,
  token: string,
): Promise<AlertLink> {
  const row = await linkOf(db, token, 'confirm');
  if (!row) return { state: 'gone' };
  const address = addressOf(ring, row);
  const desk = deskFrom(row.request_status);
  return row.status === 'active'
    ? { state: 'confirmed', address, desk }
    : {
        state: 'pending',
        address,
        states: namesOf(row.states),
        alerts: row.alerts_paused_at ? 'off' : 'on',
        desk,
      };
}

/** Put the address on the list. Using the link twice is harmless. */
export async function applyConfirm(
  db: Kysely<DB>,
  ring: ContactKeyring,
  token: string,
): Promise<AlertLink> {
  const row = await linkOf(db, token, 'confirm');
  if (!row) return { state: 'gone' };
  const now = new Date();
  await db.transaction().execute(async (trx) => {
    // The window of the first alert starts now: a new subscriber is not sent a backlog.
    await trx
      .updateTable('journalist_subscribers')
      .set({ status: 'active', confirmed_at: now, last_sent_at: now })
      .where('id', '=', row.id)
      .where('status', '=', 'pending')
      .execute();
    await trx
      .updateTable('journalist_links')
      .set({ used_at: now })
      .where('token_hash', '=', row.token_hash)
      .where('used_at', 'is', null)
      .execute();
  });
  return { state: 'confirmed', address: addressOf(ring, row), desk: deskFrom(row.request_status) };
}

/** What the stop link in an alert would do. Reads only. */
export async function describeStop(
  db: Kysely<DB>,
  ring: ContactKeyring,
  token: string,
): Promise<AlertLink> {
  const row = await linkOf(db, token, 'stop');
  if (!row) return { state: 'gone' };
  const address = addressOf(ring, row);
  return row.alerts_paused_at
    ? { state: 'paused', address }
    : { state: 'active', address, states: namesOf(row.states) };
}

/**
 * Turn alerts off: one POST, so the link works as a one-click unsubscribe.
 * It no longer takes the address off the list (decision 47): the person
 * keeps any desk access, and the page offers full removal separately. A
 * second press keeps the first time.
 */
export async function applyStop(
  db: Kysely<DB>,
  ring: ContactKeyring,
  token: string,
): Promise<AlertLink> {
  const row = await linkOf(db, token, 'stop');
  if (!row) return { state: 'gone' };
  await db
    .updateTable('journalist_subscribers')
    .set({ alerts_paused_at: new Date() })
    .where('id', '=', row.id)
    .where('status', '=', 'active')
    .where('alerts_paused_at', 'is', null)
    .execute();
  return { state: 'paused', address: addressOf(ring, row) };
}

interface SettingsRow {
  id: number;
  states: string[];
  email_enc: Buffer;
  dek_wrapped: Buffer;
  alerts_paused_at: Date | null;
}

async function settingsOf(
  db: Kysely<DB>,
  ring: ContactKeyring,
  row: SettingsRow,
): Promise<AlertSettings> {
  return {
    state: 'open',
    address: partlyHidden(openWithDek(dekOf(ring, row.dek_wrapped), row.email_enc)),
    states: row.states,
    alerts: row.alerts_paused_at ? 'off' : 'on',
    desk: await deskOf(db, row.id),
  };
}

/**
 * Change the states and turn alerts on or off. Turning them back on starts
 * the next window now, as confirming does: a resumed subscriber is not sent
 * the backlog of the weeks they had them off.
 */
async function writeSettings(
  db: Kysely<DB>,
  ring: ContactKeyring,
  id: number,
  body: AlertSettingsBody,
): Promise<AlertSettings> {
  const states = checkedStates(body.states, body.alerts);
  const row = await db
    .updateTable('journalist_subscribers')
    .set(
      body.alerts === 'off'
        ? { states, alerts_paused_at: sql<Date>`coalesce(alerts_paused_at, now())` }
        : {
            states,
            alerts_paused_at: null,
            last_sent_at: sql<Date>`CASE WHEN alerts_paused_at IS NULL THEN last_sent_at ELSE now() END`,
          },
    )
    .where('id', '=', id)
    .where('status', '=', 'active')
    .returning(['id', 'states', 'email_enc', 'dek_wrapped', 'alerts_paused_at'])
    .executeTakeFirst();
  if (!row) return { state: 'gone' };
  return settingsOf(db, ring, row);
}

/** The change page behind the link in an alert. Reads only. */
export async function describeSettings(
  db: Kysely<DB>,
  ring: ContactKeyring,
  token: string,
): Promise<AlertSettings> {
  const row = await linkOf(db, token, 'stop');
  if (row?.status !== 'active') return { state: 'gone' };
  return settingsOf(db, ring, row);
}

export async function changeSettings(
  db: Kysely<DB>,
  ring: ContactKeyring,
  token: string,
  body: AlertSettingsBody,
): Promise<AlertSettings> {
  const row = await linkOf(db, token, 'stop');
  if (!row) return { state: 'gone' };
  return writeSettings(db, ring, row.id, body);
}

/**
 * Ask for desk access from the change page (decision 69): the link proves the
 * address, as the emailed request link does. One waiting or approved is not
 * replaced; one revoked may be asked again, as on the request link.
 */
export async function requestFromSettings(
  db: Kysely<DB>,
  ring: ContactKeyring,
  token: string,
  body: AccessRequestBody,
): Promise<AlertSettings> {
  const row = await linkOf(db, token, 'stop');
  if (row?.status !== 'active') return { state: 'gone' };
  if (row.request_status !== 'pending' && row.request_status !== 'approved') {
    const dek = dekOf(ring, row.dek_wrapped);
    await db.transaction().execute((trx) => writeRequest(trx, row.id, dek, body));
  }
  return settingsOf(db, ring, row);
}

/** Remove yourself from the list entirely: the row, every link and any desk access (decision 46). */
export async function removeByLink(db: Kysely<DB>, token: string): Promise<AlertSettings> {
  const row = await linkOf(db, token, 'stop');
  if (!row) return { state: 'gone' };
  await removeSubscribers(db, [row.id]);
  return { state: 'removed' };
}

/**
 * The desk's own subscription, found by the account's address (its keyed
 * digest), so a journalist changes theirs without an email round-trip and
 * can reach nobody else's.
 */
async function ownSubscription(db: Kysely<DB>, ring: ContactKeyring, email: string) {
  const row = await db
    .selectFrom('journalist_subscribers')
    .select(['id', 'states', 'email_enc', 'dek_wrapped', 'alerts_paused_at'])
    .where('email_hmac', 'in', emailDigests(ring, email))
    .where('status', '=', 'active')
    .executeTakeFirst();
  if (!row) {
    throw new HttpError(404, 'not_listed', 'Your address is not on the journalist alert list.');
  }
  return row;
}

/**
 * The states a signed-in journalist chose for alerts, for the desk's "My
 * states" filter. Empty if their address is not on the list.
 */
export async function deskStates(
  db: Kysely<DB>,
  ring: ContactKeyring,
  email: string,
): Promise<string[]> {
  const row = await db
    .selectFrom('journalist_subscribers')
    .select('states')
    .where('email_hmac', 'in', emailDigests(ring, email))
    .where('status', '=', 'active')
    .executeTakeFirst();
  return row?.states ?? [];
}

export async function deskSettings(
  db: Kysely<DB>,
  ring: ContactKeyring,
  email: string,
): Promise<AlertSettings> {
  return settingsOf(db, ring, await ownSubscription(db, ring, email));
}

export async function changeDeskSettings(
  db: Kysely<DB>,
  ring: ContactKeyring,
  email: string,
  body: AlertSettingsBody,
): Promise<AlertSettings> {
  const { id } = await ownSubscription(db, ring, email);
  return writeSettings(db, ring, id, body);
}
