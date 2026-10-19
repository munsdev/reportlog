/**
 * Retention, which in a list belongs to a FIELD and not to a row.
 *
 * THE ROW WAS THE WRONG UNIT. A tip is two kinds of record glued together:
 * the link points at public material and is a record about the world; the
 * description, the email and the hashed address are records about people (the
 * description often about THIRD parties, so dropping the submitter does not
 * anonymize it). One `expires_at` cannot give the two halves different
 * lifetimes. Under field classes "tips expire", "the link index is durable"
 * and "check-in counts are permanent" all fall out of one mechanism: a
 * check-in's durable answers ARE the count, so what survives the sweep is the
 * count.
 *
 * A RETENTION PERIOD APPLIES FORWARD ONLY. The expiry is computed and stored
 * per row on write, so changing the setting changes what the next row gets
 * and nothing about the last one.
 *
 * Pure: no database, so the unit suite can reach every rule here.
 */

export const CLASSES = {
  /** Never collected. Nothing to erase, nothing to disclose. */
  ABSENT: 'absent',
  /** Collected, then erased in place after the configured period. */
  TRANSIENT: 'transient',
  /** Never erased by the clock. */
  DURABLE: 'durable',
} as const;

export type Retention = (typeof CLASSES)[keyof typeof CLASSES];
export const RETENTIONS: readonly Retention[] = Object.values(CLASSES);

export function isRetention(v: unknown): v is Retention {
  return RETENTIONS.includes(v as Retention);
}

/**
 * Ninety days, the proposal of record: it keeps election material into late
 * January, where thirty days does not. Read from configuration, never written
 * as a literal at a call site.
 */
export const DEFAULT_PERSONAL_DAYS = 90;

/** The spelling for "the personal half is kept until its holder erases it". */
export const NEVER = 'never';

export type PersonalDays = number | typeof NEVER;

/**
 * How long the personal half of an entry lives, from the raw setting.
 *
 * An unparseable or non-positive value falls back to the default rather than
 * meaning "never": a typo must not be able to turn retention off, because the
 * failure is invisible and the data it keeps is the heaviest in the system.
 * (The server's configuration refuses such a value at start anyway; this is
 * the second line.)
 */
export function personalRetentionDays(raw: string | undefined): PersonalDays {
  const s = (raw ?? '').trim();
  if (!s) return DEFAULT_PERSONAL_DAYS;
  if (s.toLowerCase() === NEVER) return NEVER;
  const n = Number(s);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_PERSONAL_DAYS;
}

/**
 * How long a day's hashing secret is kept before the sweep destroys it. Two
 * days, not one: a limit that looks back a day needs yesterday's secret at one
 * minute past midnight. Every extra day is a day in which a hash is still
 * correlatable.
 */
export const DEFAULT_SALT_DAYS = 2;

export function saltRetentionDays(raw: string | undefined): number {
  const n = Number((raw ?? '').trim());
  return Number.isInteger(n) && n >= 1 ? n : DEFAULT_SALT_DAYS;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** `personal_expires_at` for a row written now. NULL means kept, as the column means. */
export function personalExpiresAt(now: Date, days: PersonalDays): Date | null {
  return days === NEVER ? null : new Date(now.getTime() + days * DAY_MS);
}

/** An erasure link where nothing expires on its own (the "never" setting). */
export const DEFAULT_ERASURE_LINK_DAYS = 365;

/**
 * How long an erasure link lives: AS LONG AS THERE IS SOMETHING TO ERASE. A
 * link that expires before the data does leaves somebody holding a promise the
 * deployment can no longer keep. So it follows the entry's own expiry, and
 * falls back to a window only where there is none.
 */
export function erasureExpiry(
  personalExpires: Date | null,
  now: Date,
  linkDays: number = DEFAULT_ERASURE_LINK_DAYS,
): Date {
  if (personalExpires) return new Date(personalExpires);
  return new Date(now.getTime() + linkDays * DAY_MS);
}

/** Everything about time a list reads, resolved once from configuration. */
export interface ListSettings {
  personalDays: PersonalDays;
  saltDays: number;
  erasureLinkDays: number;
  /** Hosts a reviewer knows; every other host is marked for their eye. */
  knownHosts: readonly string[];
  /** Where a list's new entries go when it names no address of its own. */
  adminEmail: string | null;
}

export const DEFAULT_LIST_SETTINGS: ListSettings = {
  personalDays: DEFAULT_PERSONAL_DAYS,
  saltDays: DEFAULT_SALT_DAYS,
  erasureLinkDays: DEFAULT_ERASURE_LINK_DAYS,
  knownHosts: [],
  adminEmail: null,
};
