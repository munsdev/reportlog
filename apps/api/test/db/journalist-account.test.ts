/**
 * A signed-in account and the journalist list (decision 80): joining the
 * alerts without a link, applying for the desk in one step, who may decide,
 * and "not approved" staying visible.
 */
import type { MyJournalist } from '@reportlog/contracts';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildApp } from '../../src/app.ts';
import { createDatabase } from '../../src/db/database.ts';
import { migrate } from '../../src/db/migrate.ts';
import { createThrowawayDatabase } from '../../src/db/throwaway.ts';
import type { Throwaway } from '../../src/db/throwaway.ts';
import { capturingMailer } from '../../src/email/mailer.ts';
import { emailDigest, keyringFrom } from '../../src/filing/contactKeys.ts';
import { address, as, roleOf, seat, signIn } from './identity-helpers.ts';
import type { Harness } from './identity-helpers.ts';
import { LINK_CONTACT_KEY } from './links-helpers.ts';

// ITS OWN DATABASE: the journalist agreement it publishes is global and append-only.
let throwaway: Throwaway;
let h: Harness;
const ring = keyringFrom(LINK_CONTACT_KEY);

const owner = { email: address('acct-owner'), call: null as unknown as ReturnType<typeof as> };
const admin = { email: address('acct-admin'), call: null as unknown as ReturnType<typeof as> };
const manager = { email: address('acct-manager'), call: null as unknown as ReturnType<typeof as> };

const FORM = {
  name: 'Pat Reporter',
  outlet: 'Desk Daily',
  role: 'Reporter',
  about: 'Local politics at Desk Daily.',
};

const me = async (call: ReturnType<typeof as>) =>
  (await call({ method: 'GET', url: '/api/journalists/me' })).json<MyJournalist>();

const agreementDigest = async (call: ReturnType<typeof as>) =>
  (await call({ method: 'GET', url: '/api/agreement/journalist' })).json<{
    current: { digest: string };
  }>().current.digest;

const apply = async (call: ReturnType<typeof as>, extra: Record<string, unknown> = {}) =>
  call({
    method: 'POST',
    url: '/api/journalists/me/apply',
    payload: { ...FORM, agreement_digest: await agreementDigest(call), ...extra },
  });

async function account(stem: string) {
  const email = address(stem);
  return { email, call: as(h, await signIn(h, email)) };
}

const requestOf = async (email: string) =>
  h.db
    .selectFrom('journalist_access_requests as q')
    .innerJoin('journalist_subscribers as s', 's.id', 'q.subscriber_id')
    .select(['q.id', 'q.status', 'q.details_enc'])
    .where('s.email_hmac', '=', emailDigest(ring, email))
    .executeTakeFirst();

const decide = (who: { call: ReturnType<typeof as> }, id: number, what: string) =>
  who.call({ method: 'POST', url: `/api/owner/journalists/${String(id)}/${what}` });

beforeAll(async () => {
  throwaway = await createThrowawayDatabase(inject('serverUrl'), 'account');
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
  for (const [who, role] of [
    [owner, 'owner'],
    [admin, 'admin'],
    [manager, 'access_manager'],
  ] as const) {
    await seat(db, who.email, role);
    who.call = as(h, await signIn(h, who.email));
  }
});

afterAll(async () => {
  await h.close();
  await throwaway.drop();
});

describe('signed in, the alerts need no confirmation link', () => {
  it('refuses a stranger', async () => {
    expect((await h.app.inject({ method: 'GET', url: '/api/journalists/me' })).statusCode).toBe(
      401,
    );
  });

  it('joining creates an active row for the account address and emails what changed', async () => {
    const a = await account('alerts');
    expect(await me(a.call)).toMatchObject({ listed: false, desk: 'none', alerts: 'off' });
    const r = await a.call({
      method: 'POST',
      url: '/api/journalists/me/alerts',
      payload: { alerts: 'on', states: ['US-AZ', 'US-GA'] },
    });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json<MyJournalist>()).toMatchObject({
      listed: true,
      alerts: 'on',
      states: ['US-AZ', 'US-GA'],
    });
    const row = await h.db
      .selectFrom('journalist_subscribers')
      .select(['status', 'confirmed_at', 'last_sent_at', 'alerts_paused_at'])
      .where('email_hmac', '=', emailDigest(ring, a.email))
      .executeTakeFirstOrThrow();
    expect(row).toMatchObject({ status: 'active', alerts_paused_at: null });
    expect(row.confirmed_at).toBeInstanceOf(Date);
    expect(row.last_sent_at).toBeInstanceOf(Date);
    const mail = h.mailer.lastTo(a.email);
    expect(mail?.subject).toBe('Your alerts changed');
    expect(mail?.text).toMatch(/\/journalists\/settings\/[a-f0-9]{64}/);
    expect(mail?.text).toMatch(/\/journalists\/stop\/[a-f0-9]{64}/);
  });

  it('changing them again updates the same row; alerts on need a state', async () => {
    const a = await account('alerts-again');
    const post = (payload: object) =>
      a.call({ method: 'POST', url: '/api/journalists/me/alerts', payload });
    expect((await post({ alerts: 'on', states: [] })).statusCode).toBe(400);
    await post({ alerts: 'on', states: ['US-AZ'] });
    const off = await post({ alerts: 'off', states: ['US-AZ'] });
    expect(off.json<MyJournalist>()).toMatchObject({ alerts: 'off', states: ['US-AZ'] });
    const rows = await h.db
      .selectFrom('journalist_subscribers')
      .select('id')
      .where('email_hmac', '=', emailDigest(ring, a.email))
      .execute();
    expect(rows).toHaveLength(1);
  });
});

describe('applying for the desk from an account', () => {
  it('refuses with no agreement published', async () => {
    const a = await account('noagreement');
    const r = await a.call({
      method: 'POST',
      url: '/api/journalists/me/apply',
      payload: { ...FORM, agreement_digest: 'x' },
    });
    expect(r.statusCode).toBe(409);
    expect(r.json<{ error: { code: string } }>().error.code).toBe('no_agreement');
    expect((await me(a.call)).agreement).toBe(false);
  });

  it('one step: a pending request, the agreement accepted, and the right people emailed', async () => {
    const pub = await admin.call({
      method: 'POST',
      url: '/api/admin/agreement/journalist',
      payload: { body: 'The journalist agreement, version one.' },
    });
    expect(pub.statusCode, pub.body).toBe(200);

    const a = await account('apply');
    const r = await apply(a.call);
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json<MyJournalist>()).toMatchObject({ listed: true, alerts: 'off', desk: 'pending' });
    expect((await me(a.call)).requested_at).not.toBeNull();

    const state = await a.call({ method: 'GET', url: '/api/agreement/journalist' });
    expect(state.json<{ accepted: boolean }>().accepted).toBe(true);
    expect(h.mailer.lastTo(a.email)?.subject).toBe(
      'Your request for the journalist desk was received',
    );
    for (const who of [owner, admin, manager]) {
      const mail = h.mailer.lastTo(who.email);
      expect(mail?.subject).toBe('A journalist desk request is waiting');
      // No applicant details in the deciders' email.
      expect(mail?.text).not.toContain(FORM.outlet);
      expect(mail?.text).not.toContain(a.email);
    }
    // The request lands on their own account's address.
    expect(await requestOf(a.email)).toMatchObject({ status: 'pending' });
  });

  it('refuses a second request while one is pending, a stale digest, and staff', async () => {
    const a = await account('dupes');
    expect((await apply(a.call)).statusCode).toBe(200);
    const again = await apply(a.call);
    expect(again.statusCode).toBe(409);
    expect(again.json<{ error: { code: string } }>().error.code).toBe('already_asked');

    const b = await account('stale');
    const stale = await apply(b.call, { agreement_digest: 'not-the-newest' });
    expect(stale.statusCode).toBe(409);
    expect(stale.json<{ error: { code: string } }>().error.code).toBe('agreement_changed');
    expect(await requestOf(b.email)).toBeUndefined();

    expect((await me(admin.call)).desk).toBe('staff');
    const staff = await apply(admin.call);
    expect(staff.statusCode).toBe(403);
    expect(staff.json<{ error: { code: string } }>().error.code).toBe('staff_account');
  });

  it('an account already on the list keeps its alerts when it applies', async () => {
    const a = await account('listed');
    await a.call({
      method: 'POST',
      url: '/api/journalists/me/alerts',
      payload: { alerts: 'on', states: ['US-GA'] },
    });
    expect((await apply(a.call)).json<MyJournalist>()).toMatchObject({
      alerts: 'on',
      states: ['US-GA'],
      desk: 'pending',
    });
  });
});

describe('who decides, and what the person sees', () => {
  it('an administrator approves; the account becomes a journalist and the email links to the desk', async () => {
    const a = await account('approved-by-admin');
    await apply(a.call);
    const id = (await requestOf(a.email))!.id;
    const r = await decide(admin, id, 'approve');
    expect(r.statusCode, r.body).toBe(200);
    expect(await roleOf(h.db, a.email)).toBe('journalist');
    expect(await me(a.call)).toMatchObject({ desk: 'approved' });
    const mail = h.mailer.lastTo(a.email);
    expect(mail?.text).toContain('https://reports.example.test/desk');
    // They accepted the newest text when applying: the email does not ask again.
    expect(mail?.text).toContain('already accepted');
    // The desk opens straight away.
    expect((await a.call({ method: 'GET', url: '/api/desk/links' })).statusCode).toBe(200);
  });

  it('an access manager approves, rejects and ends', async () => {
    const a = await account('mgr-approve');
    await apply(a.call);
    expect((await decide(manager, (await requestOf(a.email))!.id, 'approve')).statusCode).toBe(200);
    const row = await requestOf(a.email);
    expect((await decide(manager, row!.id, 'revoke')).statusCode).toBe(200);
    expect(await roleOf(h.db, a.email)).toBe('user');
    expect(await me(a.call)).toMatchObject({ desk: 'ended' });
    expect(h.mailer.lastTo(a.email)?.subject).toBe('Your desk access has ended');
    // The audit names the access manager, not the owner.
    const audit = await h.db
      .selectFrom('role_audit')
      .select(['actor_email', 'action'])
      .where('subject_email', '=', a.email)
      .execute();
    expect(audit).toContainEqual({ actor_email: manager.email, action: 'revoke' });

    const b = await account('mgr-reject');
    await apply(b.call);
    expect((await decide(manager, (await requestOf(b.email))!.id, 'reject')).statusCode).toBe(200);
  });

  it('rejected reads "not approved", wipes what was written, and may be asked again', async () => {
    const a = await account('rejected');
    await apply(a.call);
    const row = (await requestOf(a.email))!;
    expect((await decide(owner, row.id, 'reject')).statusCode).toBe(200);
    expect(await me(a.call)).toMatchObject({ desk: 'not_approved', listed: true });
    const after = (await requestOf(a.email))!;
    expect(after.status).toBe('rejected');
    expect(after.details_enc.toString('utf8')).not.toContain(FORM.outlet);
    expect(h.mailer.lastTo(a.email)?.subject).toContain('journalist desk');
    expect((await apply(a.call)).json<MyJournalist>().desk).toBe('pending');
    // And an ended one may too.
    const id = (await requestOf(a.email))!.id;
    await decide(owner, id, 'approve');
    await decide(owner, id, 'revoke');
    expect((await me(a.call)).desk).toBe('ended');
    expect((await apply(a.call)).json<MyJournalist>().desk).toBe('pending');
  });

  it('a moderator, a journalist and a plain account may not decide', async () => {
    const a = await account('victim');
    await apply(a.call);
    const id = (await requestOf(a.email))!.id;
    const mod = await account('modx');
    await seat(h.db, mod.email, 'moderator');
    const plain = await account('plainx');
    for (const who of [{ call: as(h, await signIn(h, mod.email)) }, plain]) {
      expect((await decide(who, id, 'approve')).statusCode).toBe(403);
      expect((await who.call({ method: 'GET', url: '/api/owner/journalists' })).statusCode).toBe(
        403,
      );
    }
  });

  it('the roles page still cannot make a journalist, for any of them', async () => {
    for (const who of [owner, admin, manager]) {
      const r = await who.call({
        method: 'POST',
        url: '/api/access/system-role',
        payload: { email: address('sidestep'), role: 'journalist', action: 'grant' },
      });
      expect(r.statusCode, r.body).toBe(403);
      expect(r.body).toContain('approving');
    }
  });
});
