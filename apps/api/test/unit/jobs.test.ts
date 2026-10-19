import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { JOBS, timerUnit } from '../../src/jobs/registry.ts';
import { NOT_SWEPT, SWEPT } from '../../src/jobs/sweep.ts';

const SYSTEMD = new URL('../../../../deploy/systemd/', import.meta.url);
const unit = (name: string) => readFileSync(new URL(name, SYSTEMD), 'utf8');

describe('the job registry and the timers on disk', () => {
  it('has a timer for every job, exactly as the registry describes it', () => {
    for (const job of JOBS) expect(unit(`reportlog-${job.name}.timer`)).toBe(timerUnit(job));
  });

  it('has no timer for a job that does not exist', () => {
    const timers = readdirSync(SYSTEMD).filter((f) => f.endsWith('.timer'));
    expect(timers.sort()).toEqual(JOBS.map((j) => `reportlog-${j.name}.timer`).sort());
  });

  it('names each job once', () => {
    expect(new Set(JOBS.map((j) => j.name)).size).toBe(JOBS.length);
  });

  it('keeps the two sweeps as two jobs', () => {
    const sweep = JOBS.find((j) => j.name === 'sweep');
    const lists = JOBS.find((j) => j.name === 'lists-sweep');
    expect(sweep?.owner).toBe('H');
    expect(lists?.owner).toBe('E');
  });

  it('runs every daily job at boot if the machine was off when it was due', () => {
    for (const job of JOBS.filter((j) => j.onCalendar.startsWith('*-*-* 0'))) {
      expect(job.persistent, job.name).toBe(true);
    }
  });
});

describe('the credential sweep', () => {
  it('never names a list table: the lists sweep erases columns, this deletes rows', () => {
    for (const { table } of SWEPT) expect(table).not.toMatch(/^list/);
  });

  it('never names a table the archive keeps forever', () => {
    const permanent = [
      'reports',
      'report_heads',
      'logbooks',
      'logbook_fields',
      'logbook_forms',
      'attachments',
      'report_attachments',
      'consent_texts',
      'chain_anchors',
      'chain_anchor_heads',
      'schema_migrations',
    ];
    for (const { table } of SWEPT) expect(permanent).not.toContain(table);
  });

  it('decides about each table once', () => {
    const all = [...SWEPT.map((s) => s.table), ...NOT_SWEPT.map((s) => s.table)];
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('the systemd units', () => {
  const services = readdirSync(SYSTEMD).filter((f) => f.endsWith('.service'));

  it.each(services)('%s runs as the service user, confined', (name) => {
    const text = unit(name);
    expect(text).toMatch(/^User=reportlog$/m);
    for (const line of [
      'NoNewPrivileges=yes',
      'ProtectSystem=strict',
      'ProtectHome=yes',
      'PrivateTmp=yes',
      'CapabilityBoundingSet=',
    ]) {
      expect(text).toContain(`\n${line}\n`);
    }
    expect(text).not.toMatch(/^MemoryDenyWriteExecute/m);
  });

  it('lets the API, the jobs and the alert write their state directory and nothing else', () => {
    for (const name of [
      'reportlog-api.service',
      'reportlog-job@.service',
      'reportlog-alert@.service',
    ]) {
      expect(unit(name).match(/^ReadWritePaths=.*$/gm)).toEqual([
        'ReadWritePaths=/var/lib/reportlog',
      ]);
    }
    expect(unit('reportlog-job@backup.service.d/backup.conf')).toMatch(
      /^ReadWritePaths=\/var\/backups\/reportlog$/m,
    );
  });

  it("will not start the API on a contact key other than the archive's own", () => {
    expect(unit('reportlog-api.service')).toMatch(
      /^ExecStartPre=.*apps\/api\/src\/jobs\/cli\.ts contact-key$/m,
    );
  });

  it('runs the code from the current release, never from a fixed release', () => {
    for (const name of services)
      expect(unit(name)).toContain('WorkingDirectory=/srv/reportlog/current');
  });
});
