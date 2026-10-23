/**
 * Export the whole archive, replay it into an empty one, and check that every
 * report comes out with the fingerprint it went in with.
 *
 * The equivalent of legacy `archive-roundtrip-selftest`. The export and the
 * import are the archive's answer to "what if this operator disappears", and
 * the worst place for a silent fault: a replay that rebuilds a report's
 * sealed object even slightly differently voids every proof over it, and the
 * failure surfaces years later in the one situation the design exists for.
 *
 * So the source holds the hard cases on purpose: a correction (it seals the
 * id of the version it corrects), files carried forward by a correction, a
 * third-party filing, a question added after launch (two form versions), a
 * gap in the report ids (a rolled-back filing), and a list with entries
 * (which must not travel).
 */
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { normalizeReportFields } from '@reportlog/seal';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { runAnchor } from '../../src/anchor/anchor.ts';
import { EXCLUDED, LIST_TABLES, exportArchive, importArchive } from '../../src/anchor/archive.ts';
import type { Archive } from '../../src/anchor/archive.ts';
import { appendReportVersion } from '../../src/chain/append.ts';
import { verifyReport } from '../../src/chain/verify.ts';
import { createDatabase } from '../../src/db/database.ts';
import type { Database } from '../../src/db/database.ts';
import { migrate } from '../../src/db/migrate.ts';
import { createThrowawayDatabase } from '../../src/db/throwaway.ts';
import type { Throwaway } from '../../src/db/throwaway.ts';
import { fileEntry } from '../../src/lists/entries.ts';
import { createFromTemplate } from '../../src/lists/manage.ts';
import { DEFAULT_LIST_SETTINGS } from '../../src/lists/retention.ts';
import { GENERAL_DIGEST, QUESTIONS, fileReport, launchedLogbook, uniqueSlug } from './helpers.ts';
import { seat } from './identity-helpers.ts';
import { linkKeys } from './links-helpers.ts';
import { standInTsa } from './stand-in-tsa.ts';

const exec = promisify(execFile);
const CLI = fileURLToPath(new URL('../../src/anchor/cli.ts', import.meta.url));

let source: Throwaway;
let target: Throwaway;
let src: Database;
let dst: Database;
let tmp: string;
let archive: Archive;

async function withFiles(
  db: Database,
  lb: { id: number; slug: string },
  threadId: string,
  what: string,
  files: { ordinal: number; sha256: string; byte_size: number; media_type: string }[],
  carried: {
    id: number;
    ordinal: number;
    sha256: string;
    byte_size: number;
    media_type: string;
  }[] = [],
  correctsId: number | null = null,
) {
  return db.transaction().execute(async (trx) => {
    const manifest = [
      ...carried.map((c) => ({
        ordinal: c.ordinal,
        sha256: c.sha256,
        byte_size: c.byte_size,
        media_type: c.media_type,
      })),
      ...files,
    ].sort((x, y) => x.ordinal - y.ordinal);
    const out = await appendReportVersion(trx, {
      logbookId: lb.id,
      threadId,
      correctsId,
      fields: normalizeReportFields({
        logbook: lb.slug,
        answers: { what },
        may_publish: true,
        may_publish_digest: GENERAL_DIGEST,
      }),
      attachments: manifest,
      publicRefPrefix: 'RL-',
    });
    const made = [];
    for (const m of files) {
      const a = await trx
        .insertInto('attachments')
        .values({
          ...m,
          thread_id: threadId,
          report_id: out.row.id,
          storage_key: `k/${randomUUID()}`,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      made.push({ id: a.id, ...m });
    }
    for (const a of [...carried, ...made]) {
      await trx
        .insertInto('report_attachments')
        .values({ report_id: out.row.id, attachment_id: a.id })
        .execute();
    }
    return { row: out.row, files: made };
  });
}

beforeAll(async () => {
  source = await createThrowawayDatabase(inject('serverUrl'), 'archive_src');
  target = await createThrowawayDatabase(inject('serverUrl'), 'archive_dst');
  await migrate(source.url);
  await migrate(target.url);
  src = createDatabase(source.url, 5);
  dst = createDatabase(target.url, 5);
  tmp = mkdtempSync(join(tmpdir(), 'archive-test-'));

  await seat(src, 'owner@example.org', 'owner');
  await seat(src, 'admin@example.org', 'admin');
  const org = await src
    .insertInto('organizations')
    .values({ name: 'Helpers e.V.', verified_by: 'owner@example.org' })
    .returning('id')
    .executeTakeFirstOrThrow();
  const admin = await src
    .selectFrom('users')
    .select('id')
    .where('email', '=', 'admin@example.org')
    .executeTakeFirstOrThrow();
  await src
    .insertInto('organization_memberships')
    .values({ organization_id: org.id, user_id: admin.id, role: 'manager' })
    .execute();
  await src
    .insertInto('sessions')
    .values({
      user_id: admin.id,
      token_hash: 'f'.repeat(64),
      expires_at: new Date(Date.now() + 3600e3),
    })
    .execute();

  const a = await launchedLogbook(src);
  const b = await launchedLogbook(src);
  const a1 = await fileReport(src, a, { what: 'first in a', when: '2026-10-01' });
  // A filing that rolled back: the id sequence now has a gap.
  await src
    .transaction()
    .execute(async (trx) => {
      await appendReportVersion(trx, {
        logbookId: a.id,
        threadId: randomUUID(),
        fields: normalizeReportFields({
          logbook: a.slug,
          may_publish: true,
          may_publish_digest: GENERAL_DIGEST,
        }),
        publicRefPrefix: 'RL-',
      });
      throw new Error('rolled back on purpose');
    })
    .catch(() => undefined);
  const b1 = await fileReport(
    src,
    b,
    { what: 'taken by phone' },
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
  const thread = randomUUID();
  const w1 = await withFiles(src, a, thread, 'with two files', [
    { ordinal: 1, sha256: 'c'.repeat(64), byte_size: 1234, media_type: 'image/jpeg' },
    { ordinal: 2, sha256: 'd'.repeat(64), byte_size: 99, media_type: 'application/pdf' },
  ]);
  // The correction carries both files forward and adds a third.
  const w2 = await withFiles(
    src,
    a,
    thread,
    'corrected, with a third file',
    [{ ordinal: 3, sha256: 'e'.repeat(64), byte_size: 5, media_type: 'image/png' }],
    w1.files,
    w1.row.id,
  );
  // A question added after launch: a second form version.
  await src
    .insertInto('logbook_fields')
    .values({
      logbook_id: a.id,
      key: 'extra',
      kind: 'short_text',
      label: 'Anything else?',
      required: false,
      position: 9,
      settings: '{}',
    })
    .execute();
  const a2 = await fileReport(
    src,
    a,
    { what: 'under the second form', extra: 'yes' },
    {
      questions: [...QUESTIONS, { key: 'extra', kind: 'short_text', label: 'Anything else?' }],
    },
  );
  for (const [r, status] of [
    [a1.row, 'valid'],
    [b1.row, 'pending'],
    [w2.row, 'valid'],
    [a2.row, 'invalid'],
  ] as const) {
    await src
      .insertInto('report_heads')
      .values({ thread_id: r.thread_id, current_report_id: r.id, moderation_status: status })
      .execute();
  }

  // A list with an entry. Lists never travel with the archive.
  const list = await createFromTemplate(src, 'contact', { slug: uniqueSlug('contact') });
  await src.updateTable('lists').set({ visibility: 'listed' }).where('id', '=', list.id).execute();
  await fileEntry(
    src,
    list.slug,
    {
      answers: { subject: 'a call', message: 'please call me back' },
      email: 'someone@example.org',
      emailConsent: true,
    },
    { settings: DEFAULT_LIST_SETTINGS, keys: await linkKeys(src) },
  );
  expect(await src.selectFrom('list_entries').select('id').execute()).toHaveLength(1);

  // And an anchor, so there is something published to reconcile with.
  const tsa = await standInTsa();
  try {
    const out = await runAnchor({
      db: src,
      tsaUrl: tsa.url,
      say: () => undefined,
      now: () => new Date('2026-11-04T04:00:00Z'),
      log: {
        dir: join(tmp, 'log'),
        remotes: [],
        branch: 'main',
        author: { name: 't', email: 't@t.invalid' },
      },
    });
    expect(out.outcome).toBe('not_published');
  } finally {
    await tsa.close();
  }
});

afterAll(async () => {
  await src.destroy();
  await dst.destroy();
  await source.drop();
  await target.drop();
  rmSync(tmp, { recursive: true, force: true });
});

describe('the export', () => {
  it('carries every report, and every table someone decided it should', async () => {
    archive = await exportArchive(src);
    const reports = await src.selectFrom('reports').select('id').execute();
    expect(archive.reports).toHaveLength(reports.length);
    expect(archive.reports.length).toBeGreaterThanOrEqual(5);
    // Every table in the database is either carried or left out with a reason.
    const tables = await sql<{ t: string }>`
      SELECT table_name AS t FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`.execute(src);
    for (const { t } of tables.rows) {
      expect(t in archive.tables || t in EXCLUDED || t === 'reports', t).toBe(true);
    }
  });

  it('LEAVES THE LIST AND LINK TABLES OUT: an entry is not a report', () => {
    // Read from the lists and links migrations, less what a later one
    // dropped, so a new list or link table cannot be missed.
    const migrations = fileURLToPath(new URL('../../migrations/', import.meta.url));
    const files = readdirSync(migrations).filter((f) => /_(lists|links)\.sql$/.test(f));
    const text = files.map((f) => readFileSync(join(migrations, f), 'utf8')).join('\n');
    const dropped = new Set([...text.matchAll(/^DROP TABLE (\w+);/gm)].map((m) => m[1]));
    const created = [...text.matchAll(/CREATE TABLE (\w+) \(/g)]
      .map((m) => m[1])
      .filter((t) => !dropped.has(t));
    expect(files).toHaveLength(2);
    expect(created).toHaveLength(13);
    expect([...LIST_TABLES].sort()).toEqual([...created].sort());
    for (const t of created) {
      expect(archive.tables, t ?? '').not.toHaveProperty(t ?? '');
      expect(EXCLUDED[t ?? '']).toMatch(/list/i);
    }
    expect(JSON.stringify(archive)).not.toContain('please call me back');
  });

  it('leaves out live credentials', () => {
    for (const t of ['sessions', 'otp_codes', 'site_access_tokens', 'report_submissions']) {
      expect(archive.tables).not.toHaveProperty(t);
    }
    expect(JSON.stringify(archive)).not.toContain('f'.repeat(64));
  });

  it('records the anchors and chain heads it was exported under', () => {
    expect(archive.previous_chain_anchors).toHaveLength(1);
    expect(Object.keys(archive.previous_chain_heads)).toHaveLength(2);
  });
});

describe('the import', () => {
  it('replays into an empty database, through appendReportVersion', async () => {
    const p = join(tmp, 'archive.json');
    writeFileSync(p, `${JSON.stringify(archive)}\n`);
    const result = await importArchive(dst, JSON.parse(readFileSync(p, 'utf8')) as Archive);
    expect(result.reports).toBe(archive.reports.length);
    expect(result.identical).toBe(true);
    expect(result.anchorsRestored).toBe(1);
  });

  it('EVERY CONTENT HASH AND CHAIN HASH IS IDENTICAL, and every id the seal names', async () => {
    const shape = (db: Database) =>
      db
        .selectFrom('reports')
        .select([
          'id',
          'public_ref',
          'content_hash',
          'chain_hash',
          'prev_chain_hash',
          'corrects_id',
          'form_id',
        ])
        .orderBy('id')
        .execute();
    const before = await shape(src);
    const after = await shape(dst);
    expect(after).toEqual(before);
    expect(before.some((r) => r.corrects_id !== null)).toBe(true);
    // The gap survived: ids are not renumbered.
    expect(before.some((r, i) => i > 0 && r.id !== (before[i - 1]?.id ?? 0) + 1)).toBe(true);
  });

  it('every version carries the same files afterwards', async () => {
    const manifests = (db: Database) =>
      db
        .selectFrom('report_attachments as ra')
        .innerJoin('attachments as a', 'a.id', 'ra.attachment_id')
        .select([
          'ra.report_id',
          'a.ordinal',
          'a.sha256',
          'a.byte_size',
          'a.media_type',
          'a.storage_key',
        ])
        .orderBy('ra.report_id')
        .orderBy('a.ordinal')
        .execute();
    const before = await manifests(src);
    expect(before.length).toBe(5);
    expect(await manifests(dst)).toEqual(before);
  });

  it('and the verifier agrees, report by report, not just two queries agreeing', async () => {
    const refs = await dst.selectFrom('reports').select('public_ref').execute();
    for (const { public_ref } of refs) {
      const v = await verifyReport(dst, public_ref);
      expect(v?.content.ok && v.link.ok && v.position.ok, public_ref).toBe(true);
      expect(v?.anchor.anchored, public_ref).toBe(true);
    }
  });

  it('moderation, people, organizations and the site password come across', async () => {
    const heads = (db: Database) =>
      db.selectFrom('report_heads').selectAll().orderBy('thread_id').execute();
    expect(await heads(dst)).toEqual(await heads(src));
    const users = (db: Database) =>
      db.selectFrom('users').select(['id', 'email', 'roles']).orderBy('id').execute();
    expect(await users(dst)).toEqual(await users(src));
    expect(await dst.selectFrom('organization_memberships').selectAll().execute()).toHaveLength(1);
    const access = (db: Database) => db.selectFrom('site_access').selectAll().executeTakeFirst();
    expect(await access(dst)).toEqual(await access(src));
    expect(await dst.selectFrom('sessions').select('token_hash').execute()).toHaveLength(0);
    for (const t of LIST_TABLES) {
      const n = await sql<{ n: number }>`SELECT count(*)::int AS n FROM ${sql.table(t)}`.execute(
        dst,
      );
      expect(n.rows[0]?.n, t).toBe(0);
    }
  });

  it('the database goes on working: a new report chains on, with a fresh id', async () => {
    const lb = await dst
      .selectFrom('logbooks')
      .select(['id', 'slug'])
      .orderBy('id')
      .executeTakeFirstOrThrow();
    const max = await dst
      .selectFrom('reports')
      .select((e) => e.fn.max('id').as('m'))
      .executeTakeFirstOrThrow();
    const next = await fileReport(dst, lb, { what: 'after the move' });
    expect(next.row.id).toBeGreaterThan(max.m);
    const v = await verifyReport(dst, next.row.public_ref);
    expect(v?.position.ok && v.link.ok).toBe(true);
  });

  it('refuses a database that already holds an archive', async () => {
    await expect(importArchive(dst, archive)).rejects.toThrow(/already holds/);
  });
});

describe('when the sealed shape has changed', () => {
  it('refuses by default, and with --new-chain builds new chains and restores no anchor', async () => {
    const third = await createThrowawayDatabase(inject('serverUrl'), 'archive_new');
    try {
      await migrate(third.url);
      const db3 = createDatabase(third.url, 2);
      try {
        // Stand in for a change to the sealing code: one report's recorded
        // hash no longer matches what today's code rebuilds.
        const altered = structuredClone(archive);
        const first = altered.reports[0];
        if (!first) throw new Error('no reports');
        first.content_hash = '0'.repeat(64);
        await expect(importArchive(db3, altered)).rejects.toThrow(/would not reproduce/);
        expect(await db3.selectFrom('reports').select('id').execute()).toHaveLength(0);

        const out = await importArchive(db3, altered, { newChain: true });
        expect(out.identical).toBe(false);
        expect(out.anchorsRestored).toBe(0);
        expect(await db3.selectFrom('chain_anchors').select('id').execute()).toHaveLength(0);
      } finally {
        await db3.destroy();
      }
    } finally {
      await third.drop();
    }
  });
});

describe('the commands', () => {
  it('export and import run as commands, against the database in DATABASE_URL', async () => {
    const fourth = await createThrowawayDatabase(inject('serverUrl'), 'archive_cli');
    try {
      await migrate(fourth.url);
      const file = join(tmp, 'cli-archive.json');
      const env = { ...process.env, DATABASE_URL: source.url };
      const exported = await exec(process.execPath, [CLI, 'export', file], { env });
      expect(exported.stdout).toMatch(/reports\s+\d+/);
      const imported = await exec(process.execPath, [CLI, 'import', file], {
        env: { ...process.env, DATABASE_URL: fourth.url },
      });
      expect(imported.stdout).toMatch(/every fingerprint is identical/i);
    } finally {
      await fourth.drop();
    }
  });
});
