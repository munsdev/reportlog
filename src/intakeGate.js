/**
 * Whether this deployment is accepting new reports.
 *
 * THE OTHER END OF THE SITE FROM publication.js. That file governs what
 * leaves the building; this governs what comes into it. The two are
 * deliberately independent switches and neither implies the other:
 *
 *   intake open,   publishing off  — collect now, decide about publishing later
 *   intake closed, publishing on   — the window has shut, the record stays readable
 *   both off                       — a deployment standing by
 *
 * That middle arrangement is the one this was built for: a deployment used
 * as an intake system, where something else entirely is responsible for
 * what gets said publicly afterwards. The operator needs to be able to shut
 * either half without touching the other.
 *
 * NEVER HASHED. Delivery-layer, like the publication switches. A report
 * must not verify differently because the form was closed after it was
 * filed, and nothing in reportCore.js or verify.js may read this.
 *
 * WHAT CLOSING INTAKE DOES NOT DO. It does not hide, unpublish or delete
 * anything already filed; it does not stop a moderator working through the
 * queue; and it does not stop a reporter correcting a report they have
 * already filed. A correction is an amendment to a record this archive
 * already holds, not a new account of a new thing — refusing it would
 * leave the archive knowingly holding a version its own author says is
 * wrong, which is worse than accepting the amendment. Both doors that
 * create NEW reports are closed: the public form, and coordinator batch
 * entry.
 */
import { pool } from './db.js';

// Overridable so the database suite can watch the switch take effect
// without waiting out a cache. Not a tuning knob; nothing in a deployment
// should set it.
const SETTINGS_TTL_MS = Number(process.env.INTAKE_SETTINGS_TTL_MS ?? 30 * 1000);
let cache = { at: 0, row: null };

export async function intakeSettings() {
  if (Date.now() - cache.at < SETTINGS_TTL_MS) return cache.row;
  try {
    const { rows } = await pool.query('SELECT intake_enabled FROM site_settings WHERE id = true');
    cache = { at: Date.now(), row: rows[0] || null };
  } catch {
    // A database that cannot answer must not close the intake. Falling
    // through to the documented default keeps the form working exactly as
    // it did before this column existed — and a report that cannot be
    // filed is evidence that does not get recorded, which is the failure
    // worth avoiding here.
    cache = { at: Date.now(), row: null };
  }
  return cache.row;
}

export function clearIntakeSettingsCache() {
  cache = { at: 0, row: null };
}

/**
 * NULL resolves to OPEN, because that is what the software already does and
 * a migration must not close a running intake.
 */
export function intakeOpen(settings) {
  const stored = settings?.intake_enabled;
  return stored === null || stored === undefined ? true : stored === true;
}

export async function intakeIsOpen() {
  return intakeOpen(await intakeSettings());
}

/** What every refusing route says, in one place so they cannot disagree. */
export const INTAKE_CLOSED = {
  error: 'This archive is not accepting new reports at the moment.',
  intakeClosed: true,
};
