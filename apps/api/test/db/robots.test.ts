/**
 * robots.txt and the sitemap (site/robots.ts): open to search engines on a
 * site without a password, closed behind one and on a test server
 * (SEARCH_ENGINES=off), and listing what is taking reports now.
 *
 * Sets the site password, so it puts it back off after (files take turns:
 * vitest.config.ts).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.ts';
import { hashPassword } from '../../src/identity/secrets.ts';
import { launchedLogbook, testDatabase } from './helpers.ts';
import { SITE, harness, liftCurtain } from './identity-helpers.ts';
import type { Harness } from './identity-helpers.ts';

let h: Harness;
let lb: { id: number; slug: string };

beforeAll(async () => {
  h = await harness();
  await liftCurtain(h.db);
  lb = await launchedLogbook(h.db);
});
afterAll(async () => {
  await liftCurtain(h.db);
  await h.close();
});

const get = (url: string) => h.app.inject({ method: 'GET', url });

describe('an open site', () => {
  it('invites crawlers in, keeps them off the API and token links, and names the sitemap', async () => {
    const res = await get('/api/site/robots.txt');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/plain/);
    expect(res.body).toContain('User-agent: *');
    expect(res.body).toContain('Disallow: /api/');
    expect(res.body).toContain('Disallow: /file/confirm/');
    expect(res.body).not.toMatch(/^Disallow: \/$/m);
    expect(res.body).toContain(`Sitemap: ${SITE}/sitemap.xml`);
  });

  it('lists the public pages and a logbook taking reports, never a single report', async () => {
    const res = await get('/api/site/sitemap.xml');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/xml/);
    expect(res.body).toContain(`<loc>${SITE}/</loc>`);
    expect(res.body).toContain(`<loc>${SITE}/board</loc>`);
    expect(res.body).toContain(`<loc>${SITE}/${lb.slug}</loc>`);
    expect(res.body).not.toContain('/board/RL-');
  });

  it('leaves out a draft and a closed logbook', async () => {
    const draft = await h.db
      .insertInto('logbooks')
      .values({ slug: `draft-${String(lb.id)}`, title: 'Not yet' })
      .returning('slug')
      .executeTakeFirstOrThrow();
    const closed = await launchedLogbook(h.db);
    await h.db
      .updateTable('logbooks')
      .set({ closed_at: new Date() })
      .where('id', '=', closed.id)
      .execute();
    const body = (await get('/api/site/sitemap.xml')).body;
    expect(body).not.toContain(`/${draft.slug}<`);
    expect(body).not.toContain(`/${closed.slug}<`);
  });
});

describe('behind the site password', () => {
  beforeAll(async () => {
    await h.db
      .updateTable('site_access')
      .set({ enabled: true, password_hash: await hashPassword('robots-test-password') })
      .where('id', '=', true)
      .execute();
  });
  afterAll(async () => {
    await liftCurtain(h.db);
  });

  it('answers a crawler, which has no password, and asks it to stay out', async () => {
    const res = await get('/api/site/robots.txt');
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('User-agent: *\nDisallow: /\n');
  });

  it('lists nothing: the logbooks are behind the password too', async () => {
    const res = await get('/api/site/sitemap.xml');
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('<url>');
    expect(res.body).not.toContain(lb.slug);
  });
});

describe('a test server (SEARCH_ENGINES=off)', () => {
  it('asks every crawler to stay out, and lists nothing', async () => {
    const db = testDatabase();
    const app = await buildApp({
      config: { LOG_LEVEL: 'silent', SITE_ORIGIN: SITE, SEARCH_ENGINES: 'off' },
      db,
    });
    try {
      const robots = await app.inject({ method: 'GET', url: '/api/site/robots.txt' });
      expect(robots.body).toBe('User-agent: *\nDisallow: /\n');
      const map = await app.inject({ method: 'GET', url: '/api/site/sitemap.xml' });
      expect(map.body).not.toContain('<url>');
    } finally {
      await app.close();
      await db.destroy();
    }
  });
});
