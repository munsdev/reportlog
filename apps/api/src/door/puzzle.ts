/**
 * THE PUZZLE: ALTCHA proof of work, self-hosted (brief §02).
 *
 * The page fetches a challenge from this server, the browser solves it in
 * the background (the `altcha` widget, bundled with the website, so no other
 * host is ever asked), and the solution is sent with the report or tip. The
 * server checks, in order:
 *
 *   1. it is a solution at all, to a challenge in the one form we issue;
 *   2. the challenge is ours: its parameters carry our HMAC signature, so its
 *      difficulty and expiry are the ones we chose and nobody else's;
 *   3. it has not expired (PUZZLE_TTL_S after it was issued);
 *   4. the solution is right: one key derivation, here;
 *   5. it has not been used before. The hash of its signature is kept in
 *      `door_spent_puzzles` until the challenge would have expired anyway,
 *      and a second use is refused. Checked last, so a wrong answer cannot
 *      burn somebody else's challenge.
 *
 * MAKING A CHALLENGE COSTS ONE HMAC. The library can also pre-compute a key
 * at issue ("deterministic mode"), which would make fetching a challenge
 * cost the server the very work the puzzle asks of a visitor; it is not used.
 * Verifying costs one derivation at the challenge's cost.
 */
import { createHash } from 'node:crypto';
import { createChallenge, verifySolution } from 'altcha-lib';
import type { Challenge, Solution } from 'altcha-lib';
import { deriveKey } from 'altcha-lib/algorithms/pbkdf2';
import { sql } from 'kysely';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.gen.ts';
import type { PuzzleLevel } from '../moderation/switches.ts';

/** The one algorithm we issue: PBKDF2, which every browser's WebCrypto has. */
export const PUZZLE_ALGORITHM = 'PBKDF2/SHA-256';

/** How long a challenge may be solved and sent for. Enough to write a report in. */
export const PUZZLE_TTL_S = 30 * 60;

/**
 * How hard each level is: the PBKDF2 iterations per attempt, and the hex
 * prefix the derived key must start with (each 0 is sixteen times as many
 * attempts on average). Measured in headless Chromium on 4 cores (the cloud
 * test container, 21 October 2026), from page load to solved: "normal" 0.7 to
 * 0.9 s, most of it the widget's own half-second minimum; "harder" (the
 * moderators' switch, brief §05) 1 to 14 s over two runs, still well under the
 * time a form takes to fill in, since it solves while the reporter answers.
 * Not tuned automatically (brief §07); tune both in the flood rehearsal.
 */
export const PUZZLE_LEVELS: Record<PuzzleLevel, { cost: number; keyPrefix: string }> = {
  normal: { cost: 250, keyPrefix: '000' },
  harder: { cost: 1000, keyPrefix: '0000' },
};

export type PuzzleCheck = 'puzzle_missing' | 'puzzle_wrong' | 'puzzle_expired' | 'puzzle_reused';

export async function issueChallenge(
  secret: string,
  level: PuzzleLevel,
  now: number = Date.now(),
): Promise<Challenge> {
  return createChallenge({
    algorithm: PUZZLE_ALGORITHM,
    ...PUZZLE_LEVELS[level],
    deriveKey,
    expiresAt: Math.floor(now / 1000) + PUZZLE_TTL_S,
    hmacSignatureSecret: secret,
  });
}

interface Payload {
  challenge: Challenge;
  solution: Solution;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** The widget's payload (base64 of JSON), in the one shape a solution has, or null. */
function parse(text: unknown): Payload | null {
  if (typeof text !== 'string' || !text || text.length > 4096) return null;
  let v: unknown;
  try {
    v = JSON.parse(Buffer.from(text, 'base64').toString('utf8'));
  } catch {
    return null;
  }
  if (!isObj(v) || !isObj(v.challenge) || !isObj(v.solution)) return null;
  const { challenge, solution } = v;
  const p = challenge.parameters;
  if (!isObj(p) || typeof challenge.signature !== 'string') return null;
  // The library also takes a "server-verified" payload signed by a hosted
  // service. That is a third party, and nothing here accepts it.
  if (p.algorithm !== PUZZLE_ALGORITHM || typeof p.expiresAt !== 'number') return null;
  if (typeof p.cost !== 'number' || p.cost < 1 || p.cost > 1_000_000) return null;
  if (typeof solution.counter !== 'number' || !Number.isSafeInteger(solution.counter)) return null;
  if (typeof solution.derivedKey !== 'string' || !/^[a-f0-9]{2,256}$/.test(solution.derivedKey))
    return null;
  return v as unknown as Payload;
}

/** Null when the solution is good and now spent; otherwise which check refused it. */
export async function spendSolution(
  db: Kysely<DB>,
  secret: string,
  text: unknown,
  now: number = Date.now(),
): Promise<PuzzleCheck | null> {
  if (text === undefined || text === null || text === '') return 'puzzle_missing';
  const payload = parse(text);
  if (!payload) return 'puzzle_wrong';
  const expiresAt = payload.challenge.parameters.expiresAt ?? 0;
  if (expiresAt * 1000 <= now) return 'puzzle_expired';
  let verified: boolean;
  try {
    const result = await verifySolution({
      challenge: payload.challenge,
      solution: payload.solution,
      deriveKey,
      hmacSignatureSecret: secret,
    });
    if (result.expired) return 'puzzle_expired';
    verified = result.verified;
  } catch {
    verified = false;
  }
  if (!verified) return 'puzzle_wrong';

  // SINGLE USE. The insert is the check: a second request with the same
  // solution finds the row, whichever of two simultaneous ones gets there.
  const signatureHash = createHash('sha256')
    .update(payload.challenge.signature ?? '')
    .digest('hex');
  const spent = await db
    .insertInto('door_spent_puzzles')
    .values({ signature_hash: signatureHash, expires_at: new Date(expiresAt * 1000) })
    .onConflict((oc) => oc.column('signature_hash').doNothing())
    .returning('signature_hash')
    .executeTakeFirst();
  // What has expired can never be presented again, so it is not kept.
  await db
    .deleteFrom('door_spent_puzzles')
    .where('expires_at', '<', sql<Date>`now()`)
    .execute();
  return spent ? null : 'puzzle_reused';
}
