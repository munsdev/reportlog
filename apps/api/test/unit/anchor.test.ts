/**
 * The anchor's pure parts: its settings, the doctor's thresholds, and the
 * rule that no address reaches a log line. The legacy settings-panel checks
 * of `translog-selftest` become configuration checks here, because the
 * rebuild takes the log's address and key from configuration.
 */
import { describe, expect, it } from 'vitest';
import { describeContradictions } from '../../src/anchor/anchor.ts';
import { anchorFinding, anchorHealth } from '../../src/anchor/health.ts';
import { logSettingsFrom } from '../../src/anchor/job.ts';
import { countsDigestMatches, countsRecord } from '../../src/anchor/records.ts';
import { hostOf, remotes, scrub } from '../../src/anchor/translog.ts';
import { loadConfig } from '../../src/config.ts';

const base = { DATABASE_URL: 'postgres://x/y' };

describe('the settings that decide whether the proof leaves this server', () => {
  it("defaults to DFN's authority, in Germany", () => {
    expect(loadConfig(base).TSA_URL).toBe('https://zeitstempel.dfn.de');
    // An empty line in an env file is "not set".
    expect(loadConfig({ ...base, TSA_URL: '', TRANSPARENCY_LOG_DIR: '' })).toMatchObject({
      TSA_URL: 'https://zeitstempel.dfn.de',
    });
  });

  it('several mirrors are kept, in order, because one host can be compelled', () => {
    const c = loadConfig({
      ...base,
      TRANSPARENCY_LOG_REMOTES: 'git@codeberg.org:org/log.git, https://u:t@github.com/org/log.git',
    });
    expect(c.TRANSPARENCY_LOG_REMOTES).toEqual([
      'git@codeberg.org:org/log.git',
      'https://u:t@github.com/org/log.git',
    ]);
  });

  it.each([
    ['TRANSPARENCY_LOG_REMOTES', 'not a url'],
    ['TRANSPARENCY_LOG_DIR', 'relative/path'],
    ['TSA_URL', 'http://insecure.example/'],
    ['TRANSPARENCY_LOG_BRANCH', 'has spaces'],
    ['TRANSPARENCY_LOG_SSH_KEY', 'key'],
  ])('refuses a bad %s with its name', (key, value) => {
    expect(() => loadConfig({ ...base, [key]: value })).toThrow(new RegExp(key));
  });

  it('a stand-in authority on this machine may be plain http', () => {
    expect(loadConfig({ ...base, TSA_URL: 'http://127.0.0.1:8318/' }).TSA_URL).toBe(
      'http://127.0.0.1:8318/',
    );
  });

  it('without a checkout the job says so, rather than anchoring into nowhere', () => {
    expect(logSettingsFrom(loadConfig(base))).toMatch(/TRANSPARENCY_LOG_DIR is not set/);
    expect(
      logSettingsFrom(loadConfig({ ...base, TRANSPARENCY_LOG_DIR: '/var/lib/reportlog/log' })),
    ).toMatchObject({
      dir: '/var/lib/reportlog/log',
      branch: 'main',
    });
  });
});

describe('no address reaches a log line', () => {
  const list = remotes({
    remotes: [
      'https://anchor:s3cret@github.com/org/log.git',
      'git@codeberg.org:org/log.git',
      '/srv/mirror.git',
    ],
  });

  it('a remote is named by position and host', () => {
    expect(list.map((r) => r.label)).toEqual([
      'remote 1 (github.com)',
      'remote 2 (codeberg.org)',
      'remote 3 (a local path)',
    ]);
    expect(hostOf('ssh://git@example.org:2222/x.git')).toBe('example.org');
  });

  it("git's own words lose the address and anything that looks like a credential", () => {
    const said = scrub(
      "fatal: unable to access 'https://anchor:s3cret@github.com/org/log.git/': 403\n" +
        'remote: see https://other:token@host.example/ for details',
      list,
    );
    expect(said).not.toContain('s3cret');
    expect(said).not.toContain('token');
    expect(said).toContain('remote 1 (github.com)');
  });
});

describe('the refusal, in words', () => {
  it('names each logbook that went and each chain that shrank', () => {
    const lines = describeContradictions(
      { dropped: ['gone'], shrunk: [{ logbook: 'short', was: 5, now: 2 }] },
      'in the log',
    );
    expect(lines).toEqual([
      'Logbook "gone" was in the last anchor in the log and is gone.',
      'Logbook "short" had 5 report(s) in the last anchor in the log and now has 2.',
    ]);
  });
});

describe("the doctor's judgement", () => {
  const now = new Date('2026-11-05T10:00:00Z');
  const run = (outcome: string) => ({
    outcome,
    detail: 'what it said',
    finished_at: '2026-11-05T04:10:00Z',
  });

  it('reads a date as the start of that day, and stale after 36 hours by default', () => {
    expect(anchorHealth('2026-11-05', { now })).toMatchObject({ state: 'ok', ageHours: 10 });
    expect(anchorHealth('2026-11-04', { now })).toMatchObject({ state: 'ok', ageHours: 34 });
    expect(anchorHealth('2026-11-03', { now })).toMatchObject({ state: 'stale', ageHours: 58 });
    expect(anchorHealth(null, { now }).state).toBe('never');
  });

  it('never anchored is fine with nothing to anchor, and a failure with reports', () => {
    const never = anchorHealth(null, { now });
    expect(anchorFinding(never, { hasReports: false, lastRun: null, remotes: 1 }).status).toBe(
      'ok',
    );
    expect(anchorFinding(never, { hasReports: true, lastRun: null, remotes: 1 }).detail).toMatch(
      /NOTHING HAS EVER BEEN ANCHORED/,
    );
  });

  it('a refusal outranks everything, even a fresh anchor', () => {
    const f = anchorFinding(anchorHealth('2026-11-05', { now }), {
      hasReports: true,
      lastRun: run('refused'),
      remotes: 2,
    });
    expect(f.status).toBe('fail');
    expect(f.detail).toMatch(/REFUSED.*deleting reports/);
  });

  it.each([
    ['published', 2, 'ok'],
    ['partly_published', 2, 'warn'],
    ['not_published', 2, 'fail'],
    ['published', 0, 'fail'],
  ])('a fresh anchor whose last run %s with %d remote(s) is %s', (outcome, remotes, status) => {
    expect(
      anchorFinding(anchorHealth('2026-11-05', { now }), {
        hasReports: true,
        lastRun: run(outcome),
        remotes,
      }).status,
    ).toBe(status);
  });

  it('a stale anchor fails and quotes the last run', () => {
    const f = anchorFinding(anchorHealth('2026-11-01', { now }), {
      hasReports: true,
      lastRun: run('failed'),
      remotes: 1,
    });
    expect(f.status).toBe('fail');
    expect(f.detail).toMatch(/NOT BEEN ANCHORED FOR .* HOURS.*what it said/);
  });
});

describe('the counts file', () => {
  const doc = {
    reportlog_list_aggregates: 1,
    generated_at: '2026-11-05T04:00:00.000Z',
    window: { since: null, until: null },
    lists: [
      {
        slug: 'checkins',
        title: 'Check-ins',
        aggregates_published: true,
        definition: [{ key: 'state', label: 'State', kind: 'choice', options: ['ok', 'help'] }],
        totals: { received: 3, approved: 2, rejected: 1, last_entry: '2026-11-04T20:00:00.000Z' },
        fields: [
          {
            key: 'state',
            label: 'State',
            kind: 'choice',
            values: [{ value: 'ok', received: 3, approved: 2 }],
          },
        ],
        // A field the list module might add for a screen one day.
        screen_only: 'never published',
      },
    ],
  };

  it('carries only the named fields, and a digest anybody can recompute', () => {
    const rec = countsRecord('2026-11-05', doc);
    expect(JSON.stringify(rec)).not.toMatch(/screen_only|rejected|last_entry|generated_at/);
    expect(countsDigestMatches(rec)).toBe(true);
    expect(countsDigestMatches({ ...rec, date: '2026-11-06' })).toBe(false);
  });
});
