/**
 * Has the archive been anchored recently enough to still mean anything?
 *
 * WHY THIS FILE EXISTS. `EXPECTED_UNITS` in src/doctor.js checks that
 * `reportlog-anchor.timer` is ENABLED, which catches a deployment that never
 * set it up and nothing else. A timer that is enabled and fires and fails —
 * the timestamp authority unreachable, the transparency-log checkout without
 * a git identity, a push refused by the remote — looks identical to one that
 * is working, from every angle except the newest row in `chain_anchors`.
 *
 * Six days of daily publication were missed in late September with nothing
 * raising a fault. Every public sentence about this archive being checkable
 * is false while that can happen quietly, so the state of the anchor is a
 * thing the software asks about rather than a thing an operator remembers to
 * look at.
 *
 * PURE, AND IT TAKES THE DATE RATHER THAN READING IT, for the same reason
 * src/backup.js splits `backupHealth` out: a function that reaches the
 * database cannot be tested without one, and this is the half worth testing.
 * The query lives in scripts/anchor-watch.js and in the doctor.
 */

/**
 * How old the newest anchor may be before something is wrong.
 *
 * The job runs daily, so 24 hours is the expected gap and anything under
 * about a day and a half is ordinary jitter — a timer that fires at 03:00
 * and takes four minutes is 24h04m apart from itself. 36 hours means one
 * run was skipped entirely, which is the smallest fault worth waking
 * somebody for: at 48 the archive is two days stale in public before anybody
 * is told, and that is already too late to call it a daily anchor.
 */
export const DEFAULT_MAX_AGE_HOURS = 36;

/**
 * The state of the anchor, from the newest anchor date and the time now.
 *
 * `newest` is whatever the database handed back for
 * `max(anchor_date)` — a Date, a date string, or null when the table is
 * empty. A date column with no time in it is the coarsest input this can
 * have, so an age in hours is rounded from midnight of that day and a
 * deployment anchored this morning reads as a few hours old rather than
 * zero. That understates nothing: it can only make the archive look
 * staler than it is, which is the safe direction for an alarm.
 *
 * THREE STATES, AND 'never' IS NOT 'stale'. A deployment that has never
 * anchored may be one that was set up ten minutes ago, and faulting it
 * teaches an operator to ignore this check on the first day they meet it.
 * The caller decides what 'never' deserves, because only the caller knows
 * whether there is anything in the archive yet.
 */
export function anchorHealth(newest, {
  now = new Date(), maxAgeHours = DEFAULT_MAX_AGE_HOURS,
} = {}) {
  if (newest === null || newest === undefined || newest === '') {
    return { state: 'never', ageHours: null, newest: null };
  }
  const at = newest instanceof Date ? newest : new Date(`${String(newest).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(at.getTime())) {
    return { state: 'never', ageHours: null, newest: null };
  }
  const ageHours = Math.round(((now - at) / 3_600_000) * 10) / 10;
  return {
    state: ageHours > maxAgeHours ? 'stale' : 'ok',
    ageHours,
    newest: at.toISOString().slice(0, 10),
  };
}

/**
 * What to say about a stale or missing anchor, in one place.
 *
 * The doctor prints it and anchor-watch.js emails it, and a fault whose
 * wording depends on which noticed it is a fault somebody has to learn
 * twice. `hasReports` is what separates "nothing has happened here yet"
 * from "there is an archive and it is not being timestamped".
 */
export function anchorFault(health, { hasReports = true } = {}) {
  if (health.state === 'ok') return null;
  if (health.state === 'never') {
    if (!hasReports) return null;
    return 'NOTHING HAS EVER BEEN ANCHORED, and this archive holds reports. '
      + 'Until the daily timestamp runs, nothing published here can be shown to be '
      + 'unaltered — which is the one promise it makes.';
  }
  return `THE ARCHIVE HAS NOT BEEN ANCHORED FOR ${health.ageHours} HOURS. `
    + `The newest anchor is dated ${health.newest}. A daily timestamp that stopped `
    + 'looks exactly like one that is working, and every sentence about this archive '
    + 'being checkable is false for the days it missed.';
}
