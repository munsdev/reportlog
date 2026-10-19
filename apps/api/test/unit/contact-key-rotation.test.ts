/**
 * The deploy's contact-key check, with a planned rotation. H's refusal
 * stands for an unplanned change; a rotation is let through only when the
 * key being rotated FROM is the one this archive recorded.
 */
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkAndRecord, compare, fingerprint, recordRotated } from '../../src/jobs/contact-key.ts';

const key = () => randomBytes(32).toString('base64');

describe('a planned rotation of CONTACT_KEY', () => {
  it('lets a new key through only beside the recorded one, and records nothing yet', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rl-key-'));
    const original = key();
    const next = key();
    await checkAndRecord(original, dir);
    expect((await checkAndRecord(next, dir, original)).state).toBe('rotating');
    expect(readFileSync(join(dir, 'contact-key.sha256'), 'utf8').trim()).toBe(
      fingerprint(original),
    );
  });

  it('still refuses a changed key with no previous one, or beside a key that is not the recorded one', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rl-key-'));
    const original = key();
    await checkAndRecord(original, dir);
    expect((await checkAndRecord(key(), dir)).state).toBe('changed');
    expect((await checkAndRecord(key(), dir, key())).state).toBe('changed');
  });

  it('after the rotation, records the new key, and a left-over previous key is only a reminder', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rl-key-'));
    const original = key();
    const next = key();
    await checkAndRecord(original, dir);
    await recordRotated(next, dir);
    expect(readFileSync(join(dir, 'contact-key.sha256'), 'utf8').trim()).toBe(fingerprint(next));
    expect(await checkAndRecord(next, dir, original)).toEqual({
      state: 'same',
      previousLeftOver: true,
    });
    expect(await checkAndRecord(next, dir)).toEqual({ state: 'same' });
    // And the old key alone is now the changed one.
    expect((await checkAndRecord(original, dir)).state).toBe('changed');
  });

  it('compares without touching the disk', () => {
    const a = key();
    const b = key();
    expect(compare(b, fingerprint(a), a)).toEqual({ state: 'rotating' });
    expect(compare(b, fingerprint(a), b)).toEqual({ state: 'changed' });
  });
});
