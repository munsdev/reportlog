import { pool } from './db.js';

export const SITE_ACCESS_COOKIE = 'site_access';

export async function getSiteSettings() {
  const { rows } = await pool.query(
    'SELECT access_enabled, access_password_hash FROM site_settings WHERE id = true',
  );
  // No row means gated, not open.
  //
  // Migration 005 seeds the row, so this should be unreachable on any
  // correctly migrated database. It is here because the failure it guards
  // against is silent and total: a missing row used to read as
  // `access_enabled: false`, which took the gate off an entire deployment
  // with nothing on screen to say so. Failing closed costs an operator one
  // confusing password prompt; failing open costs them the whole site.
  //
  // The null password hash is what makes that safe to do — no password can
  // match a null hash, so an unconfigured deployment refuses everyone
  // rather than admitting anyone.
  /* THE MISSING-ROW CASE IS MARKED, not just defaulted.
     It used to be indistinguishable from a real row with no password set,
     and that mattered the moment the rule below changed: "enabled with no
     password" now means OPEN, and if a missing row still looked like that
     it would reintroduce the exact failure this fallback was written to
     prevent — an entire deployment ungated with nothing on screen saying
     so. A missing row stays closed. */
  return rows[0] || { access_enabled: true, access_password_hash: null, missing: true };
}

/**
 * Is there a gate to get past at all?
 *
 * ONE SENTENCE, IN ONE PLACE, because three callers ask it — the gate
 * itself, the status route the lock screen reads, and the unlock route.
 * When they disagreed, the lock screen sat over an app whose every
 * request succeeded, and nothing on screen explained it.
 *
 * Pure, so `npm test` can put all three states to it directly rather than
 * standing up a deployment to infer them.
 */
export function gateApplies(settings) {
  if (!settings || settings.missing) return true;   // no row: refuse everyone
  if (!settings.access_enabled) return false;       // turned off
  return !!settings.access_password_hash;           // on, but only if there IS a password
}

// Mounted ahead of every other /api/* route except /api/site-access itself
// (see server.js) — a soft, admin-toggleable gate to keep the app off the
// open internet before launch, entirely separate from OTP user auth.
/**
 * Whether this request is past the site password — true on a deployment
 * with no password at all. One answer, used by the gate below and by the few
 * routes in front of it that let a single list or logbook through, so the
 * two cannot disagree about who is inside.
 */
export async function hasSiteAccess(req) {
  const settings = await getSiteSettings();
  if (!settings.access_enabled) return true;

  if (!gateApplies(settings)) return true;
  /* A GATE WITH NO PASSWORD IS NOT A GATE, IT IS A LOCKED DOOR WITH NO KEY.
     `access_enabled` defaults to TRUE in migration 001 and no password is
     set until somebody sets one — so a freshly migrated database is gated
     with a null hash, no password can match a null hash, and NOBODY can
     get in. Including the first-run setup wizard, which is behind this.
     That is the state every new install starts in.
     It went unnoticed because tools/container-setup.sh turns the gate off
     explicitly ("gate off for the browser suite"), so every suite and
     every dev container ran against a deployment that had already stepped
     around it. It was found on a test box the first time a database was wiped
     and migrated without the wizard having run.
     The docstring above has promised this behaviour all along — "true on
     a deployment with no password at all" — and the code simply did not
     do it. This is the code catching up with the sentence.
     IT IS NOT FAILING OPEN. There is nothing here to fail open ABOUT: a
     deployment with no password has not been given one to check, and the
     operator who sets one closes the gate in the same action. The
     dangerous case — no settings row at all — is marked above and still
     refuses everyone. */

  const token = req.cookies?.[SITE_ACCESS_COOKIE];
  if (!token) return false;
  const { rows } = await pool.query(
    'SELECT 1 FROM site_access_tokens WHERE token = $1 AND expires_at > now()',
    [token],
  );
  return rows.length > 0;
}

/** The answer the gate gives, so a route in front of it can give the same one. */
export const LOCKED = Object.freeze({ error: 'Site access required', locked: true });

export async function requireSiteAccess(req, res, next) {
  // Set only by the allow-list in front of this in server.js (src/doors.js):
  // a call the filing form makes for a logbook opened without the password.
  if (req.outsidePass === true) return next();
  if (await hasSiteAccess(req)) return next();
  return res.status(401).json(LOCKED);
}
