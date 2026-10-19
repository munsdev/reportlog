/**
 * Has the archive been anchored recently enough to still mean anything?
 *
 * A timer that is enabled, fires, and fails (the authority unreachable, a
 * push refused, a run that refused because a logbook vanished) looks exactly
 * like one that works, from every angle except the newest anchor and the
 * newest run. The old application once missed six days of publication with
 * nothing raising a fault. So the doctor asks, rather than an operator
 * remembering to look.
 *
 * `anchorHealth` and `anchorFinding` are pure and take the time, so every
 * threshold is tested without a database; `checkAnchor` is the one call the
 * doctor (workstream H) makes.
 */
import type { Database } from '../db/database.ts';

export const DEFAULT_MAX_AGE_HOURS = 36;

export interface AnchorHealth {
  state: 'ok' | 'stale' | 'never';
  ageHours: number | null;
  newest: string | null;
}

/**
 * From the newest anchor date and the time now. A date has no time in it, so
 * the age counts from that day's midnight UTC: it can only make the archive
 * look staler than it is, which is the safe direction for an alarm.
 *
 * 36 hours: the job runs daily, so one skipped run is the smallest fault worth
 * waking somebody for. NEVER IS NOT STALE: a deployment set up ten minutes ago
 * has never anchored and is not broken. The caller decides, knowing whether
 * there is anything in the archive yet.
 */
export function anchorHealth(
  newest: string | null,
  {
    now = new Date(),
    maxAgeHours = DEFAULT_MAX_AGE_HOURS,
  }: { now?: Date; maxAgeHours?: number } = {},
): AnchorHealth {
  if (!newest) return { state: 'never', ageHours: null, newest: null };
  const at = new Date(`${newest.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(at.getTime())) return { state: 'never', ageHours: null, newest: null };
  const ageHours = Math.round(((now.getTime() - at.getTime()) / 3_600_000) * 10) / 10;
  return { state: ageHours > maxAgeHours ? 'stale' : 'ok', ageHours, newest: newest.slice(0, 10) };
}

/** The doctor's shape (workstream H's `Finding`). */
export interface AnchorFinding {
  status: 'ok' | 'warn' | 'fail';
  check: 'anchor';
  detail: string;
}

export interface LastRun {
  outcome: string;
  detail: string;
  finished_at: string;
}

export function anchorFinding(
  health: AnchorHealth,
  {
    hasReports,
    lastRun,
    remotes,
  }: { hasReports: boolean; lastRun: LastRun | null; remotes: number },
): AnchorFinding {
  const f = (status: AnchorFinding['status'], detail: string): AnchorFinding => ({
    status,
    check: 'anchor',
    detail,
  });
  // A refusal outranks everything: it means the list of chains contradicts
  // what was published, and it repeats every day until somebody looks.
  if (lastRun?.outcome === 'refused') {
    return f(
      'fail',
      `THE LAST ANCHOR RUN REFUSED (${lastRun.finished_at}): ${lastRun.detail} ` +
        'This is what deleting reports looks like. Find out what happened before anything else.',
    );
  }
  if (health.state === 'never') {
    if (!hasReports) return f('ok', 'nothing anchored yet, and nothing to anchor');
    return f(
      'fail',
      'NOTHING HAS EVER BEEN ANCHORED, and this archive holds reports. Until the daily timestamp runs, ' +
        'nothing published here can be shown to be unaltered. Look at: journalctl -u reportlog-job@anchor',
    );
  }
  if (health.state === 'stale') {
    return f(
      'fail',
      `THE ARCHIVE HAS NOT BEEN ANCHORED FOR ${String(health.ageHours)} HOURS (newest ${health.newest ?? ''}). ` +
        'A daily timestamp that stopped looks exactly like one that works. ' +
        `Look at: journalctl -u reportlog-job@anchor${lastRun ? `. The last run said: ${lastRun.detail}` : ''}`,
    );
  }
  if (!remotes) {
    return f(
      'fail',
      `anchored ${health.newest ?? ''}, and TRANSPARENCY_LOG_REMOTES is not set: the anchors never leave this server, which is the one place they were meant to outlive.`,
    );
  }
  if (lastRun?.outcome === 'not_published' || lastRun?.outcome === 'failed') {
    return f(
      'fail',
      `anchored ${health.newest ?? ''}, and the last run did not publish: ${lastRun.detail}`,
    );
  }
  if (lastRun?.outcome === 'partly_published') {
    return f(
      'warn',
      `anchored ${health.newest ?? ''}; some mirrors were not reached: ${lastRun.detail}`,
    );
  }
  return f('ok', `anchored ${health.newest ?? ''} (${String(health.ageHours)}h ago) and published`);
}

/** What the doctor calls. Reads; never changes anything. */
export async function checkAnchor(
  db: Database,
  {
    now = new Date(),
    maxAgeHours = DEFAULT_MAX_AGE_HOURS,
    remotes,
  }: { now?: Date; maxAgeHours?: number; remotes: number },
): Promise<AnchorFinding> {
  const newest = await db
    .selectFrom('chain_anchors')
    .select((e) => e.fn.max('anchor_date').as('d'))
    .executeTakeFirst();
  const any = await db.selectFrom('reports').select('id').limit(1).executeTakeFirst();
  const run = await db
    .selectFrom('anchor_runs')
    .select(['outcome', 'detail', 'finished_at'])
    .orderBy('id', 'desc')
    .limit(1)
    .executeTakeFirst();
  return anchorFinding(anchorHealth(newest?.d ?? null, { now, maxAgeHours }), {
    hasReports: Boolean(any),
    remotes,
    lastRun: run
      ? {
          outcome: run.outcome,
          detail: run.detail,
          finished_at: new Date(run.finished_at).toISOString(),
        }
      : null,
  });
}
