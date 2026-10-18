/**
 * One-time codes, bound to what they were asked for.
 *
 * A code is stored under a SUBJECT: what it proves. Signing in as an address,
 * setting a deployment up as an address, and handing the owner's seat to one
 * named address are three different subjects, so a code minted for one never
 * verifies for another. The handover is the one where that matters most: the
 * code goes to the owner's mailbox naming the recipient, and that email is a
 * record only if the seat cannot then go somewhere else on the same code.
 *
 * Six digits are a million guesses, so a subject gets MAX_ATTEMPTS wrong
 * tries across its live codes and then none of them work. That is the real
 * limit; the per-address limiter on the routes only stops the mailbox being
 * flooded.
 */
import { sql } from 'kysely';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.gen.ts';
import { normalizeEmail, randomCode, sameHex, sha256Hex } from './secrets.ts';

export const CODE_TTL_MS = 10 * 60 * 1000;
export const MAX_ATTEMPTS = 5;

// NUL separates the parts because it cannot occur in an address, so no pair
// of addresses can collide with another pair by concatenation.
export const subjects = {
  signIn: (email: string) => `sign-in\u0000${normalizeEmail(email)}`,
  setup: (email: string) => `setup\u0000${normalizeEmail(email)}`,
  handover: (ownerEmail: string, toEmail: string) =>
    `handover\u0000${normalizeEmail(ownerEmail)}\u0000${normalizeEmail(toEmail)}`,
};

export async function createCode(db: Kysely<DB>, subject: string): Promise<string> {
  const code = randomCode();
  await db
    .insertInto('otp_codes')
    .values({
      subject_hash: sha256Hex(subject),
      code_hash: sha256Hex(code),
      expires_at: new Date(Date.now() + CODE_TTL_MS),
    })
    .execute();
  return code;
}

/**
 * True once, for the right code, and spends it. Does not say why a code
 * failed: wrong, expired, spent and out of tries all look the same, which is
 * all the person at the keyboard can act on anyway.
 */
export async function verifyCode(db: Kysely<DB>, subject: string, code: unknown): Promise<boolean> {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code.trim())) {
    // Still counts as a try: a malformed guess is a guess.
    await countWrongAttempt(db, subject);
    return false;
  }
  const subjectHash = sha256Hex(subject);
  const codeHash = sha256Hex(code.trim());
  const live = await db
    .selectFrom('otp_codes')
    .select(['id', 'code_hash'])
    .where('subject_hash', '=', subjectHash)
    .where('used_at', 'is', null)
    .where('expires_at', '>', new Date())
    .where('attempts', '<', MAX_ATTEMPTS)
    .orderBy('created_at', 'desc')
    .execute();
  const match = live.find((row) => sameHex(row.code_hash, codeHash));
  if (!match) {
    await countWrongAttempt(db, subject);
    return false;
  }
  // Spent with a condition, so two requests racing with the same code cannot
  // both succeed.
  const spent = await db
    .updateTable('otp_codes')
    .set({ used_at: new Date() })
    .where('id', '=', match.id)
    .where('used_at', 'is', null)
    .executeTakeFirst();
  return spent.numUpdatedRows === 1n;
}

async function countWrongAttempt(db: Kysely<DB>, subject: string): Promise<void> {
  await db
    .updateTable('otp_codes')
    .set({ attempts: sql`attempts + 1` })
    .where('subject_hash', '=', sha256Hex(subject))
    .where('used_at', 'is', null)
    .where('expires_at', '>', new Date())
    .execute();
}
