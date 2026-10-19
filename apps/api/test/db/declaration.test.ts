/**
 * What the signed declaration in "My reports" prints about the version it
 * declares: the same fingerprint and chain link the verifier recomputes.
 */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { verifyReport } from '../../src/chain/verify.ts';
import { launchedLogbook } from './helpers.ts';
import { fileThroughRoutes, filingHarness, threadOf } from './filing-helpers.ts';
import type { FilingHarness } from './filing-helpers.ts';
import { address, as, signIn } from './identity-helpers.ts';

let h: FilingHarness;
beforeAll(async () => {
  h = await filingHarness();
});
afterAll(async () => {
  await h.close();
});

it('a report’s detail carries the current version’s fingerprint and chain link', async () => {
  const lb = await launchedLogbook(h.db, [
    { key: 'what', kind: 'long_text', label: 'What happened?', required: true },
  ]);
  const email = address('declares');
  const ref = await fileThroughRoutes(h, lb.slug, { what: 'Sworn to.' }, email);
  const thread = await threadOf(h.db, ref);
  const me = as(h, await signIn(h, email));
  const first = (await me({ method: 'GET', url: `/api/mine/reports/${thread}` })).json<{
    content_hash: string;
    chain_hash: string;
  }>();
  const v = await verifyReport(h.db, ref);
  expect(first.content_hash).toBe(v?.content.recorded);
  expect(first.chain_hash).toBe(v?.link.recorded);

  // After a correction it declares the new version, not the first.
  const fixed = await me({
    method: 'POST',
    url: `/api/mine/reports/${thread}/correct`,
    payload: { answers: { what: 'Sworn to, again.' }, comment: 'more' },
  });
  const newRef = fixed.json<{ public_ref: string }>().public_ref;
  const second = (await me({ method: 'GET', url: `/api/mine/reports/${thread}` })).json<{
    content_hash: string;
  }>();
  expect(second.content_hash).toBe((await verifyReport(h.db, newRef))?.content.recorded);
  expect(second.content_hash).not.toBe(first.content_hash);
});
