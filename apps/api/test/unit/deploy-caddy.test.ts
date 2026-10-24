/**
 * deploy/caddy/Caddyfile, run in a real Caddy: what a browser is told to
 * cache (legacy boot-guard's job, "browsers ask before using an old script").
 *
 * The file is rendered the way deploy/lib.sh renders it, with four changes
 * so it can run here and nowhere else: the site is plain HTTP on a free
 * loopback port (no certificate), the admin endpoint gets a free port, the
 * website comes from a directory made here, and the API is a stand-in.
 * Every header, matcher and route is the shipped file's.
 *
 * Needs a `caddy` binary (CADDY_BIN, or on PATH). Skipped without one on a
 * development machine, and fails without one in CI, which installs it.
 */
import { execFileSync, spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REPO } from './deploy-sandbox.ts';

const CADDY = process.env.CADDY_BIN ?? 'caddy';
const hasCaddy = (() => {
  try {
    execFileSync(CADDY, ['version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();
if (!hasCaddy && process.env.CI)
  throw new Error(`deploy-caddy: no caddy at "${CADDY}"; CI installs one.`);

const SHIPPED = readFileSync(join(REPO, 'deploy/caddy/Caddyfile'), 'utf8');
// What deploy/lib.sh appends when WWW_REDIRECT=yes.
const WWW = readFileSync(join(REPO, 'deploy/caddy/www.caddy'), 'utf8');
const HASHED = 'index-B3xq9_Zt.js';

async function freePort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  const { port } = s.address() as AddressInfo;
  await new Promise<void>((r) =>
    s.close(() => {
      r();
    }),
  );
  return port;
}

/** The shipped file as deploy/lib.sh renders it, then moved onto this machine. */
function render(site: string, admin: number, dist: string, api: number): string {
  const swaps: [string, string][] = [
    ['@SITE_DOMAIN@ {', `${site} {`],
    ['@ACME_EMAIL_LINE@', ''],
    ['admin localhost:2019', `admin 127.0.0.1:${String(admin)}`],
    ['root * /srv/reportlog/current/apps/web/dist', `root * ${dist}`],
    ['reverse_proxy 127.0.0.1:3000', `reverse_proxy 127.0.0.1:${String(api)}`],
  ];
  let out = SHIPPED;
  for (const [from, to] of swaps) {
    expect(out, from).toContain(from);
    out = out.replace(from, to);
  }
  return out;
}

/** The www block on a loopback port of its own, sending to `site` (a host:port). */
function renderWww(www: string, site: string): string {
  const from = 'www.@SITE_DOMAIN@ {';
  expect(WWW).toContain(from);
  return WWW.replace(from, `${www} {`).replaceAll('@SITE_DOMAIN@', site);
}

// S1 and S3, needing no Caddy: what the shipped file asks for.
describe('the shipped Caddyfile, read as text', () => {
  const directives = SHIPPED.split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));

  it('asks for no access log (S1): a `log` directive would write every visitor’s address', () => {
    expect(directives.filter((l) => /^log\b/.test(l))).toEqual([]);
  });

  it('has one catch-all route for the website (S3), so a new page needs no Caddy change', () => {
    expect(directives.filter((l) => l.startsWith('try_files'))).toEqual([
      'try_files {path} /index.html',
    ]);
  });
});

describe.skipIf(!hasCaddy)('the Caddyfile, in Caddy', () => {
  let dir: string;
  let base: string;
  let wwwBase: string;
  let caddy: ChildProcess;
  let api: Server;
  const seenByApi: Record<string, string | string[] | undefined>[] = [];
  // Everything Caddy itself writes while it runs, for the log test below.
  let caddyOutput = '';

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'rl-caddy-'));
    const dist = join(dir, 'dist');
    mkdirSync(join(dist, 'assets'), { recursive: true });
    writeFileSync(
      join(dist, 'index.html'),
      `<!doctype html><script type="module" src="/assets/${HASHED}"></script>`,
    );
    writeFileSync(join(dist, 'assets', HASHED), 'console.log("app")\n');
    writeFileSync(join(dist, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');

    api = createServer((req, res) => {
      seenByApi.push(req.headers);
      res
        .writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        .end('{"ok":true}');
    });
    await new Promise<void>((r) => api.listen(0, '127.0.0.1', r));

    const port = await freePort();
    base = `http://127.0.0.1:${String(port)}`;
    const file = join(dir, 'Caddyfile');
    wwwBase = `http://127.0.0.1:${String(await freePort())}`;
    writeFileSync(
      file,
      `${render(base, await freePort(), dist, (api.address() as AddressInfo).port)}\n${renderWww(
        wwwBase,
        `127.0.0.1:${String(port)}`,
      )}`,
    );
    caddy = spawn(CADDY, ['run', '--adapter', 'caddyfile', '--config', file], {
      env: {
        ...process.env,
        XDG_DATA_HOME: join(dir, 'data'),
        XDG_CONFIG_HOME: join(dir, 'config'),
        HOME: dir,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    for (const stream of [caddy.stdout, caddy.stderr]) {
      stream?.on('data', (chunk: Buffer) => {
        caddyOutput += chunk.toString('utf8');
      });
    }
    for (let i = 0; i < 100; i++) {
      try {
        await fetch(base);
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    throw new Error('Caddy did not start');
  }, 20_000);

  afterAll(async () => {
    caddy.kill();
    await new Promise<void>((r) =>
      api.close(() => {
        r();
      }),
    );
    rmSync(dir, { recursive: true, force: true });
  });

  const get = (path: string, headers: Record<string, string> = {}) =>
    fetch(`${base}${path}`, { headers });

  it('the shipped file validates as Caddy reads it, with a real domain', () => {
    const file = join(dir, 'Caddyfile.real');
    writeFileSync(
      file,
      `${SHIPPED.replaceAll('@SITE_DOMAIN@', 'reports.example.org').replace(
        '@ACME_EMAIL_LINE@',
        'email ops@example.org',
      )}\n${WWW.replaceAll('@SITE_DOMAIN@', 'reports.example.org')}`,
    );
    execFileSync(CADDY, ['validate', '--adapter', 'caddyfile', '--config', file], {
      stdio: 'pipe',
      env: {
        ...process.env,
        XDG_DATA_HOME: join(dir, 'data'),
        XDG_CONFIG_HOME: join(dir, 'config'),
        HOME: dir,
      },
    });
  });

  it('makes a browser ask again for the page, at every address the app answers', async () => {
    for (const path of ['/', '/index.html', '/logbooks/noise/reports/RL-1', '/favicon.svg']) {
      const res = await get(path);
      expect(res.status, path).toBe(200);
      expect(res.headers.get('cache-control'), path).toBe('no-cache');
    }
    const page = await get('/logbooks/noise');
    expect(page.headers.get('content-type')).toMatch(/^text\/html/);
    expect(await page.text()).toContain(`/assets/${HASHED}`);
  });

  it('lets asking again be cheap: an unchanged page answers 304', async () => {
    const first = await get('/');
    const etag = first.headers.get('etag');
    expect(etag).toBeTruthy();
    const again = await get('/', { 'if-none-match': String(etag) });
    expect(again.status).toBe(304);
  });

  it('keeps a hashed asset for a year, as itself', async () => {
    const res = await get(`/assets/${HASHED}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(res.headers.get('content-type')).toMatch(/^text\/javascript/);
  });

  it('answers 404 for an asset the release does not have: never the page, never kept', async () => {
    // A page loaded before a deploy asking for a chunk the new release dropped.
    for (const path of ['/assets/old-chunk-Dq81kz.js', '/assets/', '/assets/nested/x.css']) {
      const res = await get(path);
      expect(res.status, path).toBe(404);
      expect(res.headers.get('cache-control'), path).toBe('no-cache');
      expect(res.headers.get('content-type') ?? '', path).not.toMatch(/html/);
    }
  });

  it("leaves the API's own caching alone, and replaces an address the visitor sent", async () => {
    const res = await get('/api/health', { 'x-forwarded-for': '203.0.113.9' });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const seen = seenByApi.at(-1) ?? {};
    expect(seen['x-forwarded-for']).toBe('127.0.0.1');
  });

  it('sends the security headers with every kind of answer', async () => {
    for (const path of ['/', `/assets/${HASHED}`, '/assets/gone.js']) {
      const res = await get(path);
      expect(res.headers.get('content-security-policy'), path).toContain("default-src 'self'");
      expect(res.headers.get('x-content-type-options'), path).toBe('nosniff');
      expect(res.headers.get('server'), path).toBeNull();
    }
  });

  it('serves every page of the app from the one catch-all route, at any depth (S3)', async () => {
    // The pages added with the moderation and EU items, and one that does not exist yet.
    for (const path of [
      '/terms',
      '/illegal-content',
      `/illegal-content/status/${'a'.repeat(64)}`,
      `/file/erase/${'b'.repeat(64)}`,
      '/some/page/nobody/has/written/yet',
    ]) {
      const res = await get(path);
      expect(res.status, path).toBe(200);
      expect(await res.text(), path).toContain(`/assets/${HASHED}`);
    }
  });

  it('sends the www name to the same path on the site, permanently, with HSTS', async () => {
    for (const path of ['/', '/terms', '/logbooks/noise?x=1', '/api/health']) {
      const res = await fetch(`${wwwBase}${path}`, { redirect: 'manual' });
      expect(res.status, path).toBe(301);
      expect(res.headers.get('location'), path).toBe(`https://${new URL(base).host}${path}`);
      expect(res.headers.get('strict-transport-security'), path).toContain('includeSubDomains');
      expect(res.headers.get('server'), path).toBeNull();
    }
  });

  it('writes nothing about a visitor: no access log, no client address (S1)', async () => {
    const visitor = '203.0.113.77';
    for (const path of [
      '/',
      '/terms',
      '/api/health',
      '/assets/gone.js',
      `/file/erase/${'c'.repeat(64)}`,
    ]) {
      await get(path, { 'x-forwarded-for': visitor, 'user-agent': 'a-distinctive-agent/9' });
    }
    // And at the www name, which is a site of its own in Caddy.
    await fetch(`${wwwBase}/file/erase/${'c'.repeat(64)}`, {
      headers: { 'x-forwarded-for': visitor, 'user-agent': 'a-distinctive-agent/9' },
      redirect: 'manual',
    });
    // Caddy flushes its log lines as it writes them; give it a moment anyway.
    await new Promise((r) => setTimeout(r, 300));
    expect(caddyOutput).not.toContain(visitor);
    expect(caddyOutput).not.toContain('a-distinctive-agent');
    expect(caddyOutput).not.toContain('http.log.access');
    expect(caddyOutput).not.toMatch(/remote_ip|client_ip|"request"/);
    // And not the tokens in those paths either.
    expect(caddyOutput).not.toContain('c'.repeat(64));
  });
});
