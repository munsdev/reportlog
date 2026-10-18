/**
 * Retention, which in a list belongs to a FIELD and not to a row.
 *
 * THE ROW WAS THE WRONG UNIT, and the handed-in spec is where that shows.
 * It had three unrelated rules — tips expire whole, the link index is
 * durable, check-in counts are permanent — because a tip is two kinds of
 * record glued together and one `expires_at` cannot give the two halves
 * different lifetimes. The link points at public material and is a record
 * about the world. The description, the email and the hashed address are
 * records about people, and the description is personal data about THIRD
 * parties, so dropping the submitter does not anonymize it.
 *
 * Under field classes all three of those rules fall out of one mechanism,
 * and check-ins stop needing a special case: their durable columns ARE the
 * count, so what survives the sweep is the count.
 *
 * A RETENTION PERIOD APPLIES FORWARD ONLY. Rows already collected keep the
 * period they were collected under, which is why the expiry is computed and
 * stored per row on write rather than derived at read time from whatever
 * the configuration happens to say later. Changing the setting changes what
 * the next row gets and nothing about the last one.
 */

export const CLASSES = {
  // Never collected. The field does not exist on this instance, so there is
  // nothing to erase, nothing to disclose on request, and the lightest
  // possible privacy notice.
  ABSENT: 'absent',
  // Collected, then erased in place after the configured period.
  TRANSIENT: 'transient',
  // Never erased. An operator may only choose this for a personal field
  // together with a required email — see fields.js.
  DURABLE: 'durable',
};

export const CLASS_IDS = Object.freeze(Object.values(CLASSES));

/**
 * Ninety days, which is the proposal of record rather than a number with
 * anything behind it. It keeps election material into late January, where
 * thirty days does not.
 *
 * Read from configuration, never written as a literal at a call site, so
 * there is one place to change it and one place to read it from.
 */
export const DEFAULT_PERSONAL_DAYS = 90;

/** The sentinel for "the personal half is durable". */
export const NEVER = 'never';

/**
 * How long the personal half of a list entry lives.
 *
 * Returns a positive integer of days, or `NEVER`. An unparseable or
 * non-positive setting falls back to the default and says so rather than
 * silently meaning "never": a typo in an environment variable must not be
 * able to turn retention off, because the failure is invisible and the data
 * it keeps is the heaviest in the system.
 */
export function personalRetentionDays(env = process.env) {
  const raw = (env.LIST_PERSONAL_DAYS ?? '').toString().trim();
  if (!raw) return DEFAULT_PERSONAL_DAYS;
  if (raw.toLowerCase() === NEVER) return NEVER;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return DEFAULT_PERSONAL_DAYS;
  return n;
}

/**
 * How long a day's hashing secret is kept before the sweep destroys it.
 *
 * Two days, not one: a rate limit that looks back twenty-four hours needs
 * yesterday's secret to still exist at one minute past midnight. Longer
 * than it needs to be is the only cost that matters here, because every
 * extra day is a day in which a hash is still correlatable.
 */
export const DEFAULT_SALT_DAYS = 2;

export function saltRetentionDays(env = process.env) {
  const n = Number((env.LIST_SALT_DAYS ?? '').toString().trim());
  if (!Number.isInteger(n) || n < 1) return DEFAULT_SALT_DAYS;
  return n;
}

/**
 * The value for `personal_expires_at` on a row being written now.
 *
 * `null` means durable, which is the same thing the column means, so there
 * is no second spelling of it.
 */
export function personalExpiresAt(now = new Date(), env = process.env) {
  const days = personalRetentionDays(env);
  if (days === NEVER) return null;
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}

/**
 * The three profiles an operator picks. The classes above are the mechanism;
 * these are the choices, and they are presets over the mechanism rather
 * than a fourth concept.
 */
export const PROFILES = Object.freeze({
  // Nothing personal is collected at all.
  none: { personal: CLASSES.ABSENT, requiresEmail: false },
  // The default: collected, erased after the configured period.
  expiring: { personal: CLASSES.TRANSIENT, requiresEmail: true },
  // Kept indefinitely, which is only available WITH a required email.
  kept: { personal: CLASSES.DURABLE, requiresEmail: true },
});

export const PROFILE_IDS = Object.freeze(Object.keys(PROFILES));
