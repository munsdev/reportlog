/**
 * Writing a request for desk access, from wherever it is asked: the emailed
 * request link (vetting.ts), the alerts sign-up and the change page behind
 * every alert (list.ts, owner decision 69). Its own file so those two do not
 * import each other.
 *
 * Writing one grants nothing. Only somebody who decides approving it does
 * (vetting.ts): the owner, an administrator or an Access Manager (decision 80).
 */
import type { AccessRequestBody, DeskAccess } from '@reportlog/contracts';
import { sql, type Kysely, type Transaction } from 'kysely';
import type { DB } from '../db/schema.gen.ts';
import type { Mailer } from '../email/mailer.ts';
import { wrapDek } from '../filing/contactKeys.ts';

/** What `details_enc` holds, encrypted under the subscriber's own key. */
export interface Details {
  outlet: string;
  role: string;
  about?: string;
  /** Only on requests sent before the form asked for `about` instead. */
  links?: string[];
  press_card_number?: string;
  press_card_issuer?: string;
}

export function sealedDetails(dek: Buffer, input: AccessRequestBody): Buffer {
  const details: Details = {
    outlet: input.outlet,
    role: input.role,
    about: input.about,
    // Absent, not empty, when not given: the owner sees "none" either way.
    ...(input.press_card_number ? { press_card_number: input.press_card_number } : {}),
    ...(input.press_card_issuer ? { press_card_issuer: input.press_card_issuer } : {}),
  };
  return wrapDek(dek, Buffer.from(JSON.stringify(details), 'utf8'));
}

/**
 * Replace the subscriber's request with this one. The caller has already
 * refused to replace one that is waiting or approved; a revoked one may be
 * asked again.
 */
export async function writeRequest(
  trx: Transaction<DB>,
  subscriberId: number,
  dek: Buffer,
  input: AccessRequestBody,
): Promise<void> {
  await trx
    .deleteFrom('journalist_access_requests')
    .where('subscriber_id', '=', subscriberId)
    .execute();
  await trx
    .insertInto('journalist_access_requests')
    .values({ subscriber_id: subscriberId, details_enc: sealedDetails(dek, input) })
    .execute();
}

/** A request's status as a subscriber's own pages show it. */
export const deskFrom = (status: string | null | undefined): DeskAccess =>
  status === 'pending' || status === 'approved' ? status : 'none';

export async function deskOf(db: Kysely<DB>, subscriberId: number): Promise<DeskAccess> {
  const row = await db
    .selectFrom('journalist_access_requests')
    .select('status')
    .where('subscriber_id', '=', subscriberId)
    .executeTakeFirst();
  return deskFrom(row?.status);
}

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
 * Tell everyone who may decide that a request has reached the queue (decision
 * 80), with no applicant details. Called once a request becomes visible in the
 * queue, from whichever path put it there: the signed-in account, the alerts
 * sign-up once its address is confirmed, the emailed request link, or the
 * change page behind every alert. Only the first path used to tell anybody, so
 * a request made while signed out could sit unseen. A failed email does not
 * undo the request.
 */
export async function tellDeciders(deps: {
  db: Kysely<DB>;
  mailer: Mailer;
  siteOrigin: string;
}): Promise<void> {
  const message = requestWaitingEmail(`${deps.siteOrigin}/access/journalists`);
  for (const to of await deciders(deps.db)) {
    await deps.mailer.send({ to, ...message }).catch(() => undefined);
  }
}
