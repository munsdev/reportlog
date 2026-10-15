/**
 * Whether this deployment publishes, and whether it distributes.
 *
 * Delivery-layer settings. They are NOT in the hashed object and the chain
 * does not know they exist — see migration 009 for why that is not an
 * oversight. A report's seal records what was reported and what the
 * reporter permitted; whether an operator had the board switched on this
 * week is neither.
 *
 * Two gates, and both must be open:
 *
 *   `may_publish`  the reporter's answer, inside the fingerprint, permanent.
 *   this           the operator's answer, outside it, changeable any day.
 *
 * A reporter permitting publication does not oblige a deployment to
 * publish. A deployment willing to publish cannot publish what the reporter
 * did not permit. Neither substitutes for the other, and neither substitutes
 * for a moderator, who is still the only way anything becomes public at all.
 *
 * Cached the same way and for the same reason as the attachment settings:
 * these are read on request paths that run constantly, they change roughly
 * never, and a board that takes a extra query per view to ask a question
 * whose answer was the same all day is a cost with nothing bought.
 */
import { pool } from './db.js';

// Overridable so the database suite can watch a switch take effect without
// waiting out a cache three times. It is not a tuning knob and nothing in a
// deployment should set it: the default is the value that ships.
const SETTINGS_TTL_MS = Number(process.env.PUBLICATION_SETTINGS_TTL_MS ?? 30 * 1000);
let settingsCache = { at: 0, row: null };

export async function publicationSettings() {
  if (Date.now() - settingsCache.at < SETTINGS_TTL_MS) return settingsCache.row;
  try {
    const { rows } = await pool.query(
      'SELECT public_archive_enabled, distribution_enabled FROM site_settings WHERE id = true',
    );
    settingsCache = { at: Date.now(), row: rows[0] || null };
  } catch {
    // A database that cannot answer must not change what either switch
    // means. Falling through with a null row gives the documented
    // no-opinion defaults, which is where both lived before the columns
    // existed: the archive publishes, nothing distributes.
    settingsCache = { at: Date.now(), row: null };
  }
  return settingsCache.row;
}

export function clearPublicationSettingsCache() {
  settingsCache = { at: 0, row: null };
}

/**
 * NULL resolves to ON, because that is what the software already does and a
 * migration must not empty a running board.
 */
export function publicArchiveEnabled(settings) {
  const stored = settings?.public_archive_enabled;
  return stored === null || stored === undefined ? true : stored === true;
}

/**
 * NULL resolves to OFF. Nothing distributes today, and no deployment may
 * start distributing because a migration ran or a column defaulted. Only an
 * operator saying yes turns this on.
 */
export function distributionEnabled(settings) {
  return settings?.distribution_enabled === true;
}

export async function publicArchiveAvailable() {
  return publicArchiveEnabled(await publicationSettings());
}

export async function distributionAvailable() {
  return distributionEnabled(await publicationSettings());
}

/**
 * The guard for every route that shows the archive to somebody.
 *
 * It answers 200 with `published: false` rather than 404 or 403. A
 * deployment that has switched publication off has not lost its archive and
 * is not refusing this particular caller — it is telling anybody who asks
 * that it does not publish, which is a true and useful answer and the one a
 * client can render. A 404 would say the route is gone; a 403 would say
 * come back with credentials. Neither is what happened.
 */
export const PUBLICATION_OFF = {
  published: false,
  reason: 'This deployment does not publish a public archive.',
};
