/**
 * EXPORT AND IMPORT OF A WHOLE ARCHIVE: moving it to another server, or
 * across a change of schema, with every report replayed through
 * `appendReportVersion` rather than copied.
 *
 * This is not a backup. A backup preserves bytes (pg_dump does that, and does
 * it better); this moves the archive's meaning. Take a backup before relying
 * on either.
 *
 * REPORTS ARE REPLAYED, NEVER COPIED. Each one is sealed again from what the
 * export says was sealed, by the same code that seals a new filing, and the
 * import checks the result against the fingerprint recorded at export. That
 * is what proves the new archive says what the old one said, rather than
 * assuming it.
 *
 * IDS ARE KEPT, because a correction seals the id of the version it corrects
 * (`corrects_id`). A replay that renumbered reports (a rolled-back filing
 * leaves a gap in the sequence) would change those fingerprints. So every row
 * keeps its id, and each report is replayed with the id sequence positioned
 * on the id it had.
 *
 * EVERY TABLE IS DISCOVERED, NOT LISTED. A table added next year travels by
 * default; what does not travel is named in EXCLUDED with the reason, and a
 * test fails if a table is neither.
 *
 * THE ANCHORS travel only when every fingerprint replays identically: then
 * every published proof still reconciles, and they are restored as they
 * were. Otherwise the new chains are not the ones the log timestamped, the
 * anchors are left behind, and the change has to be published beside them
 * (`reset-marker`).
 */
import { createWriteStream } from 'node:fs';
import { rename, rm, stat } from 'node:fs/promises';
import { once } from 'node:events';
import type { ChainHead, ReportFields, SealedReport } from '@reportlog/seal';
import { sql } from 'kysely';
import type { Transaction } from 'kysely';
import { appendReportVersion } from '../chain/append.ts';
import { currentHeads } from '../chain/heads.ts';
import { manifestFor, sealedReportRows, toStoredRecord } from '../chain/record.ts';
import { rebuildSealedObject } from '@reportlog/seal';
import type { Database } from '../db/database.ts';
import type { DB } from '../db/schema.gen.ts';

export const ARCHIVE_FORMAT = 1;

/** Workstream E's tables. An entry is not a report. */
export const LIST_TABLES = [
  'lists',
  'list_fields',
  'list_entries',
  'links',
  'link_groups',
  'link_checks',
  'link_comments',
  'link_erasures',
  'link_blocklist',
  'link_block_log',
  'link_secrets',
  'list_erasures',
  'list_notify_confirmations',
] as const;

const LIST_REASON =
  'A list, not the archive: an entry is not a report, lists erase on a timer, and a copy in an export file would outlive that.';

/** What does not travel, and why. Everything else does. */
export const EXCLUDED: Readonly<Record<string, string>> = {
  ...Object.fromEntries(LIST_TABLES.map((t) => [t, LIST_REASON])),
  schema_migrations: "The migration runner's own record. The new database has its own.",
  sessions: 'Live sign-ins. Everybody signs in again on the new server.',
  otp_codes: 'Sign-in codes, minutes old at most.',
  site_access_tokens: 'Site-password cookies. Visitors type the password again.',
  organization_invite_sends: "A rate limit's memory of today, nothing more.",
  ownership_transfers: "A handover of the owner's seat in progress, with its code. Start it again.",
  report_submissions:
    'Unconfirmed filings, holding an address in the clear until confirmed or swept. An unconfirmed filing is not yet in the archive.',
  report_values:
    "A report's held text and links, each under a key hung from this server's link secret, which does not travel either. A copy in an export file would outlive an erasure. The fingerprints travel with the reports, so every report still verifies.",
  report_submission_values:
    'Held text and links of unconfirmed filings, which do not travel (report_submissions).',
  anchor_runs: "This server's record of its own anchor runs.",
  chain_anchors:
    'Carried as previous_chain_anchors, and restored only when every fingerprint replays identically.',
  chain_anchor_heads: 'Carried with previous_chain_anchors.',
};

type Value = unknown;
interface Column {
  name: string;
  type: string;
}
interface TableDump {
  columns: Column[];
  rows: Record<string, Value>[];
}

export interface ArchivedReport {
  id: number;
  logbook_id: number;
  form_id: number | null;
  content_hash: string;
  chain_hash: string;
  /** Exactly what was sealed, rebuilt the way the verifier rebuilds it. */
  sealed: SealedReport;
  /** The whole row, so a column nothing replays is noticed rather than lost. */
  row: Record<string, Value>;
}

export interface ArchivedAnchor {
  anchor: Record<string, Value>;
  heads: Record<string, Value>[];
}

export interface Archive {
  reportlog_archive: number;
  exported_at: string;
  note: string;
  /** The order rows can be inserted in, `reports` among them (the replay). */
  order: string[];
  /** Rows of every carried table, by name. */
  tables: Record<string, TableDump>;
  reports: ArchivedReport[];
  left_out: Record<string, string>;
  /** What the archive claimed when it was exported, one head per logbook. */
  previous_chain_heads: Record<string, string>;
  previous_chain_list: ChainHead[];
  previous_chain_anchors: ArchivedAnchor[];
}

// ── values in and out of JSON ────────────────────────────────────────────

/** A value as JSON can hold it. Bytes are tagged, so they come back as bytes. */
function out(v: Value): Value {
  if (Buffer.isBuffer(v)) return { $base64: v.toString('base64') };
  if (v instanceof Date) return v.toISOString();
  return v;
}

function back(v: Value, type: string): Value {
  if (v === null || v === undefined) return null;
  if (type === 'bytea' && typeof v === 'object' && '$base64' in v) {
    return Buffer.from((v as { $base64: string }).$base64, 'base64');
  }
  // A JS array would be sent as a Postgres array; json wants text.
  if (type === 'json' || type === 'jsonb') return JSON.stringify(v);
  return v;
}

function without<T extends object, K extends keyof T>(o: T, keys: readonly K[]): Omit<T, K> {
  const drop = new Set<PropertyKey>(keys);
  return Object.fromEntries(Object.entries(o).filter(([k]) => !drop.has(k))) as Omit<T, K>;
}

const dumpRow = (row: Record<string, Value>): Record<string, Value> =>
  Object.fromEntries(Object.entries(row).map(([k, v]) => [k, out(v)]));

// ── the catalogue ────────────────────────────────────────────────────────

async function tablesOf(db: Database): Promise<string[]> {
  const r = await sql<{ t: string }>`
    SELECT table_name AS t FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
     ORDER BY table_name`.execute(db);
  return r.rows.map((x) => x.t);
}

async function columnsOf(db: Database | Transaction<DB>, table: string): Promise<Column[]> {
  const r = await sql<{ name: string; type: string }>`
    SELECT column_name AS name, data_type AS type FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = ${table} AND is_generated = 'NEVER'
     ORDER BY ordinal_position`.execute(db);
  return r.rows;
}

async function primaryKey(
  db: Database | Transaction<DB>,
  table: string,
): Promise<{ name: string; type: string }[]> {
  const r = await sql<{ name: string; type: string }>`
    SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type
      FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
     WHERE i.indrelid = ${table}::regclass AND i.indisprimary`.execute(db);
  return r.rows;
}

/** Tables in an order rows can be inserted in: each after every table it references. */
async function insertOrder(db: Database, tables: readonly string[]): Promise<string[]> {
  const r = await sql<{ t: string; r: string }>`
    SELECT conrelid::regclass::text AS t, confrelid::regclass::text AS r
      FROM pg_constraint WHERE contype = 'f'`.execute(db);
  const set = new Set(tables);
  const needs = new Map(tables.map((t) => [t, new Set<string>()]));
  for (const e of r.rows) {
    if (e.t !== e.r && set.has(e.t) && set.has(e.r)) needs.get(e.t)?.add(e.r);
  }
  const order: string[] = [];
  const done = new Set<string>();
  while (order.length < tables.length) {
    const next = tables.find(
      (t) => !done.has(t) && [...(needs.get(t) ?? [])].every((d) => done.has(d)),
    );
    if (!next)
      throw new Error(
        'The tables reference each other in a circle; the archive cannot order them.',
      );
    order.push(next);
    done.add(next);
  }
  return order;
}

// ── export ───────────────────────────────────────────────────────────────

const NOTE =
  "A logical export of a ReportLog archive. Not a backup. Import it with the same deployment's CONTACT_KEY, or every stored address stays unreadable.";

/** Rows read from the database at a time. Memory is this many rows, never the archive. */
const BATCH = 500;

/** Where the export's text goes, a piece at a time. Resolves when it may take more. */
export type Sink = (chunk: string) => Promise<void>;

export interface ArchiveSummary {
  reports: number;
  /** Rows of each carried table. */
  tables: Record<string, number>;
  anchors: number;
  left_out: string[];
}

/**
 * THE EXPORT, WRITTEN AS IT IS READ. An archive grows without limit, and an
 * export built as one object in memory and stringified at the end needs the
 * whole archive in memory twice: the day it matters most (moving a large
 * archive off a failing server) is the day it would run out. So rows are
 * read through a cursor, a batch at a time, and written straight out; the
 * sink's promise is how a slow disk or a slow download holds the reading back.
 *
 * The text is exactly the JSON of an `Archive`: `importArchive` reads it
 * unchanged, and `exportArchive` below is this, collected.
 */
export async function writeArchive(db: Database, write: Sink): Promise<ArchiveSummary> {
  const all = await tablesOf(db);
  // Read in one transaction, so the export is one moment of the archive.
  return db
    .transaction()
    .setIsolationLevel('repeatable read')
    .execute(async (trx) => {
      const order = await insertOrder(
        db,
        all.filter((t) => !(t in EXCLUDED)),
      );
      const summary: ArchiveSummary = {
        reports: 0,
        tables: {},
        anchors: 0,
        left_out: Object.keys(EXCLUDED),
      };
      const j = (v: unknown) => JSON.stringify(v);
      await write(
        `{"reportlog_archive":${j(ARCHIVE_FORMAT)},"exported_at":${j(new Date().toISOString())},"note":${j(NOTE)},"order":${j(order)},"tables":{`,
      );

      let firstTable = true;
      for (const t of order.filter((x) => x !== 'reports')) {
        const columns = await columnsOf(trx, t);
        const pk = await primaryKey(trx, t);
        const by = pk.length ? sql.raw(pk.map((c) => `"${c.name}"`).join(', ')) : sql.raw('1');
        await write(`${firstTable ? '' : ','}${j(t)}:{"columns":${j(columns)},"rows":[`);
        firstTable = false;
        let n = 0;
        await sql`DECLARE archive_rows NO SCROLL CURSOR FOR SELECT * FROM ${sql.table(t)} ORDER BY ${by}`.execute(
          trx,
        );
        for (;;) {
          const batch = await sql<
            Record<string, Value>
          >`FETCH ${sql.raw(String(BATCH))} FROM archive_rows`.execute(trx);
          if (!batch.rows.length) break;
          let text = '';
          for (const row of batch.rows) text += `${n++ ? ',' : ''}${j(dumpRow(row))}`;
          await write(text);
        }
        await sql`CLOSE archive_rows`.execute(trx);
        await write(']}');
        summary.tables[t] = n;
      }

      // Reports by id, a batch at a time, each sealed object rebuilt the way
      // the verifier rebuilds it.
      await write('},"reports":[');
      let after = 0;
      for (;;) {
        const rows = await sealedReportRows(trx)
          .where('r.id', '>', after)
          .orderBy('r.id')
          .limit(BATCH)
          .execute();
        if (!rows.length) break;
        let text = '';
        for (const row of rows) {
          const sealed = rebuildSealedObject(toStoredRecord(row), await manifestFor(trx, row.id));
          // The row as the reports table holds it, without the join's columns.
          const own = without(row, ['logbook_slug', 'logbook_title', 'logbook_form']);
          const report: ArchivedReport = {
            id: row.id,
            logbook_id: row.logbook_id,
            form_id: row.form_id,
            content_hash: row.content_hash,
            chain_hash: row.chain_hash,
            sealed,
            row: dumpRow(own),
          };
          text += `${summary.reports++ ? ',' : ''}${j(report)}`;
          after = row.id;
        }
        await write(text);
      }

      // The anchors are one row a day: small enough to hold.
      const anchors = await trx.selectFrom('chain_anchors').selectAll().orderBy('id').execute();
      const previous_chain_anchors: ArchivedAnchor[] = [];
      for (const a of anchors) {
        const heads = await trx
          .selectFrom('chain_anchor_heads')
          .selectAll()
          .where('anchor_id', '=', a.id)
          .execute();
        previous_chain_anchors.push({ anchor: dumpRow(a), heads: heads.map(dumpRow) });
      }
      summary.anchors = previous_chain_anchors.length;

      const list = await currentHeads(trx);
      await write(
        `],"left_out":${j({ ...EXCLUDED })},"previous_chain_heads":${j(
          Object.fromEntries(list.filter((h) => h.reports > 0).map((h) => [h.logbook, h.head])),
        )},"previous_chain_list":${j(list)},"previous_chain_anchors":${j(previous_chain_anchors)}}\n`,
      );
      return summary;
    });
}

/** The export as one object, for tests and small archives. The same text, collected. */
export async function exportArchive(db: Database): Promise<Archive> {
  const parts: string[] = [];
  await writeArchive(db, (chunk) => {
    parts.push(chunk);
    return Promise.resolve();
  });
  return JSON.parse(parts.join('')) as Archive;
}

/**
 * The export to a file, written under a `.partial` name and renamed only
 * once complete, so a half-written export never looks like a whole one.
 * Readable by this user only: it holds every account and the contact details
 * under their keys.
 */
export async function writeArchiveFile(
  db: Database,
  file: string,
): Promise<ArchiveSummary & { bytes: number }> {
  const partial = `${file}.partial`;
  const out = createWriteStream(partial, { mode: 0o600 });
  // A disk that fills or a file that cannot be written: every wait below
  // races this, so the export's transaction stops rather than waiting for a
  // 'drain' that will never come.
  const failed = new Promise<never>((_resolve, reject) => {
    out.once('error', reject);
  });
  failed.catch(() => undefined);
  const sink: Sink = async (chunk) => {
    if (!out.write(chunk)) await Promise.race([once(out, 'drain'), failed]);
  };
  try {
    const summary = await Promise.race([writeArchive(db, sink), failed]);
    await Promise.race([
      new Promise<void>((resolve) => {
        out.end(resolve);
      }),
      failed,
    ]);
    await rename(partial, file);
    return { ...summary, bytes: (await stat(file)).size };
  } catch (err) {
    out.destroy();
    await rm(partial, { force: true });
    throw err;
  }
}

// ── import ───────────────────────────────────────────────────────────────

export class ImportRefusal extends Error {
  override name = 'ImportRefusal';
}

export interface ImportResult {
  reports: number;
  tables: Record<string, number>;
  /** Every report sealed to exactly the fingerprint it had. */
  identical: boolean;
  differing: string[];
  anchorsRestored: number;
}

/** A logbook is inserted unlaunched, given its questions, then launched, as the guards require. */
const LAUNCH_COLUMNS = ['launched_at', 'opens_at', 'closes_at', 'closed_at'];

async function insertRows(
  trx: Transaction<DB>,
  table: string,
  dump: TableDump,
  { skip = [], onConflict }: { skip?: string[]; onConflict?: 'nothing' | 'update' } = {},
): Promise<number> {
  const present = new Set((await columnsOf(trx, table)).map((c) => c.name));
  const cols = dump.columns.filter((c) => !skip.includes(c.name));
  const missing = cols.filter((c) => !present.has(c.name)).map((c) => c.name);
  if (missing.length) {
    throw new ImportRefusal(
      `The archive has ${table}.${missing.join(', ')}, which this database does not. Migrate it to the same version first.`,
    );
  }
  const pk = await primaryKey(trx, table);
  for (const row of dump.rows) {
    const names = sql.join(cols.map((c) => sql.ref(c.name)));
    const values = sql.join(cols.map((c) => sql`${back(row[c.name], c.type)}`));
    const conflict =
      onConflict && pk.length
        ? onConflict === 'nothing'
          ? sql` ON CONFLICT (${sql.join(pk.map((c) => sql.ref(c.name)))}) DO NOTHING`
          : sql` ON CONFLICT (${sql.join(pk.map((c) => sql.ref(c.name)))}) DO UPDATE SET ${sql.join(
              cols
                .filter((c) => !pk.some((p) => p.name === c.name))
                .map((c) => sql`${sql.ref(c.name)} = EXCLUDED.${sql.ref(c.name)}`),
            )}`
        : sql``;
    // OVERRIDING SYSTEM VALUE: ids are kept, so nothing that points at a row
    // has to be rewritten.
    await sql`INSERT INTO ${sql.table(table)} (${names}) OVERRIDING SYSTEM VALUE VALUES (${values})${conflict}`.execute(
      trx,
    );
  }
  return dump.rows.length;
}

/** The sealed fields `appendReportVersion` takes: the sealed object minus what it adds itself. */
function fieldsOf(s: SealedReport): ReportFields {
  // Dropping keys rather than naming the ones to keep: whatever else was
  // sealed goes back exactly as it was, absent keys staying absent.
  return without(s, [
    'public_ref',
    'received_at',
    'thread_id',
    'corrects_id',
    'recipe',
    'attachments',
    'logbook_form',
  ]);
}

const sameValue = (a: Value, b: Value) => JSON.stringify(out(a)) === JSON.stringify(b);

export async function importArchive(
  db: Database,
  archive: Archive,
  { newChain = false }: { newChain?: boolean } = {},
): Promise<ImportResult> {
  if (archive.reportlog_archive !== ARCHIVE_FORMAT) {
    throw new ImportRefusal('This is not an archive file this version understands.');
  }
  return db.transaction().execute(async (trx) => {
    for (const t of ['reports', 'logbooks', 'users'] as const) {
      const any = await sql<{ x: number }>`SELECT 1 AS x FROM ${sql.table(t)} LIMIT 1`.execute(trx);
      if (any.rows.length) {
        throw new ImportRefusal(
          `This database already holds ${t}. An archive is replayed into an empty one, or two histories would interleave.`,
        );
      }
    }

    const counts: Record<string, number> = {};
    const differing: string[] = [];
    const order = archive.order;

    const replay = async () => {
      for (const r of archive.reports) {
        // The id it had: the next value the sequence gives is this one.
        await sql`SELECT setval(pg_get_serial_sequence('reports', 'id'), ${r.id}, false)`.execute(
          trx,
        );
        const { row } = await appendReportVersion(trx, {
          logbookId: r.logbook_id,
          threadId: r.sealed.thread_id,
          correctsId: r.sealed.corrects_id,
          fields: fieldsOf(r.sealed),
          attachments: r.sealed.attachments ?? null,
          ...(r.form_id === null ? {} : { formId: r.form_id }),
          publicRefPrefix: '',
          replay: { publicRef: r.sealed.public_ref, receivedAt: r.sealed.received_at },
        });
        if (row.id !== r.id)
          throw new Error(
            `${r.sealed.public_ref} replayed as id ${String(row.id)}, not ${String(r.id)}.`,
          );
        if (row.content_hash !== r.content_hash || row.chain_hash !== r.chain_hash) {
          differing.push(r.sealed.public_ref);
          continue;
        }
        // A column the replay does not write would be lost without a word.
        for (const [k, v] of Object.entries(r.row)) {
          if (!sameValue((row as Record<string, Value>)[k], v)) {
            throw new ImportRefusal(
              `${r.sealed.public_ref}: reports.${k} does not come back as it was. The import does not know how to carry that column yet.`,
            );
          }
        }
      }
      counts.reports = archive.reports.length;
    };

    for (const t of order) {
      if (t === 'reports') {
        await replay();
        continue;
      }
      const dump = archive.tables[t];
      if (!dump || counts[t] !== undefined) continue;
      if (t === 'logbooks') {
        counts.logbooks = await insertRows(trx, 'logbooks', dump, { skip: LAUNCH_COLUMNS });
        const fields = archive.tables.logbook_fields;
        if (fields) counts.logbook_fields = await insertRows(trx, 'logbook_fields', fields);
        for (const lb of dump.rows) {
          const set = Object.fromEntries(
            LAUNCH_COLUMNS.filter((c) => c in lb).map((c) => [c, lb[c] ?? null]),
          );
          if (Object.values(set).some((v) => v !== null)) {
            await trx.updateTable('logbooks').set(set).where('id', '=', Number(lb.id)).execute();
          }
        }
        continue;
      }
      const pk = await primaryKey(trx, t);
      const singleton = pk.length === 1 && pk[0]?.type === 'boolean';
      // Settings rows a fresh database already has take the archive's values;
      // the card wording is named by its own digest, so the same digest is the same text.
      counts[t] = await insertRows(trx, t, dump, {
        ...(singleton ? { onConflict: 'update' as const } : {}),
        ...(t === 'consent_texts' ? { onConflict: 'nothing' as const } : {}),
      });
    }

    if (differing.length && !newChain) {
      throw new ImportRefusal(
        `${String(differing.length)} report(s) would not reproduce the fingerprint they were exported with ` +
          `(${differing.slice(0, 5).join(', ')}${differing.length > 5 ? ', …' : ''}). Nothing was imported. ` +
          'If the sealing code changed on purpose, import with --new-chain and publish a reset marker.',
      );
    }

    // Every id sequence picks up after the highest id carried.
    for (const t of order) {
      for (const c of await columnsOf(trx, t)) {
        const seq = await sql<{
          s: string | null;
        }>`SELECT pg_get_serial_sequence(${t}, ${c.name}) AS s`.execute(trx);
        const name = seq.rows[0]?.s;
        if (!name) continue;
        await sql`SELECT setval(${name}, COALESCE((SELECT max(${sql.ref(c.name)}) FROM ${sql.table(t)}), 0) + 1, false)`.execute(
          trx,
        );
      }
    }

    let anchorsRestored = 0;
    if (!differing.length) {
      // Every published proof still reconciles, so the record of them comes too.
      const anchorCols = await columnsOf(trx, 'chain_anchors');
      const headCols = await columnsOf(trx, 'chain_anchor_heads');
      for (const a of archive.previous_chain_anchors) {
        await insertRows(trx, 'chain_anchors', { columns: anchorCols, rows: [a.anchor] });
        await insertRows(trx, 'chain_anchor_heads', { columns: headCols, rows: a.heads });
        anchorsRestored += 1;
      }
      for (const c of anchorCols) {
        const seq = await sql<{
          s: string | null;
        }>`SELECT pg_get_serial_sequence('chain_anchors', ${c.name}) AS s`.execute(trx);
        const name = seq.rows[0]?.s;
        if (name) {
          await sql`SELECT setval(${name}, COALESCE((SELECT max(id) FROM chain_anchors), 0) + 1, false)`.execute(
            trx,
          );
        }
      }
    }

    return {
      reports: archive.reports.length,
      tables: counts,
      identical: differing.length === 0,
      differing,
      anchorsRestored,
    };
  });
}
