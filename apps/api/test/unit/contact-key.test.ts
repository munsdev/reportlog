import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkAndRecord, compare, fingerprint } from '../../src/jobs/contact-key.ts';

const key = () => randomBytes(32).toString('base64');

describe('CONTACT_KEY is never rotated', () => {
  it('records the first key it sees, then accepts only that key', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rl-key-'));
    const original = key();
    expect((await checkAndRecord(original, dir)).state).toBe('first');
    expect((await checkAndRecord(original, dir)).state).toBe('same');
    expect((await checkAndRecord(key(), dir)).state).toBe('changed');
    // A changed key never replaces the recorded one.
    expect(readFileSync(join(dir, 'contact-key.sha256'), 'utf8').trim()).toBe(
      fingerprint(original),
    );
    expect((await checkAndRecord(original, dir)).state).toBe('same');
  });

  it('records nothing for a site with no key yet', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rl-key-'));
    expect((await checkAndRecord(undefined, dir)).state).toBe('unset');
    const later = key();
    expect((await checkAndRecord(later, dir)).state).toBe('first');
  });

  it('stores a fingerprint that is not the key', () => {
    const k = key();
    expect(fingerprint(k)).toMatch(/^[0-9a-f]{64}$/);
    expect(fingerprint(k)).not.toContain(k);
    expect(compare(k, fingerprint(k))).toEqual({ state: 'same' });
  });
});
