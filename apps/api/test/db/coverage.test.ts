/**
 * Coverage (decision 84): a journalist links an article to their profile,
 * a moderator approves it, and only then, and only if its author chose to
 * list it, does it reach the public list, the map counts and a public card.
 */
import type { CoverageCounts, MyCoverage, QueuedArticle } from '@reportlog/contracts';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildApp } from '../../src/app.ts';
import { createDatabase } from '../../src/db/database.ts';
import { migrate } from '../../src/db/migrate.ts';
import { createThrowawayDatabase, type Throwaway } from '../../src/db/throwaway.ts';
import { capturingMailer } from '../../src/email/mailer.ts';
import { address, as, seat, signIn, type Harness } from './identity-helpers.ts';
import { LINK_CONTACT_KEY } from './links-helpers.ts';

// ITS OWN DATABASE: the agreements it publishes are global and append-only.
let throwaway: Throwaway;
let h: Harness;
let page: Server;
let pageHits = 0;

type Call = ReturnType<typeof as>;
let admin: Call;
let moderator: Call;
let journalist: Call;
let journalistEmail = '';

const ARTICLE = {
  url: 'http://news.example/2026/11/03/lines?utm_source=x',
  happened_on: '2026-11-03',
  national: false,
  international: false,
  places: ['US-AZ-04013', 'US-AZ-04019', 'US-GA'],
  listed: true,
};

async function accept(call: Call, audience: 'journalist' | 'moderator') {
  const state = await call({ method: 'GET', url: `/api/agreement/${audience}` });
  const digest = state.json<{ current: { digest: string } }>().current.digest;
  const r = await call({
    method: 'POST',
    url: `/api/agreement/${audience}/accept`,
    payload: { digest },
  });
  expect(r.statusCode, r.body).toBe(200);
}

/** Sign in, apply from the account, be approved, accept: a journalist with desk access. */
async function newJournalist(stem: string): Promise<{ email: string; call: Call }> {
  const email = address(stem);
  const call = as(h, await signIn(h, email));
  const digest = (await call({ method: 'GET', url: '/api/agreement/journalist' })).json<{
    current: { digest: string };
  }>().current.digest;
  const applied = await call({
    method: 'POST',
    url: '/api/journalists/me/apply',
    payload: {
      name: 'Pat Reporter',
      outlet: 'Desk Daily',
      role: 'Reporter',
      about: 'Courts.',
      agreement_digest: digest,
    },
  });
  expect(applied.statusCode, applied.body).toBe(200);
  const queue = (await admin({ method: 'GET', url: '/api/owner/journalists' })).json<{
    requests: { id: number; status: string }[];
  }>().requests;
  const id = queue.find((r) => r.status === 'pending')?.id ?? 0;
  const ok = await admin({ method: 'POST', url: `/api/owner/journalists/${String(id)}/approve` });
  expect(ok.statusCode, ok.body).toBe(200);
  // A fresh session: the role was given after this one was made.
  return { email, call: as(h, await signIn(h, email)) };
}

const mine = async (call: Call) =>
  (await call({ method: 'GET', url: '/api/coverage/mine' })).json<MyCoverage>();
const publicList = async (query = '') =>
  (await h.app.inject({ method: 'GET', url: `/api/coverage${query}` })).json<{
    articles: { id: number; url: string; byline: unknown; places: { code: string }[] }[];
    total: number;
  }>();
const counts = async () =>
  (await h.app.inject({ method: 'GET', url: '/api/coverage/counts' })).json<CoverageCounts>();

beforeAll(async () => {
  page = createServer((req, res) => {
    pageHits += 1;
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(
      `<head><meta property="og:title" content="Lines in ${req.url ?? ''}"><meta property="og:site_name" content="News Example"></head>`,
    );
  });
  await new Promise<void>((r) => page.listen(0, '127.0.0.1', r));
  const port = (page.address() as AddressInfo).port;

  throwaway = await createThrowawayDatabase(inject('serverUrl'), 'coverage');
  await migrate(throwaway.url);
  const db = createDatabase(throwaway.url, 10);
  const mailer = capturingMailer();
  const app = await buildApp({
    config: {
      LOG_LEVEL: 'silent',
      SITE_ORIGIN: 'https://reports.example.test',
      CONTACT_KEY: LINK_CONTACT_KEY,
    },
    db,
    mailer,
    // Every name reaches the test's own page; nothing else is reachable.
    coverageFetch: {
      resolve: () => Promise.resolve([{ address: '127.0.0.1', family: 4 }]),
      allowed: (a) => a === '127.0.0.1',
      testPort: port,
    },
  });
  h = {
    db,
    app,
    mailer,
    close: async () => {
      await app.close();
      await db.destroy();
    },
  };
  const adminEmail = address('cov-admin');
  await seat(db, adminEmail, 'admin');
  admin = as(h, await signIn(h, adminEmail));
  const modEmail = address('cov-mod');
  await seat(db, modEmail, 'moderator');
  moderator = as(h, await signIn(h, modEmail));
  for (const audience of ['journalist', 'moderator'] as const) {
    const pub = await admin({
      method: 'POST',
      url: `/api/admin/agreement/${audience}`,
      payload: { body: `The ${audience} agreement.` },
    });
    expect(pub.statusCode, pub.body).toBe(200);
  }
  await accept(admin, 'moderator');
  await accept(moderator, 'moderator');
  const j = await newJournalist('cov-journalist');
  journalist = j.call;
  journalistEmail = j.email;
});

afterAll(async () => {
  await h.close();
  await throwaway.drop();
  await new Promise<void>((r) => {
    page.close(() => {
      r();
    });
  });
});

describe('who may use the profile', () => {
  it('refuses a stranger, a plain account and a moderator', async () => {
    expect((await h.app.inject({ method: 'GET', url: '/api/coverage/mine' })).statusCode).toBe(401);
    const plain = as(h, await signIn(h, address('cov-plain')));
    expect((await plain({ method: 'GET', url: '/api/coverage/mine' })).statusCode).toBe(403);
    expect((await moderator({ method: 'GET', url: '/api/coverage/mine' })).statusCode).toBe(403);
  });

  it('refuses the queue to a journalist', async () => {
    const r = await journalist({ method: 'GET', url: '/api/moderation/coverage' });
    expect(r.statusCode).toBe(403);
  });
});

describe('linking an article', () => {
  it('sets a byline, links an article, and keeps it waiting', async () => {
    const b = await journalist({
      method: 'PUT',
      url: '/api/coverage/mine/byline',
      payload: { name: 'Pat Reporter', outlet: 'Desk Daily' },
    });
    expect(b.statusCode, b.body).toBe(200);
    const r = await journalist({
      method: 'POST',
      url: '/api/coverage/mine/articles',
      payload: ARTICLE,
    });
    expect(r.statusCode, r.body).toBe(200);
    const got = r.json<MyCoverage>();
    expect(got.byline).toEqual({ name: 'Pat Reporter', outlet: 'Desk Daily' });
    expect(got.articles).toHaveLength(1);
    expect(got.articles[0]).toMatchObject({
      // Trackers are stripped, as everywhere a link is stored.
      url: 'http://news.example/2026/11/03/lines',
      host: 'news.example',
      happened_on: '2026-11-03',
      review: 'waiting',
      listed: true,
    });
    expect(got.articles[0]?.places.map((p) => p.code)).toEqual([
      'US-AZ-04013',
      'US-AZ-04019',
      'US-GA',
    ]);
    expect(got.articles[0]?.places[2]?.name).toBe('Georgia');
  });

  it('refuses a second copy, no place at all, an unknown place, a bad date and a bad link', async () => {
    const post = (payload: Record<string, unknown>) =>
      journalist({ method: 'POST', url: '/api/coverage/mine/articles', payload });
    const codeOf = async (payload: Record<string, unknown>) =>
      (await post(payload)).json<{ error?: { code: string } }>().error?.code;
    expect(await codeOf(ARTICLE)).toBe('already_linked');
    expect((await post({ ...ARTICLE, url: 'http://news.example/b', places: [] })).statusCode).toBe(
      400,
    );
    expect(await codeOf({ ...ARTICLE, url: 'http://news.example/c', places: ['US-ZZ'] })).toBe(
      'unknown_place',
    );
    expect(
      await codeOf({ ...ARTICLE, url: 'http://news.example/d', happened_on: '2026-02-30' }),
    ).toBe('bad_date');
    expect(await codeOf({ ...ARTICLE, url: 'https://bit.ly/x' })).toBe('bad_url');
    expect(await codeOf({ ...ARTICLE, url: 'http://10.0.0.1/x' })).toBe('bad_url');
  });

  it('takes National and International without a place', async () => {
    const r = await journalist({
      method: 'POST',
      url: '/api/coverage/mine/articles',
      payload: {
        url: 'https://wire.example/national',
        national: true,
        international: false,
        places: [],
        listed: true,
      },
    });
    expect(r.statusCode, r.body).toBe(200);
    const r2 = await journalist({
      method: 'POST',
      url: '/api/coverage/mine/articles',
      payload: {
        url: 'https://wire.example/abroad',
        national: false,
        international: true,
        places: ['DE'],
        listed: false,
      },
    });
    expect(r2.statusCode, r2.body).toBe(200);
  });
});

describe('nothing is public until a moderator approves it', () => {
  it('the public list, counts and cards show nothing while it waits', async () => {
    expect((await publicList()).total).toBe(0);
    expect((await counts()).total).toBe(0);
    const id = (await mine(journalist)).articles.at(-1)?.id ?? 0;
    const card = await h.app.inject({ method: 'GET', url: `/api/coverage/${String(id)}/card` });
    expect(card.statusCode).toBe(404);
  });

  it('its author and a moderator may see its card while it waits; the page is read once', async () => {
    const id = (await mine(journalist)).articles.at(-1)?.id ?? 0;
    const before = pageHits;
    const own = await journalist({ method: 'GET', url: `/api/coverage/${String(id)}/card` });
    expect(own.json()).toMatchObject({
      found: true,
      title: 'Lines in /2026/11/03/lines',
      site_name: 'News Example',
    });
    const mod = await moderator({ method: 'GET', url: `/api/coverage/${String(id)}/card` });
    expect(mod.statusCode).toBe(200);
    expect(pageHits).toBe(before + 1);
  });

  it('the queue holds all three, oldest first, with the byline', async () => {
    const q = (await moderator({ method: 'GET', url: '/api/moderation/coverage' })).json<{
      articles: QueuedArticle[];
      waiting: number;
    }>();
    expect(q.waiting).toBe(3);
    expect(q.articles.map((a) => a.host)).toEqual(['news.example', 'wire.example', 'wire.example']);
    expect(q.articles[0]?.byline).toEqual({ name: 'Pat Reporter', outlet: 'Desk Daily' });
  });

  it('approving shows the listed ones; the unlisted stays on the profile only', async () => {
    const q = (await moderator({ method: 'GET', url: '/api/moderation/coverage' })).json<{
      articles: QueuedArticle[];
    }>();
    for (const a of q.articles) {
      const r = await moderator({
        method: 'POST',
        url: `/api/moderation/coverage/${String(a.id)}`,
        payload: { decision: 'approved' },
      });
      expect(r.statusCode, r.body).toBe(200);
      expect(r.json<QueuedArticle>().reviewed_by).not.toBeNull();
    }
    const list = await publicList();
    expect(list.total).toBe(2);
    expect(list.articles.map((a) => a.url).sort()).toEqual([
      'http://news.example/2026/11/03/lines',
      'https://wire.example/national',
    ]);
    expect(list.articles.find((a) => a.url.includes('news'))?.byline).toEqual({
      name: 'Pat Reporter',
      outlet: 'Desk Daily',
    });
    expect(list.articles.some((a) => a.url === 'https://wire.example/abroad')).toBe(false);
  });

  it('counts each article once per area, a state holding its counties', async () => {
    expect(await counts()).toEqual({
      areas: { 'US-AZ': 1, 'US-GA': 1 },
      counties: { 'US-AZ-04013': 1, 'US-AZ-04019': 1 },
      national: 1,
      international: 0,
      total: 2,
    });
  });

  it('a clicked place narrows the list, a state holding its counties', async () => {
    expect((await publicList('?place=US-AZ')).total).toBe(1);
    expect((await publicList('?place=US-AZ-04013')).total).toBe(1);
    expect((await publicList('?place=US-TX')).total).toBe(0);
    // The whole country on a world map: every US place and the national ones.
    expect((await publicList('?place=US')).total).toBe(2);
  });

  it('a public card for an approved, listed one, without signing in', async () => {
    const id = (await publicList()).articles[0]?.id ?? 0;
    const r = await h.app.inject({ method: 'GET', url: `/api/coverage/${String(id)}/card` });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ found: true });
  });

  it('declining takes one off again, and its author sees the note', async () => {
    const id = (await mine(journalist)).articles.find((a) => a.url.endsWith('/national'))?.id ?? 0;
    await moderator({
      method: 'POST',
      url: `/api/moderation/coverage/${String(id)}`,
      payload: { decision: 'declined', note: 'Not about an event.' },
    });
    expect((await publicList()).total).toBe(1);
    const own = (await mine(journalist)).articles.find((a) => a.id === id);
    expect(own).toMatchObject({ review: 'declined', review_note: 'Not about an event.' });
  });
});

describe('the author stays in charge of their own', () => {
  it('unlisting takes it off the list and the counts without a new review', async () => {
    const id = (await publicList()).articles[0]?.id ?? 0;
    await journalist({
      method: 'POST',
      url: `/api/coverage/mine/articles/${String(id)}/listed`,
      payload: { listed: false },
    });
    expect((await publicList()).total).toBe(0);
    await journalist({
      method: 'POST',
      url: `/api/coverage/mine/articles/${String(id)}/listed`,
      payload: { listed: true },
    });
    expect((await publicList()).total).toBe(1);
  });

  it('another journalist cannot touch it', async () => {
    const other = await newJournalist('cov-other');
    const id = (await publicList()).articles[0]?.id ?? 0;
    const r = await other.call({
      method: 'DELETE',
      url: `/api/coverage/mine/articles/${String(id)}`,
    });
    expect(r.statusCode).toBe(404);
    expect((await publicList()).total).toBe(1);
  });

  it('when their access ends the articles leave the public list at once, and come back with it', async () => {
    await h.db
      .updateTable('users')
      .set({ roles: [] })
      .where('email', '=', journalistEmail)
      .execute();
    expect((await publicList()).total).toBe(0);
    expect((await counts()).total).toBe(0);
    await h.db
      .updateTable('users')
      .set({ roles: ['journalist'] })
      .where('email', '=', journalistEmail)
      .execute();
    expect((await publicList()).total).toBe(1);
  });

  it('removing deletes it', async () => {
    const id = (await publicList()).articles[0]?.id ?? 0;
    const r = await journalist({
      method: 'DELETE',
      url: `/api/coverage/mine/articles/${String(id)}`,
    });
    expect(r.statusCode).toBe(200);
    expect((await publicList()).total).toBe(0);
    const left = await h.db
      .selectFrom('coverage_article_places')
      .select('code')
      .where('article_id', '=', id)
      .execute();
    expect(left).toEqual([]);
  });
});
