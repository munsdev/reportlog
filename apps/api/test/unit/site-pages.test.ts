/** P2's pure rules: the version line and the development notice's window. */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { COPY_SLOTS, resolveCopy } from '../../src/site/copy.ts';
import { MAX_DEV_MODE_HOURS, validateDevModeHours } from '../../src/site/devMode.ts';
import { readVersion, releaseIn } from '../../src/site/version.ts';

describe('the version line', () => {
  it('reads a plain semantic version and prefixes it once', () => {
    expect(releaseIn('{"version":"1.2.3"}')).toBe('v1.2.3');
    expect(releaseIn('{"version":"v0.4.0"}')).toBe('v0.4.0');
  });

  it('names no release rather than a wrong one', () => {
    for (const raw of [null, '', 'not json', '{}', '{"version":"0.0.01"}', '{"version":7}']) {
      expect(releaseIn(raw), String(raw)).toBeNull();
    }
  });

  it('takes the build from REVISION, shortened, and nothing from a checkout', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rl-version-'));
    const pkg = join(dir, 'package.json');
    const rev = join(dir, 'REVISION');
    writeFileSync(pkg, '{"version":"2.0.0"}');
    expect(readVersion(pathToFileURL(pkg), pathToFileURL(rev))).toEqual({
      release: 'v2.0.0',
      build: null,
    });
    writeFileSync(rev, `${'c'.repeat(40)}\n`);
    expect(readVersion(pathToFileURL(pkg), pathToFileURL(rev)).build).toBe('c'.repeat(12));
    // Something in REVISION that is not a commit is not shown as one.
    writeFileSync(rev, 'hello');
    expect(readVersion(pathToFileURL(pkg), pathToFileURL(rev)).build).toBeNull();
  });
});

describe('the development notice', () => {
  it('takes a window between nothing and a week, or null for off', () => {
    expect(validateDevModeHours(null)).toEqual({ ok: true, value: null });
    expect(validateDevModeHours(6)).toEqual({ ok: true, value: 6 });
    expect(validateDevModeHours(MAX_DEV_MODE_HOURS).ok).toBe(true);
    for (const bad of [0, -2, MAX_DEV_MODE_HOURS + 1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(validateDevModeHours(bad).ok, String(bad)).toBe(false);
    }
  });
});

describe('the slots', () => {
  it('are legacy’s nine, the lock screen’s paragraph, the three terms slots and Plan E’s three, and the optional ones resolve to nothing', () => {
    expect(COPY_SLOTS).toHaveLength(16);
    expect(COPY_SLOTS.find((s) => s.key === 'lock_intro')).toMatchObject({ optional: true });
    const copy = resolveCopy([]);
    for (const s of COPY_SLOTS) {
      if (s.optional) expect(copy[s.key], s.key).toBe('');
      else expect(copy[s.key].length, s.key).toBeGreaterThan(0);
    }
  });
});
