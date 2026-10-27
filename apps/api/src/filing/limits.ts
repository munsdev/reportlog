/**
 * The limits on filing that an operator may move, and what they are when
 * nobody has: how long a confirmation link works, the day every report
 * contact is deleted, and how many reports one address may send in a day.
 *
 * NULL, OR NO ROW, IS THE DEFAULT BELOW. The defaults live in code so a
 * fresh database is right without a seed row, and so a migration never has
 * to write a value into somebody's settings.
 *
 * NEVER SEALED. None of these is part of a report.
 */
import { createHmac, hkdfSync } from 'node:crypto';
import { sql } from 'kysely';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.gen.ts';
import type { ContactKeyring } from './contactKeys.ts';

/** D15: 90 days. A person who files on a Friday and reads mail on Sunday is fine. */
export const DEFAULT_LINK_DAYS = 90;
/** D4: one date for every report contact. */
export const DEFAULT_CONTACTS_DELETE_ON = '2027-01-31';
/** D5. */
export const DEFAULT_ADDRESS_DAILY_CAP = 5;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface FilingLimits {
  link_days: number;
  /** A calendar day, YYYY-MM-DD, UTC. */
  contacts_delete_on: string;
  address_daily_cap: number;
}

export interface StoredFilingLimits {
  link_days: number | null;
  contacts_delete_on: string | null;
  address_daily_cap: number | null;
}

export async function storedFilingLimits(db: Kysely<DB>): Promise<StoredFilingLimits> {
  // Read as text so a date is the calendar day it is, not a midnight in some zone.
  const row = await sql<StoredFilingLimits>`
    SELECT link_days, address_daily_cap, contacts_delete_on::text AS contacts_delete_on
      FROM filing_settings WHERE id`
    .execute(db)
    .then((r) => r.rows[0]);
  return {
    link_days: row?.link_days ?? null,
    contacts_delete_on: row?.contacts_delete_on ?? null,
    address_daily_cap: row?.address_daily_cap ?? null,
  };
}

export async function filingLimits(db: Kysely<DB>): Promise<FilingLimits> {
  const s = await storedFilingLimits(db);
  return {
    link_days: s.link_days ?? DEFAULT_LINK_DAYS,
    contacts_delete_on: s.contacts_delete_on ?? DEFAULT_CONTACTS_DELETE_ON,
    address_daily_cap: s.address_daily_cap ?? DEFAULT_ADDRESS_DAILY_CAP,
  };
}

/** Null clears a value back to the default. Undefined leaves it alone. */
export async function setFilingLimits(
  db: Kysely<DB>,
  patch: Partial<StoredFilingLimits>,
  by: string,
): Promise<void> {
  const values = {
    ...(patch.link_days !== undefined ? { link_days: patch.link_days } : {}),
    ...(patch.address_daily_cap !== undefined
      ? { address_daily_cap: patch.address_daily_cap }
      : {}),
    ...(patch.contacts_delete_on !== undefined
      ? { contacts_delete_on: patch.contacts_delete_on }
      : {}),
  };
  await db
    .insertInto('filing_settings')
    .values({ id: true, ...values, updated_by: by })
    .onConflict((oc) =>
      oc.column('id').doUpdateSet({ ...values, updated_by: by, updated_at: new Date() }),
    )
    .execute();
}

/** How long a link filed now will work, in milliseconds. */
export async function linkTtlMs(db: Kysely<DB>): Promise<number> {
  return (await filingLimits(db)).link_days * DAY_MS;
}

/** The words for the link's life: "90 days". */
export const linkLife = (days: number): string => (days === 1 ? '1 day' : `${String(days)} days`);

// ── five per address per day ────────────────────────────────────────────

/**
 * THE ANSWER FOR A REPORT TURNED AWAY FOR VOLUME. It does not say which
 * check refused, so it cannot be used to learn how the counting works or
 * whether an address has been seen today.
 */
export const TRY_LATER = 'We could not take this report right now. Please try again tomorrow.';

/**
 * A key for one day, derived from the contact key, so an address digest of
 * Monday matches nothing on Tuesday. The address is never stored: only this
 * digest, beside a count, and only for the day it counts.
 */
function dayKey(ring: ContactKeyring, day: string): Buffer {
  return Buffer.from(
    hkdfSync('sha256', ring.hmacKey, Buffer.from(day), 'reportlog address day v1', 32),
  );
}

export const utcDay = (now: Date = new Date()): string => now.toISOString().slice(0, 10);

/**
 * Count one more report from this address today, and say whether it is over
 * the cap. Run inside the caller's transaction: a refused report rolls the
 * count back with it, so refusals do not push the count up. One statement,
 * so two requests at once cannot both slip under the cap.
 */
export async function countAddressToday(
  trx: Kysely<DB>,
  ring: ContactKeyring,
  email: string,
  cap: number,
  now: Date = new Date(),
): Promise<{ over: boolean }> {
  const day = utcDay(now);
  const digest = createHmac('sha256', dayKey(ring, day))
    .update(email.trim().toLowerCase(), 'utf8')
    .digest('hex');
  const row = await trx
    .insertInto('filing_address_days')
    .values({ day, digest, n: 1 })
    .onConflict((oc) =>
      oc.columns(['day', 'digest']).doUpdateSet({ n: sql`filing_address_days.n + 1` }),
    )
    .returning('n')
    .executeTakeFirstOrThrow();
  return { over: row.n > cap };
}
