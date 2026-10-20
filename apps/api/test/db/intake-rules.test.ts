/**
 * Plan D intake rules, through the real route:
 *   L7  an answer to a question the logbook does not ask is refused, in words
 *   L7  an optional choice answer that is not one of the options is refused
 *   L3  a logbook with no text question refuses a text answer, however it is sent
 * Lists keep dropping unknown keys (lists.test.ts); only logbook filing refuses.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { filingHarness, send, spine } from './filing-helpers.ts';
import type { FilingHarness } from './filing-helpers.ts';
import { launchedLogbook } from './helpers.ts';
import { address } from './identity-helpers.ts';

const CHOICES = [
  {
    key: 'how',
    kind: 'choice_one',
    label: 'How did it go',
    required: true,
    settings: { options: ['Well', 'Badly'] },
  },
  {
    key: 'extra',
    kind: 'choice_one',
    label: 'Anything else',
    required: false,
    settings: { options: ['Long queue', 'Closed early'] },
  },
];

let h: FilingHarness;
beforeAll(async () => {
  h = await filingHarness();
});
afterAll(async () => {
  await h.close();
});

const file = async (answers: Record<string, unknown>, stem: string) => {
  const lb = await launchedLogbook(h.db, CHOICES);
  return send(h, { ...spine(address(stem)), logbook: lb.slug, answers });
};

describe('L7: only the questions the logbook asks', () => {
  it('refuses a key the form does not have, in plain words', async () => {
    const r = await file({ how: 'Well', account: 'Somebody I know did a thing' }, 'unknown-key');
    expect(r.status).toBe(400);
    const err = r.body.error as { code: string; message: string };
    expect(err.code).toBe('incomplete');
    expect(err.message).toContain('account');
    expect(err.message).toContain('did not ask for');
  });

  it('refuses an optional choice answer that is not one of the options', async () => {
    const r = await file({ how: 'Well', extra: 'Free text, not an option' }, 'bad-choice');
    expect(r.status).toBe(400);
    expect((r.body.error as { message: string }).message).toContain(
      'Anything else must be one of the choices offered',
    );
  });

  it('still takes an offered option, and leaving the optional one out', async () => {
    expect((await file({ how: 'Well', extra: 'Long queue' }, 'good-choice')).status).toBe(200);
    expect((await file({ how: 'Badly' }, 'no-optional')).status).toBe(200);
  });
});

describe('L3: a logbook with no text question refuses a text answer', () => {
  it('refuses text under a key of its own', async () => {
    const r = await file({ how: 'Well', description: 'I saw a man named Dave' }, 'l3-key');
    expect(r.status).toBe(400);
  });

  it('refuses text where a choice is asked', async () => {
    const r = await file({ how: 'It was fine, mostly, apart from Dave' }, 'l3-choice');
    expect(r.status).toBe(400);
    expect((r.body.error as { message: string }).message).toContain('How did it go');
  });
});
