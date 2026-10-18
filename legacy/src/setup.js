/**
 * First-run setup: whether this deployment has been handed over yet.
 *
 * The problem this exists to solve: a fresh install comes up gated with no
 * curtain password set, and every route that could set one is behind the
 * curtain. The install is locked out of itself. `scripts/set-curtain-password.js`
 * gives the operator running the install a way in; this gives the person
 * they hand it to a way to take ownership.
 *
 * "Needs setup" is the flag alone: setup_completed_at IS NULL. It is NOT
 * also "has no admin", which is what it was first written as. That version
 * could not work, and running it is what showed why: minting the admin is
 * step two of three, so the moment it succeeded the wizard decided it was
 * no longer needed and refused its own last screen — the curtain-password
 * decision, which is the screen the whole feature exists for.
 *
 * The admin check still matters, in the two places where it is the right
 * question: migration 008 marks an existing deployment complete, so this
 * can never open a wizard on a live archive, and the route that mints the
 * admin refuses if one already exists. What the flag answers is "is this
 * handover finished", and only marking it finished may answer that.
 *
 * `has_admin` counts an OWNER as well as an admin. The wizard mints an
 * owner now, so a deployment set up after migration 023 has no row with
 * role 'admin' at all — and a check that missed that would reopen the
 * wizard on a live archive, which is the one dangerous thing here.
 */
import { pool } from './db.js';

export const MIN_CURTAIN_PASSWORD = 8;

export async function setupState() {
  const { rows } = await pool.query(`
    SELECT (SELECT setup_completed_at FROM site_settings WHERE id = true) AS completed_at,
           EXISTS (SELECT 1 FROM users WHERE role IN ('admin', 'owner')) AS has_admin
  `);
  const r = rows[0] || {};
  return {
    completedAt: r.completed_at || null,
    hasAdmin: !!r.has_admin,
    needed: !r.completed_at,
  };
}

export async function setupNeeded() {
  return (await setupState()).needed;
}

export async function markSetupComplete(client = pool) {
  await client.query(
    'UPDATE site_settings SET setup_completed_at = now(), updated_at = now() WHERE id = true AND setup_completed_at IS NULL',
  );
}

/**
 * What the software will accept as a curtain password.
 *
 * Deliberately a floor and not a policy. The curtain is not what protects
 * the archive — it keeps a half-finished deployment off the open internet,
 * and it is shared casually between people who are testing. A composition
 * rule here would buy very little and would push operators toward writing
 * it down, which is the failure that actually happens.
 *
 * What it does refuse is the shapes that mean somebody did not choose one:
 * empty, whitespace, and shorter than it takes to type on purpose.
 */
export function validateCurtainPassword(raw) {
  const password = String(raw ?? '');
  if (!password.trim()) return { ok: false, error: 'Enter a password' };
  if (password.length < MIN_CURTAIN_PASSWORD) {
    return { ok: false, error: `Use at least ${MIN_CURTAIN_PASSWORD} characters` };
  }
  return { ok: true, password };
}
