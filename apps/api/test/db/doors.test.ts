/**
 * What gets past the site password, and what does not, with the password ON.
 *
 * Every other test file runs with the gate open, so none of them can see
 * this. This one sets a real password (not just the flag: a gate with no
 * password is no gate, so a hash-less one would make every check below pass
 * by letting everything through) and walks both sides.
 *
 * Ported from legacy/scripts/doors-selftest.mjs. The routes a logbook's
 * filing form calls belong to other workstreams and do not exist yet, so
 * stand-ins are registered at the agreed patterns; the list half is the
 * marker a list route carries, since lists are not built yet either.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.ts';
import { capturingMailer } from '../../src/email/mailer.ts';
import { hashPassword } from '../../src/identity/secrets.ts';
import { gateApplies, siteAccessSettings } from '../../src/identity/siteAccess.ts';
import { launchedLogbook, testDatabase, uniqueSlug } from './helpers.ts';
import { address, cookieFrom, liftCurtain, seat, trustSession } from './identity-helpers.ts';
import { codeFor } from './identity-helpers.ts';
import { paintedLook } from '../../src/site/look.ts';
import { readSettings } from '../../src/site/settings.ts';

const db = testDatabase();
const mailer = capturingMailer();
let app: FastifyInstance;
const PASSWORD = 'doors-test-password';
const reached: string[] = [];
/** The stand-ins actually registered: a pattern another workstream has built is the real route. */
const standIns = new Set<string>();

const isLocked = (res: { statusCode: number; json: () => unknown }) =>
  res.statusCode === 401 && (res.json() as { error?: { code?: string } }).error?.code === 'locked';

async function setPassword(password: string | null) {
  await db
    .updateTable('site_access')
    .set({ enabled: true, password_hash: password === null ? null : await hashPassword(password) })
    .where('id', '=', true)
    .execute();
}

beforeAll(async () => {
  app = await buildApp({ config: { LOG_LEVEL: 'silent' }, db, mailer });
  // Stand-ins at the patterns the filing form's routes are agreed to use,
  // for whichever of them no workstream has built yet. Where the real route
  // exists, the status checks below are what prove it passed the gate.
  for (const [method, url] of [
    ['GET', '/api/logbooks/:slug'],
    ['GET', '/api/logbooks'],
    ['POST', '/api/reports'],
    ['GET', '/api/reports/confirm/:token'],
    ['GET', '/api/reports'],
    ['GET', '/api/moderation/queue'],
  ] as const) {
    if (app.hasRoute({ method, url })) continue;
    standIns.add(`${method} ${url}`);
    app.route({ method, url, handler: () => (reached.push(`${method} ${url}`), { ok: true }) });
  }
  // A list route deciding for itself. Its own address, now that the real list
  // routes exist (test/db/lists-routes.test.ts walks those with the password on).
  app.route({
    method: 'GET',
    url: '/api/lists/stand-in/:slug',
    config: { curtain: 'decides-itself' },
    handler: () => ({ list: true }),
  });
});
afterAll(async () => {
  await liftCurtain(db);
  await app.close();
  await db.destroy();
});

const get = (url: string, cookies: Record<string, string> = {}) =>
  app.inject({ method: 'GET', url, cookies });

describe('a gate with no password is not a gate', () => {
  it('lets people in when it is on with NO password, the state a fresh install starts in', async () => {
    await setPassword(null);
    expect((await get('/api/site-access/status')).json()).toEqual({
      locked: false,
      dev_mode_until: null,
      look: paintedLook(await readSettings(db)),
    });
    expect((await get('/api/auth/me')).statusCode).toBe(200);
    const live = await siteAccessSettings(db);
    expect(live.missing).toBeUndefined();
  });

  it('states the rule directly: no row refuses everyone; off is off; only on-with-a-password gates', () => {
    expect(
      gateApplies({ enabled: true, password_hash: null, setup_completed_at: null, missing: true }),
    ).toBe(true);
    expect(gateApplies({ enabled: false, password_hash: null, setup_completed_at: null })).toBe(
      false,
    );
    expect(gateApplies({ enabled: false, password_hash: 'x', setup_completed_at: null })).toBe(
      false,
    );
    expect(gateApplies({ enabled: true, password_hash: 'x', setup_completed_at: null })).toBe(true);
    expect(gateApplies({ enabled: true, password_hash: null, setup_completed_at: null })).toBe(
      false,
    );
  });

  it('reads a MISSING settings row as locked, and nobody gets in', async () => {
    await db
      .transaction()
      .execute(async (trx) => {
        await trx.deleteFrom('site_access').execute();
        const s = await siteAccessSettings(trx);
        expect(s.missing).toBe(true);
        expect(gateApplies(s)).toBe(true);
        // Undo: the transaction is rolled back by throwing.
        throw new Error('rollback');
      })
      .catch((e: unknown) => {
        if (!(e instanceof Error) || e.message !== 'rollback') throw e;
      });
    expect((await siteAccessSettings(db)).missing).toBeUndefined();
  });
});

describe('with the password on', () => {
  beforeAll(async () => {
    await setPassword(PASSWORD);
  });

  it('answers everything behind it with one shape, unknown addresses included', async () => {
    for (const url of [
      '/api/auth/me',
      '/api/orgs',
      '/api/access/audit',
      '/api/setup/status',
      '/api/reports/RL-X/verify',
      '/api/nothing-here',
    ]) {
      const res = await get(url);
      expect(isLocked(res), `${url}: ${res.body}`).toBe(true);
    }
    const signIn = await app.inject({
      method: 'POST',
      url: '/api/auth/code',
      payload: { email: address('locked') },
    });
    expect(isLocked(signIn)).toBe(true);
  });

  it('refuses before validating, so a stranger learns nothing from an error', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/code',
      payload: { nonsense: true },
    });
    expect(isLocked(res)).toBe(true);
  });

  it('keeps the lock screen’s own calls and the health check in front of it', async () => {
    expect((await get('/api/health')).statusCode).toBe(200);
    expect((await get('/api/site-access/status')).json()).toMatchObject({ locked: true });
    expect((await get('/api/doors')).statusCode).toBe(200);
  });

  it('refuses the wrong password and trades the right one for a cookie that lets you through', async () => {
    const wrong = await app.inject({
      method: 'POST',
      url: '/api/site-access/unlock',
      payload: { password: 'guess' },
    });
    expect(wrong.statusCode).toBe(401);
    const right = await app.inject({
      method: 'POST',
      url: '/api/site-access/unlock',
      payload: { password: PASSWORD },
    });
    expect(right.statusCode).toBe(200);
    const token = cookieFrom(right, 'site_access') ?? '';
    expect(right.cookies.find((c) => c.name === 'site_access')).toMatchObject({
      httpOnly: true,
      secure: true,
    });
    expect((await get('/api/site-access/status', { site_access: token })).json()).toEqual({
      locked: false,
      dev_mode_until: null,
      look: paintedLook(await readSettings(db)),
    });
    expect((await get('/api/auth/me', { site_access: token })).statusCode).toBe(200);
  });

  it('stores the password salted and stretched, never as typed', async () => {
    const s = await siteAccessSettings(db);
    expect(s.password_hash).toMatch(/^scrypt\$[a-f0-9]{32}\$[a-f0-9]{64}$/);
    expect(s.password_hash).not.toContain(PASSWORD);
  });
});

describe('a list decides for itself', () => {
  it('reaches its own handler without the password', async () => {
    const res = await get('/api/lists/stand-in/anything');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ list: true });
  });

  it('is the only kind of route allowed to: anything else claiming it stops the server starting', async () => {
    const other = await buildApp({ config: { LOG_LEVEL: 'silent' }, db });
    expect(() =>
      other.route({
        method: 'GET',
        url: '/api/board',
        config: { curtain: 'decides-itself' },
        handler: () => ({}),
      }),
    ).toThrow(/Only list routes may/);
    await other.close().catch(() => undefined);
  });
});

describe('a logbook opened for filing without the password', () => {
  let open = { id: 0, slug: '' };
  let shut = { id: 0, slug: '' };

  beforeAll(async () => {
    await setPassword(PASSWORD);
    open = await launchedLogbook(db);
    shut = await launchedLogbook(db);
  });

  it('opens nothing while no logbook is open outside, not even the card text', async () => {
    // Other test files' logbooks are all `closed`, the default.
    expect(isLocked(await get('/api/publication-card'))).toBe(true);
  });

  it('serves its form, takes a report and confirms one, and nothing else', async () => {
    await db
      .updateTable('logbooks')
      .set({ outside_access: 'link' })
      .where('id', '=', open.id)
      .execute();
    reached.length = 0;

    expect((await get(`/api/logbooks/${open.slug}`)).statusCode).toBe(200);
    expect(isLocked(await get(`/api/logbooks/${shut.slug}`))).toBe(true);
    expect(isLocked(await get('/api/logbooks'))).toBe(true); // would name the others
    expect(isLocked(await get('/api/reports'))).toBe(true); // the board
    expect(isLocked(await get('/api/moderation/queue'))).toBe(true); // staff
    expect(isLocked(await get('/api/auth/me'))).toBe(true);
    expect((await get('/api/publication-card')).statusCode).toBe(200);

    const filed = await app.inject({
      method: 'POST',
      url: '/api/reports',
      payload: { logbook: open.slug },
    });
    // Past the gate. The real route then judges the report on its merits.
    expect(isLocked(filed)).toBe(false);
    const refused = await app.inject({
      method: 'POST',
      url: '/api/reports',
      payload: { logbook: shut.slug },
    });
    expect(isLocked(refused)).toBe(true);
    const unnamed = await app.inject({ method: 'POST', url: '/api/reports', payload: {} });
    expect(isLocked(unnamed)).toBe(true);

    // THE CONFIRMATION LINK, which is only ever reached from an email.
    // A made-up token is refused like anything else: the link passes on a
    // token that names a real submission (filing-doors.test.ts), and on
    // nothing else, so the gate says nothing about which tokens exist.
    expect(isLocked(await get('/api/reports/confirm/some-token'))).toBe(true);

    expect(reached).toEqual(
      ['GET /api/logbooks/:slug', 'POST /api/reports', 'GET /api/reports/confirm/:token'].filter(
        (r) => standIns.has(r),
      ),
    );
  });

  it('is offered on the password page only when set to `door`, and never as a draft', async () => {
    let doors = (await get('/api/doors')).json<{ doors: { href: string }[] }>().doors;
    expect(doors.some((d) => d.href === `/file/${open.slug}`)).toBe(false);

    await db
      .updateTable('logbooks')
      .set({ outside_access: 'door' })
      .where('id', '=', open.id)
      .execute();
    const draftSlug = uniqueSlug('draft');
    await db
      .insertInto('logbooks')
      .values({ slug: draftSlug, title: 'A draft', outside_access: 'door' })
      .execute();

    doors = (await get('/api/doors')).json<{ doors: { href: string; title: string }[] }>().doors;
    expect(doors).toContainEqual({
      kind: 'logbook',
      slug: open.slug,
      title: `Logbook ${open.slug}`,
      href: `/file/${open.slug}`,
    });
    expect(doors.some((d) => d.href === `/file/${shut.slug}`)).toBe(false);
    expect(doors.some((d) => d.href === `/file/${draftSlug}`)).toBe(false);
    // A draft open outside is not open: it cannot take reports.
    expect(isLocked(await get(`/api/logbooks/${draftSlug}`))).toBe(true);
  });

  it('is set by an administrator only, on the record', async () => {
    await setPassword(null);
    const adminEmail = address('doors-admin');
    await seat(db, adminEmail, 'admin');
    await app.inject({ method: 'POST', url: '/api/auth/code', payload: { email: adminEmail } });
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in',
      payload: { email: adminEmail, code: codeFor(mailer, adminEmail) },
    });
    const session = cookieFrom(res, 'session_token') ?? '';
    // A fixture: the second factor is tested in second-factor.test.ts.
    await trustSession(db, session);
    const set = await app.inject({
      method: 'POST',
      url: `/api/access/doors/logbooks/${shut.slug}`,
      payload: { outside_access: 'door' },
      cookies: { session_token: session },
    });
    expect(set.statusCode).toBe(200);
    const nobody = await app.inject({
      method: 'POST',
      url: `/api/access/doors/logbooks/${shut.slug}`,
      payload: { outside_access: 'closed' },
    });
    expect(nobody.statusCode).toBe(401);
    const trail = await db
      .selectFrom('role_audit')
      .select('detail')
      .where('actor_email', '=', adminEmail)
      .execute();
    expect(trail).toEqual([
      { detail: `set logbook ${shut.slug} to door without the site password` },
    ]);
    await db.updateTable('users').set({ role: 'user' }).where('email', '=', adminEmail).execute();
    await db
      .updateTable('logbooks')
      .set({ outside_access: 'closed' })
      .where('id', 'in', [open.id, shut.id])
      .execute();
  });
});
