/**
 * The door's fields for a test that sends a report or tip straight to the
 * API rather than through a page (apps/api/src/door/). A real start token and
 * a real challenge, solved here in Node the way the widget solves it in a
 * page. The suite's minimum time on a form is 0 (global-setup.ts).
 */
import type { APIRequestContext } from '@playwright/test';
import { solveChallenge } from 'altcha-lib';
import type { Challenge } from 'altcha-lib';
import { deriveKey } from 'altcha-lib/algorithms/pbkdf2';

export async function doorFields(
  request: APIRequestContext,
): Promise<{ start: string; altcha: string }> {
  const { start } = (await (await request.get('/api/door/start')).json()) as { start: string };
  const challenge = (await (await request.get('/api/door/challenge')).json()) as Challenge;
  const solution = await solveChallenge({ challenge, deriveKey });
  if (!solution) throw new Error('the door’s puzzle was not solved');
  return {
    start,
    altcha: Buffer.from(JSON.stringify({ challenge, solution })).toString('base64'),
  };
}
