/**
 * The second factor (plan E, decision E3): who needs one, what they have,
 * checking a code, and what a session has proved.
 *
 * WHO NEEDS ONE: anybody holding a role. That is every system role but
 * `user` (owner, administrator, access manager, moderator, journalist) and
 * anybody in an organization (managers and intake coordinators). Until the
 * session has proved a factor, `userForSession` (sessions.ts) hands every
 * route a person with no role and no memberships, so nothing behind a role
 * opens, whichever guard a route uses and whether or not it remembered to
 * ask. Plain users and alert subscribers never meet any of this.
 *
 * A CODE IS EITHER an authenticator app's six digits or a recovery code.
 * Both go through `checkCode`, which spends a try before it compares (as
 * otp.ts does), so guesses sent in parallel cannot outrun the lock.
 */
import { createHash, randomInt } from 'node:crypto';
import { sql } from 'kysely';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.gen.ts';
import { HttpError } from '../http/errors.ts';
import { recordRoleChange } from './roles.ts';
import { sameHex, sha256Hex } from './secrets.ts';
import { matchTotp, newTotpSecret, otpauthUri, base32Encode } from './totp.ts';
import type { TwoFactorKey } from './twoFactorKey.ts';
import { openTotpSecret, sealTotpSecret } from './twoFactorKey.ts';

/** How long a role holder's session lasts once it has proved a factor (E3). */
export const STAFF_SESSION_MS = 12 * 60 * 60 * 1000;
/** How long a role holder's session lasts before it has: enough to set one up. */
export const PENDING_SESSION_MS = 20 * 60 * 1000;
/** How long a step-up counts for (plan-e.md). */
export const STEP_UP_MS = 5 * 60 * 1000;
/** Wrong codes before the second factor locks, and for how long. */
export const MAX_FAILURES = 5;
export const LOCK_MS = 15 * 60 * 1000;
export const RECOVERY_CODE_COUNT = 10;

export function needsSecondFactor(role: string, memberships: readonly unknown[]): boolean {
  return role !== 'user' || memberships.length > 0;
}

/** What a signed-in person's second factor stands at, as the website is told it. */
export type SecondFactorState = 'not-needed' | 'set-up' | 'verify' | 'done';

export interface Factors {
  totp: boolean;
  /** An app being set up and not yet confirmed with a code. */
  totpPending: boolean;
  passkeys: { id: number; name: string; created_at: Date; last_used_at: Date | null }[];
  recoveryLeft: number;
}

export async function factorsOf(db: Kysely<DB>, userId: number): Promise<Factors> {
  const [totp, passkeys, recovery] = await Promise.all([
    db
      .selectFrom('two_factor_totp')
      .select(['confirmed_at', 'pending_at'])
      .where('user_id', '=', userId)
      .executeTakeFirst(),
    db
      .selectFrom('two_factor_passkeys')
      .select(['id', 'name', 'created_at', 'last_used_at'])
      .where('user_id', '=', userId)
      .orderBy('id')
      .execute(),
    db
      .selectFrom('two_factor_recovery_codes')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('user_id', '=', userId)
      .where('used_at', 'is', null)
      .executeTakeFirstOrThrow(),
  ]);
  return {
    totp: Boolean(totp?.confirmed_at),
    totpPending: Boolean(totp?.pending_at),
    passkeys,
    recoveryLeft: Number(recovery.n),
  };
}

/** Whether somebody has a factor they can sign in with. Recovery codes alone are not one. */
export async function hasFactor(db: Kysely<DB>, userId: number): Promise<boolean> {
  const f = await factorsOf(db, userId);
  return f.totp || f.passkeys.length > 0;
}

// ── the session ────────────────────────────────────────────────────────

/**
 * The session proved a factor just now: it becomes a staff session of 12
 * hours from now, and the proof counts as a step-up too (it is the same
 * factor, seconds ago).
 */
export async function markSecondFactor(db: Kysely<DB>, tokenHash: string): Promise<Date> {
  const now = new Date();
  const expires = new Date(now.getTime() + STAFF_SESSION_MS);
  await db
    .updateTable('sessions')
    .set({ second_factor_at: now, step_up_at: now, expires_at: expires })
    .where('token_hash', '=', tokenHash)
    .execute();
  return expires;
}

/** A step-up: the factor again, in a session that has already proved one. */
export async function markStepUp(db: Kysely<DB>, tokenHash: string): Promise<void> {
  await db
    .updateTable('sessions')
    .set({ step_up_at: new Date() })
    .where('token_hash', '=', tokenHash)
    .where('second_factor_at', 'is not', null)
    .execute();
}

export function stepUpFresh(stepUpAt: Date | null, now = Date.now()): boolean {
  return stepUpAt !== null && now - stepUpAt.getTime() < STEP_UP_MS && stepUpAt.getTime() <= now;
}

// ── wrong codes ────────────────────────────────────────────────────────

export const lockedOut = () =>
  new HttpError(
    429,
    'second_factor_locked',
    'Too many wrong codes. Your second factor is locked for 15 minutes. A passkey still works.',
  );

/**
 * Spends one try, or says the second factor is locked. Counted BEFORE the
 * code is compared and in one statement, so parallel guesses each take a
 * slot and at most MAX_FAILURES get compared before the lock.
 */
async function spendTry(db: Kysely<DB>, userId: number): Promise<boolean> {
  await db
    .insertInto('two_factor_attempts')
    .values({ user_id: userId })
    .onConflict((oc) => oc.column('user_id').doNothing())
    .execute();
  const row = await db
    .updateTable('two_factor_attempts')
    .set({ failures: sql`failures + 1`, locked_until: null })
    .where('user_id', '=', userId)
    .where((eb) => eb.or([eb('locked_until', 'is', null), eb('locked_until', '<=', new Date())]))
    .where('failures', '<', MAX_FAILURES)
    .returning('failures')
    .executeTakeFirst();
  return row !== undefined;
}

async function wrongCode(db: Kysely<DB>, userId: number): Promise<void> {
  // The try was spent already; at the limit, the lock starts and the count
  // starts again after it.
  await db
    .updateTable('two_factor_attempts')
    .set({ failures: 0, locked_until: new Date(Date.now() + LOCK_MS) })
    .where('user_id', '=', userId)
    .where('failures', '>=', MAX_FAILURES)
    .execute();
}

async function rightCode(db: Kysely<DB>, userId: number): Promise<void> {
  await db
    .updateTable('two_factor_attempts')
    .set({ failures: 0 })
    .where('user_id', '=', userId)
    .where((eb) => eb.or([eb('locked_until', 'is', null), eb('locked_until', '<=', new Date())]))
    .execute();
}

export async function isLocked(db: Kysely<DB>, userId: number): Promise<boolean> {
  const row = await db
    .selectFrom('two_factor_attempts')
    .select('locked_until')
    .where('user_id', '=', userId)
    .executeTakeFirst();
  return Boolean(row?.locked_until && row.locked_until.getTime() > Date.now());
}

// ── checking a code ────────────────────────────────────────────────────

export type CodeCheck = { ok: true; kind: 'totp' | 'recovery' } | { ok: false; locked: boolean };

/**
 * An authenticator code or a recovery code. Wrong, replayed, spent and
 * malformed all count as one wrong try and look the same; locked is said,
 * because the person can act on it (a passkey, or waiting).
 */
export async function checkCode(
  db: Kysely<DB>,
  key: TwoFactorKey | null,
  userId: number,
  typed: unknown,
  now = Date.now(),
): Promise<CodeCheck> {
  const code = typeof typed === 'string' ? typed.trim() : '';
  if (!(await spendTry(db, userId))) return { ok: false, locked: true };
  const ok = /^\d{6}$/.test(code)
    ? await checkTotp(db, key, userId, code, now)
    : await spendRecoveryCode(db, userId, code);
  if (ok) {
    await rightCode(db, userId);
    return { ok: true, kind: /^\d{6}$/.test(code) ? 'totp' : 'recovery' };
  }
  await wrongCode(db, userId);
  return { ok: false, locked: false };
}

async function checkTotp(
  db: Kysely<DB>,
  key: TwoFactorKey | null,
  userId: number,
  code: string,
  now: number,
): Promise<boolean> {
  if (!key) return false;
  const row = await db
    .selectFrom('two_factor_totp')
    .select('secret_enc')
    .where('user_id', '=', userId)
    .executeTakeFirst();
  if (!row?.secret_enc) return false;
  const secret = openTotpSecret(key, userId, row.secret_enc);
  if (!secret) return false;
  const step = matchTotp(secret, code, now);
  if (step === null) return false;
  // A CODE IS ACCEPTED ONCE, and nothing older than the newest accepted:
  // a conditional update, so two requests racing with one code cannot both
  // win, and a code watched over somebody's shoulder is spent by its owner.
  const spent = await db
    .updateTable('two_factor_totp')
    .set({ last_step: step })
    .where('user_id', '=', userId)
    .where((eb) => eb.or([eb('last_step', 'is', null), eb('last_step', '<', step)]))
    .executeTakeFirst();
  return spent.numUpdatedRows === 1n;
}

// ── setting up an authenticator app ────────────────────────────────────

export const noTwoFactorKey = () =>
  new HttpError(
    503,
    'no_two_factor_key',
    'This server cannot set up an authenticator app yet (TWO_FACTOR_KEY is not set). Use a passkey, or ask whoever runs the server.',
  );

/**
 * A new secret, kept as pending until a code from it is typed. Returned
 * once, to be shown once: the server never shows a stored secret again.
 */
export async function beginTotp(
  db: Kysely<DB>,
  key: TwoFactorKey | null,
  user: { id: number; email: string },
  issuer: string,
): Promise<{ secret: string; uri: string }> {
  if (!key) throw noTwoFactorKey();
  const secret = newTotpSecret();
  const sealed = sealTotpSecret(key, user.id, secret);
  const now = new Date();
  await db
    .insertInto('two_factor_totp')
    .values({ user_id: user.id, pending_secret_enc: sealed, pending_at: now })
    .onConflict((oc) =>
      oc.column('user_id').doUpdateSet({ pending_secret_enc: sealed, pending_at: now }),
    )
    .execute();
  return { secret: base32Encode(secret), uri: otpauthUri(secret, user.email, issuer) };
}

/** True when the code is right for the pending secret, which then becomes the one in use. */
export async function confirmTotp(
  db: Kysely<DB>,
  key: TwoFactorKey | null,
  userId: number,
  typed: unknown,
  now = Date.now(),
): Promise<boolean> {
  if (!key) throw noTwoFactorKey();
  const code = typeof typed === 'string' ? typed.trim() : '';
  if (!(await spendTry(db, userId))) throw lockedOut();
  const row = await db
    .selectFrom('two_factor_totp')
    .select(['pending_secret_enc', 'pending_at'])
    .where('user_id', '=', userId)
    .executeTakeFirst();
  const secret =
    row?.pending_secret_enc && row.pending_at
      ? openTotpSecret(key, userId, row.pending_secret_enc)
      : null;
  const step = secret ? matchTotp(secret, code, now) : null;
  if (step === null || !row?.pending_secret_enc || !row.pending_at) {
    await wrongCode(db, userId);
    return false;
  }
  // Conditional on the pending secret still being the one checked, so a
  // second "begin" in another tab cannot have its secret confirmed by a
  // code from the first.
  const moved = await db
    .updateTable('two_factor_totp')
    .set({
      secret_enc: row.pending_secret_enc,
      confirmed_at: new Date(),
      pending_secret_enc: null,
      pending_at: null,
      last_step: step,
    })
    .where('user_id', '=', userId)
    .where('pending_at', '=', row.pending_at)
    .executeTakeFirst();
  if (moved.numUpdatedRows !== 1n) return false;
  await rightCode(db, userId);
  return true;
}

export async function removeTotp(db: Kysely<DB>, userId: number): Promise<void> {
  await db.deleteFrom('two_factor_totp').where('user_id', '=', userId).execute();
}

// ── recovery codes ─────────────────────────────────────────────────────

// Crockford's base32: no I, L, O or U, so nothing on paper is mistaken for
// anything else. 16 characters are 80 bits.
const RECOVERY_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function newRecoveryCode(): string {
  let s = '';
  for (let i = 0; i < 16; i += 1) s += RECOVERY_ALPHABET.charAt(randomInt(0, 32));
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}-${s.slice(12)}`;
}

/** The one spelling a recovery code is hashed in: what a person writes down, forgiven. */
export function normalizeRecoveryCode(typed: string): string | null {
  const s = typed.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  return /^[0-9A-HJKMNP-TV-Z]{16}$/.test(s) ? s : null;
}

const recoveryHash = (normalized: string) =>
  createHash('sha256').update(`recovery\u0000${normalized}`, 'utf8').digest('hex');

/** Ten new codes, replacing any left. Shown once; only their hashes are kept. */
export async function newRecoveryCodes(db: Kysely<DB>, userId: number): Promise<string[]> {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, newRecoveryCode);
  await db.transaction().execute(async (trx) => {
    await trx.deleteFrom('two_factor_recovery_codes').where('user_id', '=', userId).execute();
    await trx
      .insertInto('two_factor_recovery_codes')
      .values(
        codes.map((c) => ({
          user_id: userId,
          code_hash: recoveryHash(normalizeRecoveryCode(c) ?? ''),
        })),
      )
      .execute();
  });
  return codes;
}

async function spendRecoveryCode(db: Kysely<DB>, userId: number, typed: string): Promise<boolean> {
  const normalized = normalizeRecoveryCode(typed);
  if (!normalized) return false;
  const want = recoveryHash(normalized);
  const live = await db
    .selectFrom('two_factor_recovery_codes')
    .select(['id', 'code_hash'])
    .where('user_id', '=', userId)
    .where('used_at', 'is', null)
    .execute();
  const match = live.find((r) => sameHex(r.code_hash, want));
  if (!match) return false;
  // Spent with a condition: two requests with the one code, one wins.
  const spent = await db
    .updateTable('two_factor_recovery_codes')
    .set({ used_at: new Date() })
    .where('id', '=', match.id)
    .where('used_at', 'is', null)
    .executeTakeFirst();
  return spent.numUpdatedRows === 1n;
}

// ── resetting ──────────────────────────────────────────────────────────

/** Who role_audit says did a reset from the server. Not an address: nobody signed in did. */
export const SERVER_ACTOR = 'the server (reportlog reset-2fa)';

/**
 * Clears every factor somebody has and signs them out everywhere, so their
 * next sign-in sets one up again. Recorded in role_audit, in the same
 * transaction. The caller decides who may; this only does it.
 */
export async function resetSecondFactor(
  db: Kysely<DB>,
  subject: { id: number; email: string },
  actorEmail: string,
  how: string,
): Promise<void> {
  await db.transaction().execute(async (trx) => {
    await trx.deleteFrom('two_factor_totp').where('user_id', '=', subject.id).execute();
    await trx.deleteFrom('two_factor_passkeys').where('user_id', '=', subject.id).execute();
    await trx.deleteFrom('two_factor_recovery_codes').where('user_id', '=', subject.id).execute();
    await trx.deleteFrom('two_factor_attempts').where('user_id', '=', subject.id).execute();
    await trx.deleteFrom('sessions').where('user_id', '=', subject.id).execute();
    await recordRoleChange(trx, {
      actorEmail,
      subjectEmail: subject.email,
      axis: 'second_factor',
      action: 'revoke',
      detail: `second factor reset, ${how}`,
    });
  });
}

/** The session row's hash, for the routes that act on the asking session. */
export const sessionHash = (token: string) => sha256Hex(token);
