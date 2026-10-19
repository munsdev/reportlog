import { describe, expect, it } from 'vitest';
import {
  ageRecipients,
  backupHealth,
  backupName,
  backupTime,
  badRecipients,
  checkDir,
  ours,
  prune,
} from '../../src/jobs/backup-files.ts';

const at = (iso: string) => new Date(iso);

describe('backup names', () => {
  it('carry the moment, sort as text and round-trip', () => {
    const name = backupName(at('2026-10-19T03:04:05.678Z'));
    expect(name).toBe('reportlog-2026-10-19T03-04-05Z.dump');
    expect(backupTime(name)?.toISOString()).toBe('2026-10-19T03:04:05.000Z');
    expect(name).not.toContain(':');
  });

  it('are not mistaken for anything else in the directory', () => {
    for (const other of [
      'reportlog-2026-10-19T03-04-05Z.dump.partial',
      'reportlog-2026-10-19T03-04-05Z.dump.age',
      'before-upgrade.dump',
      'reportlog-2026-13-45T99-99-99Z.dump',
    ]) {
      expect(backupTime(other), other).toBeUndefined();
    }
  });
});

describe('pruning', () => {
  const names = [
    'reportlog-2026-10-17T03-00-00Z.dump',
    'by-hand-before-upgrade.dump',
    'reportlog-2026-10-19T03-00-00Z.dump',
    'reportlog-2026-10-18T03-00-00Z.dump',
    'reportlog-2026-10-19T03-00-00Z.dump.partial',
  ];

  it('keeps the newest and deletes only files it named', () => {
    expect(ours(names)[0]).toBe('reportlog-2026-10-19T03-00-00Z.dump');
    expect(prune(names, 2)).toEqual(['reportlog-2026-10-17T03-00-00Z.dump']);
    expect(prune(names, 14)).toEqual([]);
  });

  it('never deletes the backup just taken, whatever the setting says', () => {
    expect(prune(names, 0)).toHaveLength(2);
    expect(prune(names, -3)).not.toContain('reportlog-2026-10-19T03-00-00Z.dump');
  });
});

describe('backup health', () => {
  const now = at('2026-10-19T12:00:00Z');
  it('distinguishes never, too old and fine', () => {
    expect(backupHealth([], now, 48)).toEqual({ state: 'none' });
    expect(backupHealth(['reportlog-2026-10-19T03-00-00Z.dump'], now, 48)).toMatchObject({
      state: 'ok',
      ageHours: 9,
    });
    expect(backupHealth(['reportlog-2026-10-16T03-00-00Z.dump'], now, 48)).toMatchObject({
      state: 'stale',
    });
  });
});

describe('where backups may go', () => {
  it('refuses the root and anywhere inside the code', () => {
    expect(checkDir('/', '/srv/reportlog/current').ok).toBe(false);
    expect(checkDir('/srv/app/apps/web/dist', '/srv/app').ok).toBe(false);
    expect(checkDir('/srv/app', '/srv/app').ok).toBe(false);
    expect(checkDir('/var/backups/reportlog', '/srv/app')).toEqual({
      ok: true,
      target: '/var/backups/reportlog',
    });
    // A sibling whose name merely starts the same is not inside.
    expect(checkDir('/srv/app-backups', '/srv/app').ok).toBe(true);
  });
});

describe('encryption recipients', () => {
  const key = 'age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p';
  it('accepts age public keys separated by spaces or commas', () => {
    expect(ageRecipients(`${key}, ${key}\n${key}`)).toHaveLength(3);
    expect(ageRecipients(undefined)).toEqual([]);
    expect(badRecipients([key])).toEqual([]);
  });

  it('rejects anything that is not one, including a private key pasted by mistake', () => {
    expect(badRecipients(['ssh-ed25519', 'AGE-SECRET-KEY-1QQQ', 'age1short'])).toHaveLength(3);
  });
});
