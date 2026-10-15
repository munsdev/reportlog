// The "under active development" notice shown in the corner of the site.
//
// Stored as an expiry (site_settings.dev_mode_until), not a boolean, for
// one reason: a boolean left on by accident quietly trains testers to
// ignore the notice, which is worse than never showing it. An expiry
// switches itself off.
import { pool } from './db.js';
import { APP_VERSION } from './appVersion.js';

export const DEV_MODE_HOURS = 6;

export async function getDevMode() {
  const { rows } = await pool.query('SELECT dev_mode_until FROM site_settings WHERE id = true');
  const until = rows[0]?.dev_mode_until || null;
  return { until, active: Boolean(until && new Date(until) > new Date()) };
}

// hours = null turns it off immediately.
export async function setDevMode(hours) {
  const { rows } = await pool.query(
    `UPDATE site_settings
     SET dev_mode_until = CASE WHEN $1::numeric IS NULL THEN NULL
                               ELSE now() + ($1::numeric * interval '1 hour') END,
         updated_at = now()
     WHERE id = true
     RETURNING dev_mode_until`,
    [hours],
  );
  const until = rows[0]?.dev_mode_until || null;
  return { until, active: Boolean(until && new Date(until) > new Date()) };
}

// Called once at boot. Deploys here are a git pull plus a systemd restart,
// so "the build changed since we last started" is a reliable proxy for
// "something just shipped" — which is exactly when testers should be
// warned that things may be moving under them. Arming on the *version*
// rather than on every start means a crash-restart loop doesn't keep
// re-arming the notice, and it stays armed only for DEV_MODE_HOURS.
export async function armDevModeOnDeploy() {
  const { rows } = await pool.query('SELECT last_seen_version FROM site_settings WHERE id = true');
  if (!rows.length) return { armed: false, reason: 'no-settings-row' };

  const previous = rows[0].last_seen_version;
  if (previous === APP_VERSION) return { armed: false, reason: 'unchanged' };

  // First boot after this migration has no previous version recorded, so
  // there's nothing to compare against — record the build, but don't
  // pretend a deploy just happened and pop the notice at everyone.
  if (previous === null) {
    await pool.query(
      'UPDATE site_settings SET last_seen_version = $1, updated_at = now() WHERE id = true',
      [APP_VERSION],
    );
    return { armed: false, reason: 'first-boot', to: APP_VERSION };
  }

  // GREATEST so a deploy never *shortens* a window an admin set by hand.
  await pool.query(
    `UPDATE site_settings
     SET last_seen_version = $1,
         dev_mode_until = GREATEST(
           COALESCE(dev_mode_until, now()),
           now() + ($2::numeric * interval '1 hour')),
         updated_at = now()
     WHERE id = true`,
    [APP_VERSION, DEV_MODE_HOURS],
  );
  return { armed: true, from: previous, to: APP_VERSION };
}
