/**
 * Writing a request for desk access, from wherever it is asked: the emailed
 * request link (vetting.ts), the alerts sign-up and the change page behind
 * every alert (list.ts, owner decision 69). Its own file so those two do not
 * import each other.
 *
 * Writing one grants nothing. Only the owner approving it does (vetting.ts).
 */
import type { AccessRequestBody, DeskAccess } from '@reportlog/contracts';
import type { Kysely, Transaction } from 'kysely';
import type { DB } from '../db/schema.gen.ts';
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
