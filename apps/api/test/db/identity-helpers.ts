/**
 * What the identity tests share: an app with a mailer that keeps what it was
 * asked to send, and signing somebody in the way a person would (asking for
 * a code and reading it out of the email).
 */
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../../src/app.ts';
import type { Database } from '../../src/db/database.ts';
import { capturingMailer } from '../../src/email/mailer.ts';
import type { CapturingMailer } from '../../src/email/mailer.ts';
import { testDatabase } from './helpers.ts';

export const SITE = 'https://reports.example.test';

export interface Harness {
  db: Database;
  app: FastifyInstance;
  mailer: CapturingMailer;
  close(): Promise<void>;
}

export async function harness(): Promise<Harness> {
  const db = testDatabase();
  const mailer = capturingMailer();
  const app = await buildApp({ config: { LOG_LEVEL: 'silent', SITE_ORIGIN: SITE }, db, mailer });
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

/** Sign in by code; returns the session cookie's value. */
export async function signIn(
  h: Harness,
  email: string,
  cookies: Record<string, string> = {},
): Promise<string> {
  const asked = await h.app.inject({
    method: 'POST',
    url: '/api/auth/code',
    payload: { email },
    cookies,
  });
  if (asked.statusCode !== 200) throw new Error(`code request failed: ${asked.body}`);
  const res = await h.app.inject({
    method: 'POST',
    url: '/api/auth/sign-in',
    payload: { email, code: codeFor(h.mailer, email) },
    cookies,
  });
  const token = cookieFrom(res, 'session_token');
  if (res.statusCode !== 200 || !token) throw new Error(`sign-in failed: ${res.body}`);
  return token;
}

/** Give an address a role directly, as a fixture. The owner seat is cleared first. */
export async function seat(db: Database, email: string, role: string): Promise<number> {
  if (role === 'owner') {
    await db.updateTable('users').set({ role: 'admin' }).where('role', '=', 'owner').execute();
  }
  const row = await db
    .insertInto('users')
    .values({ email, role })
    .onConflict((oc) => oc.column('email').doUpdateSet({ role }))
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
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

export async function roleOf(db: Database, email: string): Promise<string | undefined> {
  const row = await db
    .selectFrom('users')
    .select('role')
    .where('email', '=', email)
    .executeTakeFirst();
  return row?.role;
}

/** Put the site password back off, as the other test files expect to find it. */
export async function liftCurtain(db: Database): Promise<void> {
  await db.updateTable('site_access').set({ enabled: false }).where('id', '=', true).execute();
}
