import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CONFIG_KEYS } from '../../src/config.ts';
import {
  assessBackups,
  assessCertificate,
  assessDisk,
  assessJobUnit,
  assessListen,
  assessMigrations,
  assessNode,
  assessUnattended,
  exitCode,
} from '../../src/jobs/doctor-checks.ts';

describe('the doctor', () => {
  it('fails PostgreSQL listening beyond its socket and the loopback', () => {
    expect(assessListen('').status).toBe('ok');
    expect(assessListen('localhost').status).toBe('ok');
    expect(assessListen('127.0.0.1, ::1').status).toBe('ok');
    expect(assessListen('*').status).toBe('fail');
    expect(assessListen('localhost,10.0.0.5').status).toBe('fail');
  });

  it('fails a migration not applied, and only warns about a database ahead (after a rollback)', () => {
    expect(assessMigrations(['a.sql', 'b.sql'], ['a.sql', 'b.sql']).status).toBe('ok');
    expect(assessMigrations(['a.sql', 'b.sql'], ['a.sql']).status).toBe('fail');
    const ahead = assessMigrations(['a.sql'], ['a.sql', 'b.sql']);
    expect(ahead.status).toBe('warn');
    expect(ahead.detail).toMatch(/rollback/);
  });

  it('warns before a certificate expires and fails when it is nearly gone', () => {
    expect(assessCertificate('x.org', 60).status).toBe('ok');
    expect(assessCertificate('x.org', 15).status).toBe('warn');
    expect(assessCertificate('x.org', 3).status).toBe('fail');
  });

  it('warns at 20% disk and fails at 10%', () => {
    expect(assessDisk('/', 0.5).status).toBe('ok');
    expect(assessDisk('/', 0.15).status).toBe('warn');
    expect(assessDisk('/', 0.05).status).toBe('fail');
  });

  describe('backups', () => {
    const now = new Date('2026-10-19T12:00:00Z');
    const fresh = { state: 'ok', count: 3, newest: 'n', ageHours: 9 } as const;
    const statuses = (input: Parameters<typeof assessBackups>[0]) =>
      assessBackups(input).map((f) => `${f.check}:${f.status}`);

    it('fails no backup, warns no off-site copy', () => {
      expect(
        statuses({
          health: { state: 'none' },
          state: {},
          offsiteConfigured: false,
          now,
          maxAgeHours: 48,
        }),
      ).toEqual(['backup:fail', 'off-site:warn']);
    });

    it('fails an off-site copy that is configured and missing or old', () => {
      expect(
        statuses({ health: fresh, state: {}, offsiteConfigured: true, now, maxAgeHours: 48 }),
      ).toEqual(['backup:ok', 'off-site:fail']);
      const old = { offsite: { at: '2026-10-15T03:00:00Z', key: 'k', bytes: 1 } };
      expect(
        statuses({ health: fresh, state: old, offsiteConfigured: true, now, maxAgeHours: 48 }),
      ).toEqual(['backup:ok', 'off-site:fail']);
    });

    it('is content with a fresh local and off-site copy, and reports the last failure', () => {
      const good = { offsite: { at: '2026-10-19T03:10:00Z', key: 'k', bytes: 1 } };
      expect(
        statuses({ health: fresh, state: good, offsiteConfigured: true, now, maxAgeHours: 48 }),
      ).toEqual(['backup:ok', 'off-site:ok']);
      const failing = { ...good, failure: { at: 'today', step: 'upload', why: 'denied' } };
      expect(
        statuses({ health: fresh, state: failing, offsiteConfigured: true, now, maxAgeHours: 48 }),
      ).toContain('backup:fail');
    });
  });

  it('fails a timer that is off and a job whose last run failed; warns an unbuilt slot', () => {
    const on = {
      job: 'x',
      timerEnabled: 'enabled',
      timerActive: 'active',
      result: 'success',
      lastRun: '',
    };
    expect(assessJobUnit(on, true).status).toBe('ok');
    expect(assessJobUnit(on, false).status).toBe('warn');
    expect(assessJobUnit({ ...on, timerEnabled: 'disabled' }, true).status).toBe('fail');
    expect(assessJobUnit({ ...on, timerEnabled: '' }, true).status).toBe('fail');
    expect(
      assessJobUnit({ ...on, result: 'exit-code', lastRun: 'Mon 2026-10-19 03:30:01 UTC' }, true)
        .status,
    ).toBe('fail');
  });

  it('fails a server without unattended updates and warns when a reboot is waiting', () => {
    const on = 'APT::Periodic::Update-Package-Lists "1";\nAPT::Periodic::Unattended-Upgrade "1";';
    expect(assessUnattended(on, false).map((f) => f.status)).toEqual(['ok']);
    expect(assessUnattended(on, true).map((f) => f.status)).toEqual(['ok', 'warn']);
    expect(assessUnattended(undefined, false)[0]?.status).toBe('fail');
    expect(assessUnattended(on.replace('Upgrade "1"', 'Upgrade "0"'), false)[0]?.status).toBe(
      'fail',
    );
  });

  it('notices Node drifting from the pinned version', () => {
    expect(assessNode('v22.23.3', '22.23.3').status).toBe('ok');
    expect(assessNode('v22.20.0', '22.23.3').status).toBe('warn');
  });

  it('exits non-zero if anything failed, and only then', () => {
    expect(exitCode([{ status: 'warn', check: 'a', detail: '' }])).toBe(0);
    expect(exitCode([{ status: 'fail', check: 'a', detail: '' }])).toBe(1);
  });
});

describe('.env.example', () => {
  const text = readFileSync(new URL('../../../../.env.example', import.meta.url), 'utf8');

  it('documents every setting the server reads', () => {
    const documented = new Set([...text.matchAll(/^(?:# )?([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]));
    expect(CONFIG_KEYS.filter((k) => !documented.has(k))).toEqual([]);
  });

  it('holds no real-looking secret', () => {
    for (const line of text.split('\n').filter((l) => /SECRET|KEY_ID/.test(l) && l.includes('='))) {
      expect(line).toMatch(/=(|0{8}-[0-9-]+|EXAMPLE\w*|example-[\w-]+)$/);
    }
  });
});
