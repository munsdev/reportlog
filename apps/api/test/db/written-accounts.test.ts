/**
 * W3 and W4: report links in the link store, and the written accounts queue.
 *
 * Library calls for the transitions, HTTP for the contract and the guards.
 * The shared test database is used, so every assertion names its own report.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyReport } from '../../src/chain/verify.ts';
import { addBlock } from '../../src/links/blocklist.ts';
import { checkGroup } from '../../src/links/checks.ts';
import type { LinkKeys } from '../../src/links/keys.ts';
import { matchKey } from '../../src/links/keys.ts';
import { groupsForCheck } from '../../src/links/reads.ts';
import { fileEntry } from '../../src/lists/entries.ts';
import { createFromTemplate } from '../../src/lists/manage.ts';
import { DEFAULT_LIST_SETTINGS } from '../../src/lists/retention.ts';
import { normalizeUrl } from '../../src/lists/urls.ts';
import {
  checkText,
  detail,
  openText,
  redactText,
  reviewRedaction,
} from '../../src/moderation/texts/items.ts';
import { decideBatch } from '../../src/moderation/queue.ts';
import { clearedTexts, readCleared } from '../../src/moderation/texts/clearance.ts';
import { eraseMyWritten, myWritten, reportWritten } from '../../src/moderation/texts/panels.ts';
import { setPermission } from '../../src/permissions/log.ts';
import type { FilingHarness } from './filing-helpers.ts';
import { launchedLogbook, uniqueSlug } from './helpers.ts';
import { address } from './identity-helpers.ts';
import { linkKeys } from './links-helpers.ts';
import { moderationHarness, seenMap, seenOf, staff } from './moderation-helpers.ts';
import { HELD_QUESTIONS, fileHeld, textRef } from './written-helpers.ts';

const run = `${String(process.pid)}${String(Date.now() % 1e6)}`;
const MOD = address('texts-mod');
const OTHER = address('texts-mod-2');
const TEXT = `The two scanners stopped at about 4 (${run}). A poll worker named Mary told us to use the slot.`;
// A note a moderator wrote, quoting only what they chose.
const COPY = `Note (${run}): scanners failed at one site. A reporter says staff told voters to "use the slot".`;

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

const link = (stem: string) => `https://${stem}-${run}.example.org/post/1`;
const groupOf = async (u: string) => {
  const n = normalizeUrl(u);
  return (
    await h.db
      .selectFrom('link_groups')
      .select('id')
      .where('match_key', '=', matchKey(keys, n.ok ? n.url : u))
      .executeTakeFirstOrThrow()
  ).id;
};

describe('W3 · report links in the link store', () => {
  it('groups a report copy with tip copies of the same address, across forms of it', async () => {
    const tips = await createFromTemplate(h.db, 'election-tips', { slug: uniqueSlug('etips') });
    const u = link('grouped');
    await fileEntry(
      h.db,
      tips.slug,
      { answers: { links: `${u}?utm_source=x`, category: 'Not sure' }, email: address('tip') },
      { settings: DEFAULT_LIST_SETTINGS, keys },
    );
    const t = await fileHeld(h.db, keys, lb, { links: { links: [u] } });
    const id = await groupOf(u);
    const row = await h.db
      .selectFrom('report_values')
      .select('group_id')
      .where('report_id', '=', t.reportId)
      .executeTakeFirstOrThrow();
    expect(row.group_id).toBe(id);
    const g = (await groupsForCheck(h.db, keys, { filter: 'unchecked' })).find((x) => x.id === id);
    expect(g).toMatchObject({ from_tips: 1, from_reports: 1, copies: 2, url: u });
    expect(g?.logbooks.map((l) => l.id)).toEqual([lb.id]);
  });

  it('illegal erases tip and report copies, leaves a tombstone, and the report still verifies', async () => {
    const u = link('illegal');
    const t = await fileHeld(h.db, keys, lb, { text: { what: TEXT }, links: { links: [u] } });
    const id = await groupOf(u);
    const out = await checkGroup(h.db, keys, id, {
      outcome: 'illegal',
      actor: MOD,
      reason: 'other-illegal',
    });
    expect(out.erased).toBe(1);
    const left = await h.db
      .selectFrom('report_values')
      .select(['kind'])
      .where('report_id', '=', t.reportId)
      .execute();
    expect(left.map((l) => l.kind)).toEqual(['private_text']);
    const stone = await h.db
      .selectFrom('report_value_erasures')
      .select(['kind', 'reason_category', 'actor'])
      .where('report_id', '=', t.reportId)
      .execute();
    expect(stone).toEqual([{ kind: 'private_link', reason_category: 'other-illegal', actor: MOD }]);
    const v = await verifyReport(h.db, t.publicRef);
    expect(v?.content.ok === true && v.link.ok && v.position.ok).toBe(true);
    // The group keeps its record and no address.
    const g = await h.db
      .selectFrom('link_groups')
      .select(['outcome', 'match_key'])
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    expect(g).toEqual({ outcome: 'illegal', match_key: null });
  });

  it('a blocklisted address is not kept at filing, nobody is told, and the report verifies', async () => {
    const u = link('blocked');
    const n = normalizeUrl(u);
    if (!n.ok) throw new Error('fixture');
    await addBlock(
      h.db,
      { kind: 'address', hash: matchKey(keys, n.url) },
      { reason: 'other-illegal', actor: MOD },
    );
    const t = await fileHeld(h.db, keys, lb, { links: { links: [u, link('fine')] } });
    const kept = await h.db
      .selectFrom('report_values')
      .select('position')
      .where('report_id', '=', t.reportId)
      .execute();
    expect(kept.map((k) => k.position)).toEqual([1]);
    const stone = await h.db
      .selectFrom('report_value_erasures')
      .select(['position', 'reason_category'])
      .where('report_id', '=', t.reportId)
      .execute();
    expect(stone).toEqual([{ position: 0, reason_category: 'blocklisted' }]);
    const v = await verifyReport(h.db, t.publicRef);
    expect(v?.content.ok === true && v.link.ok && v.position.ok).toBe(true);
  });

  it('checking a group that only a report carries works, and a domain block takes its host from the report copy', async () => {
    const u = link('onlyreport');
    await fileHeld(h.db, keys, lb, { links: { links: [u] } });
    const id = await groupOf(u);
    await checkGroup(h.db, keys, id, {
      outcome: 'illegal',
      actor: MOD,
      reason: 'other-illegal',
      block: 'domain',
    });
    const again = await fileHeld(h.db, keys, lb, { links: { links: [link('onlyreport')] } });
    const kept = await h.db
      .selectFrom('report_values')
      .select('id')
      .where('report_id', '=', again.reportId)
      .execute();
    expect(kept).toEqual([]);
  });
});

describe('W4 · the written accounts queue', () => {
  it('a note needs the reporter\'s permission; keeping internal and illegal need none; "checked" is gone', async () => {
    const t = await fileHeld(h.db, keys, lb, { text: { what: TEXT } }, { share: false });
    const ref = await textRef(h.db, t.reportId);
    await expect(
      checkText(h.db, keys, ref, {
        outcome: 'checked',
        reason: undefined,
        why: 'Checked for the record.',
        actor: MOD,
      }),
    ).rejects.toMatchObject({ code: 'not_an_outcome' });
    await expect(
      redactText(h.db, keys, ref, { body: COPY, why: 'Names a private person.', actor: MOD }),
    ).rejects.toMatchObject({ code: 'not_shared' });
    expect(
      await checkText(h.db, keys, ref, {
        outcome: 'withheld',
        reason: undefined,
        why: 'Checked for the record.',
        actor: MOD,
      }),
    ).toEqual({ outcome: 'withheld', erased: false });
    await setPermission(h.db, {
      threadId: t.threadId,
      permission: 'journalist_sharing',
      granted: true,
    });
    expect(
      await redactText(h.db, keys, ref, { body: COPY, why: 'Names a private person.', actor: MOD }),
    ).toEqual({ outcome: 'redacted' });
  });

  it('refuses an outcome that is not one, and illegal without a category', async () => {
    const t = await fileHeld(h.db, keys, lb, { text: { what: TEXT } }, { share: true });
    const ref = await textRef(h.db, t.reportId);
    await expect(
      checkText(h.db, keys, ref, {
        outcome: 'redacted',
        reason: undefined,
        why: 'Checked for the record.',
        actor: MOD,
      }),
    ).rejects.toMatchObject({ code: 'not_an_outcome' });
    await expect(
      checkText(h.db, keys, ref, {
        outcome: 'illegal',
        reason: 'because',
        why: 'Checked for the record.',
        actor: MOD,
      }),
    ).rejects.toMatchObject({ code: 'reason_needed' });
  });

  it('redaction: the original never changes, the copy is encrypted apart and marked, review by another', async () => {
    const t = await fileHeld(h.db, keys, lb, { text: { what: TEXT } }, { share: true });
    const ref = await textRef(h.db, t.reportId);
    await expect(
      redactText(h.db, keys, ref, { body: TEXT, why: 'Names a private person.', actor: MOD }),
    ).rejects.toMatchObject({ code: 'note_is_original' });
    await expect(
      redactText(h.db, keys, ref, { body: '   ', why: 'Names a private person.', actor: MOD }),
    ).rejects.toMatchObject({ code: 'copy_needed' });
    await redactText(h.db, keys, ref, { body: COPY, why: 'Names a private person.', actor: MOD });
    const item = await h.db
      .selectFrom('text_items as ti')
      .innerJoin('text_redactions as x', 'x.item_id', 'ti.id')
      .select(['ti.outcome', 'x.body_enc', 'x.redacted_by'])
      .where(
        'ti.fingerprint',
        '=',
        (
          await h.db
            .selectFrom('report_values')
            .select('fingerprint')
            .where('report_id', '=', t.reportId)
            .executeTakeFirstOrThrow()
        ).fingerprint,
      )
      .executeTakeFirstOrThrow();
    expect(item.outcome).toBe('redacted');
    expect(item.body_enc.toString('utf8')).not.toContain('scanners');
    // The original is where it was.
    const original = await reportWritten(h.db, keys, t.threadId);
    // The panel never carries the words; they come through openText.
    expect(original.texts[0]?.text).toBeNull();
    expect((await openText(h.db, keys, ref, MOD)).text).toBe(TEXT);
    expect(original.texts[0]?.outcome).toBe('redacted');
    await expect(
      reviewRedaction(h.db, keys, ref, { verdict: 'approved', actor: MOD, isOwner: false }),
    ).rejects.toMatchObject({ code: 'own_copy' });
    expect(
      await reviewRedaction(h.db, keys, ref, { verdict: 'approved', actor: OTHER, isOwner: false }),
    ).toEqual({ verdict: 'approved' });
    // Returned: the copy is deleted and the account waits again.
    await redactText(h.db, keys, ref, { body: COPY, why: 'Redone for the record.', actor: MOD });
    await reviewRedaction(h.db, keys, ref, { verdict: 'returned', actor: MOD, isOwner: true });
    const after = await reportWritten(h.db, keys, t.threadId);
    expect(after.texts[0]).toMatchObject({ outcome: null, redaction: null });
    const history = await h.db.selectFrom('text_checks').select('outcome').orderBy('id').execute();
    expect(history.map((x) => x.outcome)).toEqual(
      expect.arrayContaining(['redacted', 'review_approved', 'review_returned']),
    );
  });

  it('the history is append-only', async () => {
    await expect(h.db.deleteFrom('text_checks').execute()).rejects.toThrow();
  });

  it('illegal erases the words and the copy, writes the tombstone, and the report verifies', async () => {
    const t = await fileHeld(h.db, keys, lb, { text: { what: TEXT } }, { share: true });
    const ref = await textRef(h.db, t.reportId);
    await redactText(h.db, keys, ref, { body: COPY, why: 'Names a private person.', actor: MOD });
    const out = await checkText(h.db, keys, ref, {
      outcome: 'illegal',
      reason: 'personal-data',
      why: 'Checked for the record.',
      actor: MOD,
    });
    expect(out).toEqual({ outcome: 'illegal', erased: true });
    expect(
      await h.db
        .selectFrom('report_values')
        .select('id')
        .where('report_id', '=', t.reportId)
        .execute(),
    ).toEqual([]);
    const stone = await h.db
      .selectFrom('report_value_erasures')
      .select(['kind', 'reason_category'])
      .where('report_id', '=', t.reportId)
      .execute();
    expect(stone).toEqual([{ kind: 'private_text', reason_category: 'personal-data' }]);
    expect(
      await h.db
        .selectFrom('text_redactions as x')
        .innerJoin('text_items as ti', 'ti.id', 'x.item_id')
        .select('x.item_id')
        .where('ti.outcome', '=', 'illegal')
        .execute(),
    ).toEqual([]);
    const v = await verifyReport(h.db, t.publicRef);
    expect(v?.content.ok === true && v.link.ok && v.position.ok).toBe(true);
    expect((await reportWritten(h.db, keys, t.threadId)).erased).toHaveLength(1);
  });

  it('a correction that re-sends the words starts again unchecked (D2)', async () => {
    const t = await fileHeld(h.db, keys, lb, { text: { what: TEXT } }, { share: true });
    await redactText(h.db, keys, await textRef(h.db, t.reportId), {
      body: COPY,
      why: 'Checked for the record.',
      actor: MOD,
    });
    const fixed = await fileHeld(
      h.db,
      keys,
      lb,
      { text: { what: `${TEXT} More.` } },
      { threadId: t.threadId, correctsId: t.reportId },
    );
    const now = await reportWritten(h.db, keys, t.threadId);
    expect(now.texts).toHaveLength(1);
    expect(now.texts[0]?.outcome).toBeNull();
    expect((await openText(h.db, keys, now.texts[0]?.ref ?? '', MOD)).text).toContain('More.');
    expect(fixed.reportId).not.toBe(t.reportId);
  });

  it('the reporter sees where each check stands and can erase everything they wrote', async () => {
    const u = link('mine');
    const t = await fileHeld(
      h.db,
      keys,
      lb,
      { text: { what: TEXT }, links: { links: [u] } },
      { share: true },
    );
    const before = await myWritten(h.db, keys, t.threadId);
    expect(before.texts[0]?.outcome).toBe('waiting');
    expect(before.links[0]?.outcome).toBe('waiting');
    expect(before.shared).toBe(true);
    expect(await eraseMyWritten(h.db, t.threadId)).toBe(2);
    const after = await myWritten(h.db, keys, t.threadId);
    expect(after.texts).toEqual([]);
    expect(after.erased).toHaveLength(2);
    const stone = await h.db
      .selectFrom('report_value_erasures')
      .select('actor')
      .where('report_id', '=', t.reportId)
      .execute();
    expect(stone.every((s) => s.actor === 'reporter')).toBe(true);
  });
});

describe('W4 · over HTTP', () => {
  it('moderators reach the queue; a signed-out visitor and an ordinary account do not', async () => {
    const t = await fileHeld(h.db, keys, lb, { text: { what: TEXT } }, { share: true });
    const mod = await staff(h, 'texts-http', 'moderator');
    const r = await mod.call({ method: 'GET', url: '/api/moderation/texts?filter=waiting' });
    expect(r.statusCode, r.body).toBe(200);
    const body = r.json<{
      items: { ref: string; text: string | null; shared: boolean; reference: string }[];
    }>();
    const mine = body.items.find((i) => i.reference === t.publicRef);
    expect(mine).toMatchObject({ text: null, shared: true });
    const checked = await mod.call({
      method: 'POST',
      url: `/api/moderation/texts/${mine?.ref ?? ''}/redact`,
      payload: { body: COPY, why: 'Reads as a plain account.' },
    });
    expect(checked.statusCode, checked.body).toBe(200);
    const panel = await mod.call({
      method: 'GET',
      url: `/api/moderation/reports/${t.threadId}/written`,
    });
    expect(panel.json<{ texts: { outcome: string }[] }>().texts[0]?.outcome).toBe('redacted');
    const anon = await h.app.inject({ method: 'GET', url: '/api/moderation/texts' });
    expect(anon.statusCode).toBe(401);
    const user = await staff(h, 'texts-user', 'user');
    expect((await user.call({ method: 'GET', url: '/api/moderation/texts' })).statusCode).toBe(403);
    expect(
      (
        await user.call({
          method: 'POST',
          url: `/api/moderation/texts/${mine?.ref ?? ''}/check`,
          payload: { outcome: 'withheld' },
        })
      ).statusCode,
    ).toBe(403);
  });
});

describe('N2 · reasons, readings and approval', () => {
  const WHY = 'Reads as a plain account of events.';

  it('every text decision needs a reason of 10 to 500 characters, kept in the history', async () => {
    const t = await fileHeld(h.db, keys, lb, { text: { what: `${TEXT} a` } }, { share: true });
    const ref = await textRef(h.db, t.reportId);
    for (const why of [undefined, '', 'short', 'x'.repeat(501)]) {
      await expect(
        checkText(h.db, keys, ref, { outcome: 'withheld', reason: undefined, why, actor: MOD }),
      ).rejects.toMatchObject({ code: 'why_needed' });
    }
    await expect(
      redactText(h.db, keys, ref, { body: COPY, why: 'too short', actor: MOD }),
    ).rejects.toMatchObject({ code: 'why_needed' });
    await checkText(h.db, keys, ref, {
      outcome: 'withheld',
      reason: undefined,
      why: WHY,
      actor: MOD,
    });
    const d = await detail(h.db, keys, ref);
    expect(d.history.at(-1)).toMatchObject({ kind: 'withheld', by: MOD, reason: WHY });
    expect(d.item.text).toBeNull();
  });

  it('opening the words writes the access log first, once per press, for each person', async () => {
    const t = await fileHeld(h.db, keys, lb, { text: { what: `${TEXT} b` } }, { share: true });
    const ref = await textRef(h.db, t.reportId);
    await openText(h.db, keys, ref, MOD);
    await openText(h.db, keys, ref, OTHER);
    await openText(h.db, keys, ref, OTHER);
    const rows = await h.db
      .selectFrom('contact_access_log')
      .select(['staff_email', 'reason', 'thread_id'])
      .where('kind', '=', 'text_read')
      .where('read_ref', '=', ref)
      .execute();
    expect(rows.map((r) => r.staff_email).sort()).toEqual([MOD, OTHER, OTHER].sort());
    expect(rows.every((r) => r.reason === null && r.thread_id === t.threadId)).toBe(true);
    await expect(openText(h.db, keys, 'report-999999999', MOD)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('the reporter and the desk never get a reason', async () => {
    const t = await fileHeld(h.db, keys, lb, { text: { what: `${TEXT} c` } }, { share: true });
    const ref = await textRef(h.db, t.reportId);
    await redactText(h.db, keys, ref, { body: COPY, why: WHY, actor: MOD });
    expect(JSON.stringify(await myWritten(h.db, keys, t.threadId))).not.toContain(WHY);
    const desk = await clearedTexts(h.db);
    const mine = desk.filter((c) => c.reportId === t.reportId);
    expect(mine).toHaveLength(1);
    expect(JSON.stringify(mine)).not.toContain(WHY);
    const read = await readCleared(h.db, keys, mine);
    expect(JSON.stringify([...read.values()])).not.toContain(WHY);
  });

  it('a report holding an undecided account is skipped in a batch and needs decisions to approve', async () => {
    const t = await fileHeld(h.db, keys, lb, { text: { what: `${TEXT} d` } }, { share: true });
    const plain = await fileHeld(h.db, keys, lb, {}, { share: true });
    const out = await decideBatch(
      h.db,
      [t.threadId, plain.threadId],
      MOD,
      await seenMap(h.db, [t.threadId, plain.threadId]),
    );
    expect(out.approved).toEqual([plain.threadId]);
    expect(out.skipped).toEqual([
      { thread_id: t.threadId, why: 'It has a written account, which needs its own look.' },
    ]);
    const mod = await staff(h, 'texts-approve', 'moderator');
    const url = `/api/moderation/reports/${t.threadId}/decision`;
    const seen = await seenOf(h.db, t.threadId);
    const refused = await mod.call({ method: 'POST', url, payload: { status: 'valid', seen } });
    expect(refused.statusCode).toBe(409);
    const ref = await textRef(h.db, t.reportId);
    const noReason = await mod.call({
      method: 'POST',
      url,
      payload: {
        status: 'valid',
        seen,
        written: [{ ref, outcome: 'redacted', note: COPY, why: 'no' }],
      },
    });
    expect(noReason.statusCode).toBe(400);
    const ok = await mod.call({
      method: 'POST',
      url,
      payload: {
        status: 'valid',
        seen,
        written: [{ ref, outcome: 'redacted', note: COPY, why: WHY }],
      },
    });
    expect(ok.statusCode, ok.body).toBe(200);
    const head = await h.db
      .selectFrom('report_heads')
      .select('moderation_status')
      .where('thread_id', '=', t.threadId)
      .executeTakeFirstOrThrow();
    expect(head.moderation_status).toBe('valid');
    // Nothing typed: approves with no extra step.
    const bare = await fileHeld(h.db, keys, lb, {}, { share: true });
    const bareOk = await mod.call({
      method: 'POST',
      url: `/api/moderation/reports/${bare.threadId}/decision`,
      payload: { status: 'valid', seen: await seenOf(h.db, bare.threadId) },
    });
    expect(bareOk.statusCode, bareOk.body).toBe(200);
  });
});
