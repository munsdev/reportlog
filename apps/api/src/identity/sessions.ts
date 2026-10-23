/**
 * Sessions, and who is asking.
 *
 * Signing in is a one-time code to the address, then a cookie. The cookie
 * holds a random token; the database holds its hash. Every request with the
 * cookie is resolved to a person once, here, and routes read `request.user`.
 */
import { toRoleSet } from '@reportlog/access';
import type { HeldRole, OrgRole } from '@reportlog/access';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.gen.ts';
import { STAFF_SESSION_MS, hasFactor, needsSecondFactor } from './secondFactor.ts';
import type { SecondFactorState } from './secondFactor.ts';
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
  /**
   * The roles this request may act with (a person may hold several, decision
   * 70). A role holder whose session has not proved a second factor gets none
   * here, and no memberships: every guard reads these, so none of them can
   * forget to ask (secondFactor.ts).
   */
  roles: HeldRole[];
  memberships: Membership[];
  /** The roles on their account, whatever this session has proved. For the website only. */
  heldRoles: HeldRole[];
  secondFactor: SecondFactorState;
  /** When this session last proved the factor for a step-up (stepUp.ts). */
  stepUpAt: Date | null;
  /** The session row, for the routes that act on the asking session itself. */
  sessionHash: string;
  /** The tester flag (workstream G2's feedback tracker). Grants nothing else. */
  tester: boolean;
  /** The team-member flag. Opens the team's pages; grants nothing else. */
  teamMember: boolean;
  /** Display only (identity/flags.ts). */
  desks: string[];
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

/**
 * `ttlMs` is SESSION_TTL_MS for somebody with no role, and PENDING_SESSION_MS
 * for a role holder, whose session becomes a 12-hour one only when it proves
 * a second factor (secondFactor.ts).
 */
export async function createSession(
  db: Kysely<DB>,
  userId: number,
  ttlMs = SESSION_TTL_MS,
): Promise<string> {
  const token = randomToken();
  await db
    .insertInto('sessions')
    .values({
      token_hash: sha256Hex(token),
      user_id: userId,
      expires_at: new Date(Date.now() + ttlMs),
    })
    .execute();
  return token;
}

export function setSessionCookie(reply: FastifyReply, token: string, ttlMs = SESSION_TTL_MS): void {
  reply.setCookie(SESSION_COOKIE, token, cookieOptions(ttlMs));
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
    .select([
      'u.id',
      'u.email',
      'u.roles',
      'u.is_tester',
      'u.is_team_member',
      'u.desks',
      's.token_hash',
      's.second_factor_at',
      's.step_up_at',
    ])
    .where('s.token_hash', '=', sha256Hex(token))
    .where('s.expires_at', '>', new Date())
    .executeTakeFirst();
  if (!row) return null;
  const held = toRoleSet(row.roles);
  const memberships = await membershipsFor(db, row.id);
  const needed = needsSecondFactor(held, memberships);
  // A proof older than a staff session is no proof, whatever expires_at says.
  const proved =
    row.second_factor_at !== null && Date.now() - row.second_factor_at.getTime() < STAFF_SESSION_MS;
  const secondFactor: SecondFactorState = !needed
    ? 'not-needed'
    : proved
      ? 'done'
      : (await hasFactor(db, row.id))
        ? 'verify'
        : 'set-up';
  const pending = secondFactor === 'set-up' || secondFactor === 'verify';
  return {
    id: row.id,
    email: row.email,
    roles: pending ? [] : held,
    memberships: pending ? [] : memberships,
    heldRoles: held,
    secondFactor,
    stepUpAt: pending ? null : row.step_up_at,
    sessionHash: row.token_hash,
    tester: row.is_tester,
    teamMember: row.is_team_member,
    desks: row.desks,
  };
}

export function installSessions(app: FastifyInstance, db: Kysely<DB>): void {
  app.decorateRequest('user', null);
  app.addHook('onRequest', async (request: FastifyRequest) => {
    request.user = await userForSession(db, request.cookies[SESSION_COOKIE]);
  });
}
