/**
 * What the tests that file through the routes send at the door: a start token
 * from an hour ago, and a solved puzzle, both signed with the app's own key.
 *
 * The puzzle is made in the library's "deterministic" mode (a known counter),
 * so it is solved at once: a test about filing should not spend a second on
 * proof of work. It is still a real challenge, verified, spent and refused on
 * reuse by the same code as any other; test/db/door.test.ts solves a real one.
 */
import type { FastifyInstance } from 'fastify';
import { createChallenge, solveChallenge } from 'altcha-lib';
import { deriveKey } from 'altcha-lib/algorithms/pbkdf2';
import { doorOf } from '../src/door/index.ts';
import { PUZZLE_ALGORITHM, PUZZLE_TTL_S } from '../src/door/puzzle.ts';
import { issueStart } from '../src/door/start.ts';

export interface DoorPass {
  start: string;
  altcha: string;
}

/** A solution to a challenge this app signed. `expiresInS` below 0 makes an expired one. */
export async function solvedPuzzle(
  app: FastifyInstance,
  { expiresInS = PUZZLE_TTL_S, secret }: { expiresInS?: number; secret?: string } = {},
): Promise<string> {
  const door = doorOf(app);
  if (!door) throw new Error('this app has no door');
  const challenge = await createChallenge({
    algorithm: PUZZLE_ALGORITHM,
    cost: 1,
    counter: 0,
    deriveKey,
    expiresAt: Math.floor(Date.now() / 1000) + expiresInS,
    hmacSignatureSecret: secret ?? door.secrets.puzzle,
  });
  const solution = await solveChallenge({ challenge, deriveKey });
  if (!solution) throw new Error('the test puzzle was not solved');
  return Buffer.from(
    JSON.stringify({
      challenge: { parameters: challenge.parameters, signature: challenge.signature },
      solution,
    }),
  ).toString('base64');
}

/** A start token from `agoMs` ago, signed by this app. */
export function startToken(app: FastifyInstance, agoMs = 60 * 60 * 1000): string {
  const door = doorOf(app);
  if (!door) throw new Error('this app has no door');
  return issueStart(door.secrets.start, Date.now() - agoMs);
}

/** Everything the door wants, fresh: send it with ONE report or tip. */
export async function doorPass(app: FastifyInstance): Promise<DoorPass> {
  return { start: startToken(app), altcha: await solvedPuzzle(app) };
}
