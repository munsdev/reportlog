/**
 * The two queues' work filters (docs/design/moderation-unified.md): what
 * replaced the Written accounts, Links and Files waiting pages. Files have
 * their own case in files-staff.test.ts, where a report with files is made.
 *
 * THE PROMISES UNDER TEST:
 *   - "has a written account", "has links to check" and "can go to
 *     journalists" find exactly the reports holding that, and the status
 *     counts follow them as they follow every other filter;
 *   - a link judged anywhere leaves "links to check" everywhere, because a
 *     verdict is its group's;
 *   - a list entry's review page narrows the same way, and names each tip
 *     description by the ref the written-account routes take, with its
 *     decision, never its words beyond what the page already shows;
 *   - the filters reach the server through the contract, behind the guard.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkGroup } from '../../src/links/checks.ts';
import type { LinkKeys } from '../../src/links/keys.ts';
import { fileEntry } from '../../src/lists/entries.ts';
import { createFromTemplate, reviewQueues } from '../../src/lists/manage.ts';
import { DEFAULT_LIST_SETTINGS } from '../../src/lists/retention.ts';
import { reviewBatch } from '../../src/lists/review.ts';
import { listQueue, queueCounts } from '../../src/moderation/queue.ts';
import { checkText } from '../../src/moderation/texts/items.ts';
import type { FilingHarness } from './filing-helpers.ts';
import { launchedLogbook } from './helpers.ts';
import { address } from './identity-helpers.ts';
import { linkKeys } from './links-helpers.ts';
import { moderationHarness, staff } from './moderation-helpers.ts';
import { HELD_QUESTIONS, fileHeld } from './written-helpers.ts';

const run = `${String(process.pid)}${String(Date.now() % 1e6)}`;
const link = (stem: string) => `https://${stem}-${run}.example.org/post/1`;

let h: FilingHarness;
let keys: LinkKeys;
let lb: { id: number; slug: string };

beforeAll(async () => {
  h = await moderationHarness();
  keys = await linkKeys(h.db);
  lb = await launchedLogbook(h.db, HELD_QUESTIONS);
});
afterAll(async () => {
  await h.close();
});

describe('the reports queue, by the work a report holds', () => {
  it('finds the written accounts, the links to check and what may go to journalists', async () => {
    const words = await fileHeld(
      h.db,
      keys,
      lb,
      { text: { what: `Scanners down ${run}` } },
      {
        share: true,
      },
    );
    const linked = await fileHeld(
      h.db,
      keys,
      lb,
      { links: { links: [link('q')] } },
      {
        share: false,
      },
    );
    const plain = await fileHeld(h.db, keys, lb, {}, { share: false });
    const mine = new Set([words.threadId, linked.threadId, plain.threadId]);
    const found = async (f: Parameters<typeof listQueue>[1]) =>
      (await listQueue(h.db, { status: 'all', logbook: lb.slug, ...f }))
        .map((r) => r.thread_id)
        .filter((t) => mine.has(t))
        .sort();

    expect(await found({ written: true })).toEqual([words.threadId]);
    expect(await found({ links: true })).toEqual([linked.threadId]);
    expect(await found({ sharing: true })).toEqual([words.threadId]);
    expect(await found({ written: true, links: true })).toEqual([]);
    expect(await found({})).toEqual([...mine].sort());

    // The status counts follow the filter, as they follow every other.
    const counts = await queueCounts(h.db, { logbook: lb.slug, links: true });
    const listed = await listQueue(h.db, { status: 'pending', logbook: lb.slug, links: true });
    expect(counts.pending).toBe(listed.length);

    // A verdict is the link's group's: judged once, it leaves the filter.
    const group = (
      await h.db
        .selectFrom('report_values')
        .select('group_id')
        .where('report_id', '=', linked.reportId)
        .where('kind', '=', 'private_link')
        .executeTakeFirstOrThrow()
    ).group_id;
    if (group === null) throw new Error('the link has no group');
    await checkGroup(h.db, keys, group, { outcome: 'withheld', actor: address('unified-mod') });
    expect(await found({ links: true })).toEqual([]);
  });

  it('takes the filters over HTTP, behind the moderators’ guard', async () => {
    const shared = await fileHeld(
      h.db,
      keys,
      lb,
      { text: { what: `Queue ${run}` } },
      {
        share: true,
      },
    );
    const mod = await staff(h, 'unified-http', 'moderator');
    const r = await mod.call({
      method: 'GET',
      url: `/api/moderation/reports?status=all&written=true&sharing=true&logbook=${lb.slug}`,
    });
    expect(r.statusCode, r.body).toBe(200);
    const body = r.json<{ reports: { thread_id: string }[]; counts: { all: number } }>();
    expect(body.reports.map((x) => x.thread_id)).toContain(shared.threadId);
    expect(body.counts.all).toBe(body.reports.length);
    const bad = await mod.call({ method: 'GET', url: '/api/moderation/reports?links=maybe' });
    expect(bad.statusCode).toBe(400);
    const nobody = await h.app.inject({ method: 'GET', url: '/api/moderation/reports?links=true' });
    expect(nobody.statusCode).toBe(401);
  });
});

describe('list entries, by the work an entry holds', () => {
  it('narrows to links to check and written accounts, and names each account by its ref', async () => {
    const tips = await createFromTemplate(h.db, 'election-tips', {
      slug: `unified-${run}`.slice(0, 40),
    });
    const fields = await h.db
      .selectFrom('list_fields')
      .select(['key', 'kind'])
      .where('list_id', '=', tips.id)
      .execute();
    const long = fields.find((f) => f.kind === 'long_text')?.key;
    if (!long) throw new Error('the tip list asks for no description');
    const file = (answers: Record<string, string>) =>
      fileEntry(
        h.db,
        tips.slug,
        { answers: { category: 'Not sure', ...answers }, email: address('unified-tip') },
        { settings: DEFAULT_LIST_SETTINGS, keys },
      );
    // A tip always carries a link. The second's is judged already, as if on
    // a report that sent the same address: it is not "to check" anywhere.
    await file({ links: link('tip') });
    await file({ links: link('judged'), [long]: `They moved the drop box ${run}` });
    const judged = (await reviewBatch(h.db, tips.id, { keys })).entries.find((e) =>
      e.links.some((l) => l.url.includes('judged')),
    )?.links[0]?.group_id;
    if (judged === undefined) throw new Error('no judged link');
    await checkGroup(h.db, keys, judged, { outcome: 'checked', actor: address('unified-mod') });

    const all = await reviewBatch(h.db, tips.id, { keys });
    expect(all.entries).toHaveLength(2);
    const withLinks = await reviewBatch(h.db, tips.id, { keys, links: true });
    expect(withLinks.entries).toHaveLength(1);
    expect(withLinks.entries[0]?.links[0]).toMatchObject({ outcome: null, comment: null });
    const withWords = await reviewBatch(h.db, tips.id, { keys, written: true });
    expect(withWords.entries).toHaveLength(1);
    const entry = withWords.entries[0];
    if (!entry) throw new Error('no entry');
    expect(entry.texts).toEqual([
      { ref: `tip-${String(entry.id)}-${long}`, field_key: long, outcome: null },
    ]);

    // The overview counts the same work among what waits.
    const row = (await reviewQueues(h.db)).find((q) => q.id === tips.id);
    expect(row).toMatchObject({ waiting: 2, with_links: 1, with_written: 1 });

    // Decided through the written-account routes' own call, the entry says so.
    const ref = entry.texts[0]?.ref ?? '';
    await checkText(h.db, keys, ref, {
      outcome: 'withheld',
      reason: undefined,
      why: 'Left with the list entry, for staff only.',
      actor: address('unified-mod'),
    });
    const after = await reviewBatch(h.db, tips.id, { keys, written: true });
    expect(after.entries[0]?.texts[0]?.outcome).toBe('withheld');
  });
});
