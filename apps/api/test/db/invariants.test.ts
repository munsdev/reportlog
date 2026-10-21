/**
 * INVARIANTS THAT EVERY FUTURE TABLE, ROUTE AND CALLER MUST KEEP, checked by
 * sweeping what exists rather than a list somebody has to remember to extend.
 *
 * - I4: every append-only table refuses UPDATE, DELETE and TRUNCATE. The set
 *   comes from the Postgres catalogue (and from the migrations' own words), so
 *   a new append-only table is in it the moment its trigger is.
 * - I6: card wording is stored under the digest of its NFC text, and a
 *   third-party block is complete or absent.
 * - I2: every registered staff route refuses an anonymous caller and a
 *   signed-in one with no role. The routes come from Fastify as it registers
 *   them, so a route added outside its scope's guard is found.
 * - I3: `rebuildSealedObject` is only ever handed a row from
 *   `sealedReportRows`, by a walk of the source.
 *
 * Everything runs against a database of its own, so the rows planted here
 * (one in every append-only table) never meet another file's assumptions.
 */
import { buildAnswers } from '@reportlog/fields';
import { chainGenesis, normalizeReportFields } from '@reportlog/seal';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type * as FastifyModule from 'fastify';
import type { FastifyInstance } from 'fastify';
import type * as ZodProvider from 'fastify-type-provider-zod';
import { sql } from 'kysely';
import ts from 'typescript';
import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { buildApp } from '../../src/app.ts';
import { createDatabase } from '../../src/db/database.ts';
import type { Database } from '../../src/db/database.ts';
import { migrate } from '../../src/db/migrate.ts';
import { createThrowawayDatabase } from '../../src/db/throwaway.ts';
import type { Throwaway } from '../../src/db/throwaway.ts';
import { capturingMailer } from '../../src/email/mailer.ts';
import { GENERAL_DIGEST, QUESTIONS, fileReport, launchedLogbook } from './helpers.ts';
import { address, seat, signIn } from './identity-helpers.ts';

// ── how the route sweep sees every route ───────────────────────────────────
// Fastify announces each route to `onRoute` hooks as it is registered, but
// buildApp makes its own instance, so the hook is added the moment that
// instance exists: every route registered after, in any scope, is seen.
const registered = vi.hoisted(() => [] as { method: string; url: string }[]);
vi.mock('fastify', async (importOriginal) => {
  const real = await importOriginal<typeof FastifyModule>();
  const make = (opts: FastifyModule.FastifyServerOptions) => {
    const app = real.default(opts);
    app.addHook('onRoute', (opts) => {
      for (const method of [opts.method].flat()) registered.push({ method, url: opts.url });
    });
    return app;
  };
  return { ...real, default: make };
});
// A staff guard runs at preHandler, AFTER Fastify validates the request. A
// request refused by validation never reaches the guard, so it proves nothing
// about it. In this file only, validation accepts anything, so every request
// reaches the guard and the guard alone decides.
vi.mock('fastify-type-provider-zod', async (importOriginal) => {
  const real = await importOriginal<typeof ZodProvider>();
  return {
    ...real,
    validatorCompiler: () => (data: unknown) => ({ value: data }),
  };
});

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

let throwaway: Throwaway;
let db: Database;

beforeAll(async () => {
  throwaway = await createThrowawayDatabase(inject('serverUrl'), 'invariants');
  await migrate(throwaway.url);
  db = createDatabase(throwaway.url, 5);
});

afterAll(async () => {
  await db.destroy();
  await throwaway.drop();
});

// ═══════════════════════════════════════════════════════════════════════════
// I4 · APPEND-ONLY MEANS APPEND-ONLY
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Append-only, as the catalogue says it: a table with a trigger named
 * `*_append_only`, or a row trigger that runs `reject_modification()` on
 * UPDATE. That is how every migration so far has written it, and the source
 * check below holds them to it. A table that only refuses DELETE with the
 * same function (`report_assessments`: changed by UPDATE, never deleted) is
 * not append-only and is not in the set.
 */
async function appendOnlyTables(): Promise<string[]> {
  const r = await sql<{ table: string }>`
    SELECT DISTINCT c.relname AS table
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_proc p ON p.oid = t.tgfoid
     WHERE n.nspname = current_schema()
       AND NOT t.tgisinternal
       AND (t.tgname LIKE '%\\_append\\_only'
            OR (p.proname = 'reject_modification' AND (t.tgtype::int & 1) = 1
                AND (t.tgtype::int & 16) <> 0))
     ORDER BY 1`.execute(db);
  return r.rows.map((x) => x.table);
}

/** What the catalogue says each trigger on a table fires on, and whether it is on. */
async function triggersOn(table: string) {
  // tgtype bits: 1 row, 2 before, 4 insert, 8 delete, 16 update, 32 truncate.
  const r = await sql<{ name: string; type: number; enabled: string }>`
    SELECT t.tgname AS name, t.tgtype::int AS type, t.tgenabled::text AS enabled
      FROM pg_trigger t
     WHERE t.tgrelid = ${table}::regclass AND NOT t.tgisinternal`.execute(db);
  const on = (bits: number, row: boolean) =>
    r.rows.some(
      (t) =>
        // 'O' fires normally; 'A' always. 'D' (disabled) and 'R' (replica only) do not.
        ['O', 'A'].includes(t.enabled) &&
        (t.type & 2) !== 0 &&
        (t.type & 1) === (row ? 1 : 0) &&
        (t.type & bits) !== 0,
    );
  return { update: on(16, true), delete: on(8, true), truncate: on(32, false) };
}

/**
 * Tables a migration DESCRIBES as append-only: "APPEND-ONLY", or a comment
 * line opening "Append-only", in the comment block just above its CREATE
 * TABLE. (Not "versions are append-only" above `editorial_notes`, which is
 * about another table.) A table described that way and missing its trigger
 * is exactly the slip this sweep is for.
 */
function describedAppendOnly(): string[] {
  const dir = join(ROOT, 'apps/api/migrations');
  const found = new Set<string>();
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql'))) {
    const lines = readFileSync(join(dir, f), 'utf8').split('\n');
    for (const [i, line] of lines.entries()) {
      const m = /^CREATE TABLE (\w+)/.exec(line);
      if (!m?.[1]) continue;
      const comment: string[] = [];
      for (let j = i - 1; j >= 0 && (lines[j] ?? '').startsWith('--'); j -= 1) {
        comment.unshift(lines[j] ?? '');
      }
      const text = comment.join(' ');
      if (
        (text.includes('APPEND-ONLY') || comment.some((c) => /^--\s*Append-only/.test(c))) &&
        !/NOT APPEND-ONLY|NONE OF THESE TABLES IS APPEND-ONLY/.test(text)
      ) {
        found.add(m[1]);
      }
    }
  }
  return [...found].sort();
}

/**
 * KNOWN GAPS, found by this sweep and reported rather than fixed. The two it
 * found (TRUNCATE on the feedback tables) are closed by migration
 * *_close_invariant_gaps.sql; a new one goes here, with its reason, and the
 * test below makes sure the entry goes when the gap does.
 */
const KNOWN_GAPS: Record<string, { truncate: string }> = {};

/** One row in every append-only table, so a row trigger has something to fire on. */
async function plantOneRowEach(): Promise<void> {
  const lb = await launchedLogbook(db);
  const filed = await fileReport(db, lb, { what: 'a row for the sweep' });
  const report = filed.row;
  const thread = report.thread_id;
  await db
    .insertInto('report_heads')
    .values({ thread_id: thread, current_report_id: report.id })
    .execute();
  const hex = (c: string) => c.repeat(64);

  const att = await db
    .insertInto('attachments')
    .values({
      thread_id: thread,
      report_id: report.id,
      ordinal: 1,
      media_type: 'image/jpeg',
      byte_size: 1,
      sha256: hex('a'),
      storage_key: 'sweep/1',
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await db
    .insertInto('report_attachments')
    .values({ report_id: report.id, attachment_id: att.id })
    .execute();
  await db
    .insertInto('attachment_events')
    .values({ attachment_id: att.id, thread_id: thread, action: 'erased', actor: 'system' })
    .execute();
  await db
    .insertInto('refused_uploads')
    .values({ thread_id: thread, name: 'a.jpg', status: 'infected', reason: 'for the sweep' })
    .execute();

  const anchor = await db
    .insertInto('chain_anchors')
    .values({ anchor_date: '2026-11-01', root_chain_hash: hex('b') })
    .returning('id')
    .executeTakeFirstOrThrow();
  await db
    .insertInto('chain_anchor_heads')
    .values({
      anchor_id: anchor.id,
      logbook_slug: lb.slug,
      head_chain_hash: hex('c'),
      report_count: 1,
    })
    .execute();
  await db
    .insertInto('anchor_runs')
    .values({ started_at: new Date(), outcome: 'failed', detail: 'a row for the sweep' })
    .execute();

  await db
    .insertInto('role_audit')
    .values({
      actor_email: 'a@example.org',
      subject_email: 'b@example.org',
      axis: 'system',
      action: 'grant',
      detail: 'moderator',
    })
    .execute();
  await db
    .insertInto('report_contacts')
    .values({ thread_id: thread, filed_by: 'reporter', contact_enc: Buffer.from('x') })
    .execute();
  await db
    .insertInto('reporter_actions')
    .values({ thread_id: thread, action: 'withdraw' })
    .execute();
  await db
    .insertInto('report_permissions_log')
    .values({ thread_id: thread, permission: 'contact_passing', granted: true })
    .execute();
  await db
    .insertInto('moderation_log')
    .values({
      thread_id: thread,
      report_id: report.id,
      action: 'review',
      actor_email: 'm@example.org',
    })
    .execute();
  const note = await db
    .insertInto('editorial_notes')
    .values({ thread_id: thread })
    .returning('id')
    .executeTakeFirstOrThrow();
  await db
    .insertInto('editorial_note_versions')
    .values({
      note_id: note.id,
      body: 'A note long enough for its CHECK.',
      author_email: 'm@example.org',
    })
    .execute();
  await db
    .insertInto('contact_access_log')
    .values({ staff_email: 'm@example.org', kind: 'audit_log' })
    .execute();

  // Plan D, moderation: the agreement, the decision notice, a notice of
  // illegal content and the threat flag, each append-only.
  const agreement = await db
    .insertInto('agreement_texts')
    .values({
      audience: 'moderator',
      version: 1,
      body: 'A row for the sweep.',
      digest: hex('d'),
      created_by: 'a@example.org',
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await db
    .insertInto('agreement_acceptances')
    .values({ text_id: agreement.id, user_email: 'm@example.org' })
    .execute();
  await db
    .insertInto('decision_notices')
    .values({
      thread_id: thread,
      report_id: report.id,
      reason_code: 'duplicate',
      outcome: 'sent',
      actor_email: 'm@example.org',
    })
    .execute();
  const notice = await db
    .insertInto('content_notices')
    .values({
      receipt: 'IC-ABCDEFGH',
      token_hash: hex('e'),
      where_found: 'a row for the sweep',
      explanation: 'a row for the sweep',
      good_faith: true,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await db
    .insertInto('content_notice_events')
    .values({ notice_id: notice.id, action: 'received', actor: 'sender' })
    .execute();
  await db
    .insertInto('threat_events')
    .values({
      subject_kind: 'report',
      subject_ref: thread,
      action: 'raise',
      actor_email: 'm@example.org',
      note: 'A row for the sweep.',
    })
    .execute();

  const user = await db
    .insertInto('users')
    .values({ email: 'tester@example.org' })
    .returning('id')
    .executeTakeFirstOrThrow();
  const feedback = await db
    .insertInto('feedback')
    .values({
      submitter_id: user.id,
      type: 'bug',
      severity: 'minor',
      title: 'A row',
      body: 'A row for the sweep.',
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await db
    .insertInto('feedback_events')
    .values({ feedback_id: feedback.id, action: 'created', actor_id: user.id })
    .execute();
  await db
    .insertInto('feedback_comments')
    .values({ feedback_id: feedback.id, author_id: user.id, body: 'Seeing this too.' })
    .execute();
  const org = await db
    .insertInto('organizations')
    .values({ name: 'Helpers e.V.', verified_by: 'a@example.org' })
    .returning('id')
    .executeTakeFirstOrThrow();
  await db
    .insertInto('coordinator_actions')
    .values({
      thread_id: thread,
      action: 'correct',
      report_id: report.id,
      coordinator_id: user.id,
      organization_id: org.id,
      comment: 'A row for the sweep.',
    })
    .execute();
  await db
    .insertInto('contact_key_rotations')
    .values({ from_fingerprint: hex('d'), to_fingerprint: hex('e') })
    .execute();

  // Plan D tip links: the check, comment, erasure and blocklist histories.
  const group = await db
    .insertInto('link_groups')
    .values({ match_key: hex('f') })
    .returning('id')
    .executeTakeFirstOrThrow();
  const actor = 'sweep@example.org';
  await db
    .insertInto('link_checks')
    .values({ group_id: group.id, outcome: 'withheld', actor_email: actor })
    .execute();
  await db
    .insertInto('link_comments')
    .values({ group_id: group.id, body: 'for the sweep', actor_email: actor })
    .execute();
  await db
    .insertInto('link_erasures')
    .values({
      group_id: group.id,
      reason_category: 'other-illegal',
      erased_count: 0,
      actor_email: actor,
    })
    .execute();
  await db
    .insertInto('link_block_log')
    .values({
      entry_id: 1,
      kind: 'domain',
      action: 'add',
      reason_category: 'other-illegal',
      actor_email: actor,
    })
    .execute();

  // Plan E (PE3): bulk actions, the switch log, intake link uses.
  await db
    .insertInto('moderation_bulk_actions')
    .values({ action: 'decline', reason_code: 'duplicate', reached: 0, actor_email: actor })
    .execute();
  await db
    .insertInto('site_switch_log')
    .values({ switch: 'pause_intake', value: 'on', actor_email: actor })
    .execute();
  const link = await db
    .insertInto('organization_intake_links')
    .values({
      organization_id: org.id,
      token_hash: hex('a'),
      label: 'for the sweep',
      max_uses: 5,
      created_by: actor,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await db
    .insertInto('organization_intake_link_uses')
    .values({ link_id: link.id, user_id: user.id })
    .execute();
}

/** Run a statement and roll it back whatever happens; resolve to its error, or null. */
async function refusal(statement: string): Promise<string | null> {
  try {
    await db.transaction().execute(async (trx) => {
      await sql.raw(statement).execute(trx);
      throw new RolledBack();
    });
  } catch (e) {
    if (e instanceof RolledBack) return null;
    return (e as Error).message;
  }
  return null;
}
class RolledBack extends Error {}

/** Refused as append-only, by a trigger whose message names `table`. */
const refusedBy = (why: string | null, table: string) =>
  why !== null && why.includes('append-only') && why.includes(table);

describe('I4 · APPEND-ONLY MEANS APPEND-ONLY, for every table that says so', () => {
  let tables: string[] = [];
  beforeAll(async () => {
    await plantOneRowEach();
    tables = await appendOnlyTables();
  });

  it('finds the tables from the catalogue, the ones the root names among them', () => {
    // Not the definition, a floor: the reports, the transparency log's
    // anchors, the permission log, the card wording and the form versions.
    for (const t of [
      'reports',
      'chain_anchors',
      'chain_anchor_heads',
      'report_permissions_log',
      'consent_texts',
      'logbook_forms',
      // Plan D tip links (review item 12).
      'link_checks',
      'link_comments',
      'link_erasures',
      'link_block_log',
    ]) {
      expect(tables).toContain(t);
    }
  });

  it('every table a migration calls append-only has the trigger that makes it so', () => {
    const live = new Set(tables);
    const exists = async (t: string) =>
      (await sql<{ r: string | null }>`SELECT to_regclass(${t})::text AS r`.execute(db)).rows[0]
        ?.r != null;
    return Promise.all(
      describedAppendOnly().map(async (t) => {
        // A table a later migration dropped (file_publication_log) is gone, not unguarded.
        if (!(await exists(t))) return;
        expect(live.has(t), `${t} is described as append-only and has no such trigger`).toBe(true);
      }),
    );
  });

  it('every one of them holds a planted row, so the row triggers below really fire', async () => {
    for (const t of tables) {
      const n = await sql<{ n: string }>`SELECT count(*)::text AS n FROM ${sql.table(t)}`.execute(
        db,
      );
      expect(
        Number(n.rows[0]?.n),
        `${t} is append-only and empty here: add a row for it to plantOneRowEach()`,
      ).toBeGreaterThan(0);
    }
  });

  it('every one of them has an enabled BEFORE trigger for UPDATE, DELETE and TRUNCATE', async () => {
    for (const t of tables) {
      const on = await triggersOn(t);
      const expected = { update: true, delete: true, truncate: !KNOWN_GAPS[t] };
      expect(on, t).toEqual(expected);
    }
  });

  it('refuses UPDATE on every one, by its own trigger', async () => {
    const through: string[] = [];
    for (const t of tables) {
      const cols = await sql<{ c: string }>`
        SELECT a.attname AS c FROM pg_attribute a
         WHERE a.attrelid = ${t}::regclass AND a.attnum > 0 AND NOT a.attisdropped
           AND a.attidentity = '' AND a.attgenerated = ''
         ORDER BY a.attnum LIMIT 1`.execute(db);
      const col = cols.rows[0]?.c ?? '';
      const why = await refusal(
        `UPDATE "${t}" SET "${col}" = "${col}" WHERE ctid = (SELECT ctid FROM "${t}" LIMIT 1)`,
      );
      if (!refusedBy(why, t)) through.push(`${t}: ${why ?? 'went through'}`);
    }
    expect(through).toEqual([]);
  });

  it('refuses DELETE on every one, by its own trigger', async () => {
    const through: string[] = [];
    for (const t of tables) {
      const why = await refusal(
        `DELETE FROM "${t}" WHERE ctid = (SELECT ctid FROM "${t}" LIMIT 1)`,
      );
      if (!refusedBy(why, t)) through.push(`${t}: ${why ?? 'went through'}`);
    }
    expect(through).toEqual([]);
  });

  it('refuses TRUNCATE on every one, by its own trigger and not one it cascades to', async () => {
    const through: string[] = [];
    for (const t of tables.filter((x) => !KNOWN_GAPS[x])) {
      const why = await refusal(`TRUNCATE "${t}" CASCADE`);
      // reject_modification names the table it fired on: "… TRUNCATE is not permitted on <t>".
      if (!refusedBy(why, `on ${t}`)) through.push(`${t}: ${why ?? 'went through'}`);
    }
    expect(through).toEqual([]);
  });

  // Skipped, not deleted: these are the gaps the sweep found (KNOWN_GAPS).
  it.skip.each(Object.entries(KNOWN_GAPS))('refuses TRUNCATE on %s', async (t) => {
    expect(await refusal(`TRUNCATE "${t}" CASCADE`)).toMatch(/append-only/);
  });

  it('each known gap is still a gap: when one is closed, take it out of KNOWN_GAPS', async () => {
    for (const t of Object.keys(KNOWN_GAPS)) {
      expect(tables).toContain(t);
      expect((await triggersOn(t)).truncate, `${t} now refuses TRUNCATE`).toBe(false);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// I6 · CARD WORDING UNDER ITS OWN DIGEST, AND A THIRD-PARTY BLOCK WHOLE OR ABSENT
// ═══════════════════════════════════════════════════════════════════════════

const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

describe('I6 · the card wording is stored under the digest of exactly its words', () => {
  const insert = (digest: string, body: string) =>
    db
      .insertInto('consent_texts')
      .values({ digest, variant: 'general', body, introduced_by_role: 'test' })
      .execute();

  it('refuses a wording filed under somebody else’s digest', async () => {
    const body = `May we publish this? ${randomUUID()}`;
    await expect(insert(sha(`${body} (but a different sentence)`), body)).rejects.toThrow(
      /check constraint/,
    );
  });

  it('digests the NFC form: decomposed words are stored under the composed digest, and only that', async () => {
    const composed = `Darf das veröffentlicht werden? ${randomUUID()}`.normalize('NFC');
    const decomposed = composed.normalize('NFD');
    expect(decomposed).not.toBe(composed);
    await expect(insert(sha(decomposed), decomposed)).rejects.toThrow(/check constraint/);
    await insert(sha(composed), decomposed);
  });

  it('and once stored, a wording cannot be edited under its digest (the I4 sweep holds it too)', async () => {
    const body = `Publish it? ${randomUUID()}`;
    await insert(sha(body), body);
    await expect(
      sql`UPDATE consent_texts SET body = ${`${body}!`} WHERE digest = ${sha(body)}`.execute(db),
    ).rejects.toThrow(/append-only/);
  });
});

describe('I6 · a third-party block is complete or absent, whatever writes the row', () => {
  let lb: { id: number; slug: string };
  beforeAll(async () => {
    lb = await launchedLogbook(db);
  });

  /** A raw insert that links correctly, so the only thing in question is the block. */
  async function insert(block: Record<string, unknown>) {
    const head = await db
      .selectFrom('reports')
      .select('chain_hash')
      .where('logbook_id', '=', lb.id)
      .orderBy('id', 'desc')
      .executeTakeFirst();
    const prev = head?.chain_hash ?? chainGenesis(lb.slug);
    const content = sha(randomUUID());
    return db
      .insertInto('reports')
      .values({
        public_ref: `RL-I6-${randomUUID().slice(0, 8)}`,
        received_at: new Date().toISOString(),
        thread_id: randomUUID(),
        content_hash: content,
        prev_chain_hash: prev,
        chain_hash: sha(content + prev),
        logbook_id: lb.id,
        may_publish: false,
        may_publish_digest: GENERAL_DIGEST,
        ...block,
      })
      .execute();
  }

  const complete = {
    third_party: true,
    filed_via: 'Helpers e.V.',
    intake_method: 'phone',
    attested_at: '2026-10-17T09:00:00Z',
  };

  it.each([
    ['third_party false (direct is NULL, never false)', { third_party: false }],
    ['no filed_via', { ...complete, filed_via: null }],
    ['no intake_method', { ...complete, intake_method: null }],
    ['no attested_at', { ...complete, attested_at: null }],
    [
      'a block with no third_party flag and no attestation',
      { ...complete, third_party: null, attested_at: null },
    ],
    ['a collection date on a direct report', { collected_on: '2026-10-15' }],
  ])('refuses %s', async (_what, block) => {
    await expect(insert(block)).rejects.toThrow(/check constraint/);
  });

  // Was a GAP, found by this test and closed by *_close_invariant_gaps.sql:
  // with third_party NULL and filed_via, intake_method and
  // attested_at all present, the core CHECK evaluates to NULL, and a CHECK
  // that is NULL passes. The row is stored with a coordinator's provenance
  // that rebuildSealedObject leaves out (it adds the block only when
  // third_party is true): the silently dropped block the rebuild fixed in
  // code, which the database now refuses too.
  it('refuses a whole block whose third_party flag is missing', async () => {
    await expect(insert({ ...complete, third_party: null })).rejects.toThrow(/check constraint/);
  });

  it('takes a direct report, and a complete block with or without a collection date', async () => {
    await insert({});
    await insert(complete);
    await insert({ ...complete, collected_on: '2026-10-15' });
  });

  it('and the filing path itself never writes half a block: buildAnswers to normalizeReportFields refuses it', () => {
    const { answers } = buildAnswers(QUESTIONS, { what: 'x' });
    expect(() =>
      normalizeReportFields({
        logbook: lb.slug,
        answers,
        may_publish: true,
        may_publish_digest: GENERAL_DIGEST,
        third_party: true,
        filed_via: 'Helpers e.V.',
      }),
    ).toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// I2 · EVERY STAFF ROUTE REFUSES A STRANGER AND A PERSON WITH NO ROLE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Staff areas, by prefix. A route under one of these is staff unless it is
 * in SIGNED_IN_ANYONE with its reason.
 */
const STAFF_PREFIXES = [
  '/api/admin/',
  '/api/moderate/',
  '/api/moderation/',
  '/api/access/',
  '/api/intake/',
  '/api/list-review',
  '/api/link-checks',
  // Plan D session 5: the owner's journalist queue, and the desk (journalists only).
  '/api/owner/',
  '/api/desk/',
] as const;

/**
 * Under a staff prefix, and for anybody signed in, ON PURPOSE: the owner's
 * seat can be offered to somebody with no role at all, and they have to be
 * able to see that it waits for them. The test checks what such a person
 * sees there.
 */
const SIGNED_IN_ANYONE = ['GET /api/access/owner'] as const;

/**
 * Everything else, so that a route under a NEW prefix makes this file fail
 * until somebody decides which side it is on. Not staff: public, a reporter's
 * own (by token or by session), a tester's, a coordinator's organization, or
 * the gate's. Each area tests its own refusals.
 */
const NOT_STAFF_PREFIXES = [
  // Anybody signed in reads and accepts an agreement; the page cannot sit
  // behind the agreement it asks for. Publishing one is under /api/admin/.
  '/api/agreement/',
  // The public form to report illegal content and its status link (D1), and
  // the erase link in a confirmation email (I5): each proves itself by token.
  '/api/illegal-content',
  '/api/erase/',
  '/api/auth/',
  '/api/orgs',
  '/api/invitations/',
  // The journalist alert list: signup and the two email links, public (journalists/routes.ts).
  '/api/journalists/',
  '/api/intake-switch',
  // Plan E (PE3): whether intake is paused (public, in front of the
  // password), and joining an organization by its intake link (signed in).
  '/api/intake-pause',
  '/api/intake-links/',
  '/api/site',
  '/api/setup/',
  '/api/doors',
  '/api/directory',
  '/api/telemetry',
  '/api/health',
  '/api/home-buttons',
  '/api/publication-card',
  '/api/reports',
  '/api/legal',
  '/api/logbooks',
  '/api/lists',
  '/api/list-mail/',
  '/api/notifications',
  '/api/feedback',
  '/api/forget/',
  '/api/files/',
  '/api/maps',
  '/api/mine/',
  '/api/uploads',
  '/api/evidence/',
  '/api/board',
  '/api/v1',
  '/api/chain/',
  '/api/press',
] as const;

const isStaff = (url: string) => STAFF_PREFIXES.some((p) => url.startsWith(p));

/** A concrete address for a route pattern. The values only have to reach the guard. */
const concrete = (url: string) =>
  url.replace(/:(\w+)/g, (_m, name: string) => (/thread/i.test(name) ? randomUUID() : '1'));

describe('I2 · every registered staff route refuses a stranger and a person with no role', () => {
  let app: FastifyInstance;
  let noRole: string;
  let routes: { method: string; url: string }[];

  beforeAll(async () => {
    registered.length = 0;
    const mailer = capturingMailer();
    app = await buildApp({
      config: { LOG_LEVEL: 'silent', SITE_ORIGIN: 'https://x.test' },
      db,
      mailer,
    });
    await app.ready();
    // HEAD is Fastify's copy of each GET, and goes through the same hooks.
    routes = registered.filter((r) => r.method !== 'HEAD');
    const email = address('no-role');
    await seat(db, email, 'user');
    noRole = await signIn({ db, app, mailer, close: () => Promise.resolve() }, email);
  });
  afterAll(() => app.close());

  it('sees the routes from Fastify itself, staff ones among them', () => {
    // A floor, so a broken hook cannot make the sweep below pass on nothing.
    expect(routes.length).toBeGreaterThan(150);
    expect(routes.filter((r) => isStaff(r.url)).length).toBeGreaterThan(70);
    expect(routes).toContainEqual({ method: 'POST', url: '/api/admin/logbooks/:id/launch' });
  });

  it('every route is under a prefix somebody decided is staff or is not', () => {
    const undecided = routes.filter(
      (r) => !isStaff(r.url) && !NOT_STAFF_PREFIXES.some((p) => r.url.startsWith(p)),
    );
    expect(
      undecided,
      'a route under a new prefix: add the prefix to STAFF_PREFIXES or NOT_STAFF_PREFIXES',
    ).toEqual([]);
  });

  it('refuses every staff route to a caller who is not signed in (401)', async () => {
    const let_in: string[] = [];
    for (const r of routes.filter((x) => isStaff(x.url))) {
      const res = await app.inject({ method: r.method as 'GET', url: concrete(r.url) });
      if (res.statusCode !== 401) let_in.push(`${r.method} ${r.url} → ${String(res.statusCode)}`);
    }
    expect(let_in).toEqual([]);
  });

  it('refuses every staff route to somebody signed in with no role (403)', async () => {
    const let_in: string[] = [];
    for (const r of routes.filter((x) => isStaff(x.url))) {
      if ((SIGNED_IN_ANYONE as readonly string[]).includes(`${r.method} ${r.url}`)) continue;
      const res = await app.inject({
        method: r.method as 'GET',
        url: concrete(r.url),
        cookies: { session_token: noRole },
      });
      if (res.statusCode !== 403) let_in.push(`${r.method} ${r.url} → ${String(res.statusCode)}`);
    }
    expect(let_in).toEqual([]);
  });

  it('the one staff-area route open to anybody signed in tells them only whether the seat waits for them', async () => {
    for (const key of SIGNED_IN_ANYONE)
      expect(routes.map((r) => `${r.method} ${r.url}`)).toContain(key);
    const res = await app.inject({
      method: 'GET',
      url: '/api/access/owner',
      cookies: { session_token: noRole },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ awaitingMyAcceptance: false });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// I3 · A SEALED OBJECT IS ONLY REBUILT FROM A ROW sealedReportRows READ
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Walk the source and return every place that hands `rebuildSealedObject`
 * something other than `toStoredRecord(<a row from sealedReportRows>)`.
 *
 * A row "comes from" sealedReportRows when, followed back through variables,
 * reassignments, `for … of`, `await`, method chains (`.where(…)`,
 * `.execute()`) and functions that return it, it starts at a call to
 * sealedReportRows. A function parameter is a row from somewhere else: the
 * walk cannot see the caller, so it refuses it. Identifiers are resolved by
 * the TypeScript binder, so two `row`s in one file are two different things.
 */
function unsealedRebuilds(files: readonly string[]): string[] {
  const program = ts.createProgram(files, {
    noEmit: true,
    allowJs: false,
    jsx: ts.JsxEmit.Preserve,
    allowImportingTsExtensions: true,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ES2022,
  });
  const checker = program.getTypeChecker();
  const problems: string[] = [];
  const where = (n: ts.Node) => {
    const sf = n.getSourceFile();
    const { line } = sf.getLineAndCharacterOfPosition(n.getStart());
    return `${relative(ROOT, sf.fileName)}:${String(line + 1)}`;
  };
  const calls = (n: ts.Node, name: string) =>
    ts.isCallExpression(n) &&
    ((ts.isIdentifier(n.expression) && n.expression.text === name) ||
      (ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === name));

  const declarationOf = (id: ts.Identifier): ts.Declaration | undefined => {
    let sym = checker.getSymbolAtLocation(id);
    if (sym && sym.flags & ts.SymbolFlags.Alias) sym = checker.getAliasedSymbol(sym);
    return sym?.valueDeclaration ?? sym?.declarations?.[0];
  };

  /** Every `x = …` to the same variable as `decl`, anywhere in its file. */
  const assignmentsTo = (decl: ts.VariableDeclaration): ts.Expression[] => {
    const out: ts.Expression[] = [];
    const visit = (n: ts.Node) => {
      if (
        ts.isBinaryExpression(n) &&
        n.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isIdentifier(n.left) &&
        declarationOf(n.left) === decl
      ) {
        out.push(n.right);
      }
      ts.forEachChild(n, visit);
    };
    visit(decl.getSourceFile());
    return out;
  };

  const returnsOf = (fn: ts.FunctionLikeDeclaration): ts.Expression[] => {
    if (!fn.body) return [];
    if (!ts.isBlock(fn.body)) return [fn.body];
    const out: ts.Expression[] = [];
    const visit = (n: ts.Node) => {
      if (ts.isFunctionLike(n) && n !== fn) return; // a nested function's returns are its own
      if (ts.isReturnStatement(n) && n.expression) out.push(n.expression);
      ts.forEachChild(n, visit);
    };
    ts.forEachChild(fn.body, visit);
    return out;
  };

  // `seen` holds the expressions being followed right now. Meeting one again
  // is a cycle (`query = query.where(…)`), which adds no new origin: the
  // variable's initializer and every other assignment still have to pass.
  const fromSealedRows = (e: ts.Expression, seen: Set<ts.Node>): boolean => {
    if (seen.has(e)) return true;
    seen.add(e);
    try {
      return follow(e, seen);
    } finally {
      seen.delete(e);
    }
  };
  const follow = (e: ts.Expression, seen: Set<ts.Node>): boolean => {
    if (
      ts.isAwaitExpression(e) ||
      ts.isParenthesizedExpression(e) ||
      ts.isAsExpression(e) ||
      ts.isNonNullExpression(e) ||
      ts.isSatisfiesExpression(e)
    ) {
      return fromSealedRows(e.expression, seen);
    }
    if (ts.isPropertyAccessExpression(e) || ts.isElementAccessExpression(e)) {
      return fromSealedRows(e.expression, seen);
    }
    if (ts.isCallExpression(e)) {
      if (calls(e, 'sealedReportRows')) return true;
      // A method on something that came from it: .where(…), .execute(), …
      if (ts.isPropertyAccessExpression(e.expression))
        return fromSealedRows(e.expression.expression, seen);
      if (ts.isIdentifier(e.expression)) {
        const fn = declarationOf(e.expression);
        const body =
          fn && ts.isFunctionLike(fn)
            ? (fn as ts.FunctionLikeDeclaration)
            : fn &&
                ts.isVariableDeclaration(fn) &&
                fn.initializer &&
                ts.isArrowFunction(fn.initializer)
              ? fn.initializer
              : undefined;
        if (!body) return false;
        const rets = returnsOf(body);
        return rets.length > 0 && rets.every((r) => fromSealedRows(r, seen));
      }
      return false;
    }
    if (ts.isIdentifier(e)) {
      const decl = declarationOf(e);
      if (!decl || !ts.isVariableDeclaration(decl)) return false; // a parameter, an import, …
      const list = decl.parent;
      const holder = ts.isVariableDeclarationList(list) ? list.parent : undefined;
      if (holder && ts.isForOfStatement(holder)) return fromSealedRows(holder.expression, seen);
      if (!ts.isIdentifier(decl.name) || !decl.initializer) return false;
      return [decl.initializer, ...assignmentsTo(decl)].every((x) => fromSealedRows(x, seen));
    }
    return false;
  };

  for (const sf of program.getSourceFiles()) {
    if (sf.isDeclarationFile || sf.fileName.includes('/node_modules/')) continue;
    const visit = (n: ts.Node) => {
      if (ts.isImportSpecifier(n) && (n.propertyName ?? n.name).text === 'rebuildSealedObject') {
        if (n.propertyName && n.name.text !== 'rebuildSealedObject') {
          problems.push(`${where(n)} imports rebuildSealedObject under another name`);
        }
      } else if (ts.isIdentifier(n) && n.text === 'rebuildSealedObject') {
        const p = n.parent;
        const isCallee =
          (ts.isCallExpression(p) && p.expression === n) ||
          (ts.isPropertyAccessExpression(p) &&
            p.name === n &&
            ts.isCallExpression(p.parent) &&
            p.parent.expression === p);
        const isOwnDeclaration = ts.isFunctionDeclaration(p) && p.name === n;
        if (!isCallee && !isOwnDeclaration && !ts.isImportSpecifier(p)) {
          problems.push(
            `${where(n)} passes rebuildSealedObject around, where the walk cannot follow it`,
          );
        }
      }
      if (calls(n, 'rebuildSealedObject')) {
        const arg = (n as ts.CallExpression).arguments[0];
        if (!arg || !calls(arg, 'toStoredRecord')) {
          problems.push(`${where(n)} rebuilds from something toStoredRecord did not make`);
        }
      }
      if (calls(n, 'toStoredRecord')) {
        const arg = (n as ts.CallExpression).arguments[0];
        if (!arg || !fromSealedRows(arg, new Set())) {
          problems.push(
            `${where(n)} hands toStoredRecord a row that did not come from sealedReportRows`,
          );
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return problems;
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (/\.tsx?$/.test(name) && !name.endsWith('.d.ts') && !name.endsWith('.gen.ts'))
      out.push(p);
  }
  return out;
}

describe('I3 · a sealed object is only ever rebuilt from a row sealedReportRows read', () => {
  const everything = () => [
    ...sourceFiles(join(ROOT, 'apps/api/src')),
    ...sourceFiles(join(ROOT, 'apps/web/src')),
    ...readdirSync(join(ROOT, 'packages')).flatMap((p) =>
      sourceFiles(join(ROOT, 'packages', p, 'src')),
    ),
  ];

  it('holds across apps/api, apps/web and every package', () => {
    const files = everything();
    expect(files.some((f) => f.endsWith('apps/api/src/chain/verify.ts'))).toBe(true);
    expect(unsealedRebuilds(files)).toEqual([]);
  });

  it('and the walk really looks: the six callers today are all found', () => {
    const files = everything();
    const callers = files.filter((f) => /\brebuildSealedObject\(/.test(readFileSync(f, 'utf8')));
    expect(callers.map((f) => relative(ROOT, f)).sort()).toEqual([
      'apps/api/src/anchor/archive.ts',
      'apps/api/src/anchor/records.ts',
      'apps/api/src/chain/chainFile.ts',
      'apps/api/src/chain/verify.ts',
      'apps/api/src/evidence/requests.ts',
      'packages/seal/src/report.ts',
    ]);
  });

  describe('the walk itself, on planted code', () => {
    let dir: string;
    beforeAll(() => {
      dir = mkdtempSync(join(tmpdir(), 'i3-walk-'));
    });
    afterAll(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    const PRELUDE = `
      declare const db: any;
      declare function sealedReportRows(db: any): any;
      declare function toStoredRecord(row: any): any;
      declare function rebuildSealedObject(r: any, m: any): any;
    `;
    const walk = (name: string, body: string) => {
      const f = join(dir, `${name}.ts`);
      writeFileSync(f, PRELUDE + body);
      return unsealedRebuilds([f]);
    };

    it.each([
      [
        'a row from its own query',
        `export async function f() {
           const row = await db.selectFrom('reports').selectAll().executeTakeFirst();
           return rebuildSealedObject(toStoredRecord(row), null);
         }`,
      ],
      [
        'a row handed in by a caller',
        `export function f(row: unknown) { return rebuildSealedObject(toStoredRecord(row), null); }`,
      ],
      [
        'an object made on the spot',
        `export const f = () => rebuildSealedObject({ public_ref: 'x' }, null);`,
      ],
      [
        'a variable reassigned to another query',
        `export async function f() {
           let q = sealedReportRows(db);
           q = db.selectFrom('reports');
           const row = await q.executeTakeFirst();
           return rebuildSealedObject(toStoredRecord(row), null);
         }`,
      ],
      [
        'the function passed around',
        `export const f = (rows: unknown[]) => rows.map(rebuildSealedObject as any);`,
      ],
      [
        'the right name on the wrong row in the same file',
        `export async function good() {
           const row = await sealedReportRows(db).executeTakeFirst();
           return rebuildSealedObject(toStoredRecord(row), null);
         }
         export async function bad() {
           const row = await db.selectFrom('reports').selectAll().executeTakeFirst();
           return rebuildSealedObject(toStoredRecord(row), null);
         }`,
      ],
    ])('refuses %s', (what, body) => {
      expect(walk(what.replace(/\W+/g, '-'), body).length).toBeGreaterThan(0);
    });

    it('accepts the shapes the real callers use', () => {
      expect(
        walk(
          'good',
          `function published(d: any) { return sealedReportRows(d).where('x', '=', 1); }
           export async function a() {
             const rows = await published(db).orderBy('r.id').execute();
             for (const row of rows) rebuildSealedObject(toStoredRecord(row), null);
           }
           export async function b(published?: unknown) {
             let query = sealedReportRows(db).where('r.logbook_id', '=', 1);
             if (published) query = query.where('r.id', 'in', published);
             const rows = await query.orderBy('r.id').execute();
             for (const row of rows) rebuildSealedObject(toStoredRecord(row), null);
           }
           export async function c() {
             const prev = await sealedReportRows(db).where('r.id', '=', 1).executeTakeFirstOrThrow();
             return rebuildSealedObject(toStoredRecord(prev), null);
           }`,
        ),
      ).toEqual([]);
    });
  });
});
