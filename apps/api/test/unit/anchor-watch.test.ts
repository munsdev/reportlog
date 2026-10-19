/**
 * anchor-watch: the anchor checked from outside it (legacy
 * scripts/anchor-watch.js). The check is D2's `anchorDoctorCheck`, tested
 * with D2's code; this holds the job to failing exactly when that check
 * fails, so a silent anchor becomes a failed unit and an alert.
 */
import { describe, expect, it, vi } from 'vitest';
import type { AnchorFinding } from '../../src/anchor/health.ts';
import type { JobContext } from '../../src/jobs/context.ts';
import { findJob } from '../../src/jobs/registry.ts';

let next: AnchorFinding;
vi.mock('../../src/anchor/job.ts', () => ({
  anchorDoctorCheck: () => Promise.resolve(next),
}));
const { runAnchorWatch } = await import('../../src/jobs/anchor-watch.ts');

const ctx = {} as JobContext;
const finding = (status: AnchorFinding['status'], detail: string): AnchorFinding => ({
  status,
  check: 'anchor',
  detail,
});

describe('anchor-watch', () => {
  it('fails the unit when the archive has not been anchored', async () => {
    next = finding('fail', 'THE ARCHIVE HAS NOT BEEN ANCHORED FOR 60 HOURS (newest 2026-10-17).');
    expect(await runAnchorWatch(ctx)).toEqual({
      ok: false,
      summary: 'fail: THE ARCHIVE HAS NOT BEEN ANCHORED FOR 60 HOURS (newest 2026-10-17).',
    });
  });

  it('passes a fresh anchor, and a warning, which the doctor shows', async () => {
    next = finding('ok', 'anchored 2026-10-19 (9h ago) and published');
    expect((await runAnchorWatch(ctx)).ok).toBe(true);
    next = finding('warn', 'anchored 2026-10-19; some mirrors were not reached');
    expect((await runAnchorWatch(ctx)).ok).toBe(true);
  });

  it('runs daily, hours after the anchor, and catches up after downtime', () => {
    const job = findJob('anchor-watch');
    expect(job?.onCalendar).toBe('*-*-* 09:00:00');
    expect(job?.persistent).toBe(true);
    expect(findJob('anchor')?.onCalendar).toBe('*-*-* 04:00:00');
  });
});
