/**
 * The website's page with its head written on the server (site/pageHead.ts):
 * what a link-preview bot or a search engine reads without running the page.
 *
 * Sets the site password in one block, so it puts it back off after (files
 * take turns: vitest.config.ts). Uses a small stand-in for the built
 * index.html, passed to the app.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.ts';
import { hashPassword } from '../../src/identity/secrets.ts';
import { launchedLogbook, testDatabase } from './helpers.ts';
import { SITE, liftCurtain } from './identity-helpers.ts';
import type { FastifyInstance } from 'fastify';
import type { Database } from '../../src/db/database.ts';

// What the build makes, in the parts that matter here: its own title and
// description (which must be replaced, not joined) and the script.
const TEMPLATE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>ReportLog</title>
    <meta
      name="description"
      content="File and check incident reports in a tamper-evident archive."
    />
  </head>
  <body><div id="root"></div><script type="module" src="/assets/app.js"></script></body>
</html>
`;

let db: Database;
let app: FastifyInstance;
let lb: { id: number; slug: string };

beforeAll(async () => {
  db = testDatabase();
  app = await buildApp({
    config: { LOG_LEVEL: 'silent', SITE_ORIGIN: SITE },
    db,
    pageTemplate: TEMPLATE,
  });
  await liftCurtain(db);
  lb = await launchedLogbook(db);
  await db
    .updateTable('logbooks')
    .set({ title: 'Noise <& "nuisance"', blurb: 'Tell us\nabout noise near you.' })
    .where('id', '=', lb.id)
    .execute();
});
afterAll(async () => {
  await liftCurtain(db);
  await app.close();
  await db.destroy();
});

const page = (path: string) => app.inject({ method: 'GET', url: `/api/site/page${path}` });
const count = (body: string, needle: RegExp) => body.match(needle)?.length ?? 0;

describe('a public page', () => {
  it('gets its own title, description, address and share tags, and may be indexed', async () => {
    const res = await page('/terms');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/html/);
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.body).toContain('<title>Terms of use and contact · ');
    expect(res.body).toContain(
      'name="description" content="What this site does with what you send it',
    );
    expect(res.body).toContain('name="robots" content="index, follow"');
    expect(res.body).toContain(`<link rel="canonical" href="${SITE}/terms" />`);
    expect(res.body).toContain(`property="og:url" content="${SITE}/terms"`);
    expect(res.body).toContain('property="og:type" content="website"');
    expect(res.body).toContain(`property="og:image" content="${SITE}/api/site/share.png"`);
    expect(res.body).toContain('property="og:image:width" content="1200"');
    expect(res.body).toContain('property="og:image:height" content="630"');
    expect(res.body).toContain('name="twitter:card" content="summary_large_image"');
    // The build's own title and sentence are replaced, never doubled, and the app is still there.
    expect(count(res.body, /<title>/g)).toBe(1);
    expect(count(res.body, /name="description"/g)).toBe(1);
    expect(res.body).not.toContain('<title>ReportLog</title>');
    expect(res.body).toContain('/assets/app.js');
  });

  it('answers an unchanged page 304', async () => {
    const first = await page('/terms');
    const again = await app.inject({
      method: 'GET',
      url: '/api/site/page/terms',
      headers: { 'if-none-match': String(first.headers.etag) },
    });
    expect(again.statusCode).toBe(304);
  });

  it('ignores a trailing slash, as the sitemap does', async () => {
    const res = await page('/terms/');
    expect(res.body).toContain(`<link rel="canonical" href="${SITE}/terms" />`);
  });

  it('uses a logbook’s own words, escaped, and the real address for its short one', async () => {
    await db
      .updateTable('logbooks')
      .set({ short_slug: `s-${lb.slug}`.slice(0, 20) })
      .where('id', '=', lb.id)
      .execute();
    const res = await page(`/${lb.slug}`);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<title>Noise &lt;&amp; &quot;nuisance&quot; · ');
    expect(res.body).toContain('content="Tell us about noise near you."');
    expect(res.body).toContain('name="robots" content="index, follow"');
    expect(res.body).not.toContain('<& "nuisance"');
    const short = await page(`/s-${lb.slug}`.slice(0, 21));
    expect(short.statusCode).toBe(200);
    expect(short.body).toContain(`<link rel="canonical" href="${SITE}/${lb.slug}" />`);
  });
});

describe('a page that is not for search engines', () => {
  it('says noindex on a staff page, with no canonical address', async () => {
    const res = await page('/moderate');
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('name="robots" content="noindex"');
    expect(res.body).not.toContain('rel="canonical"');
    expect(count(res.body, /<title>/g)).toBe(1);
  });

  it('says noindex on a single report and on a token link', async () => {
    for (const path of ['/mine/abc', '/file/confirm/abc']) {
      const res = await page(path);
      expect(res.statusCode, path).toBe(200);
      expect(res.body, path).toContain('name="robots" content="noindex"');
    }
  });
});

describe('an address that is nothing', () => {
  it('is a 404 that still carries the app, so it can say so itself', async () => {
    const res = await page('/no-such-address-anywhere');
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toMatch(/^text\/html/);
    expect(res.body).toContain('/assets/app.js');
    expect(res.body).toContain('name="robots" content="noindex"');
  });

  it('is so for a map and a published report that are not there', async () => {
    expect((await page('/maps/no-such-map')).statusCode).toBe(404);
    expect((await page('/board/RL-NOPE-0000')).statusCode).toBe(404);
  });

  it('is not so for a draft’s address that is a page, nor for a route the server cannot see', async () => {
    // A draft is nothing public, like any other missing address.
    const draft = await db
      .insertInto('logbooks')
      .values({ slug: `draft-${String(lb.id)}-x`, title: 'Not yet' })
      .returning('slug')
      .executeTakeFirstOrThrow();
    const res = await page(`/${draft.slug}`);
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain('Not yet');
    // A reserved word, a deep address and an odd one: soft 200, not a guess.
    for (const path of ['/settings', '/some/page/nobody/has/written', '/Mixed-Case']) {
      expect((await page(path)).statusCode, path).toBe(200);
    }
  });

  it('is a plain page, with no 404, on a search engines-off test server', async () => {
    const off = await buildApp({
      config: { LOG_LEVEL: 'silent', SITE_ORIGIN: SITE, SEARCH_ENGINES: 'off' },
      db,
      pageTemplate: TEMPLATE,
    });
    try {
      const res = await off.inject({ method: 'GET', url: '/api/site/page/terms' });
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('name="robots" content="noindex"');
      expect(res.body).toContain('Terms of use and contact');
    } finally {
      await off.close();
    }
  });
});

describe('behind the site password', () => {
  beforeAll(async () => {
    await db
      .updateTable('site_access')
      .set({ enabled: true, password_hash: await hashPassword('page-head-test-password') })
      .where('id', '=', true)
      .execute();
  });
  afterAll(async () => {
    await liftCurtain(db);
  });

  it('answers the same generic head for every address, whether or not it exists', async () => {
    for (const path of [`/${lb.slug}`, '/terms', '/no-such-address-anywhere', '/maps/nope']) {
      const res = await page(path);
      // In front of the password, so a bot is answered; 200 for all, so the
      // status says nothing about which addresses are logbooks.
      expect(res.statusCode, path).toBe(200);
      expect(res.body, path).toContain('name="robots" content="noindex"');
      expect(res.body, path).not.toContain('rel="canonical"');
      expect(res.body, path).not.toContain('property="og:url"');
      expect(res.body, path).not.toContain('Noise');
      expect(res.body, path).not.toContain('Terms of use');
      expect(res.body, path).toContain('/assets/app.js');
    }
  });
});
