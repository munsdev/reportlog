/**
 * The rules the DATABASE enforces, whatever the application does. Each of
 * these is a write the application never makes; the point is that if a
 * future path tries, it fails here rather than succeeding quietly.
 */
import { chainGenesis } from '@reportlog/seal';
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import {
  GENERAL_DIGEST,
  fileReport,
  launchedLogbook,
  testDatabase,
  uniqueSlug,
} from './helpers.ts';

const db = testDatabase();
afterAll(() => db.destroy());

describe('reports are append-only', () => {
  it('refuses UPDATE, DELETE and TRUNCATE', async () => {
    const lb = await launchedLogbook(db);
    const r = await fileReport(db, lb, { what: 'x' });
    await expect(
      sql`UPDATE reports SET may_publish = false WHERE id = ${r.row.id}`.execute(db),
    ).rejects.toThrow(/append-only/);
    await expect(sql`DELETE FROM reports WHERE id = ${r.row.id}`.execute(db)).rejects.toThrow(
      /append-only/,
    );
    await expect(sql`TRUNCATE reports CASCADE`.execute(db)).rejects.toThrow(/append-only/);
  });
});

describe('the chain is checked on insert', () => {
  const insert = (logbookId: number, prev: string, extra: Record<string, unknown> = {}) =>
    db
      .insertInto('reports')
      .values({
        public_ref: `RL-T-${randomUUID().slice(0, 8)}`,
        received_at: new Date().toISOString(),
        thread_id: randomUUID(),
        content_hash: 'e'.repeat(64),
        prev_chain_hash: prev,
        chain_hash: sql<string>`encode(sha256(convert_to(${'e'.repeat(64)} || ${prev}, 'UTF8')), 'hex')`,
        logbook_id: logbookId,
        may_publish: false,
        may_publish_digest: GENERAL_DIGEST,
        ...extra,
      })
      .execute();

  it("refuses a report that does not link to its logbook's head", async () => {
    const lb = await launchedLogbook(db);
    await fileReport(db, lb, { what: 'x' });
    await expect(insert(lb.id, chainGenesis(lb.slug))).rejects.toThrow(/does not link/);
  });

  it('refuses a report in a logbook that has not launched', async () => {
    const slug = uniqueSlug();
    const lb = await db
      .insertInto('logbooks')
      .values({ slug, title: 'Draft' })
      .returning('id')
      .executeTakeFirstOrThrow();
    await expect(insert(lb.id, chainGenesis(slug))).rejects.toThrow(/launched/);
  });

  it('refuses answers stored as {} and a digest nobody issued', async () => {
    const lb = await launchedLogbook(db);
    await expect(insert(lb.id, chainGenesis(lb.slug), { answers: '{}' })).rejects.toThrow(
      /check constraint/,
    );
    await expect(
      insert(lb.id, chainGenesis(lb.slug), { may_publish_digest: 'f'.repeat(64) }),
    ).rejects.toThrow(/foreign key/);
  });
});

describe('launching a logbook is a one-way door', () => {
  it('allows a new optional question and nothing else', async () => {
    const lb = await launchedLogbook(db);
    const field = (key: string, required: boolean) =>
      db
        .insertInto('logbook_fields')
        .values({ logbook_id: lb.id, key, kind: 'short_text', label: key, required })
        .execute();

    await expect(field('later_optional', false)).resolves.toBeDefined();
    await expect(field('later_required', true)).rejects.toThrow(/optional/);
    await expect(
      db
        .updateTable('logbook_fields')
        .set({ label: 'Reworded' })
        .where('logbook_id', '=', lb.id)
        .where('key', '=', 'what')
        .execute(),
    ).rejects.toThrow(/never changed/);
    await expect(
      db
        .deleteFrom('logbook_fields')
        .where('logbook_id', '=', lb.id)
        .where('key', '=', 'when')
        .execute(),
    ).rejects.toThrow(/never removed/);
    // Delivery, not meaning: whether the board filters on it may change.
    await expect(
      db
        .updateTable('logbook_fields')
        .set({ filterable: true })
        .where('logbook_id', '=', lb.id)
        .where('key', '=', 'when')
        .execute(),
    ).resolves.toBeDefined();
  });

  it('never changes a slug, unlaunches, or deletes a launched logbook', async () => {
    const lb = await launchedLogbook(db);
    await expect(
      db.updateTable('logbooks').set({ slug: 'renamed' }).where('id', '=', lb.id).execute(),
    ).rejects.toThrow(/slug/);
    await expect(
      db.updateTable('logbooks').set({ launched_at: null }).where('id', '=', lb.id).execute(),
    ).rejects.toThrow(/stays launched/);
    await expect(db.deleteFrom('logbooks').where('id', '=', lb.id).execute()).rejects.toThrow(
      /never deleted/,
    );
    await expect(
      db.updateTable('logbooks').set({ title: 'A new title' }).where('id', '=', lb.id).execute(),
    ).resolves.toBeDefined();
  });

  it('lets a draft change freely', async () => {
    const slug = uniqueSlug();
    const lb = await db
      .insertInto('logbooks')
      .values({ slug, title: 'Draft' })
      .returning('id')
      .executeTakeFirstOrThrow();
    await db
      .insertInto('logbook_fields')
      .values({ logbook_id: lb.id, key: 'q', kind: 'short_text', label: 'Q', required: true })
      .execute();
    await db
      .updateTable('logbook_fields')
      .set({ label: 'Q2' })
      .where('logbook_id', '=', lb.id)
      .execute();
    await db.deleteFrom('logbooks').where('id', '=', lb.id).execute();
  });
});

describe('form versions check their own hash', () => {
  it('refuses a definition whose hash does not match its text', async () => {
    const lb = await launchedLogbook(db);
    await expect(
      db
        .insertInto('logbook_forms')
        .values({ logbook_id: lb.id, form_hash: 'a'.repeat(64), definition: '{}' })
        .execute(),
    ).rejects.toThrow(/check constraint/);
  });
});
