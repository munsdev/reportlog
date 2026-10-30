/**
 * What search engines are told about each page (features/site-pages/searchMeta.tsx,
 * and `indexable` in packages/contracts/src/robots.ts).
 *
 * Every page the router has is checked, read from the generated route tree
 * as e2e/third-party.spec.ts reads it, so a page added later is classified
 * without anybody remembering to: only the public ones may be indexed.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { INDEXED_PAGES, indexable } from '@reportlog/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { setSearchMeta } from '../src/features/site-pages/searchMeta.tsx';

function everyPage(): string[] {
  // From the working directory, as test/ui/client-first.test.ts reads src:
  // under jsdom, import.meta.url is not a file address.
  const tree = readFileSync(join(process.cwd(), 'src', 'routeTree.gen.ts'), 'utf8');
  const block = /fullPaths:\s*((?:\|\s*'[^']*'\s*)+)/.exec(tree)?.[1] ?? '';
  return [...block.matchAll(/'([^']*)'/g)].map((m) => m[1] ?? '');
}

describe('which of the router’s pages may be indexed', () => {
  const pages = everyPage();

  it('reads the route tree', () => {
    expect(pages.length).toBeGreaterThan(50);
  });

  it('every listed page exists', () => {
    const plain = new Set(pages.map((p) => (p.length > 1 ? p.replace(/\/$/, '') : p)));
    for (const p of INDEXED_PAGES) expect(plain.has(p), p).toBe(true);
  });

  it('no page with a parameter but a map and a form at the root, and no other page unlisted', () => {
    const indexed = pages.filter((p) => indexable(p.replace(/\$\w+/g, 'x')));
    for (const p of indexed) {
      const plain = p.length > 1 ? p.replace(/\/$/, '') : p;
      expect(
        INDEXED_PAGES.includes(plain) || plain === '/$slug' || plain === '/maps/$slug',
        p,
      ).toBe(true);
    }
  });
});

describe('setSearchMeta', () => {
  afterEach(() => {
    document.head.innerHTML = '';
  });

  it('names an indexable page’s one address, without its query', () => {
    setSearchMeta('/board/', true);
    expect(document.head.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe(
      'index, follow',
    );
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
      `${window.location.origin}/board`,
    );
  });

  it('says noindex, and drops the address, on any other', () => {
    setSearchMeta('/board', true);
    setSearchMeta('/moderate', false);
    expect(document.head.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe(
      'noindex',
    );
    expect(document.head.querySelector('link[rel="canonical"]')).toBeNull();
    expect(document.head.querySelectorAll('meta[name="robots"]')).toHaveLength(1);
  });
});
