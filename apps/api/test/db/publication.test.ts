/**
 * The publication answer: sealed with the digest of the exact wording the
 * server showed, and of nothing else.
 *
 * legacy/scripts/publication-selftest.mjs tests the operator's switch that
 * withholds the PUBLIC ARCHIVE (every board read refusing when it is off).
 * Those reads are the board's (workstream D) and none exists yet, so that
 * half is D's to port. What is filing's is here: the card a reporter
 * answers, the digest the form sends back, and that a report can only seal a
 * digest the server issued.
 */
import { CARD, cardLines, digestOf } from '@reportlog/seal';
import type { cardFor } from '@reportlog/seal';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appendReportVersion } from '../../src/chain/append.ts';
import { verifyReport } from '../../src/chain/verify.ts';
import { normalizeReportFields } from '@reportlog/seal';
import { launchedLogbook } from './helpers.ts';
import { COORDINATOR, GENERAL, fileThroughRoutes, filingHarness } from './filing-helpers.ts';
import type { FilingHarness } from './filing-helpers.ts';
import { address } from './identity-helpers.ts';

let h: FilingHarness;
let lb: { id: number; slug: string };

beforeAll(async () => {
  h = await filingHarness();
  lb = await launchedLogbook(h.db, [{ key: 'what', kind: 'short_text', label: 'What?' }]);
});
afterAll(async () => {
  await h.close();
});

describe('the card', () => {
  it('is served with the digest of exactly the lines on it', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/publication-card' });
    const card = res.json<ReturnType<typeof cardFor>>();
    expect(card.digest).toBe(GENERAL);
    expect(card.digest).toBe(digestOf(cardLines('general')));
    expect(card.question).toBe(CARD.question);
    // Optional, and it says so on the card before anybody acts.
    expect(card.optionality).toMatch(/will not be published/);
  });

  it('the coordinators’ card is a different wording, so a different digest', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/publication-card?variant=coordinator',
    });
    expect(res.json<{ digest: string }>().digest).toBe(COORDINATOR);
    expect(COORDINATOR).not.toBe(GENERAL);
  });

  it('both wordings are on record, so a report can name them', async () => {
    const rows = await h.db.selectFrom('consent_texts').select(['digest', 'variant']).execute();
    expect(rows).toEqual(
      expect.arrayContaining([
        { digest: GENERAL, variant: 'general' },
        { digest: COORDINATOR, variant: 'coordinator' },
      ]),
    );
  });
});

describe('what a report seals', () => {
  it('a filed report seals the answer and the digest of the card it answered', async () => {
    const ref = await fileThroughRoutes(h, lb.slug, { what: 'x' }, address('pub'));
    const v = await verifyReport(h.db, ref);
    expect(v?.hashed_fields).toMatchObject({ may_publish: true, may_publish_digest: GENERAL });
  });

  it('the database refuses a digest the server never issued, whatever path tried', async () => {
    await expect(
      h.db.transaction().execute((trx) =>
        appendReportVersion(trx, {
          logbookId: lb.id,
          threadId: randomUUID(),
          fields: normalizeReportFields({
            logbook: lb.slug,
            may_publish: true,
            may_publish_digest: 'b'.repeat(64),
          }),
          publicRefPrefix: 'RL-',
        }),
      ),
    ).rejects.toThrow(/foreign key/);
  });
});
