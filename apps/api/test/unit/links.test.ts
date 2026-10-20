/**
 * Tip links (Plan D §5, §8) without a database: what is fetched (nothing),
 * the blocklist's domain rules, and the categories the contract and the
 * module must agree on.
 */
import { LINK_FIELD_WORDING, LINK_REASONS, UNBLOCK_REASONS } from '@reportlog/contracts';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  REASON_CATEGORIES,
  UNBLOCK_REASONS as MODULE_UNBLOCK,
  cleanDomain,
  domainsOf,
} from '../../src/links/blocklist.ts';

const SRC = fileURLToPath(new URL('../../src/', import.meta.url));

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts') && !p.endsWith('.gen.ts')) out.push(p);
  }
  return out;
}

/** Comments say "fetch(" freely; code is what matters. */
const code = (p: string) =>
  readFileSync(p, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const NETWORK = [
  /\bfetch\(/,
  /\bhttps?\.(?:get|request)\(/,
  /from 'node:(?:http|https|net|dns|tls)'/,
  /from 'undici'/,
];

describe('K6 and X1 · the server never requests a submitted link', () => {
  it('across apps/api/src, only the doctor makes a request, and it asks this site', () => {
    const callers = walk(SRC)
      .filter((p) => NETWORK.some((re) => re.test(code(p))))
      .map((p) => relative(SRC, p))
      .sort();
    // The doctor checks this site's own health; nothing else opens a socket
    // itself. A new entry here is a new outbound request: decide it, then add it.
    expect(callers).toEqual(['jobs/doctor.ts']);
  });

  it('the links and lists modules reach no network code at all, not even a mailer', () => {
    for (const p of [...walk(join(SRC, 'links')), ...walk(join(SRC, 'lists'))]) {
      const text = code(p);
      for (const re of NETWORK)
        expect(re.test(text), `${relative(SRC, p)} ${String(re)}`).toBe(false);
    }
    for (const p of walk(join(SRC, 'links'))) {
      expect(code(p), relative(SRC, p)).not.toMatch(/from '\.\.\/email\//);
    }
  });
});

describe('K13 · the blocklist covers a domain and its subdomains', () => {
  it('tests a host with each parent domain, never the bare top-level one', () => {
    expect(domainsOf('a.video.example.co.uk')).toEqual([
      'a.video.example.co.uk',
      'video.example.co.uk',
      'example.co.uk',
      'co.uk',
    ]);
    expect(domainsOf('Example.COM.')).toEqual(['example.com']);
    expect(domainsOf('localhost')).toEqual([]);
  });

  it('takes a domain typed bare or pasted as an address, and refuses what is not one', () => {
    expect(cleanDomain('Example.com')).toBe('example.com');
    expect(cleanDomain('https://video.example.com/watch?v=1')).toBe('video.example.com');
    expect(cleanDomain('münchen.de')).toBe('xn--mnchen-3ya.de');
    expect(cleanDomain('com')).toBe(null);
    expect(cleanDomain('')).toBe(null);
    expect(cleanDomain('not a domain')).toBe(null);
  });
});

describe('the contract and the module agree', () => {
  it('on the reasons a link is illegal and the reasons an entry comes off the list', () => {
    expect(Object.keys(LINK_REASONS)).toEqual([...REASON_CATEGORIES]);
    expect(Object.keys(UNBLOCK_REASONS)).toEqual([...MODULE_UNBLOCK]);
  });

  it('K2 · the wording above every link field is the spec’s, word for word', () => {
    expect(LINK_FIELD_WORDING).toBe(
      "Any link you add here may be shared with vetted journalists after a moderator checks it. It is never published. Don't link to your own account if you want to stay anonymous.",
    );
  });
});
