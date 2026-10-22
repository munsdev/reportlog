/**
 * The queue's status buttons and pages (docs/design/screens/moderation.md
 * section 02): a count for every status under the same filters, and the list
 * a page at a time with its total.
 *
 * What it holds: each count is exactly what that status's list holds, under
 * every other filter in force; `all` is their sum; pages neither overlap nor
 * drop a report; a page past the end shows the last one.
 */
import type { FieldDefinition } from '@reportlog/fields';
import { QUEUE_PAGE_SIZE } from '@reportlog/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FilingHarness } from './filing-helpers.ts';
import { launchedLogbook } from './helpers.ts';
import {
  fileThread,
  moderationHarness,
  resetModerationSettings,
  staff,
} from './moderation-helpers.ts';

const Q: FieldDefinition[] = [
  { key: 'what', kind: 'long_text', label: 'What happened?', required: true },
];

type Caller = Awaited<ReturnType<typeof staff>>['call'];
interface Queue {
  reports: { thread_id: string; moderation_status: string; withdrawn: boolean }[];
  counts: Record<string, number>;
  total: number;
  page: number;
  pages: number;
}

let h: FilingHarness;
let lb: { id: number; slug: string };
let mod: Caller;

const queue = async (query: string) => {
  const res = await mod({
    method: 'GET',
    url: `/api/moderation/reports?logbook=${lb.slug}&${query}`,
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<Queue>();
};

const decide = async (thread: string, status: string) => {
  const res = await mod({
    method: 'POST',
    url: `/api/moderation/reports/${thread}/decision`,
    payload: {
      status,
      comment: 'Read and checked.',
      ...(status === 'invalid' ? { reason_code: 'cannot_assess' } : {}),
    },
  });
  expect(res.statusCode, res.body).toBe(200);
};

const many = QUEUE_PAGE_SIZE + 3;

beforeAll(async () => {
  h = await moderationHarness();
  await resetModerationSettings(h.db);
  lb = await launchedLogbook(h.db, Q);
  mod = (await staff(h, 'pages-mod', 'moderator')).call;
  const threads: string[] = [];
  for (let i = 0; i < many; i += 1) {
    const word = i < 5 ? 'lanternfish' : 'ordinary';
    threads.push(
      (await fileThread(h.db, lb, Q, { what: `Report ${String(i)}, ${word}.` })).threadId,
    );
  }
  // Two approved, one declined, one unclear, one withdrawn by a moderator;
  // the rest waiting. Two of the five "lanternfish" ones are decided.
  await decide(threads[0] ?? '', 'valid');
  await decide(threads[1] ?? '', 'invalid');
  await decide(threads[10] ?? '', 'valid');
  await decide(threads[11] ?? '', 'unknown');
  const off = await mod({
    method: 'POST',
    url: `/api/moderation/reports/${threads[12] ?? ''}/withdraw`,
    payload: { comment: 'A test of the withdrawn count.' },
  });
  expect(off.statusCode, off.body).toBe(200);
});
afterAll(async () => {
  await h.close();
});

describe('the status buttons’ counts', () => {
  it('count each status under the other filters, and All is the sum', async () => {
    const q = await queue('status=pending');
    expect(q.counts).toEqual({
      all: many,
      pending: many - 5,
      valid: 2,
      invalid: 1,
      unknown: 1,
      withdrawn: 1,
    });
    expect(q.total).toBe(many - 5);
  });

  it('follow the search, and each equals what its own list holds', async () => {
    const q = await queue('status=pending&q=lanternfish');
    expect(q.counts).toEqual({
      all: 5,
      pending: 3,
      valid: 1,
      invalid: 1,
      unknown: 0,
      withdrawn: 0,
    });
    for (const status of ['all', 'pending', 'valid', 'invalid', 'unknown', 'withdrawn']) {
      const list = await queue(`status=${status}&q=lanternfish`);
      expect(list.reports.length, status).toBe(q.counts[status]);
      expect(list.total, status).toBe(q.counts[status]);
    }
  });
});

describe('pages', () => {
  it('hold every report once, a page at a time', async () => {
    const first = await queue('status=all');
    expect(first).toMatchObject({ total: many, page: 1, pages: 2 });
    expect(first.reports).toHaveLength(QUEUE_PAGE_SIZE);
    const second = await queue('status=all&page=2');
    expect(second.page).toBe(2);
    expect(second.reports).toHaveLength(3);
    const seen = new Set([...first.reports, ...second.reports].map((r) => r.thread_id));
    expect(seen.size).toBe(many);
  });

  it('a page past the end shows the last page, and a short list has one page', async () => {
    const past = await queue('status=all&page=9');
    expect(past.page).toBe(2);
    expect(past.reports).toHaveLength(3);
    const one = await queue('status=valid&page=4');
    expect(one).toMatchObject({ page: 1, pages: 1, total: 2 });
  });

  it('refuses a page that is not a number', async () => {
    const res = await mod({
      method: 'GET',
      url: `/api/moderation/reports?logbook=${lb.slug}&page=0`,
    });
    expect(res.statusCode).toBe(400);
  });
});
