/**
 * Filing, chaining and verifying against a real database.
 */
import { checkChainFile, chainGenesis, contradictions } from '@reportlog/seal';
import type { ChainFile } from '@reportlog/seal';
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import { appendReportVersion } from '../../src/chain/append.ts';
import { buildChainFile } from '../../src/chain/chainFile.ts';
import { currentHeads } from '../../src/chain/heads.ts';
import { verifyReport } from '../../src/chain/verify.ts';
import { normalizeReportFields } from '@reportlog/seal';
import { GENERAL_DIGEST, QUESTIONS, fileReport, launchedLogbook, testDatabase } from './helpers.ts';

const db = testDatabase();
afterAll(() => db.destroy());

/** Through JSON and back, as a downloaded file would be. */
const asDownloaded = (file: ChainFile | null): ChainFile =>
  JSON.parse(JSON.stringify(file)) as ChainFile;

const allOk = (v: Awaited<ReturnType<typeof verifyReport>>) =>
  v !== null && v.content.ok && v.link.ok && v.position.ok;

describe('filing and verifying', () => {
  it('chains each logbook from its own genesis, and every report verifies', async () => {
    const lb = await launchedLogbook(db);
    const first = await fileReport(db, lb, { what: 'One', when: '2026-10-01' });
    const second = await fileReport(db, lb, { what: 'Two', has: 'yes', of: 'a video' });

    expect(first.row.prev_chain_hash).toBe(chainGenesis(lb.slug));
    expect(second.row.prev_chain_hash).toBe(first.row.chain_hash);

    const v1 = await verifyReport(db, first.row.public_ref);
    const v2 = await verifyReport(db, second.row.public_ref);
    expect(allOk(v1)).toBe(true);
    expect(allOk(v2)).toBe(true);
    expect(v1?.position.is_first).toBe(true);
    expect(v2?.hashed_fields).toMatchObject({ answers: { what: 'Two', has: true, of: 'a video' } });
    expect(v1?.anchor).toEqual({ anchored: false });
  });

  it('keeps logbooks independent: a second logbook starts at its own genesis', async () => {
    const a = await launchedLogbook(db);
    const b = await launchedLogbook(db);
    await fileReport(db, a, { what: 'In A' });
    const inB = await fileReport(db, b, { what: 'In B' });
    expect(inB.row.prev_chain_hash).toBe(chainGenesis(b.slug));
  });

  it('verifies a correction, a third-party filing and a report with files', async () => {
    const lb = await launchedLogbook(db);
    const original = await fileReport(db, lb, { what: 'Original' });
    const correction = await fileReport(
      db,
      lb,
      { what: 'Corrected' },
      {
        threadId: original.row.thread_id,
        correctsId: original.row.id,
      },
    );
    const coordinator = await fileReport(
      db,
      lb,
      { what: 'Taken by phone' },
      {
        submission: {
          third_party: true,
          filed_via: 'Helpers e.V.',
          intake_method: 'phone',
          attested_at: '2026-10-17T11:00:00+02:00',
          collected_on: '2026-10-15',
        },
      },
    );

    const manifest = [
      { ordinal: 1, sha256: 'c'.repeat(64), byte_size: 1234, media_type: 'image/jpeg' },
      { ordinal: 2, sha256: 'd'.repeat(64), byte_size: 99, media_type: 'application/pdf' },
    ];
    const threadId = randomUUID();
    const withFiles = await db.transaction().execute(async (trx) => {
      const out = await appendReportVersion(trx, {
        logbookId: lb.id,
        threadId,
        fields: normalizeReportFields({
          logbook: lb.slug,
          answers: { what: 'With files' },
          may_publish: true,
          may_publish_digest: GENERAL_DIGEST,
        }),
        attachments: manifest,
        publicRefPrefix: 'RL-',
      });
      for (const m of manifest) {
        const a = await trx
          .insertInto('attachments')
          .values({
            ...m,
            thread_id: threadId,
            report_id: out.row.id,
            storage_key: `k/${String(m.ordinal)}`,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        await trx
          .insertInto('report_attachments')
          .values({ report_id: out.row.id, attachment_id: a.id })
          .execute();
      }
      return out;
    });

    for (const r of [correction, coordinator, withFiles]) {
      expect(allOk(await verifyReport(db, r.row.public_ref))).toBe(true);
    }
    const vc = await verifyReport(db, coordinator.row.public_ref);
    expect(vc?.hashed_fields).toMatchObject({
      third_party: true,
      attested_at: '2026-10-17T09:00:00.000Z',
      collected_on: '2026-10-15',
    });
    expect((await verifyReport(db, correction.row.public_ref))?.hashed_fields.corrects_id).toBe(
      original.row.id,
    );
  });

  it("notices an edit made behind the application's back", async () => {
    const lb = await launchedLogbook(db);
    const r = await fileReport(db, lb, { what: 'Before' });
    // Only a superuser can do this, by switching the guard off. That is the
    // attack the fingerprint exists to reveal.
    await db.transaction().execute(async (trx) => {
      await sql`ALTER TABLE reports DISABLE TRIGGER reports_append_only`.execute(trx);
      await sql`UPDATE reports SET answers = '{"what":"After"}' WHERE id = ${r.row.id}`.execute(
        trx,
      );
      await sql`ALTER TABLE reports ENABLE TRIGGER reports_append_only`.execute(trx);
    });
    const v = await verifyReport(db, r.row.public_ref);
    expect(v?.content.ok).toBe(false);
    expect(v?.link.ok).toBe(false);
  });

  it('returns null for a reference that does not exist', async () => {
    expect(await verifyReport(db, 'RL-NOPE-000000')).toBeNull();
  });

  it('builds a complete chain file that checks out with nothing but the file', async () => {
    const lb = await launchedLogbook(db);
    await fileReport(db, lb, { what: 'One' });
    await fileReport(db, lb, { what: 'Two', when: '2026-01-02' });
    const file = await buildChainFile(db, lb.id);
    expect(file).not.toBeNull();
    const result = checkChainFile(asDownloaded(file));
    expect(result.problems).toEqual([]);
    expect(result.checked).toBe(2);
  });
});

describe('concurrency', () => {
  it('turns twenty simultaneous filings into one unbroken chain', async () => {
    const lb = await launchedLogbook(db);
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => fileReport(db, lb, { what: `Report ${String(i)}` })),
    );
    const file = await buildChainFile(db, lb.id);
    const result = checkChainFile(asDownloaded(file));
    expect(result.problems).toEqual([]);
    expect(result.checked).toBe(20);
  });
});

describe('form versions', () => {
  it('seals the questions each reporter was asked, across an added optional question', async () => {
    const lb = await launchedLogbook(db);
    const before = await fileReport(db, lb, { what: 'Before' });
    await db
      .insertInto('logbook_fields')
      .values({
        logbook_id: lb.id,
        key: 'extra',
        kind: 'short_text',
        label: 'Anything else?',
        position: 99,
      })
      .execute();
    const questions = [...QUESTIONS, { key: 'extra', kind: 'short_text', label: 'Anything else?' }];
    const after = await fileReport(db, lb, { what: 'After', extra: 'yes' }, { questions });

    expect(before.sealed.logbook_form).not.toBe(after.sealed.logbook_form);
    expect(allOk(await verifyReport(db, before.row.public_ref))).toBe(true);
    expect(allOk(await verifyReport(db, after.row.public_ref))).toBe(true);
    const result = checkChainFile(asDownloaded(await buildChainFile(db, lb.id)));
    expect(result.problems).toEqual([]);
  });
});

describe('heads', () => {
  it('lists every launched logbook, an empty one at its genesis', async () => {
    const empty = await launchedLogbook(db);
    const heads = await currentHeads(db);
    expect(heads.find((h) => h.logbook === empty.slug)).toEqual({
      logbook: empty.slug,
      head: chainGenesis(empty.slug),
      reports: 0,
    });
    expect(
      contradictions(
        heads.map((h) => ({ logbook: h.logbook, reports: h.reports })),
        heads,
      ),
    ).toEqual({
      dropped: [],
      shrunk: [],
    });
  });
});
