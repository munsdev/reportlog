/**
 * First-run setup, against a real database and the real app: a fresh
 * install really is locked out of itself, the installer's password is the
 * way in, and the wizard can be walked from one end to the other once.
 *
 * Ported from legacy/scripts/setup-selftest.mjs. The legacy code was read out
 * of its stored hash by trying all million codes; here it is read from the
 * email, which is what a person would do. The three questions the old wizard
 * asked in between (the site's name, publishing, attachments) write to the
 * site and files workstreams' settings and are theirs to test.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { writeSiteAccess } from '../../src/identity/siteAccess.ts';
import { address, codeFor, cookieFrom, harness, liftCurtain } from './identity-helpers.ts';
import type { Harness } from './identity-helpers.ts';

let h: Harness;
const INSTALL_PW = 'INSTALLPW1';
const NEW_PW = 'OPERATORPW2';
const OWNER = address('owner-setup');
let curtain = '';
let session = '';

interface Opts {
  method?: 'GET' | 'POST';
  url: string;
  payload?: object;
}
const call = ({ method = 'GET', url, payload }: Opts, cookies: Record<string, string> = {}) =>
  h.app.inject({ method, url, ...(payload ? { payload } : {}), cookies });
const behind = (o: Opts) => call(o, { site_access: curtain });
const asOwner = (o: Opts) => call(o, { site_access: curtain, session_token: session });
const unlock = (password: string) =>
  call({ method: 'POST', url: '/api/site-access/unlock', payload: { password } });

beforeAll(async () => {
  h = await harness();
  // A deployment as the installer leaves it: a password it chose, no owner,
  // setup not finished. Anybody earlier test files left holding a seat would
  // make it look set up already.
  await h.db
    .updateTable('users')
    .set({ role: 'user' })
    .where('role', 'in', ['owner', 'admin'])
    .execute();
  await h.db
    .updateTable('site_access')
    .set({ setup_completed_at: null })
    .where('id', '=', true)
    .execute();
  await writeSiteAccess(h.db, { password: INSTALL_PW });
});
afterAll(async () => {
  await h.db
    .updateTable('users')
    .set({ role: 'user' })
    .where('role', 'in', ['owner', 'admin'])
    .execute();
  await liftCurtain(h.db);
  await h.close();
});

describe('a deployment with no site password at all', () => {
  it('will not be set up, so a stranger who finds it cannot claim it', async () => {
    await h.db
      .updateTable('site_access')
      .set({ password_hash: null })
      .where('id', '=', true)
      .execute();
    try {
      const res = await call({
        method: 'POST',
        url: '/api/setup/code',
        payload: { email: address('stranger') },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ error: { code: 'no_site_password' } });
    } finally {
      await writeSiteAccess(h.db, { password: INSTALL_PW });
    }
  });
});

describe('what a stranger installing this walks into', () => {
  it('cannot reach setup from in front of the curtain, nor guess past it', async () => {
    const res = await call({ url: '/api/setup/status' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: { code: 'locked' } });
    expect((await unlock('guess')).statusCode).toBe(401);
  });
});

describe('the curtain password the installer set', () => {
  it('lifts the curtain and issues a token', async () => {
    const res = await unlock(INSTALL_PW);
    expect(res.statusCode).toBe(200);
    curtain = cookieFrom(res, 'site_access') ?? '';
    expect(curtain).toMatch(/^[a-f0-9]{64}$/);
  });

  it('shows setup is needed, with no owner yet, and the password floor', async () => {
    expect((await behind({ url: '/api/setup/status' })).json()).toEqual({
      needed: true,
      hasOwner: false,
      minPassword: 8,
    });
  });
});

describe('walking the wizard', () => {
  it('refuses an address that is not one', async () => {
    expect(
      (await behind({ method: 'POST', url: '/api/setup/code', payload: { email: 'not-an-email' } }))
        .statusCode,
    ).toBe(400);
  });

  it('emails a code, and a wrong one seats nobody', async () => {
    const res = await behind({ method: 'POST', url: '/api/setup/code', payload: { email: OWNER } });
    expect(res.statusCode).toBe(200);
    expect(h.mailer.lastTo(OWNER)?.subject).toBe('Set up your ReportLog deployment');
    const right = codeFor(h.mailer, OWNER);
    const wrong = right === '000000' ? '000001' : '000000';
    expect(
      (
        await behind({
          method: 'POST',
          url: '/api/setup/owner',
          payload: { email: OWNER, code: wrong },
        })
      ).statusCode,
    ).toBe(401);
  });

  it('makes that address the OWNER with the right code, and signs them in', async () => {
    const res = await behind({
      method: 'POST',
      url: '/api/setup/owner',
      payload: { email: OWNER, code: codeFor(h.mailer, OWNER) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ signedIn: true, email: OWNER, role: 'owner' });
    session = cookieFrom(res, 'session_token') ?? '';
    expect(session).toMatch(/^[a-f0-9]{64}$/);
  });

  it('is STILL needed once the owner exists: the last screen must not refuse itself', async () => {
    expect((await behind({ url: '/api/setup/status' })).json()).toEqual({
      needed: true,
      hasOwner: true,
      minPassword: 8,
    });
  });

  it('cannot seat a second owner', async () => {
    const res = await behind({
      method: 'POST',
      url: '/api/setup/code',
      payload: { email: address('someone-else') },
    });
    expect(res.statusCode).toBe(409);
  });
});

describe('the curtain password decision, which cannot be skipped', () => {
  it('refuses no decision, a decision that is neither, and a password too short or unconfirmed', async () => {
    const tries = [
      {},
      { decision: 'maybe' },
      { decision: 'change', password: 'abc', passwordConfirm: 'abc' },
      { decision: 'change', password: NEW_PW, passwordConfirm: 'OPERATORPW3' },
      { decision: 'change', password: NEW_PW },
    ];
    for (const payload of tries) {
      const res = await asOwner({ method: 'POST', url: '/api/setup/curtain', payload });
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
    }
  });

  it('ended nothing and changed nothing by refusing', async () => {
    expect((await behind({ url: '/api/setup/status' })).json()).toMatchObject({ needed: true });
    expect((await unlock(INSTALL_PW)).statusCode).toBe(200);
  });

  it('cannot be finished by somebody behind the curtain who is not the owner', async () => {
    const res = await behind({
      method: 'POST',
      url: '/api/setup/curtain',
      payload: { decision: 'keep' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('lets the owner change the password, which ends setup and retires the installer’s cookie', async () => {
    const installer = cookieFrom(await unlock(INSTALL_PW), 'site_access') ?? '';
    const before = await call({ url: '/api/site-access/status' }, { site_access: installer });
    expect(before.json()).toEqual({ locked: false });
    const res = await asOwner({
      method: 'POST',
      url: '/api/setup/curtain',
      payload: { decision: 'change', password: NEW_PW, passwordConfirm: NEW_PW },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, changed: true });
    const after = await call({ url: '/api/site-access/status' }, { site_access: installer });
    expect(after.json()).toEqual({ locked: true });
    // The owner, mid-wizard, is not thrown out.
    expect((await behind({ url: '/api/site-access/status' })).json()).toEqual({ locked: false });
  });
});

describe('after the handover', () => {
  it("retires the installer's password and accepts the operator's", async () => {
    expect((await unlock(INSTALL_PW)).statusCode).toBe(401);
    expect((await unlock(NEW_PW)).statusCode).toBe(200);
  });

  it('is no longer needed and cannot be replayed', async () => {
    expect((await behind({ url: '/api/setup/status' })).json()).toMatchObject({ needed: false });
    expect(
      (
        await behind({
          method: 'POST',
          url: '/api/setup/code',
          payload: { email: address('attacker') },
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (await asOwner({ method: 'POST', url: '/api/setup/curtain', payload: { decision: 'keep' } }))
        .statusCode,
    ).toBe(409);
  });

  it('left the seating and the decision in the trail', async () => {
    const trail = await h.db
      .selectFrom('role_audit')
      .select(['axis', 'detail'])
      .where('actor_email', '=', OWNER)
      .orderBy('id')
      .execute();
    expect(trail).toEqual([
      { axis: 'owner', detail: 'owner, by first-run setup' },
      { axis: 'site', detail: 'finished setup with a new site password' },
    ]);
  });
});

describe('the administrator’s panel sets the same password, under the same rule', () => {
  it('states the same floor and refuses what the wizard refuses', async () => {
    const res = await asOwner({ url: '/api/access/site-access' });
    expect(res.json()).toEqual({ enabled: true, hasPassword: true, minPassword: 8 });
    for (const payload of [
      { password: 'short', passwordConfirm: 'short' },
      { password: 'LONGENOUGH1', passwordConfirm: 'LONGENOUGH2' },
      { password: 'LONGENOUGH1' },
    ]) {
      expect(
        (await asOwner({ method: 'POST', url: '/api/access/site-access', payload })).statusCode,
      ).toBe(400);
    }
    expect((await unlock(NEW_PW)).statusCode).toBe(200);
  });

  it('treats a blank password as leaving it alone', async () => {
    const res = await asOwner({
      method: 'POST',
      url: '/api/access/site-access',
      payload: { enabled: true, password: '' },
    });
    expect(res.statusCode).toBe(200);
    expect((await unlock(NEW_PW)).statusCode).toBe(200);
  });

  it('is an administrator’s, not anybody signed in', async () => {
    expect((await behind({ url: '/api/access/site-access' })).statusCode).toBe(401);
  });
});
