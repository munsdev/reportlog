/**
 * The card for an article: what its page says about itself in its own meta
 * tags (Open Graph first, then the plain title and description), read when
 * the card is asked for and NEVER STORED (decision 84). It is kept in this
 * process's memory for a few hours so a busy list does not ask the same page
 * again and again, and is gone on a restart.
 *
 * THE ONE PLACE THE SERVER REQUESTS AN ADDRESS SOMEBODY TYPED. Everywhere
 * else it never does (lists/urls.ts says why, and a unit test holds every
 * other file to it). This exception is narrow on purpose:
 *
 * - Only an article a journalist linked: a vetted person's published work,
 *   not a tip, a report's link, or anything a stranger sent. The public may
 *   ask only for an approved, listed article's card (coverage.ts decides).
 * - The browser never makes the request. The page asks this server, so the
 *   no-third-party-requests rule for the site's pages still holds.
 * - Only http and https on their own ports, no credentials, no bare address,
 *   and every name is resolved here first: any answer in a private, loopback,
 *   link-local or otherwise special range refuses the whole request, and the
 *   connection is pinned to the address that was checked, so a second lookup
 *   cannot swap it (DNS rebinding). Each redirect is checked again, at most
 *   three.
 * - A few seconds, the first 512 KiB, HTML only, and nothing but the <head>
 *   is read. No cookies are sent or kept. The address is never logged.
 */
import { lookup as dnsLookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { BlockList, isIP } from 'node:net';
import type { CoverageCard } from '@reportlog/contracts';
import { normalizeUrl } from '../lists/urls.ts';

export interface Address {
  address: string;
  family: 4 | 6;
}

export interface FetchOptions {
  /** Resolve a name to every address it has. Tests give their own. */
  resolve?: (host: string) => Promise<Address[]>;
  /** Whether an address may be connected to. Tests may allow loopback. */
  allowed?: (address: string, family: 4 | 6) => boolean;
  timeoutMs?: number;
  maxBytes?: number;
  /**
   * TESTS ONLY: connect to this port instead of 80 or 443, which a test
   * cannot listen on. The address rules still apply in full. Never set by
   * the server (articles/routes.ts passes only what app.ts was given, and
   * only tests give it anything).
   */
  testPort?: number;
}

const MAX_REDIRECTS = 3;

/** Every range a public web page cannot be in. */
const blocked = new BlockList();
for (const [net, bits] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blocked.addSubnet(net, bits, 'ipv4');
}
for (const [net, bits] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  blocked.addSubnet(net, bits, 'ipv6');
}

export function isPublicAddress(address: string, family: 4 | 6): boolean {
  if (isIP(address) !== family) return false;
  // An IPv4 address written as IPv6 (::ffff:127.0.0.1) is refused outright.
  // Not by a range in the list: the list matches every IPv4 address against
  // that range, which would refuse them all.
  if (family === 6 && /^::ffff:/i.test(address)) return false;
  return !blocked.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

const resolveAll = async (host: string): Promise<Address[]> =>
  (await dnsLookup(host, { all: true, verbatim: true })).map((a) => ({
    address: a.address,
    family: a.family === 6 ? 6 : 4,
  }));

/**
 * The first part of the page at `url`, as text, or null when it cannot or
 * may not be read. Never throws.
 */
export async function fetchHead(url: string, options: FetchOptions = {}): Promise<string | null> {
  const resolve = options.resolve ?? resolveAll;
  const allowed = options.allowed ?? isPublicAddress;
  const deadline = AbortSignal.timeout(options.timeoutMs ?? 6000);
  const maxBytes = options.maxBytes ?? 512 * 1024;
  let next = url;
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const checked = normalizeUrl(next);
      if (!checked.ok) return null;
      const u = new URL(next);
      if (u.port && u.port !== (u.protocol === 'https:' ? '443' : '80')) return null;
      const host = u.hostname.replace(/\.+$/, '');
      const addresses = await resolve(host);
      // Every answer must be public, not just the first: a name that also
      // answers with an inside address is not a public page.
      if (addresses.length === 0 || !addresses.every((a) => allowed(a.address, a.family))) {
        return null;
      }
      const pinned = addresses[0];
      if (!pinned) return null;
      const answer = await get(u, pinned, deadline, maxBytes, options.testPort);
      if (answer.kind === 'redirect') {
        next = new URL(answer.location, u).toString();
        continue;
      }
      return answer.kind === 'page' ? answer.text : null;
    }
    return null;
  } catch {
    return null;
  }
}

type Answer =
  { kind: 'page'; text: string } | { kind: 'redirect'; location: string } | { kind: 'none' };

function get(
  u: URL,
  pinned: Address,
  signal: AbortSignal,
  maxBytes: number,
  testPort: number | undefined,
): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const client = u.protocol === 'https:' ? https : http;
    const req = client.request(
      u,
      {
        method: 'GET',
        signal,
        ...(testPort ? { port: testPort } : {}),
        headers: {
          accept: 'text/html,application/xhtml+xml;q=0.9',
          'accept-language': 'en',
          'user-agent': 'Mozilla/5.0 (compatible; ReportLog link card)',
        },
        // Connect to the address that was checked, whatever a second lookup says.
        lookup: (_host, opts, cb) => {
          if ((opts as { all?: boolean }).all) {
            (cb as unknown as (e: null, a: Address[]) => void)(null, [pinned]);
          } else {
            cb(null, pinned.address, pinned.family);
          }
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          resolve({ kind: 'redirect', location: res.headers.location });
          return;
        }
        const type = res.headers['content-type'] ?? '';
        if (status !== 200 || !/html/i.test(type)) {
          res.resume();
          resolve({ kind: 'none' });
          return;
        }
        res.setEncoding('utf8');
        let text = '';
        res.on('data', (chunk: string) => {
          text += chunk;
          // The head is all that is read; stop as soon as it is over.
          if (text.length >= maxBytes || /<\/head>|<body[\s>]/i.test(text)) {
            res.destroy();
            resolve({ kind: 'page', text: text.slice(0, maxBytes) });
          }
        });
        res.on('end', () => {
          resolve({ kind: 'page', text });
        });
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.end();
  });
}

// ── reading the meta tags ──────────────────────────────────────────────────

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body.startsWith('#')) {
      const n =
        body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : Number(body.slice(1));
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

const tidy = (s: string | undefined, max: number): string | null => {
  if (!s) return null;
  // Text only: a tag inside a meta value is shown as nothing, never as markup.
  const t = decodeEntities(s)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};

/** The card's fields from a page's head. Pure: the tests feed it pages. */
export function readCard(html: string): CoverageCard {
  const head = html.slice(0, 512 * 1024);
  const meta = new Map<string, string>();
  for (const tag of head.match(/<meta\b[^>]*>/gi) ?? []) {
    const attrs = new Map<string, string>();
    for (const m of tag.matchAll(/([a-zA-Z_:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
      attrs.set((m[1] ?? '').toLowerCase(), m[2] ?? m[3] ?? m[4] ?? '');
    }
    const key = (
      attrs.get('property') ??
      attrs.get('name') ??
      attrs.get('itemprop')
    )?.toLowerCase();
    const content = attrs.get('content');
    // The first one wins, as a reader of the page would see it.
    if (key && content !== undefined && !meta.has(key)) meta.set(key, content);
  }
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1];
  const title = tidy(meta.get('og:title') ?? meta.get('twitter:title') ?? titleTag, 300);
  const description = tidy(
    meta.get('og:description') ?? meta.get('twitter:description') ?? meta.get('description'),
    500,
  );
  const siteName = tidy(meta.get('og:site_name') ?? meta.get('application-name'), 120);
  const publishedRaw =
    meta.get('article:published_time') ?? meta.get('datepublished') ?? meta.get('date');
  const published =
    publishedRaw && !Number.isNaN(Date.parse(publishedRaw))
      ? new Date(publishedRaw).toISOString().slice(0, 10)
      : null;
  if (!title && !description && !siteName) return { found: false };
  return { found: true, title, description, site_name: siteName, published };
}

// ── memory only ────────────────────────────────────────────────────────────

/**
 * Cards by address, in memory. A card that was found is kept six hours; one
 * that was not, ten minutes, so a page that was down is tried again soon.
 * The oldest is dropped past `max`. Nothing here is ever written anywhere.
 */
export class CardCache {
  private readonly cards = new Map<string, { card: CoverageCard; until: number }>();
  private readonly pending = new Map<string, Promise<CoverageCard>>();

  private readonly load: (url: string) => Promise<CoverageCard>;
  private readonly max: number;
  private readonly now: () => number;

  constructor(
    load: (url: string) => Promise<CoverageCard>,
    max = 500,
    now: () => number = Date.now,
  ) {
    this.load = load;
    this.max = max;
    this.now = now;
  }

  async get(url: string): Promise<CoverageCard> {
    const kept = this.cards.get(url);
    if (kept && kept.until > this.now()) return kept.card;
    const already = this.pending.get(url);
    if (already) return already;
    const loading = this.load(url)
      .catch((): CoverageCard => ({ found: false }))
      .then((card) => {
        this.cards.delete(url);
        const life = card.found ? 6 * 60 * 60 * 1000 : 10 * 60 * 1000;
        this.cards.set(url, { card, until: this.now() + life });
        while (this.cards.size > this.max) {
          const oldest = this.cards.keys().next().value;
          if (oldest === undefined) break;
          this.cards.delete(oldest);
        }
        return card;
      })
      .finally(() => this.pending.delete(url));
    this.pending.set(url, loading);
    return loading;
  }
}

export async function loadCard(url: string, options?: FetchOptions): Promise<CoverageCard> {
  const html = await fetchHead(url, options);
  return html === null ? { found: false } : readCard(html);
}
