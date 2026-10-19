/**
 * The per-client limit on sending reports for confirmation. Anybody can make
 * the site email any address they type, so one client gets a few sends in
 * 15 minutes. FILING_SENDS_PER_CLIENT sets how many (the browser suite raises
 * it, because every test files from 127.0.0.1); past it, the next is refused
 * and nothing is emailed.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { filingHarness, send, spine, tokenFor } from './filing-helpers.ts';
import type { FilingHarness } from './filing-helpers.ts';
import { launchedLogbook } from './helpers.ts';
import { address } from './identity-helpers.ts';

let h: FilingHarness;
let lb: { id: number; slug: string };

beforeAll(async () => {
  h = await filingHarness({ sendsPerClient: 2 });
  lb = await launchedLogbook(h.db, [
    { key: 'what_happened', kind: 'short_text', label: 'What happened?', required: true },
  ]);
});
afterAll(async () => {
  await h.close();
});

describe('sends per client', () => {
  it('takes as many as the setting allows, then refuses and emails nothing', async () => {
    const sendOne = async (email: string) =>
      send(h, { ...spine(email), logbook: lb.slug, answers: { what_happened: 'Turned away' } });
    // Different addresses, so only the per-client limit can be what refuses.
    expect((await sendOne(address('limit-a'))).status).toBe(200);
    expect((await sendOne(address('limit-b'))).status).toBe(200);
    const third = address('limit-c');
    const refused = await sendOne(third);
    expect(refused.status).toBe(429);
    expect(tokenFor(h.mailer, third)).toBeUndefined();
  });
});
