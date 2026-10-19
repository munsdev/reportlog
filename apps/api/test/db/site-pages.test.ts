/**
 * P2's half of the site settings: the development notice, figures in the
 * page wording, and the slots the About, How-to, board, filing and
 * directory pages read. Ports legacy's devMode.js behaviour (no self-test
 * of its own existed) and the "numbers in an operator's own wording" group
 * of selftest.js that touches routes: "the public text route renders, and
 * the editor saves only text that works".
 */
import type { Site } from '@reportlog/contracts';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { figureValues } from '../../src/board/figures.ts';
import { setPublicArchive } from '../../src/board/publication.ts';
import { DEV_MODE_HOURS, armDevModeOnDeploy, getDevMode } from '../../src/site/devMode.ts';
import { writeCopy } from '../../src/site/settings.ts';
import { address, harness, seat, signIn } from './identity-helpers.ts';
import type { Harness } from './identity-helpers.ts';

let h: Harness;
let db: Harness['db'];
let app: Harness['app'];
let adminSession: string;
let moderatorSession: string;

const BUILD_A = 'a'.repeat(40);
const BUILD_B = 'b'.repeat(40);

beforeAll(async () => {
  h = await harness();
  ({ db, app } = h);
  const adminEmail = address('p2-admin');
  await seat(db, adminEmail, 'admin');
  adminSession = await signIn(h, adminEmail);
  const modEmail = address('p2-moderator');
  await seat(db, modEmail, 'moderator');
  moderatorSession = await signIn(h, modEmail);
});
afterAll(async () => {
  await db
    .updateTable('site_settings')
    .set({ dev_mode_until: null, last_seen_build: null })
    .execute();
  for (const key of ['how_intro', 'about_archive']) await writeCopy(db, key, null);
  await setPublicArchive(db, null, 'p2-test');
  await h.close();
});

const site = async () => (await app.inject({ method: 'GET', url: '/api/site' })).json<Site>();
const admin = (method: 'GET' | 'PUT', url: string, payload?: unknown) =>
  app.inject({
    method,
    url,
    cookies: { session_token: adminSession },
    ...(payload !== undefined ? { payload } : {}),
  });

describe('the development notice', () => {
  beforeEach(async () => {
    await db
      .updateTable('site_settings')
      .set({ dev_mode_until: null, last_seen_build: null })
      .execute();
  });

  it('is off until somebody or something turns it on', async () => {
    expect((await getDevMode(db)).active).toBe(false);
    expect((await site()).dev_mode_until).toBeNull();
  });

  it('turns on for a window, and every page reads when it ends', async () => {
    const res = await admin('PUT', '/api/admin/site/dev-mode', { hours: 6 });
    expect(res.statusCode).toBe(200);
    const state = res.json<{ active: boolean; until: string }>();
    expect(state.active).toBe(true);
    const hoursLeft = (new Date(state.until).getTime() - Date.now()) / 36e5;
    expect(hoursLeft).toBeGreaterThan(5.9);
    expect(hoursLeft).toBeLessThanOrEqual(6.01);
    expect((await site()).dev_mode_until).toBe(state.until);
  });

  it('switches itself off when the window passes, with nobody touching it', async () => {
    await db
      .updateTable('site_settings')
      .set({ dev_mode_until: sql<Date>`now() - interval '1 minute'` })
      .execute();
    expect((await getDevMode(db)).active).toBe(false);
    expect((await site()).dev_mode_until).toBeNull();
  });

  it('comes down at once when turned off', async () => {
    await admin('PUT', '/api/admin/site/dev-mode', { hours: 2 });
    const off = await admin('PUT', '/api/admin/site/dev-mode', { hours: null });
    expect(off.json<{ active: boolean }>().active).toBe(false);
    expect((await site()).dev_mode_until).toBeNull();
  });

  it('refuses a window of nothing or of more than a week, in words', async () => {
    for (const hours of [0, -1, 169]) {
      const res = await admin('PUT', '/api/admin/site/dev-mode', { hours });
      expect(res.statusCode, String(hours)).toBe(400);
      expect(res.json<{ error: { message: string } }>().error.message).toMatch(/week/);
    }
    expect((await getDevMode(db)).active).toBe(false);
  });

  it('is an administrator’s switch, nobody else’s', async () => {
    for (const [method, url, payload] of [
      ['GET', '/api/admin/site/dev-mode', undefined],
      ['PUT', '/api/admin/site/dev-mode', { hours: 6 }],
      ['GET', '/api/admin/site/figures', undefined],
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
    expect((await getDevMode(db)).active).toBe(false);
  });
});

describe('a deploy arms the notice by itself', () => {
  beforeEach(async () => {
    await db
      .updateTable('site_settings')
      .set({ dev_mode_until: null, last_seen_build: null })
      .execute();
  });

  it('not from a checkout, which has no build', async () => {
    expect(await armDevModeOnDeploy(db, undefined)).toEqual({ armed: false, reason: 'no-build' });
    expect((await getDevMode(db)).active).toBe(false);
  });

  it('not on the first start that knows its build: nothing just shipped that we can tell', async () => {
    expect(await armDevModeOnDeploy(db, BUILD_A)).toEqual({
      armed: false,
      reason: 'first-start',
    });
    expect((await getDevMode(db)).active).toBe(false);
  });

  it('when the build changed, for the default window, and not again on a restart', async () => {
    await armDevModeOnDeploy(db, BUILD_A);
    expect(await armDevModeOnDeploy(db, BUILD_B)).toEqual({
      armed: true,
      from: BUILD_A,
      to: BUILD_B,
    });
    const state = await getDevMode(db);
    expect(state.active).toBe(true);
    const hoursLeft = (new Date(state.until ?? 0).getTime() - Date.now()) / 36e5;
    expect(hoursLeft).toBeGreaterThan(DEV_MODE_HOURS - 0.1);

    // A crash-restart loop on the same build must not keep pushing it out.
    await admin('PUT', '/api/admin/site/dev-mode', { hours: null });
    expect(await armDevModeOnDeploy(db, BUILD_B)).toEqual({ armed: false, reason: 'unchanged' });
    expect((await getDevMode(db)).active).toBe(false);
  });

  it('never shortens a longer window an administrator set', async () => {
    await armDevModeOnDeploy(db, BUILD_A);
    await admin('PUT', '/api/admin/site/dev-mode', { hours: 48 });
    const before = (await getDevMode(db)).until;
    await armDevModeOnDeploy(db, BUILD_B);
    expect((await getDevMode(db)).until).toBe(before);
  });
});

describe('the five slots the other pages read', () => {
  it('are offered by the editor and served to every page', async () => {
    const copy = (await site()).copy;
    for (const key of [
      'about_archive',
      'submit_intro',
      'board_intro',
      'how_intro',
      'alliance_intro',
    ]) {
      expect(Object.keys(copy), key).toContain(key);
    }
    const editor = (await admin('GET', '/api/admin/site')).json<{
      copy: { key: string; optional: boolean }[];
    }>();
    expect(editor.copy.map((s) => s.key)).toEqual(expect.arrayContaining(Object.keys(copy)));
  });

  it('an optional slot nobody wrote shows nothing, not our note to the operator', async () => {
    const copy = (await site()).copy;
    expect([copy.submit_intro, copy.board_intro, copy.how_intro, copy.alliance_intro]).toEqual([
      '',
      '',
      '',
      '',
    ]);
    // A page that must not come up empty says plainly that it is unwritten.
    expect(copy.about_archive).toMatch(/has not written its About page/);
  });

  it('keep what an operator wrote', async () => {
    const res = await admin('PUT', '/api/admin/site/copy/how_intro', {
      body: 'Ask at the front desk.',
    });
    expect(res.statusCode).toBe(200);
    expect((await site()).copy.how_intro).toBe('Ask at the front desk.');
  });
});

describe('numbers in an operator’s own wording', () => {
  beforeEach(async () => {
    await setPublicArchive(db, null, 'p2-test');
  });

  it('the public text route renders them; the editor keeps the placeholder', async () => {
    const text = 'So far {{ [reports.filed.all] + 1000 }} reports.';
    const res = await admin('PUT', '/api/admin/site/copy/about_archive', { body: text });
    expect(res.statusCode).toBe(200);
    const filed = (await figureValues(db))['reports.filed.all'] ?? NaN;
    expect((await site()).copy.about_archive).toBe(
      `So far ${(filed + 1000).toLocaleString('en-US')} reports.`,
    );
    const editor = (await admin('GET', '/api/admin/site')).json<{
      copy: { key: string; body: string }[];
    }>();
    expect(editor.copy.find((s) => s.key === 'about_archive')?.body).toBe(text);
  });

  it('show "?" while the archive is not public, never the count', async () => {
    await admin('PUT', '/api/admin/site/copy/about_archive', {
      body: 'So far {{ [reports.filed.all] }} reports.',
    });
    await setPublicArchive(db, false, 'p2-test');
    expect((await site()).copy.about_archive).toBe('So far ? reports.');
  });

  it('a number that would not work is refused when saved, and says why', async () => {
    await writeCopy(db, 'how_intro', 'Before.');
    for (const [body, why] of [
      ['{{ [no.such.figure] }}', /no figure called \[no\.such\.figure\]/],
      ['{{ percent(1) }}', /percent takes 2/],
      ['{{ process.exit() }}', /process/],
    ] as const) {
      const res = await admin('PUT', '/api/admin/site/copy/how_intro', { body });
      expect(res.statusCode, body).toBe(400);
      expect(res.json<{ error: { message: string } }>().error.message, body).toMatch(why);
    }
    expect((await site()).copy.how_intro).toBe('Before.');
  });

  it('the editor is offered every figure, with its value, whether or not the archive is public', async () => {
    await setPublicArchive(db, false, 'p2-test');
    const res = await admin('GET', '/api/admin/site/figures');
    expect(res.statusCode).toBe(200);
    const ids = res.json<{ figures: { id: string }[] }>().figures.map((f) => f.id);
    expect(ids).toContain('reports.filed.all');
    expect(ids).toContain('reports.published.7d');
  });
});

describe('the version line', () => {
  it('is served with the site, and a checkout has no build to name', async () => {
    const { version } = await site();
    expect(version.build).toBeNull();
    expect(version.release === null || /^v\d+\.\d+\.\d+$/.test(version.release)).toBe(true);
  });
});
