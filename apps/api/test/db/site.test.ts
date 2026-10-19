/**
 * The site's settings against a real database and a real app. Ports
 * legacy's legal-selftest.mjs (the front page's buttons are B's: see
 * home-buttons.test.ts), and checks that only an administrator reaches the
 * settings routes.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SKELETONS } from '../../src/site/legal.ts';
import { readSettings, writeSettings } from '../../src/site/settings.ts';
import { address, harness, seat, signIn } from './identity-helpers.ts';
import type { Harness } from './identity-helpers.ts';

let h: Harness;
let db: Harness['db'];
let app: Harness['app'];
/** An administrator, signed in the way a person would be. */
let adminSession: string;
/** Signed in, but not an administrator. */
let moderatorSession: string;

beforeAll(async () => {
  h = await harness();
  ({ db, app } = h);
  const adminEmail = address('settings-admin');
  await seat(db, adminEmail, 'admin');
  adminSession = await signIn(h, adminEmail);
  const modEmail = address('settings-moderator');
  await seat(db, modEmail, 'moderator');
  moderatorSession = await signIn(h, modEmail);
});
afterAll(async () => {
  await writeSettings(db, { impressum_text: null, privacy_text: null, site_name: null });
  await h.close();
});

const get = async <T>(url: string) => (await app.inject({ method: 'GET', url })).json<T>();
const published = () => get<{ impressum: string | null; privacy: string | null }>('/api/legal');
const admin = (method: 'GET' | 'PUT', url: string, payload?: unknown) =>
  app.inject({
    method,
    url,
    cookies: { session_token: adminSession },
    ...(payload ? { payload } : {}),
  });

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
  it('refuse somebody signed out and a moderator, and change nothing', async () => {
    const before = await readSettings(db);
    for (const [method, url, payload] of [
      ['GET', '/api/admin/site', undefined],
      ['PUT', '/api/admin/site/look', { palette: 'midnight' }],
      ['PUT', '/api/admin/site/name', { name: 'Taken' }],
      ['PUT', '/api/admin/site/copy/home_headline', { body: 'Taken' }],
      ['PUT', '/api/admin/site/legal/impressum', { text: 'Taken' }],
    ] as const) {
      const body = payload ? { payload } : {};
      expect((await app.inject({ method, url, ...body })).statusCode, url).toBe(401);
      const asModerator = await app.inject({
        method,
        url,
        cookies: { session_token: moderatorSession },
        ...body,
      });
      expect(asModerator.statusCode, url).toBe(403);
    }
    expect(await readSettings(db)).toEqual(before);
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
