/**
 * W1: text and links held outside the report, sealed as fingerprints,
 * erasable with a tombstone, and the report still verifying afterwards.
 *
 * Filed through the routes where a reporter files (the confirmation link is
 * read out of the email), and through appendReportVersion directly where a
 * path has no route of its own yet (a files-only version, an erasure).
 */
import type { HeldValues } from '@reportlog/fields';
import { canonicalJson, heldFingerprint, normalizeReportFields } from '@reportlog/seal';
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appendReportVersion } from '../../src/chain/append.ts';
import { prepareHeld } from '../../src/chain/held.ts';
import { verifyReport } from '../../src/chain/verify.ts';
import { appendCorrection, lockHead } from '../../src/filing/correction.ts';
import { loadLinkKeys } from '../../src/links/keys.ts';
import type { LinkKeys } from '../../src/links/keys.ts';
import { eraseHeldValue, eraseHeldValuesOf } from '../../src/reportValues/erase.ts';
import {
  erasuresOf,
  heldCounts,
  readForDesk,
  readForModerator,
  readForReporter,
} from '../../src/reportValues/reads.ts';
import { openRow } from '../../src/reportValues/store.ts';
import { GENERAL_DIGEST, launchedLogbook } from './helpers.ts';
import { CONTACT_KEY, confirm, filingHarness, send, spine, tokenFor } from './filing-helpers.ts';
import type { FilingHarness } from './filing-helpers.ts';
import { address } from './identity-helpers.ts';

const QS = [
  {
    key: 'outcome',
    kind: 'choice_one',
    label: 'How did it go?',
    settings: { options: ['ok', 'bad'] },
  },
  { key: 'what', kind: 'private_text', label: 'What happened' },
  { key: 'links', kind: 'private_link', label: 'Links', settings: { maxValues: 3 } },
];

const TEXT = 'The two scanners stopped at about 4. Around 30 people left the line.';
const LINK_A = 'https://example.org/a-post';
const LINK_B = 'https://example.net/video?id=7';

let h: FilingHarness;
let lb: { id: number; slug: string };
let keys: LinkKeys;

beforeAll(async () => {
  h = await filingHarness();
  lb = await launchedLogbook(h.db, QS);
  keys = await loadLinkKeys(h.db, CONTACT_KEY);
});
afterAll(async () => {
  await h.close();
});

const verifies = (v: Awaited<ReturnType<typeof verifyReport>>) =>
  v?.content.ok === true && v.link.ok && v.position.ok;

async function fileByLink(answers: Record<string, unknown>, who: string) {
  const email = address(who);
  const sent = await send(h, { ...spine(email), logbook: lb.slug, answers });
  expect(sent.status, JSON.stringify(sent.body)).toBe(200);
  const token = tokenFor(h.mailer, email) ?? '';
  // WAITING FOR THE LINK, THE WORDS ARE NOT IN THE PAYLOAD.
  const sub = await h.db
    .selectFrom('report_submissions')
    .select(['id', 'payload'])
    .where('confirmed_at', 'is', null)
    .orderBy('id', 'desc')
    .executeTakeFirstOrThrow();
  expect(JSON.stringify(sub.payload)).not.toContain('scanners');
  expect(JSON.stringify(sub.payload)).not.toContain('example.org');
  const done = await confirm(h, token);
  expect(done.status, JSON.stringify(done.body)).toBe(200);
  const ref = done.body.confirmation.public_ref ?? '';
  const row = await h.db
    .selectFrom('reports')
    .selectAll()
    .where('public_ref', '=', ref)
    .executeTakeFirstOrThrow();
  return { ref, row, submissionId: sub.id };
}

describe('filing text and links through the routes', () => {
  let ref: string;
  let reportId: number;

  it('seals fingerprints, never the values, and the report verifies', async () => {
    const filed = await fileByLink(
      { outcome: 'bad', what: `  ${TEXT}  `, links: [LINK_A, LINK_B, LINK_A] },
      'held-route',
    );
    ref = filed.ref;
    reportId = filed.row.id;
    expect(filed.row.recipe).toBe(2);
    expect(filed.row.answers).toEqual({ outcome: 'bad' });
    const whole = JSON.stringify(filed.row);
    expect(whole).not.toContain('scanners');
    expect(whole).not.toContain('example');

    const v = await verifyReport(h.db, ref);
    expect(verifies(v)).toBe(true);
    const sealed = v?.hashed_fields ?? {};
    expect(sealed.recipe).toBe(2);
    expect(Object.keys(sealed.text_fingerprints as object)).toEqual(['what']);
    // The same link twice is one link, in the order sent.
    expect((sealed.link_fingerprints as Record<string, string[]>).links).toHaveLength(2);
    expect(v?.canonical_json).not.toContain('scanners');
    expect(v?.canonical_json).not.toContain('example');

    // The staged copy went when the report was filed from it.
    const staged = await h.db
      .selectFrom('report_submission_values')
      .select('submission_id')
      .where('submission_id', '=', filed.submissionId)
      .execute();
    expect(staged).toEqual([]);
  });

  it('keeps each value under its own key, and its fingerprint is of that value and its nonce', async () => {
    const rows = await h.db
      .selectFrom('report_values')
      .selectAll()
      .where('report_id', '=', reportId)
      .orderBy('field_key')
      .orderBy('position')
      .execute();
    expect(rows.map((r) => [r.field_key, r.kind, r.position])).toEqual([
      ['links', 'private_link', 0],
      ['links', 'private_link', 1],
      ['what', 'private_text', 0],
    ]);
    expect(new Set(rows.map((r) => r.value_key.toString('hex'))).size).toBe(3);
    const v = await verifyReport(h.db, ref);
    const sealed = v?.hashed_fields as {
      text_fingerprints: Record<string, string>;
      link_fingerprints: Record<string, string[]>;
    };
    const opened = rows.map((r) => openRow(keys, r.value_enc, r.value_key));
    expect(opened.map((o) => o.value)).toEqual([LINK_A, LINK_B, TEXT]);
    expect(
      rows.map((r, i) => heldFingerprint(opened[i]?.nonce ?? '', opened[i]?.value ?? '')),
    ).toEqual([...(sealed.link_fingerprints.links ?? []), sealed.text_fingerprints.what]);
    expect(rows.map((r) => r.fingerprint)).toEqual([
      ...(sealed.link_fingerprints.links ?? []),
      sealed.text_fingerprints.what,
    ]);
  });

  it('reads back for a moderator, for the desk by id only, and for the reporter', async () => {
    const all = await readForModerator(h.db, keys, [reportId]);
    expect(all.map((r) => r.value).sort()).toEqual([LINK_A, LINK_B, TEXT].sort());
    const one = all.find((r) => r.kind === 'private_text');
    const desk = await readForDesk(h.db, keys, [one?.id ?? 0]);
    expect(desk.map((r) => r.value)).toEqual([TEXT]);
    expect(await readForDesk(h.db, keys, [])).toEqual([]);
    expect((await readForReporter(h.db, keys, reportId)).length).toBe(3);
    expect((await heldCounts(h.db, [reportId])).get(reportId)).toEqual({ text: 1, links: 2 });
  });

  it('erases one link: value and key gone, a tombstone, and the report still verifies', async () => {
    const before = await verifyReport(h.db, ref);
    const link = (await readForModerator(h.db, keys, [reportId])).find(
      (r) => r.kind === 'private_link' && r.position === 0,
    );
    const n = await h.db
      .transaction()
      .execute((trx) =>
        eraseHeldValue(trx, link?.id ?? 0, { reason: 'personal-data', actor: 'mod@example.org' }),
      );
    expect(n).toBe(1);
    const left = await readForModerator(h.db, keys, [reportId]);
    expect(left.map((r) => r.value).sort()).toEqual([LINK_B, TEXT].sort());

    const after = await verifyReport(h.db, ref);
    expect(verifies(after)).toBe(true);
    expect(after?.canonical_json).toBe(before?.canonical_json);

    const notices = await erasuresOf(h.db, [reportId]);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ fieldKey: 'links', kind: 'private_link', position: 0 });
    expect(notices[0]?.fingerprint).toBe(link?.fingerprint);
    expect(JSON.stringify(notices)).not.toContain('mod@example.org');

    // Once is enough: a second erasure finds nothing and writes nothing.
    expect(
      await h.db
        .transaction()
        .execute((trx) =>
          eraseHeldValue(trx, link?.id ?? 0, { reason: 'personal-data', actor: 'x' }),
        ),
    ).toBe(0);
  });

  it('refuses to change or remove a tombstone', async () => {
    await expect(
      sql`UPDATE report_value_erasures SET actor = 'someone else'`.execute(h.db),
    ).rejects.toThrow();
    await expect(sql`DELETE FROM report_value_erasures`.execute(h.db)).rejects.toThrow();
  });

  it('erases everything a version holds, for a reporter, and it still verifies', async () => {
    const n = await h.db
      .transaction()
      .execute((trx) =>
        eraseHeldValuesOf(trx, [reportId], { reason: 'reporter-request', actor: 'reporter' }),
      );
    expect(n).toBe(2);
    expect(await readForModerator(h.db, keys, [reportId])).toEqual([]);
    expect(await erasuresOf(h.db, [reportId])).toHaveLength(3);
    expect(verifies(await verifyReport(h.db, ref))).toBe(true);
  });
});

describe('what the routes refuse', () => {
  it('refuses a link that is not one, too many links, and text sent as something else', async () => {
    const email = address('held-bad');
    for (const answers of [
      { links: ['javascript:alert(1)'] },
      {
        links: [
          'https://a.example/1',
          'https://a.example/2',
          'https://a.example/3',
          'https://a.example/4',
        ],
      },
      { what: ['not', 'text'] },
    ]) {
      const sent = await send(h, { ...spine(email), logbook: lb.slug, answers });
      expect(sent.status, JSON.stringify(sent.body)).toBe(400);
    }
    expect(tokenFor(h.mailer, email)).toBeUndefined();
  });

  it('deletes staged values with their submission', async () => {
    const email = address('held-staged');
    const sent = await send(h, {
      ...spine(email),
      logbook: lb.slug,
      answers: { what: 'Staged words' },
    });
    expect(sent.status).toBe(200);
    const sub = await h.db
      .selectFrom('report_submission_values')
      .select('submission_id')
      .orderBy('submission_id', 'desc')
      .executeTakeFirstOrThrow();
    await h.db.deleteFrom('report_submissions').where('id', '=', sub.submission_id).execute();
    const left = await h.db
      .selectFrom('report_submission_values')
      .select('submission_id')
      .where('submission_id', '=', sub.submission_id)
      .execute();
    expect(left).toEqual([]);
  });
});

/** Append one version straight through the chain code. */
async function append(
  held: Parameters<typeof appendReportVersion>[1]['held'],
  extra: { threadId?: string; correctsId?: number } = {},
) {
  return h.db.transaction().execute((trx) =>
    appendReportVersion(trx, {
      logbookId: lb.id,
      threadId: extra.threadId ?? randomUUID(),
      correctsId: extra.correctsId ?? null,
      fields: normalizeReportFields({
        logbook: lb.slug,
        answers: { outcome: 'ok' },
        may_publish: true,
        may_publish_digest: GENERAL_DIGEST,
      }),
      publicRefPrefix: 'RL-',
      ...(held ? { held } : {}),
    }),
  );
}

describe('write side and read side agree, byte for byte', () => {
  const cases: Record<string, HeldValues | undefined> = {
    none: undefined,
    text: { text: { what: TEXT } },
    link: { links: { links: [LINK_A] } },
    both: { text: { what: TEXT }, links: { links: [LINK_A, LINK_B] } },
  };
  for (const [name, values] of Object.entries(cases)) {
    it(`for ${name}`, async () => {
      const { row, sealed } = await append(
        values ? { keys, rows: prepareHeld(values) } : undefined,
      );
      const v = await verifyReport(h.db, row.public_ref);
      expect(verifies(v)).toBe(true);
      expect(v?.canonical_json).toBe(canonicalJson(sealed));
      expect(row.recipe).toBe(name === 'none' ? 1 : 2);
      expect('recipe' in sealed).toBe(name !== 'none');
      expect(row.text_fingerprints === null).toBe(!('text' in (values ?? {})));
      expect(row.link_fingerprints === null).toBe(!('links' in (values ?? {})));
    });
  }
});

describe('the chain code makes the fingerprints itself', () => {
  it('refuses fingerprints handed in with the fields', async () => {
    await expect(
      h.db.transaction().execute((trx) =>
        appendReportVersion(trx, {
          logbookId: lb.id,
          threadId: randomUUID(),
          fields: normalizeReportFields({
            logbook: lb.slug,
            may_publish: true,
            may_publish_digest: GENERAL_DIGEST,
            text_fingerprints: { what: 'a'.repeat(64) },
          }),
          publicRefPrefix: 'RL-',
        }),
      ),
    ).rejects.toThrow(/made here/);
  });

  it('refuses a row whose fingerprint is not of its value', async () => {
    const rows = prepareHeld({ text: { what: TEXT } }).map((r) => ({ ...r, value: 'changed' }));
    await expect(append({ keys, rows })).rejects.toThrow(/not of its value/);
  });
});

describe('versions of one thread', () => {
  it('a correction holds new values under new keys; erasing one leaves the other', async () => {
    const first = await append({ keys, rows: prepareHeld({ text: { what: TEXT } }) });
    const threadId = first.row.thread_id;
    await h.db
      .insertInto('report_heads')
      .values({ thread_id: threadId, current_report_id: first.row.id })
      .execute();
    const corrected = await h.db.transaction().execute(async (trx) =>
      appendCorrection(trx, {
        threadId,
        headId: await lockHead(trx, threadId),
        logbookId: lb.id,
        questions: QS,
        fields: normalizeReportFields({
          logbook: lb.slug,
          answers: { outcome: 'ok' },
          may_publish: true,
          may_publish_digest: GENERAL_DIGEST,
        }),
        publicRefPrefix: 'RL-',
        held: { keys, rows: prepareHeld({ text: { what: TEXT } }) },
      }),
    );
    const [a] = await readForModerator(h.db, keys, [first.row.id]);
    const [b] = await readForModerator(h.db, keys, [corrected.id]);
    expect(a?.value).toBe(TEXT);
    expect(b?.value).toBe(TEXT);
    // The same words, a new nonce: a new fingerprint.
    expect(a?.fingerprint).not.toBe(b?.fingerprint);
    await h.db
      .transaction()
      .execute((trx) =>
        eraseHeldValue(trx, b?.id ?? 0, { reason: 'other-illegal', actor: 'm@x.org' }),
      );
    expect((await readForModerator(h.db, keys, [first.row.id])).length).toBe(1);
    expect(await readForModerator(h.db, keys, [corrected.id])).toEqual([]);
    expect(verifies(await verifyReport(h.db, first.row.public_ref))).toBe(true);
    expect(verifies(await verifyReport(h.db, corrected.public_ref))).toBe(true);
  });

  it('a version that only adds files carries the values unchanged, and erasure takes every copy', async () => {
    const first = await append({
      keys,
      rows: prepareHeld({ text: { what: TEXT }, links: { links: [LINK_A, LINK_B] } }),
    });
    // Erase one link before carrying: the carried version holds only what is left.
    const gone = (await readForModerator(h.db, keys, [first.row.id])).find(
      (r) => r.kind === 'private_link' && r.position === 0,
    );
    await h.db
      .transaction()
      .execute((trx) =>
        eraseHeldValue(trx, gone?.id ?? 0, { reason: 'personal-data', actor: 'm' }),
      );
    const carried = await append(
      { carryFrom: first.row.id },
      { threadId: first.row.thread_id, correctsId: first.row.id },
    );
    expect(carried.sealed.text_fingerprints).toEqual(first.sealed.text_fingerprints);
    expect(carried.sealed.link_fingerprints).toEqual({
      links: [first.sealed.link_fingerprints?.links?.[1]],
    });
    expect(verifies(await verifyReport(h.db, carried.row.public_ref))).toBe(true);

    const text = (await readForModerator(h.db, keys, [carried.row.id])).find(
      (r) => r.kind === 'private_text',
    );
    const n = await h.db
      .transaction()
      .execute((trx) =>
        eraseHeldValue(trx, text?.id ?? 0, { reason: 'personal-data', actor: 'm' }),
      );
    expect(n).toBe(2);
    expect((await erasuresOf(h.db, [first.row.id, carried.row.id])).length).toBe(3);
    expect(verifies(await verifyReport(h.db, first.row.public_ref))).toBe(true);
    expect(verifies(await verifyReport(h.db, carried.row.public_ref))).toBe(true);
  });
});

describe('a logbook without held questions', () => {
  it('seals exactly as before: recipe 1, neither key, neither column', async () => {
    const plain = await launchedLogbook(h.db, [
      { key: 'outcome', kind: 'choice_one', label: 'How?', settings: { options: ['ok'] } },
    ]);
    const { row, sealed } = await h.db.transaction().execute((trx) =>
      appendReportVersion(trx, {
        logbookId: plain.id,
        threadId: randomUUID(),
        fields: normalizeReportFields({
          logbook: plain.slug,
          answers: { outcome: 'ok' },
          may_publish: true,
          may_publish_digest: GENERAL_DIGEST,
        }),
        publicRefPrefix: 'RL-',
      }),
    );
    expect(row.recipe).toBe(1);
    expect(row.text_fingerprints).toBeNull();
    expect(row.link_fingerprints).toBeNull();
    expect(Object.keys(sealed).sort()).toEqual([
      'answers',
      'corrects_id',
      'logbook',
      'logbook_form',
      'may_publish',
      'may_publish_digest',
      'public_ref',
      'received_at',
      'thread_id',
    ]);
  });
});
