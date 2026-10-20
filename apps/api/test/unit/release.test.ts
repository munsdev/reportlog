/**
 * The version in the root package.json and the newest CHANGELOG.md entry
 * agree, and the changelog keeps the shape `reportlog updates` reads
 * (parseChangelog in src/jobs/updates.ts). Cutting a release changes both in
 * one commit (README, "Cutting a release"); this fails if one is forgotten.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compareVersions, parseChangelog, parseVersion } from '../../src/jobs/updates.ts';
import { readVersion } from '../../src/site/version.ts';

const ROOT = new URL('../../../../', import.meta.url);
const pkg = JSON.parse(readFileSync(new URL('package.json', ROOT), 'utf8')) as { version?: string };
const changelog = readFileSync(new URL('CHANGELOG.md', ROOT), 'utf8');
const entries = parseChangelog(changelog);

describe('the release number', () => {
  it('is a plain semantic version in the root package.json', () => {
    expect(parseVersion(pkg.version), String(pkg.version)).not.toBeNull();
  });

  it('is the newest entry in CHANGELOG.md', () => {
    expect(entries[0]?.version).toBe(`v${pkg.version}`);
  });

  it('is what the footer shows', () => {
    expect(readVersion().release).toBe(`v${pkg.version}`);
  });
});

describe('CHANGELOG.md', () => {
  it('has a date and notes under every release', () => {
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(e.date, e.version).toMatch(/^\d{1,2} [A-Z][a-z]+ \d{4}$/);
      expect(e.notes.length, e.version).toBeGreaterThan(0);
    }
  });

  it('lists releases newest first, each once', () => {
    for (let i = 1; i < entries.length; i += 1) {
      expect(compareVersions(entries[i - 1]?.version, entries[i]?.version)).toBe(1);
    }
  });

  it('has no second-level heading the update check would not read, except Unreleased at the top', () => {
    const headings = changelog.split('\n').filter((l) => l.startsWith('## '));
    const odd = headings.filter((h) => !/^##\s+v\d+\.\d+\.\d+\s*(?:[—-]\s*.+)?$/.test(h));
    expect(odd).toEqual(headings[0] === '## Unreleased' ? ['## Unreleased'] : []);
  });
});
