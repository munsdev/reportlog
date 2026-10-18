/**
 * Sessions, and who is asking.
 *
 * Signing in is a one-time code to the address, then a cookie. The cookie
 * holds a random token; the database holds its hash. Every request with the
 * cookie is resolved to a person once, here, and routes read `request.user`.
 */
import { isSystemRole } from '@reportlog/access';
import type { OrgRole, SystemRole } from '@reportlog/access';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.gen.ts';
import { randomToken, sha256Hex } from './secrets.ts';

export const SESSION_COOKIE = 'session_token';
export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export interface Membership {
  organization_id: number;
  name: string;
  role: OrgRole;
}

export interface SignedIn {
  id: number;
  email: string;
  role: SystemRole;
  memberships: Membership[];
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Who is signed in, or null. Set once per request by `installSessions`. */
    user: SignedIn | null;
  }
}

/**
 * Secure, http-only, same-site lax. Lax rather than strict so that following
 * a link from an email (an invitation) arrives signed in.
 */
export const cookieOptions = (maxAgeMs: number) =>
  ({
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: Math.floor(maxAgeMs / 1000),
  }) as const;

export async function createSession(db: Kysely<DB>, userId: number): Promise<string> {
  const token = randomToken();
  await db
    .insertInto('sessions')
    .values({
      token_hash: sha256Hex(token),
      user_id: userId,
      expires_at: new Date(Date.now() + SESSION_TTL_MS),
    })
    .execute();
  return token;
}

export function setSessionCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(SESSION_COOKIE, token, cookieOptions(SESSION_TTL_MS));
}

export async function destroySession(db: Kysely<DB>, token: string): Promise<void> {
  await db.deleteFrom('sessions').where('token_hash', '=', sha256Hex(token)).execute();
}

export async function membershipsFor(db: Kysely<DB>, userId: number): Promise<Membership[]> {
  const rows = await db
    .selectFrom('organization_memberships as m')
    .innerJoin('organizations as o', 'o.id', 'm.organization_id')
    .select(['m.organization_id', 'o.name', 'm.role'])
    .where('m.user_id', '=', userId)
    .orderBy('o.name')
    .execute();
  return rows.map((r) => ({
    organization_id: r.organization_id,
    name: r.name,
    role: r.role === 'manager' ? 'manager' : 'coordinator',
  }));
}

export async function userForSession(
  db: Kysely<DB>,
  token: string | undefined,
): Promise<SignedIn | null> {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const row = await db
    .selectFrom('sessions as s')
    .innerJoin('users as u', 'u.id', 's.user_id')
    .select(['u.id', 'u.email', 'u.role'])
    .where('s.token_hash', '=', sha256Hex(token))
    .where('s.expires_at', '>', new Date())
    .executeTakeFirst();
  if (!row || !isSystemRole(row.role)) return null;
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    memberships: await membershipsFor(db, row.id),
  };
}

export function installSessions(app: FastifyInstance, db: Kysely<DB>): void {
  app.decorateRequest('user', null);
  app.addHook('onRequest', async (request: FastifyRequest) => {
    request.user = await userForSession(db, request.cookies[SESSION_COOKIE]);
  });
}
