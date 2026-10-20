/**
 * K4 · A TIP LINK NEVER LEAVES THROUGH A PUBLIC DOOR.
 *
 * Plants a listed tips list whose counts are published, with approved
 * entries carrying a link on a host nobody else uses, a checked group and a
 * comment naming the same host. Then it asks EVERY registered GET route that
 * is not a staff route, as a stranger and as somebody signed in with no
 * role, and the downloads (the archive and the daily counts), and fails if
 * the host appears in any of them.
 *
 * THE ROUTES ARE FASTIFY'S OWN (review item 17), as in invariants.test.ts,
 * so a public route added next month is swept without anybody remembering.
 */
import type * as FastifyModule from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { exportArchive } from '../../src/anchor/archive.ts';
import { checkGroup, commentGroup } from '../../src/links/checks.ts';
import { matchKey } from '../../src/links/keys.ts';
import type { LinkKeys } from '../../src/links/keys.ts';
import { snapshotDocument } from '../../src/lists/aggregates.ts';
import { fileEntry } from '../../src/lists/entries.ts';
import { createFromTemplate, replaceFields } from '../../src/lists/manage.ts';
import { DEFAULT_LIST_SETTINGS } from '../../src/lists/retention.ts';
import { reviewEntries } from '../../src/lists/review.ts';
import { uniqueSlug } from './helpers.ts';
import { address, as, harness, liftCurtain, seat, signIn } from './identity-helpers.ts';
import type { Harness } from './identity-helpers.ts';
import { LINK_CONTACT_KEY, linkKeys } from './links-helpers.ts';

const registered = vi.hoisted(() => [] as { method: string; url: string }[]);
vi.mock('fastify', async (importOriginal) => {
  const real = await importOriginal<typeof FastifyModule>();
  const make = (opts: FastifyModule.FastifyServerOptions) => {
    const app = real.default(opts);
    app.addHook('onRoute', (o) => {
      for (const method of [o.method].flat()) registered.push({ method, url: o.url });
    });
    return app;
  };
  return { ...real, default: make };
});

/** As invariants.test.ts names them. Everything else is public, or a person's own. */
const STAFF_PREFIXES = [
  '/api/admin/',
  '/api/moderate/',
  '/api/moderation/',
  '/api/access/',
  '/api/intake/',
  '/api/list-review',
  '/api/link-checks',
];

const CANARY = `k4-canary-${String(process.pid)}${String(Date.now() % 1e6)}.example.net`;
const LINK = `https://${CANARY}/watch/1`;

let h: Harness;
let keys: LinkKeys;
let slug = '';
let routes: { method: string; url: string }[] = [];

beforeAll(async () => {
  registered.length = 0;
  h = await harness({ CONTACT_KEY: LINK_CONTACT_KEY });
  await h.app.ready();
  routes = registered.filter((r) => r.method === 'GET');
  keys = await linkKeys(h.db);
  await liftCurtain(h.db);

  // As exposed as a list can be: listed, counts published, questions counted.
  let tips = await createFromTemplate(h.db, 'tips', { slug: uniqueSlug('k4') });
  tips = await replaceFields(
    h.db,
    tips.id,
    tips.fields.map((f) =>
      f.key === 'state'
        ? { ...f, aggregatable: true, settings: { options: ['Ohio', 'Not sure'] } }
        : f,
    ),
  );
  await h.db
    .updateTable('lists')
    .set({ visibility: 'listed', aggregates_published: true })
    .where('id', '=', tips.id)
    .execute();
  slug = tips.slug;
  const ids: number[] = [];
  for (let i = 0; i < 3; i += 1) {
    const got = await fileEntry(
      h.db,
      slug,
      { answers: { links: LINK, state: 'Ohio', category: 'Not sure' } },
      { settings: DEFAULT_LIST_SETTINGS, keys },
    );
    ids.push(got.id);
  }
  await reviewEntries(h.db, tips.id, ids, { state: 'approved' });
  const group = await h.db
    .selectFrom('link_groups')
    .select('id')
    .where('match_key', '=', matchKey(keys, LINK))
    .executeTakeFirstOrThrow();
  await checkGroup(h.db, keys, group.id, { outcome: 'checked', actor: 'k4@example.org' });
  await commentGroup(h.db, group.id, { body: `Mirror of ${CANARY}`, actor: 'k4@example.org' });
});
afterAll(() => h.close());

/** A concrete address for a pattern: the planted list for a slug, a stand-in otherwise. */
const concrete = (url: string) =>
  url.replace(/:(\w+)/g, (_m, name: string) => (name === 'slug' ? slug : '1')).replace(/\*$/, '');

describe('K4 · no public route or download carries a tip link', () => {
  it('sees the routes from Fastify itself, public ones among them', () => {
    expect(routes.length).toBeGreaterThan(60);
    expect(routes).toContainEqual({ method: 'GET', url: '/api/lists/:slug/counts' });
  });

  it('the counts are really published, so the sweep is looking at a live list', async () => {
    const r = await h.app.inject({ method: 'GET', url: `/api/lists/${slug}/counts` });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('Ohio');
  });

  it('every public GET, to a stranger and to somebody signed in with no role', async () => {
    const email = address('k4');
    await seat(h.db, email, 'user');
    const signedIn = as(h, await signIn(h, email));
    const stranger = as(h);
    const leaked: string[] = [];
    for (const r of routes.filter((x) => !STAFF_PREFIXES.some((p) => x.url.startsWith(p)))) {
      for (const who of [stranger, signedIn]) {
        const res = await who({ method: 'GET', url: concrete(r.url) });
        if (res.body.includes(CANARY))
          leaked.push(`${r.method} ${r.url} → ${String(res.statusCode)}`);
      }
    }
    expect(leaked).toEqual([]);
  });

  it('and the sweep really looks: the host put in public wording is found', async () => {
    await h.db
      .updateTable('lists')
      .set({ title: `About ${CANARY}` })
      .where('slug', '=', slug)
      .execute();
    const hits: string[] = [];
    for (const r of routes.filter((x) => !STAFF_PREFIXES.some((p) => x.url.startsWith(p)))) {
      const res = await h.app.inject({ method: 'GET', url: concrete(r.url) });
      if (res.body.includes(CANARY)) hits.push(r.url);
    }
    await h.db.updateTable('lists').set({ title: 'K4 tips' }).where('slug', '=', slug).execute();
    expect(hits).toContain('/api/lists/:slug');
  });

  it('the downloads: the archive and the daily counts', async () => {
    expect(JSON.stringify(await exportArchive(h.db))).not.toContain(CANARY);
    const doc = await snapshotDocument(h.db);
    expect(doc.lists.some((l) => l.slug === slug)).toBe(true);
    expect(JSON.stringify(doc)).not.toContain(CANARY);
  });
});
