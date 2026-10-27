/**
 * The site's settings against a real database and a real app. Ports
 * legacy's legal-selftest.mjs (the front page's buttons are B's: see
 * home-buttons.test.ts), and checks that only an administrator reaches the
 * settings routes.
 */
import { readFileSync } from 'node:fs';
import { DEFAULT_LOOK, DEFAULT_LOOK_OPTIONS, THEMES } from '@reportlog/contracts';
import { sql } from 'kysely';
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
      ['PUT', '/api/admin/site/home-sections', { sections: [{ id: 'map', shown: false }] }],
      [
        'PUT',
        '/api/admin/site/social',
        { links: [{ id: 'instagram', address: '@taken', shown: true }] },
      ],
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
      panel_head: THEMES.find((t) => t.id === 'docket')?.panelHead,
      texture: THEMES.find((t) => t.id === 'docket')?.texture,
      width: 'narrow',
      columns: 'split',
      scale: 'standard',
      surface: 'outlined',
      second: 'muted',
      tag: 'plain',
      // Stage 6: Easier reading's dark flag, and no look packs installed.
      dark: true,
      stylesheets: [],
      // U1: zones, motion and the header background, and the packs' kits.
      options: DEFAULT_LOOK_OPTIONS,
      kits: [],
    });
    const refused = await admin('PUT', '/api/admin/site/look', { palette: 'retired' });
    expect(refused.statusCode).toBe(400);
    expect(refused.json()).toEqual({
      error: { code: 'refused', message: 'That is not one of the palettes on offer.' },
    });
    await admin('PUT', '/api/admin/site/look', { palette: 'flint', theme: 'signal' });
  });

  it('a palette the code no longer offers reads as the default', async () => {
    await writeSettings(db, { palette: 'retired', theme: 'signal' });
    expect((await get<{ look: unknown }>('/api/site')).look).toMatchObject({
      palette: DEFAULT_LOOK.palette,
      theme: 'signal',
    });
    await writeSettings(db, { palette: 'flint' });
  });

  it('a look stored before the look library reads as its replacement, and is saved as it', async () => {
    await writeSettings(db, { palette: 'harbour', theme: 'register' });
    expect((await get<{ look: unknown }>('/api/site')).look).toMatchObject({
      palette: 'darkroom',
      theme: 'console',
    });
    await admin('PUT', '/api/admin/site/look', { palette: 'harbour' });
    expect(await readSettings(db)).toMatchObject({ palette: 'darkroom' });
    await writeSettings(db, { palette: 'flint', theme: 'signal' });
  });
});

describe('the migration that brought in the look library', () => {
  // The migration is replayed as written (applied migrations never change),
  // except that "has an owner" now reads the roles list, which replaced the
  // `users.role` column it was written against (decision 70).
  const MIGRATION = readFileSync(
    new URL('../../migrations/20261022045623_look_library.sql', import.meta.url),
    'utf8',
  ).replaceAll("role = 'owner'", "roles @> ARRAY['owner']::text[]");

  /** Runs the migration again on the given state, reads the result, and undoes it all. */
  async function afterMigration(owner: boolean, before: { palette: string; theme: string }) {
    let seen: { palette: string; theme: string } | undefined;
    await db
      .transaction()
      .execute(async (trx) => {
        if (owner) await seat(trx, address('look-migration-owner'), 'owner');
        else
          await trx
            .updateTable('users')
            .set({ roles: sql<string[]>`array_remove(roles, 'owner')` })
            .where(sql<boolean>`roles @> ARRAY['owner']::text[]`)
            .execute();
        await trx.updateTable('site_settings').set(before).execute();
        await sql.raw(MIGRATION).execute(trx);
        seen = await trx
          .selectFrom('site_settings')
          .select(['palette', 'theme'])
          .executeTakeFirstOrThrow();
        throw new Undo();
      })
      .catch((e: unknown) => {
        if (!(e instanceof Undo)) throw e;
      });
    return seen;
  }
  class Undo extends Error {}

  it('a site with an owner keeps Flint and Signal, the look it was wearing', async () => {
    expect(await afterMigration(true, { palette: 'flint', theme: 'signal' })).toEqual({
      palette: 'flint',
      theme: 'signal',
    });
  });

  it('a site with an owner keeps a look it chose', async () => {
    expect(await afterMigration(true, { palette: 'harbour', theme: 'docket' })).toEqual({
      palette: 'harbour',
      theme: 'docket',
    });
  });

  it('an installation nobody has set up yet gets Desk', async () => {
    expect(await afterMigration(false, { palette: 'flint', theme: 'signal' })).toEqual({
      palette: 'platinum',
      theme: 'desk',
    });
  });

  it('a new row gets Desk', () => {
    expect(MIGRATION).toMatch(/ALTER COLUMN palette SET DEFAULT 'platinum'/);
    expect(MIGRATION).toMatch(/ALTER COLUMN theme SET DEFAULT 'desk'/);
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
    expect(after).toBe('What happened, in the words of people who were there.');
    const rows = await db
      .selectFrom('site_copy')
      .selectAll()
      .where('key', '=', 'home_headline')
      .execute();
    expect(rows).toEqual([]);
    const unknown = await admin('PUT', '/api/admin/site/copy/consent_text', { body: 'x' });
    expect(unknown.statusCode).toBe(400);
  });

  it('arrange the front page’s quieter sections, keeping any the screen left out', async () => {
    type Sections = { id: string; shown: boolean }[];
    const shipped = (await get<{ home_sections: Sections }>('/api/site')).home_sections;
    expect(shipped.every((s) => s.shown)).toBe(true);
    const res = await admin('PUT', '/api/admin/site/home-sections', {
      sections: [
        { id: 'map', shown: false },
        { id: 'check', shown: true },
      ],
    });
    expect(res.statusCode).toBe(200);
    const after = (await get<{ home_sections: Sections }>('/api/site')).home_sections;
    expect(after.slice(0, 2)).toEqual([
      { id: 'map', shown: false },
      { id: 'check', shown: true },
    ]);
    // The rest are still there, shown, after the two that were named.
    expect(after.map((s) => s.id).sort()).toEqual(shipped.map((s) => s.id).sort());
    for (const sections of [
      [{ id: 'ads', shown: true }],
      [
        { id: 'map', shown: true },
        { id: 'map', shown: false },
      ],
    ]) {
      const refused = await admin('PUT', '/api/admin/site/home-sections', { sections });
      expect(refused.statusCode).toBe(400);
    }
    await db.updateTable('site_settings').set({ home_sections: null }).execute();
  });

  it('sends the placements that are on, all of them until somebody chooses, keeps them when a save leaves them out, and refuses a place it does not know', async () => {
    const placements = () => get<{ social_placements?: string[] }>('/api/site');
    const links = [{ id: 'instagram', address: '@our.archive', shown: true }];
    const first = await admin('PUT', '/api/admin/site/social', { links });
    expect(first.json<{ social_placements: string[] }>().social_placements).toHaveLength(8);
    expect((await placements()).social_placements).toHaveLength(8);

    const some = await admin('PUT', '/api/admin/site/social', {
      links,
      placements: ['footer', 'front'],
    });
    expect(some.json<{ social_placements: string[] }>().social_placements).toEqual([
      'front',
      'footer',
    ]);
    expect((await placements()).social_placements).toEqual(['front', 'footer']);

    // Left out of a save, they are kept.
    await admin('PUT', '/api/admin/site/social', { links });
    expect((await placements()).social_placements).toEqual(['front', 'footer']);

    // A form is not a place the accounts can be shown, and nothing changed by asking.
    const refused = await admin('PUT', '/api/admin/site/social', {
      links,
      placements: ['front', 'file_form'],
    });
    expect(refused.statusCode).toBe(400);
    expect((await placements()).social_placements).toEqual(['front', 'footer']);

    // All off is a choice, and it is kept.
    await admin('PUT', '/api/admin/site/social', { links, placements: [] });
    expect((await placements()).social_placements).toEqual([]);
    await db
      .updateTable('site_settings')
      .set({ social_links: null, social_placements: null })
      .execute();
  });

  it('keeps the floating Follow us button off until asked, sends its pages only while it is on and something is shown, and refuses an unknown page', async () => {
    interface Float {
      on: boolean;
      pages: string[];
    }
    const site = () => get<{ social_float_pages?: string[] }>('/api/site');
    const links = [{ id: 'instagram', address: '@our.archive', shown: true }];
    const first = await admin('PUT', '/api/admin/site/social', { links });
    expect(first.json<{ social_float: Float }>().social_float).toMatchObject({ on: false });
    expect('social_float_pages' in (await site())).toBe(false);

    const on = await admin('PUT', '/api/admin/site/social', {
      links,
      float: { on: true, pages: ['about', 'front'] },
    });
    expect(on.json<{ social_float: Float }>().social_float).toEqual({
      on: true,
      pages: ['front', 'about'],
    });
    expect((await site()).social_float_pages).toEqual(['front', 'about']);

    // Left out of a save, it is kept.
    await admin('PUT', '/api/admin/site/social', { links });
    expect((await site()).social_float_pages).toEqual(['front', 'about']);

    // A form is not a page it can be on, and nothing changed by asking.
    const refused = await admin('PUT', '/api/admin/site/social', {
      links,
      float: { on: true, pages: ['front', 'file'] },
    });
    expect(refused.statusCode).toBe(400);
    expect((await site()).social_float_pages).toEqual(['front', 'about']);

    // Nothing to follow, nothing sent.
    await admin('PUT', '/api/admin/site/social', {
      links: [{ id: 'instagram', address: '', shown: false }],
    });
    expect('social_float_pages' in (await site())).toBe(false);
    await db.updateTable('site_settings').set({ social_links: null, social_float: null }).execute();
  });

  it('set the social media accounts one platform at a time, and every page reads only those on', async () => {
    type Links = { id: string; url: string | null; shown: boolean }[];
    expect((await get<{ social_links: Links }>('/api/site')).social_links).toEqual([]);
    const res = await admin('PUT', '/api/admin/site/social', {
      links: [
        { id: 'instagram', address: '@our.archive', shown: true },
        { id: 'bluesky', address: 'our.bsky.social', shown: false },
      ],
    });
    expect(res.statusCode).toBe(200);
    const editor = res.json<{ social_links: Links }>().social_links;
    // Every platform, in order; a handle is stored as the link it stands for.
    expect(editor.map((l) => l.id).slice(0, 6)).toEqual([
      'facebook',
      'instagram',
      'threads',
      'bluesky',
      'tiktok',
      'youtube',
    ]);
    expect(editor.find((l) => l.id === 'bluesky')).toEqual({
      id: 'bluesky',
      url: 'https://bsky.app/profile/our.bsky.social',
      shown: false,
    });
    // A platform the screen leaves out keeps what it had.
    await admin('PUT', '/api/admin/site/social', {
      links: [{ id: 'youtube', address: 'https://www.youtube.com/@ours', shown: true }],
    });
    expect((await get<{ social_links: Links }>('/api/site')).social_links).toEqual([
      { id: 'instagram', url: 'https://www.instagram.com/our.archive' },
      { id: 'youtube', url: 'https://www.youtube.com/@ours' },
    ]);
    for (const [links, says] of [
      [[{ id: 'myspace', address: 'x', shown: true }], 'no platform called'],
      [
        [
          { id: 'x', address: '@a', shown: true },
          { id: 'x', address: '@b', shown: true },
        ],
        'listed twice',
      ],
      [[{ id: 'tiktok', address: '', shown: true }], 'TikTok is switched on with no address'],
      [[{ id: 'facebook', address: 'https://evil.example/fb', shown: true }], 'Facebook: That'],
    ] as const) {
      const refused = await admin('PUT', '/api/admin/site/social', { links });
      expect(refused.statusCode).toBe(400);
      expect(refused.body).toContain(says);
    }
    // Refusals changed nothing.
    expect((await get<{ social_links: Links }>('/api/site')).social_links).toHaveLength(2);
    await db.updateTable('site_settings').set({ social_links: null }).execute();
  });
});
