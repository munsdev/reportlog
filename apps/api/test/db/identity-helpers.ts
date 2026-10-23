/**
 * What the identity tests share: an app with a mailer that keeps what it was
 * asked to send, and signing somebody in the way a person would (asking for
 * a code and reading it out of the email).
 */
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { sql } from 'kysely';
import type { Kysely } from 'kysely';
import type { DB } from '../../src/db/schema.gen.ts';
import { buildApp } from '../../src/app.ts';
import type { Database } from '../../src/db/database.ts';
import { capturingMailer } from '../../src/email/mailer.ts';
import { STAFF_SESSION_MS } from '../../src/identity/secondFactor.ts';
import { sha256Hex } from '../../src/identity/secrets.ts';
import { base32Decode, totpAt } from '../../src/identity/totp.ts';
import type { CapturingMailer } from '../../src/email/mailer.ts';
import { testDatabase } from './helpers.ts';

export const SITE = 'https://reports.example.test';
/** The authenticator-app key every harness runs with (two-factor tests). */
export const TWO_FACTOR_KEY = Buffer.alloc(32, 7).toString('base64');

export interface Harness {
  db: Database;
  app: FastifyInstance;
  mailer: CapturingMailer;
  close(): Promise<void>;
}

/** `extra` is more configuration, such as the CONTACT_KEY a list needs to take an email or a link. */
export async function harness(
  extra: { CONTACT_KEY?: string; TWO_FACTOR_KEY?: string } = {},
): Promise<Harness> {
  const db = testDatabase();
  const mailer = capturingMailer();
  const app = await buildApp({
    config: { LOG_LEVEL: 'silent', SITE_ORIGIN: SITE, TWO_FACTOR_KEY, ...extra },
    db,
    mailer,
  });
  return {
    db,
    app,
    mailer,
    async close() {
      await app.close();
      await db.destroy();
    },
  };
}

let n = 0;
/** An address no other test uses. */
export function address(stem: string): string {
  n += 1;
  return `${stem}-${String(process.pid)}-${String(n)}-${String(Date.now() % 1e6)}@example.org`;
}

/** The six-digit code in the newest message to this address. */
export function codeFor(mailer: CapturingMailer, email: string): string {
  const text = mailer.lastTo(email)?.text ?? '';
  // Standing alone, so the digits in an address in the same message never match.
  const code = /(?:^|\s)(\d{6})(?=[\s.,]|$)/m.exec(text)?.[1];
  if (!code) throw new Error(`no code was emailed to ${email}`);
  return code;
}

export function cookieFrom(res: LightMyRequestResponse, name: string): string | undefined {
  return res.cookies.find((c) => c.name === name)?.value;
}

/**
 * Sign in by code, as a person would, and, AS A FIXTURE, mark the session as
 * having proved a second factor (and a step-up) just now, whatever role the
 * address holds now or is given later in the test. Every other test file
 * signs staff in through here; the second factor itself, and a session that
 * has NOT proved one, are tested through the real routes in
 * second-factor.test.ts with `signInByEmailOnly`.
 */
export async function signIn(
  h: Harness,
  email: string,
  cookies: Record<string, string> = {},
): Promise<string> {
  const token = await signInByEmailOnly(h, email, cookies);
  await trustSession(h.db, token);
  return token;
}

/**
 * A FIXTURE: this session proved a second factor (and a step-up) just now.
 * Kept under the same token, unlike the real route (upgradeSession), so a
 * test can go on using the cookie it has.
 */
export async function trustSession(db: Database, token: string): Promise<void> {
  const now = new Date();
  await db
    .updateTable('sessions')
    .set({
      second_factor_at: now,
      step_up_at: now,
      expires_at: new Date(now.getTime() + STAFF_SESSION_MS),
    })
    .where('token_hash', '=', sha256Hex(token))
    .execute();
}

/** The emailed code and nothing else: a role holder's session then acts with no role. */
export async function signInByEmailOnly(
  h: Harness,
  email: string,
  cookies: Record<string, string> = {},
  remoteAddress?: string,
): Promise<string> {
  const asked = await h.app.inject({
    method: 'POST',
    url: '/api/auth/code',
    payload: { email },
    cookies,
    ...(remoteAddress ? { remoteAddress } : {}),
  });
  if (asked.statusCode !== 200) throw new Error(`code request failed: ${asked.body}`);
  const res = await h.app.inject({
    method: 'POST',
    url: '/api/auth/sign-in',
    payload: { email, code: codeFor(h.mailer, email) },
    cookies,
    ...(remoteAddress ? { remoteAddress } : {}),
  });
  const token = cookieFrom(res, 'session_token');
  if (res.statusCode !== 200 || !token) throw new Error(`sign-in failed: ${res.body}`);
  return token;
}

/**
 * Give an address its roles directly, as a fixture, replacing what it held.
 * `role` may be a comma-separated list; "user" is none. The owner seat is
 * cleared first (the previous owner steps down to administrator).
 */
export async function seat(db: Database, email: string, role: string): Promise<number> {
  const roles = role.split(',').filter((r) => r && r !== 'user');
  if (roles.includes('owner')) {
    await db
      .updateTable('users')
      .set({
        roles: sql<string[]>`CASE WHEN 'admin' = ANY(roles) THEN array_remove(roles, 'owner')
          ELSE array_append(array_remove(roles, 'owner'), 'admin') END`,
      })
      .where(sql<boolean>`roles @> ARRAY['owner']::text[]`)
      .execute();
  }
  const row = await db
    .insertInto('users')
    .values({ email, roles })
    .onConflict((oc) => oc.column('email').doUpdateSet({ roles }))
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

/** Take the owner's and administrators' seats off whoever holds them, as the setup tests need. */
export async function clearStaffSeats(db: Kysely<DB>): Promise<void> {
  await db
    .updateTable('users')
    .set({ roles: sql<string[]>`array_remove(array_remove(roles, 'owner'), 'admin')` })
    .where(sql<boolean>`roles && ARRAY['owner', 'admin']::text[]`)
    .execute();
}

/** Leave an address holding no role at all. */
export async function clearRoles(db: Kysely<DB>, email: string): Promise<void> {
  await db.updateTable('users').set({ roles: [] }).where('email', '=', email).execute();
}

/** Calls as a signed-in person (and, optionally, past the site password). */
export function as(h: Harness, session?: string, siteAccess?: string) {
  return (opts: InjectOptions) =>
    h.app.inject({
      ...opts,
      cookies: {
        ...(session ? { session_token: session } : {}),
        ...(siteAccess ? { site_access: siteAccess } : {}),
      },
    });
}

/** What an address holds, as one word ("user" for none, roles joined by a comma), or undefined with no account. */
export async function roleOf(db: Database, email: string): Promise<string | undefined> {
  const row = await db
    .selectFrom('users')
    .select('roles')
    .where('email', '=', email)
    .executeTakeFirst();
  return row && (row.roles.length ? [...row.roles].sort().join(',') : 'user');
}

/** Put the site password back off, as the other test files expect to find it. */
export async function liftCurtain(db: Database): Promise<void> {
  await db.updateTable('site_access').set({ enabled: false }).where('id', '=', true).execute();
}

/**
 * Set up an authenticator app through the real routes, as the website does,
 * computing the code from the secret it shows. Returns the secret (base32),
 * the recovery codes shown once, and the session's new token.
 */
export async function setUpTotp(
  h: Harness,
  session: string,
  cookies: Record<string, string> = {},
): Promise<{ secret: string; recoveryCodes: string[]; session: string }> {
  const all = { ...cookies, session_token: session };
  const begun = await h.app.inject({
    method: 'POST',
    url: '/api/auth/second-factor/totp/begin',
    cookies: all,
  });
  if (begun.statusCode !== 200) throw new Error(`begin failed: ${begun.body}`);
  const { secret } = begun.json<{ secret: string }>();
  const confirmed = await h.app.inject({
    method: 'POST',
    url: '/api/auth/second-factor/totp/confirm',
    payload: { code: totpAt(base32Decode(secret), Date.now()) },
    cookies: all,
  });
  if (confirmed.statusCode !== 200) throw new Error(`confirm failed: ${confirmed.body}`);
  return {
    secret,
    recoveryCodes: confirmed.json<{ recoveryCodes: string[] }>().recoveryCodes,
    // Proving the first factor replaces the session (secondFactor.ts, upgradeSession).
    session: cookieFrom(confirmed, 'session_token') ?? session,
  };
}
