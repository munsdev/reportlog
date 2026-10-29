/**
 * Which pages search engines may index (src/robots.ts): the public ones,
 * a form at the site's root, and nothing that carries a token or a report.
 */
import { describe, expect, it } from 'vitest';
import { INDEXED_PAGES, NEVER_CRAWLED, indexable } from '../src/index.ts';

describe('indexable', () => {
  it('takes every listed page, with or without a trailing slash', () => {
    for (const p of INDEXED_PAGES) {
      expect(indexable(p), p).toBe(true);
      if (p !== '/') expect(indexable(`${p}/`), `${p}/`).toBe(true);
    }
  });

  it('takes a public map and a form at the root', () => {
    expect(indexable('/maps/turnout')).toBe(true);
    expect(indexable('/vote-2026')).toBe(true);
  });

  it('refuses a single report until the owner decides otherwise', () => {
    expect(indexable('/board/RL-ABC123')).toBe(false);
    expect(indexable('/verify/RL-ABC123')).toBe(false);
  });

  it('refuses staff screens, the reporter’s own pages and every reserved word', () => {
    for (const p of [
      '/moderate',
      '/account',
      '/people',
      '/settings',
      '/mine',
      '/submit',
      '/home',
    ]) {
      expect(indexable(p), p).toBe(false);
    }
  });

  it('refuses a token page, which robots.txt also keeps crawlers off', () => {
    const token = 'a'.repeat(64);
    for (const p of [
      `/file/confirm/${token}`,
      `/journalists/stop/${token}`,
      `/evidence/${token}`,
    ]) {
      expect(indexable(p), p).toBe(false);
      expect(
        NEVER_CRAWLED.some((n) => p.startsWith(n)),
        p,
      ).toBe(true);
    }
  });

  it('keeps crawlers off no form whose address merely starts like a private page', () => {
    expect(NEVER_CRAWLED.some((n) => '/miners-strike'.startsWith(n))).toBe(false);
  });

  it('refuses a deeper or odd address', () => {
    for (const p of ['/maps', '/maps/a/b', '/Vote', '/a.b', '/x/y']) {
      expect(indexable(p), p).toBe(false);
    }
  });
});
