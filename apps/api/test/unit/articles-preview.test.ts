/**
 * The coverage card reader (decision 84): what it reads from a page, and,
 * more to the point, every address it refuses to visit.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CardCache,
  decodeEntities,
  fetchHead,
  isPublicAddress,
  loadCard,
  readCard,
  type Address,
} from '../../src/articles/preview.ts';

describe('reading a card from a page head', () => {
  it('takes Open Graph first, then twitter, then the plain tags', () => {
    const html = `<!doctype html><html><head>
      <title>Plain title | Site</title>
      <meta name="description" content="Plain description">
      <meta property="og:title" content="County opens extra polling places">
      <meta content="Lines ran past two hours &amp; the clerk responded." property="og:description" />
      <meta property='og:site_name' content='The Daily Example'>
      <meta property="article:published_time" content="2026-11-03T14:05:00Z">
      </head><body>ignored</body></html>`;
    expect(readCard(html)).toEqual({
      found: true,
      title: 'County opens extra polling places',
      description: 'Lines ran past two hours & the clerk responded.',
      site_name: 'The Daily Example',
      published: '2026-11-03',
    });
  });

  it('falls back to <title> and the description meta', () => {
    expect(
      readCard('<head><title> Just a\n title </title><meta name="description" content="d"></head>'),
    ).toEqual({
      found: true,
      title: 'Just a title',
      description: 'd',
      site_name: null,
      published: null,
    });
  });

  it('shows markup inside a value as nothing, never as markup', () => {
    const card = readCard(
      '<meta property="og:title" content="&lt;script&gt;x&lt;/script&gt;Hello">',
    );
    expect(card.found && card.title).toBe('x Hello');
  });

  it('a page that says nothing about itself is not found', () => {
    expect(readCard('<html><head></head><body>hi</body></html>')).toEqual({ found: false });
  });

  it('cuts a long title and ignores a date it cannot read', () => {
    const long = 'a'.repeat(400);
    const card = readCard(
      `<meta property="og:title" content="${long}"><meta property="article:published_time" content="soon">`,
    );
    expect(card.found && card.title?.length).toBe(300);
    expect(card.found && card.published).toBeNull();
  });

  it('decodes numeric and named entities', () => {
    expect(decodeEntities('&#8217; &#x2014; &quot;a&quot; &bogus;')).toBe('’ — "a" &bogus;');
  });
});

describe('which addresses may be visited', () => {
  it('refuses every private, loopback, link-local and special range', () => {
    for (const a of [
      '127.0.0.1',
      '10.1.2.3',
      '172.20.0.1',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '224.0.0.1',
      '198.18.0.1',
    ]) {
      expect(isPublicAddress(a, 4), a).toBe(false);
    }
    for (const a of ['::1', '::', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '64:ff9b::7f00:1']) {
      expect(isPublicAddress(a, 6), a).toBe(false);
    }
  });

  it('allows a public address, and refuses one given under the wrong family', () => {
    expect(isPublicAddress('93.184.216.34', 4)).toBe(true);
    expect(isPublicAddress('2606:2800:220:1:248:1893:25c8:1946', 6)).toBe(true);
    expect(isPublicAddress('93.184.216.34', 6)).toBe(false);
  });
});

describe('refused before anything is visited', () => {
  let server: Server;
  let port = 0;
  const hits: string[] = [];
  beforeAll(async () => {
    server = createServer((req, res) => {
      hits.push(req.url ?? '');
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<title>should never be read</title>');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(
    () =>
      new Promise<void>((r) => {
        server.close(() => {
          r();
        });
      }),
  );

  // `inside.example` answers privately; `mixed.example` answers both ways;
  // anything else stands in for a public site and reaches our local server,
  // which only these tests are allowed to reach.
  const resolve = (host: string): Promise<Address[]> =>
    Promise.resolve(
      host === 'inside.example'
        ? [{ address: '10.0.0.5', family: 4 }]
        : host === 'mixed.example'
          ? [
              { address: '127.0.0.1', family: 4 },
              { address: '10.0.0.5', family: 4 },
            ]
          : [{ address: '127.0.0.1', family: 4 }],
    );
  const opts = { resolve, allowed: (a: string) => a === '127.0.0.1', timeoutMs: 2000 };

  it('any port but the scheme’s own', async () => {
    const before = hits.length;
    expect(await fetchHead(`http://news.example:${String(port)}/a`, opts)).toBeNull();
    expect(hits.length).toBe(before);
  });

  it('a name that answers with a private address, or with one among others', async () => {
    const before = hits.length;
    expect(await fetchHead('http://inside.example/secret', { ...opts, testPort: port })).toBeNull();
    expect(await fetchHead('http://mixed.example/a', { ...opts, testPort: port })).toBeNull();
    expect(hits.length).toBe(before);
  });

  it('a bare address, credentials and other schemes, without even a lookup', async () => {
    let asked = 0;
    const counting = {
      ...opts,
      testPort: port,
      resolve: (h: string) => {
        asked += 1;
        return resolve(h);
      },
    };
    for (const u of [
      'http://127.0.0.1/a',
      'http://2130706433/a',
      'http://user:pw@news.example/a',
      'ftp://news.example/a',
      'file:///etc/passwd',
    ]) {
      expect(await fetchHead(u, counting), u).toBeNull();
    }
    expect(asked).toBe(0);
  });
});

describe('fetching, pinned to the checked address', () => {
  // The reader visits only 80 and 443, which a test cannot listen on, so
  // `testPort` sends the pinned connection to this server's port instead.
  let server: Server;
  let port = 0;
  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === '/article') {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<head><meta property="og:title" content="Found it"></head><body>');
      } else if (req.url === '/hop') {
        res.writeHead(301, { location: '/article' });
        res.end();
      } else if (req.url === '/inside') {
        res.writeHead(302, { location: 'http://inside.example/secret' });
        res.end();
      } else if (req.url === '/loop') {
        res.writeHead(302, { location: '/loop' });
        res.end();
      } else if (req.url === '/json') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{}');
      } else if (req.url === '/big') {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(`<title>big</title>${'x'.repeat(4000)}`);
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(
    () =>
      new Promise<void>((r) => {
        server.close(() => {
          r();
        });
      }),
  );

  const resolve = (host: string): Promise<Address[]> =>
    Promise.resolve(
      host === 'inside.example'
        ? [{ address: '10.0.0.5', family: 4 }]
        : [{ address: '127.0.0.1', family: 4 }],
    );
  const opts = () => ({
    resolve,
    allowed: (a: string) => a === '127.0.0.1',
    timeoutMs: 2000,
    testPort: port,
  });

  it('reads a page, and follows a redirect on the same site', async () => {
    expect(await loadCard('http://news.example/article', opts())).toMatchObject({
      found: true,
      title: 'Found it',
    });
    expect(await loadCard('http://news.example/hop', opts())).toMatchObject({ title: 'Found it' });
  });

  it('checks a redirect again: one into a private address is refused', async () => {
    expect(await fetchHead('http://news.example/inside', opts())).toBeNull();
  });

  it('gives up on a redirect loop, a page that is not HTML, and a missing one', async () => {
    expect(await fetchHead('http://news.example/loop', opts())).toBeNull();
    expect(await fetchHead('http://news.example/json', opts())).toBeNull();
    expect(await fetchHead('http://news.example/missing', opts())).toBeNull();
  });

  it('reads no more than it is allowed', async () => {
    const text = await fetchHead('http://news.example/big', { ...opts(), maxBytes: 100 });
    expect(text?.length).toBeLessThanOrEqual(100);
  });
});

describe('the cache is memory only, and asks once', () => {
  it('serves a found card again without loading, and retries a missing one later', async () => {
    let now = 0;
    const loads: string[] = [];
    const cache = new CardCache(
      (url) => {
        loads.push(url);
        return Promise.resolve(
          url.endsWith('ok')
            ? { found: true, title: 't', description: null, site_name: null, published: null }
            : { found: false },
        );
      },
      2,
      () => now,
    );
    await Promise.all([cache.get('a/ok'), cache.get('a/ok')]);
    expect(loads).toEqual(['a/ok']);
    await cache.get('b/no');
    now += 11 * 60 * 1000;
    await cache.get('b/no');
    await cache.get('a/ok');
    expect(loads).toEqual(['a/ok', 'b/no', 'b/no']);
    // Past its size the oldest goes.
    await cache.get('c/ok');
    await cache.get('a/ok');
    expect(loads.at(-1)).toBe('a/ok');
  });
});
