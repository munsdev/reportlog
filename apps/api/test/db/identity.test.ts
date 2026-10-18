/**
 * Signing in by a one-time code, and sessions.
 *
 * The legacy `identity-selftest` tested the deployment's name, which belongs
 * to the site workstream. What it shares with this file is the rule that
 * nothing presentational reaches a report; the sign-in half is new here,
 * ported from what `otp.js` and `routes/auth.js` promised.
 */
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAX_ATTEMPTS, createCode, subjects, verifyCode } from '../../src/identity/otp.ts';
import { sha256Hex } from '../../src/identity/secrets.ts';
import { address, codeFor, cookieFrom, harness, seat, signIn } from './identity-helpers.ts';
import type { Harness } from './identity-helpers.ts';

let h: Harness;
beforeAll(async () => {
  h = await harness();
});
afterAll(async () => {
  await h.close();
});

const askCode = (email: string) =>
  h.app.inject({ method: 'POST', url: '/api/auth/code', payload: { email } });
const signInWith = (email: string, code: string) =>
  h.app.inject({ method: 'POST', url: '/api/auth/sign-in', payload: { email, code } });

describe('asking for a code', () => {
  it('emails a six-digit code to the address, whether or not it has an account', async () => {
    const email = address('new');
    const res = await askCode(email);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(codeFor(h.mailer, email)).toMatch(/^\d{6}$/);
    expect(h.mailer.lastTo(email)?.subject).toBe('Your sign-in code');
  });

  it('refuses something that is not an address, with a sentence', async () => {
    const res = await askCode('not an address');
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: { code: 'bad_email', message: 'Enter a valid email address.' },
    });
  });

  it('treats capitals and spaces as the same address', async () => {
    const email = address('case');
    await askCode(`  ${email.toUpperCase()} `);
    expect(codeFor(h.mailer, email)).toMatch(/^\d{6}$/);
  });

  it('stores only the hash of the code', async () => {
    const email = address('hashed');
    await askCode(email);
    const code = codeFor(h.mailer, email);
    const row = await h.db
      .selectFrom('otp_codes')
      .select('code_hash')
      .where('subject_hash', '=', sha256Hex(subjects.signIn(email)))
      .executeTakeFirstOrThrow();
    expect(row.code_hash).toBe(sha256Hex(code));
    expect(row.code_hash).not.toContain(code);
  });

  it('stops after a handful of codes to one address in an hour', async () => {
    const email = address('flood');
    const statuses: number[] = [];
    for (let i = 0; i < 7; i += 1) statuses.push((await askCode(email)).statusCode);
    expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
    expect(statuses.slice(5)).toEqual([429, 429]);
  });

  it('does not let somebody elsewhere use up an address’s allowance', async () => {
    const email = address('victim');
    for (let i = 0; i < 6; i += 1) {
      await h.app.inject({
        method: 'POST',
        url: '/api/auth/code',
        payload: { email },
        remoteAddress: '203.0.113.7',
      });
    }
    const own = await h.app.inject({
      method: 'POST',
      url: '/api/auth/code',
      payload: { email },
      remoteAddress: '198.51.100.4',
    });
    expect(own.statusCode).toBe(200);
  });
});

describe('trading the code for a session', () => {
  it('signs in with the right code and sets a secure, http-only cookie', async () => {
    const email = address('in');
    await askCode(email);
    const res = await signInWith(email, codeFor(h.mailer, email));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      signedIn: true,
      email,
      role: 'user',
      memberships: [],
      grantsAccess: false,
    });
    const cookie = res.cookies.find((c) => c.name === 'session_token');
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax', path: '/' });
  });

  it('keeps only the hash of the session token', async () => {
    const email = address('session-hash');
    const token = await signIn(h, email);
    const rows = await h.db.selectFrom('sessions').select('token_hash').execute();
    expect(rows.some((r) => r.token_hash === sha256Hex(token))).toBe(true);
    expect(rows.some((r) => r.token_hash === token)).toBe(false);
  });

  it('refuses a wrong code and says so plainly', async () => {
    const email = address('wrong');
    await askCode(email);
    const right = codeFor(h.mailer, email);
    const wrong = right === '000000' ? '000001' : '000000';
    const res = await signInWith(email, wrong);
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({
      error: { code: 'bad_code', message: 'That code is wrong or has expired. Ask for a new one.' },
    });
    expect(cookieFrom(res, 'session_token')).toBeUndefined();
  });

  it('spends a code once', async () => {
    const email = address('once');
    await askCode(email);
    const code = codeFor(h.mailer, email);
    expect((await signInWith(email, code)).statusCode).toBe(200);
    expect((await signInWith(email, code)).statusCode).toBe(401);
  });

  it('does not accept a code past its ten minutes', async () => {
    const email = address('late');
    await askCode(email);
    const code = codeFor(h.mailer, email);
    await h.db
      .updateTable('otp_codes')
      .set({ expires_at: new Date(Date.now() - 1000) })
      .where('subject_hash', '=', sha256Hex(subjects.signIn(email)))
      .execute();
    expect((await signInWith(email, code)).statusCode).toBe(401);
  });

  it(`gives up on an address after ${String(MAX_ATTEMPTS)} wrong guesses, even for the right code`, async () => {
    const email = address('guess');
    await askCode(email);
    const right = codeFor(h.mailer, email);
    const wrong = right === '999999' ? '999998' : '999999';
    for (let i = 0; i < MAX_ATTEMPTS; i += 1)
      expect((await signInWith(email, wrong)).statusCode).toBe(401);
    expect((await signInWith(email, right)).statusCode).toBe(401);
  });

  it('binds a code to what it was asked for: a sign-in code does not set a deployment up', async () => {
    const email = address('bound');
    const code = await createCode(h.db, subjects.signIn(email));
    expect(await verifyCode(h.db, subjects.setup(email), code)).toBe(false);
    expect(await verifyCode(h.db, subjects.signIn(email), code)).toBe(true);
  });

  it('never changes a role by signing in', async () => {
    const email = address('keeps');
    await seat(h.db, email, 'moderator');
    const token = await signIn(h, email);
    const me = await h.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: { session_token: token },
    });
    expect(me.json()).toMatchObject({ signedIn: true, role: 'moderator' });
  });
});

describe('a session', () => {
  it('says who is signed in, and nobody without one', async () => {
    const email = address('me');
    const token = await signIn(h, email);
    const me = await h.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: { session_token: token },
    });
    expect(me.json()).toMatchObject({ signedIn: true, email });
    const nobody = await h.app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(nobody.json()).toEqual({ signedIn: false });
    const forged = await h.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: { session_token: 'f'.repeat(64) },
    });
    expect(forged.json()).toEqual({ signedIn: false });
  });

  it('ends at sign-out, and the token is dead afterwards', async () => {
    const token = await signIn(h, address('out'));
    const out = await h.app.inject({
      method: 'POST',
      url: '/api/auth/sign-out',
      cookies: { session_token: token },
    });
    expect(out.statusCode).toBe(200);
    const me = await h.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: { session_token: token },
    });
    expect(me.json()).toEqual({ signedIn: false });
  });

  it('expires after a day', async () => {
    const token = await signIn(h, address('expired'));
    await h.db
      .updateTable('sessions')
      .set({ expires_at: new Date(Date.now() - 1000) })
      .where('token_hash', '=', sha256Hex(token))
      .execute();
    const me = await h.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: { session_token: token },
    });
    expect(me.json()).toEqual({ signedIn: false });
  });

  it('never logs a code or a token', async () => {
    // The request serializer logs the route pattern; this is the check that
    // nothing here writes a credential into the log on its own.
    const lines: string[] = [];
    const { buildApp } = await import('../../src/app.ts');
    const { capturingMailer } = await import('../../src/email/mailer.ts');
    const mailer = capturingMailer();
    const logged = await buildApp({
      config: { LOG_LEVEL: 'trace' },
      db: h.db,
      mailer,
      logStream: { write: (l) => void lines.push(l) },
    });
    const email = address('log');
    await logged.inject({ method: 'POST', url: '/api/auth/code', payload: { email } });
    const code = codeFor(mailer, email);
    const res = await logged.inject({
      method: 'POST',
      url: '/api/auth/sign-in',
      payload: { email, code },
    });
    const token = cookieFrom(res, 'session_token') ?? 'missing';
    await logged.close();
    const all = lines.join('');
    expect(all).toContain('/api/auth/sign-in');
    expect(all).not.toContain(code);
    expect(all).not.toContain(token);
    expect(all).not.toContain(email);
  });
});

describe('nothing about who signed in reaches a report', () => {
  it('has no identity column on reports', async () => {
    const { rows } = await sql<{ column_name: string }>`
      SELECT column_name FROM information_schema.columns WHERE table_name = 'reports'
    `.execute(h.db);
    const names = rows.map((c) => c.column_name);
    for (const banned of ['site_name', 'user_id', 'email', 'session_token', 'role']) {
      expect(names).not.toContain(banned);
    }
  });
});
