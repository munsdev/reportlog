/**
 * The site password ("the curtain"): a soft gate that keeps a deployment off
 * the open internet before it is ready. Separate from signing in. Somebody
 * past the curtain is nobody in particular; somebody signed in may still
 * need the password.
 */
import type { FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.gen.ts';
import { HttpError } from '../http/errors.ts';
import { hashPassword, randomToken, sha256Hex, verifyPassword } from './secrets.ts';

export const SITE_ACCESS_COOKIE = 'site_access';
export const SITE_ACCESS_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const MIN_CURTAIN_PASSWORD = 8;

export interface SiteAccessSettings {
  enabled: boolean;
  password_hash: string | null;
  setup_completed_at: Date | null;
  /** No row at all. Marked rather than defaulted: see `gateApplies`. */
  missing?: true;
}

export async function siteAccessSettings(db: Kysely<DB>): Promise<SiteAccessSettings> {
  const row = await db
    .selectFrom('site_access')
    .select(['enabled', 'password_hash', 'setup_completed_at'])
    .where('id', '=', true)
    .executeTakeFirst();
  // The migration seeds the row, so this should never happen. If it does, it
  // is LOCKED: a missing row once read as "gate off" and took the password
  // off a whole deployment with nothing on screen saying so.
  return row ?? { enabled: true, password_hash: null, setup_completed_at: null, missing: true };
}

/**
 * Is there a gate to get past at all? ONE ANSWER, asked by the gate, by the
 * status the lock screen reads and by unlocking. When they disagreed, a lock
 * screen sat over a site whose every request succeeded.
 *
 *   no row                    gated, and nobody gets in
 *   turned off                open
 *   on, with no password set  open: a door with no key is not a gate, and a
 *                             fresh install starts here
 *   on, with a password       gated
 */
export function gateApplies(settings: SiteAccessSettings): boolean {
  if (settings.missing) return true;
  if (!settings.enabled) return false;
  return settings.password_hash !== null;
}

export async function tokenIsLive(db: Kysely<DB>, token: string | undefined): Promise<boolean> {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return false;
  const row = await db
    .selectFrom('site_access_tokens')
    .select('token_hash')
    .where('token_hash', '=', sha256Hex(token))
    .where('expires_at', '>', new Date())
    .executeTakeFirst();
  return Boolean(row);
}

/** Is this request past the password? True on a deployment with none. */
export async function hasSiteAccess(db: Kysely<DB>, request: FastifyRequest): Promise<boolean> {
  const settings = await siteAccessSettings(db);
  if (!gateApplies(settings)) return true;
  return tokenIsLive(db, request.cookies[SITE_ACCESS_COOKIE]);
}

/** What the gate answers. One shape, so the website can tell it from any other refusal. */
export const locked = () =>
  new HttpError(401, 'locked', 'This site needs its password before anything else can be shown.');

/** The caller's own site-access token, to keep through a password change. */
export function keepCurrentToken(request: FastifyRequest): { keepToken?: string } {
  const token = request.cookies[SITE_ACCESS_COOKIE];
  return token ? { keepToken: token } : {};
}

/** A token for somebody who typed the right password, or null. */
export async function unlock(db: Kysely<DB>, password: string): Promise<string | null> {
  const settings = await siteAccessSettings(db);
  if (!(await verifyPassword(password, settings.password_hash))) return null;
  const token = randomToken();
  await db
    .insertInto('site_access_tokens')
    .values({ token_hash: sha256Hex(token), expires_at: new Date(Date.now() + SITE_ACCESS_TTL_MS) })
    .execute();
  return token;
}

/**
 * A floor, not a policy. The curtain does not protect the archive; it keeps
 * an unfinished deployment off the internet and is shared casually among
 * testers. It refuses only the shapes that mean nobody chose one.
 */
export function validateCurtainPassword(
  password: unknown,
  confirm: unknown,
): { ok: true; password: string } | { ok: false; message: string } {
  const p = typeof password === 'string' ? password : '';
  if (!p.trim()) return { ok: false, message: 'Enter a password.' };
  if (p.length < MIN_CURTAIN_PASSWORD) {
    return { ok: false, message: `Use at least ${MIN_CURTAIN_PASSWORD} characters.` };
  }
  // Checked by the server, not only by the page: a mistyped password on the
  // last screen of setup locks the operator out of what they were just handed.
  if (confirm !== p) return { ok: false, message: 'The two passwords do not match.' };
  return { ok: true, password: p };
}

/**
 * Set the password (and turn the gate on with it), or turn the gate on or
 * off.
 *
 * A NEW PASSWORD RETIRES EVERY OLD WAY IN. Otherwise the installer's cookie,
 * or anybody else's, would keep working for up to thirty days after the owner
 * chose a password precisely so that it would not. The one exception is the
 * token of whoever is changing it (`keepToken`): they are behind the curtain
 * right now, and evicting them would look exactly like the software breaking.
 */
export async function writeSiteAccess(
  db: Kysely<DB>,
  change: { password?: string; enabled?: boolean; completeSetup?: boolean; keepToken?: string },
): Promise<void> {
  if (change.password !== undefined) {
    let retire = db.deleteFrom('site_access_tokens');
    if (change.keepToken) retire = retire.where('token_hash', '<>', sha256Hex(change.keepToken));
    await retire.execute();
  }
  await db
    .updateTable('site_access')
    .set({
      ...(change.password !== undefined
        ? { password_hash: await hashPassword(change.password), enabled: true }
        : {}),
      ...(change.enabled !== undefined ? { enabled: change.enabled } : {}),
      ...(change.completeSetup ? { setup_completed_at: new Date() } : {}),
      updated_at: new Date(),
    })
    .where('id', '=', true)
    .execute();
}
