/**
 * The site's settings against a real database and a real app. Ports
 * legacy's legal-selftest.mjs and home-buttons-selftest.mjs, and checks the
 * settings routes refuse anybody the guard refuses.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.ts';
import { HttpError } from '../../src/http/errors.ts';
import {
  BUILTIN_REFS,
  HomeButtonRefusal,
  availableButtons,
  clearHomeButtons,
  homeButtons,
  setHomeButtons,
  storedOrder,
} from '../../src/site/homeButtons.ts';
import { SKELETONS } from '../../src/site/legal.ts';
import { siteAdminRoutes } from '../../src/site/routes.ts';
import { readSettings, writeSettings } from '../../src/site/settings.ts';
import { launchedLogbook, testDatabase, uniqueSlug } from './helpers.ts';

const db = testDatabase();
let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({ config: { LOG_LEVEL: 'silent' }, db });
  // A stand-in for workstream A's guard: an administrator is whoever sends
  // this header. The point is to prove the routes sit behind whatever guard
  // they are given.
  await siteAdminRoutes(app, db, {
    requireAdmin: (request) => {
      if (request.headers['x-test-admin'] !== 'yes') {
        return Promise.reject(
          new HttpError(403, 'forbidden', 'Only an administrator can do that.'),
        );
      }
      return Promise.resolve();
    },
  });
});
afterAll(async () => {
  await clearHomeButtons(db);
  await writeSettings(db, { impressum_text: null, privacy_text: null, site_name: null });
  await app.close();
  await db.destroy();
});

const get = async <T>(url: string) => (await app.inject({ method: 'GET', url })).json<T>();
const published = () => get<{ impressum: string | null; privacy: string | null }>('/api/legal');
const admin = (method: 'GET' | 'PUT', url: string, payload?: unknown) =>
  app.inject({ method, url, headers: { 'x-test-admin': 'yes' }, ...(payload ? { payload } : {}) });

describe('a deployment that has published no legal text', () => {
  beforeEach(async () => {
    await writeSettings(db, { impressum_text: null, privacy_text: null });
  });

  it('stores NULL as NULL, and serves null rather than a placeholder', async () => {
    const row = await readSettings(db);
    expect([row.impressum_text, row.privacy_text]).toEqual([null, null]);
    expect(await published()).toEqual({ impressum: null, privacy: null });
  });

  it('never serves the outline the editor starts on', async () => {
    const served = JSON.stringify(await published());
    expect(served).not.toContain('outline to complete');
    expect(served).not.toContain('OUTLINE');
    const editor = (await admin('GET', '/api/admin/site')).json<{
      legal: { kind: string; text: string; published: boolean }[];
    }>();
    expect(editor.legal).toEqual([
      { kind: 'impressum', text: SKELETONS.impressum, published: false },
      { kind: 'privacy', text: SKELETONS.privacy, published: false },
    ]);
  });
});

describe('what an operator actually wrote', () => {
  const IMPRESSUM = 'Munich Incident Archive e.V.\nBeispielstraße 1\n80331 München';

  it('is served back exactly as typed, newlines and all', async () => {
    const res = await admin('PUT', '/api/admin/site/legal/impressum', { text: IMPRESSUM });
    expect(res.statusCode).toBe(200);
    expect(await published()).toEqual({ impressum: IMPRESSUM, privacy: null });
  });

  it('is published unchanged, whatever it says', async () => {
    await admin('PUT', '/api/admin/site/legal/privacy', { text: 'we do not have one, ask me' });
    expect((await published()).privacy).toBe('we do not have one, ask me');
  });

  it('comes down when the box is emptied or holds only whitespace', async () => {
    await admin('PUT', '/api/admin/site/legal/impressum', { text: '   \n  ' });
    expect((await published()).impressum).toBeNull();
    expect((await readSettings(db)).impressum_text).toBeNull();
    await writeSettings(db, { impressum_text: '' });
    expect((await published()).impressum).toBeNull();
  });
});

describe('the settings routes', () => {
  it('refuse anybody the guard refuses, and change nothing', async () => {
    const before = await readSettings(db);
    for (const [method, url, payload] of [
      ['GET', '/api/admin/site', undefined],
      ['PUT', '/api/admin/site/look', { palette: 'midnight' }],
      ['PUT', '/api/admin/site/name', { name: 'Taken' }],
      ['PUT', '/api/admin/site/copy/home_headline', { body: 'Taken' }],
      ['PUT', '/api/admin/site/legal/impressum', { text: 'Taken' }],
      ['PUT', '/api/admin/site/home-buttons', { order: [] }],
    ] as const) {
      const res = await app.inject({ method, url, ...(payload ? { payload } : {}) });
      expect(res.statusCode, url).toBe(403);
    }
    expect(await readSettings(db)).toEqual(before);
  });

  it('are not mounted at all by the app on its own', async () => {
    const bare = await buildApp({ config: { LOG_LEVEL: 'silent' }, db });
    const res = await bare.inject({
      method: 'PUT',
      url: '/api/admin/site/look',
      payload: { palette: 'ink' },
    });
    expect(res.statusCode).toBe(404);
    await bare.close();
  });

  it('change the look one axis at a time, and every page reads it', async () => {
    await admin('PUT', '/api/admin/site/look', { palette: 'midnight' });
    await admin('PUT', '/api/admin/site/look', { theme: 'docket' });
    expect((await get<{ look: unknown }>('/api/site')).look).toEqual({
      palette: 'midnight',
      theme: 'docket',
    });
    const refused = await admin('PUT', '/api/admin/site/look', { palette: 'retired' });
    expect(refused.statusCode).toBe(400);
    expect(refused.json()).toEqual({
      error: { code: 'refused', message: 'That is not one of the palettes on offer.' },
    });
    await admin('PUT', '/api/admin/site/look', { palette: 'flint', theme: 'signal' });
  });

  it('a palette the code no longer offers reads as the default', async () => {
    await writeSettings(db, { palette: 'retired' as 'flint' });
    expect((await get<{ look: unknown }>('/api/site')).look).toEqual({
      palette: 'flint',
      theme: 'signal',
    });
    await writeSettings(db, { palette: 'flint' });
  });

  it('rename the site, marks and all, and the plain name loses the marks', async () => {
    await admin('PUT', '/api/admin/site/name', { name: 'Munich"Log"' });
    const site = await get<{ name: string; plain_name: string; name_parts: unknown[] }>(
      '/api/site',
    );
    expect(site).toMatchObject({ name: 'Munich"Log"', plain_name: 'MunichLog' });
    expect(site.name_parts).toEqual([
      { text: 'Munich', mark: '' },
      { text: 'Log', mark: 'a' },
    ]);
    const manifest = await app.inject({ method: 'GET', url: '/api/site/manifest.webmanifest' });
    expect(manifest.headers['content-type']).toMatch(/application\/manifest\+json/);
    expect(manifest.json<{ name: string }>().name).toBe('MunichLog');

    const typo = await admin('PUT', '/api/admin/site/name', { name: 'Munich"Log' });
    expect(typo.statusCode).toBe(400);
    await admin('PUT', '/api/admin/site/name', { name: null });
    expect((await get<{ name: string }>('/api/site')).name).toBe('ReportLog');
  });

  it('write page wording, and clearing it goes back to what ships', async () => {
    await admin('PUT', '/api/admin/site/copy/home_headline', { body: 'Our own words.' });
    expect((await get<{ copy: Record<string, string> }>('/api/site')).copy.home_headline).toBe(
      'Our own words.',
    );
    await admin('PUT', '/api/admin/site/copy/home_headline', { body: '' });
    const after = (await get<{ copy: Record<string, string> }>('/api/site')).copy.home_headline;
    expect(after).toBe('A record of what happened, that cannot be quietly changed.');
    const rows = await db
      .selectFrom('site_copy')
      .selectAll()
      .where('key', '=', 'home_headline')
      .execute();
    expect(rows).toEqual([]);
    const unknown = await admin('PUT', '/api/admin/site/copy/consent_text', { body: 'x' });
    expect(unknown.statusCode).toBe(400);
  });
});

describe('the front page’s buttons', () => {
  let first: { id: number; slug: string };
  beforeAll(async () => {
    await clearHomeButtons(db);
    first = await launchedLogbook(db);
  });

  it('unarranged, is NULL rather than an empty list, and names every open logbook', async () => {
    expect(await storedOrder(db)).toBeNull();
    const buttons = await homeButtons(db);
    expect(buttons.some((b) => b.kind === 'logbook' && b.ref === first.slug)).toBe(true);
    expect(buttons.some((b) => b.ref === 'board') && buttons.some((b) => b.ref === 'alerts')).toBe(
      true,
    );
    expect(buttons.filter((b) => b.accent)).toHaveLength(1);
    expect(buttons[0]?.accent).toBe(true);
    // The logbooks are named, so the generic button is not there.
    expect(buttons.some((b) => b.ref === 'submit')).toBe(false);
  });

  it('a logbook that is not launched is not a button', async () => {
    const slug = uniqueSlug('draft');
    await db.insertInto('logbooks').values({ slug, title: 'A draft' }).execute();
    expect((await homeButtons(db)).some((b) => b.ref === slug)).toBe(false);
  });

  it('the order and the accent are the operator’s', async () => {
    await setHomeButtons(db, [
      { kind: 'builtin', ref: 'board' },
      { kind: 'logbook', ref: first.slug },
    ]);
    const buttons = await homeButtons(db);
    expect(buttons[0]).toMatchObject({ ref: 'board', accent: true });
    expect(buttons.filter((b) => b.accent)).toHaveLength(1);
    expect(buttons.some((b) => b.ref === 'alerts')).toBe(false);
  });

  it('a logbook made AFTER the page was arranged is appended, without the accent', async () => {
    const later = await launchedLogbook(db);
    const buttons = await homeButtons(db);
    expect(buttons.some((b) => b.kind === 'logbook' && b.ref === later.slug)).toBe(true);
    expect(buttons[0]).toMatchObject({ ref: 'board', accent: true });
    expect(buttons.filter((b) => b.accent)).toHaveLength(1);
    // A built-in the operator removed is not put back.
    expect(buttons.some((b) => b.ref === 'alerts')).toBe(false);
  });

  it.todo(
    'a logbook that closes drops off, and its place is kept for when it reopens (needs workstream B to close a logbook)',
  );

  // The logbook a label is tried on is only known once the suite has made it.
  const refusals = (slug: string): [string, string, unknown][] => [
    ['not a list', 'not-a-list', 'nope'],
    [
      'a button that does not exist',
      'unknown-button',
      [{ kind: 'logbook', ref: 'no-such-logbook-anywhere' }],
    ],
    [
      'a button listed twice',
      'duplicate',
      [
        { kind: 'builtin', ref: 'board' },
        { kind: 'builtin', ref: 'board' },
      ],
    ],
    ['a kind that is not a kind', 'bad-entry', [{ kind: 'spaceship', ref: 'board' }]],
    ['a label on a built-in', 'builtin-label', [{ kind: 'builtin', ref: 'board', label: 'Mine' }]],
    [
      'a label too long for a button',
      'label-too-long',
      [{ kind: 'logbook', ref: slug, label: 'x'.repeat(81) }],
    ],
  ];
  for (const [what, reason] of refusals('')) {
    it(`refuses ${what}, by name, and changes nothing`, async () => {
      const value = refusals(first.slug).find(([w]) => w === what)?.[2];
      const before = await storedOrder(db);
      const refused = await setHomeButtons(db, value).then(
        () => null,
        (e: unknown) => e,
      );
      expect(refused).toBeInstanceOf(HomeButtonRefusal);
      expect((refused as HomeButtonRefusal).reason).toBe(reason);
      expect(await storedOrder(db)).toEqual(before);
    });
  }

  it('stores a label override as given, and no label as no key at all', async () => {
    const saved = await setHomeButtons(db, [
      { kind: 'logbook', ref: first.slug, label: '  Report a problem  ' },
      { kind: 'builtin', ref: 'board', label: '' },
    ]);
    expect(saved).toEqual([
      { kind: 'logbook', ref: first.slug, label: 'Report a problem' },
      { kind: 'builtin', ref: 'board' },
    ]);
    const button = (await homeButtons(db))[0];
    expect(button).toMatchObject({ label: 'Report a problem', title: `Logbook ${first.slug}` });
  });

  it('an operator who removes every button gets an empty list, and the logbooks still come back', async () => {
    await setHomeButtons(db, []);
    expect(await storedOrder(db)).toEqual([]);
    const buttons = await homeButtons(db);
    // "No buttons" cannot mean "no way to file": the logbooks are appended.
    expect(buttons.some((b) => b.kind === 'logbook')).toBe(true);
    expect(buttons.some((b) => BUILTIN_REFS.includes(b.ref))).toBe(false);
  });

  it('back to the shipped order is NULL again, over HTTP too', async () => {
    const res = await admin('PUT', '/api/admin/site/home-buttons', { order: null });
    expect(res.statusCode).toBe(200);
    expect(await storedOrder(db)).toBeNull();
    const served = await get<{ buttons: { ref: string }[] }>('/api/home/buttons');
    expect(served.buttons.some((b) => b.ref === 'board')).toBe(true);
  });

  it('offers the settings screen every open logbook and every built-in, Submit included', async () => {
    const avail = await availableButtons(db);
    expect(avail.logbooks.some((b) => b.ref === first.slug)).toBe(true);
    expect(avail.builtins.some((b) => b.ref === 'submit')).toBe(true);
    expect(avail.lists.every((b) => b.kind === 'list')).toBe(true);
  });

  it('refuses a bad arrangement over HTTP with a sentence', async () => {
    const res = await admin('PUT', '/api/admin/site/home-buttons', {
      order: [{ kind: 'logbook', ref: 'no-such-logbook-anywhere' }],
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: {
        code: 'refused',
        message: 'There is nothing on this site called "no-such-logbook-anywhere".',
      },
    });
  });
});
