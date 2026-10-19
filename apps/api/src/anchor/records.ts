/**
 * The three files a day's anchor publishes, built from the database.
 *
 *   anchors/<date>.json    every logbook's chain head and the token over them
 *   snapshots/<date>.json  every published report, with exactly what was hashed
 *   counts/<date>.json     what the published lists add up to, with a token of its own
 *
 * The anchor file's shape is the old application's, key for key, so a reader
 * written against the log before the rebuild still reads it.
 */
import {
  ANCHOR_FORMAT,
  canonicalJson,
  contentHash,
  rebuildSealedObject,
  sha256Hex,
} from '@reportlog/seal';
import type { ChainHead, SealedReport } from '@reportlog/seal';
import type { Database } from '../db/database.ts';
import { manifestFor, sealedReportRows, toStoredRecord } from '../chain/record.ts';
import type { snapshotDocument } from '../lists/aggregates.ts';

export const SNAPSHOT_FORMAT = 2;
export const COUNTS_FORMAT = 1;

export interface AnchorRecord {
  anchor_format: number;
  date: string;
  chains: ChainHead[];
  /** SHA-256 of {anchor_format, date, chains} under RFC 8785: what the authority signed. */
  root_chain_hash: string;
  rfc3161_token_base64: string;
  tsa: string;
}

export function anchorRecord(
  date: string,
  chains: readonly ChainHead[],
  root: string,
  token: Uint8Array,
  tsa: string,
): AnchorRecord {
  return {
    anchor_format: ANCHOR_FORMAT,
    date,
    chains: chains.map((c) => ({ logbook: c.logbook, head: c.head, reports: c.reports })),
    root_chain_hash: root,
    rfc3161_token_base64: Buffer.from(token).toString('base64'),
    tsa,
  };
}

/** Pretty-printed, so a day's file reads in a browser and diffs line by line. */
export const prettyFile = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

// ── the snapshot ─────────────────────────────────────────────────────────

/**
 * The reports the public board shows: the current version of each thread,
 * not withdrawn, approved by a moderator, and the reporter said yes. The same
 * conditions `buildChainFile` uses for its published file.
 *
 * NOTHING IS PUBLIC UNTIL A MODERATOR APPROVES IT, and this is a log that is
 * never rewritten, so a report wrongly in here is in public for good. If the
 * board's rule gains a condition (a public-archive switch, say), this must
 * gain it in the same change.
 */
export function publishedReportRows(db: Database) {
  return sealedReportRows(db)
    .innerJoin('report_heads as h', 'h.current_report_id', 'r.id')
    .where('h.withdrawn', '=', false)
    .where('h.moderation_status', '=', 'valid')
    .where('r.may_publish', '=', true);
}

export interface SnapshotReport {
  public_ref: string;
  logbook: string;
  recipe: number;
  hashed_fields: SealedReport;
  content_hash: string;
  prev_chain_hash: string;
  chain_hash: string;
  content_hash_recomputed?: string;
}

export interface Snapshot {
  snapshot_format: number;
  date: string;
  chains: ChainHead[];
  report_count: number;
  reports_not_matching_their_own_hash?: number;
  how_to_check: string;
  notes: string;
  forms?: { hash: string; definition: string }[];
  reports: SnapshotReport[];
}

/**
 * Every published report as of now, grouped by logbook in chain order.
 *
 * `chains` is the list the day's anchor timestamped, passed in, so the two
 * files committed together can never disagree about it.
 */
export async function buildSnapshot(
  db: Database,
  date: string,
  chains: readonly ChainHead[],
): Promise<Snapshot> {
  const rows = await publishedReportRows(db).orderBy('l.slug').orderBy('r.id').execute();
  const reports: SnapshotReport[] = [];
  let mismatches = 0;
  for (const row of rows) {
    const sealed = rebuildSealedObject(toStoredRecord(row), await manifestFor(db, row.id));
    const computed = contentHash(sealed);
    // A report that no longer matches its own recorded hash is published
    // WITH the disagreement showing. A snapshot that quietly printed the
    // recomputed value would hide the one event this archive exists to show.
    if (computed !== row.content_hash) mismatches += 1;
    reports.push({
      public_ref: row.public_ref,
      logbook: row.logbook_slug,
      recipe: row.recipe,
      hashed_fields: sealed,
      content_hash: row.content_hash,
      prev_chain_hash: row.prev_chain_hash,
      chain_hash: row.chain_hash,
      ...(computed === row.content_hash ? {} : { content_hash_recomputed: computed }),
    });
  }

  // The questions those reports were answered against, only the versions in use.
  const wanted = [
    ...new Set(reports.map((r) => r.hashed_fields.logbook_form).filter((h) => h !== undefined)),
  ];
  const forms = wanted.length
    ? await db
        .selectFrom('logbook_forms')
        .select(['form_hash as hash', 'definition'])
        .where('form_hash', 'in', wanted)
        .orderBy('id')
        .execute()
    : [];

  return {
    snapshot_format: SNAPSHOT_FORMAT,
    date,
    chains: chains.map((c) => ({ logbook: c.logbook, head: c.head, reports: c.reports })),
    report_count: reports.length,
    ...(mismatches ? { reports_not_matching_their_own_hash: mismatches } : {}),
    how_to_check: [
      'Each report lists hashed_fields exactly as they were hashed.',
      'Serialize hashed_fields with RFC 8785 (JCS) and take its SHA-256:',
      'that is content_hash. Then chain_hash = SHA256(content_hash + prev_chain_hash).',
      'Every logbook is its own chain. Its first report links to',
      'SHA256("reportlog-chain:" + the logbook\'s slug), not to zeros.',
    ].join(' '),
    notes: [
      'Published reports only. A report withdrawn after a snapshot was',
      'published stops appearing in later snapshots; it is not removed from',
      'earlier ones, which are already public.',
      'chains covers every report in each logbook, including any not',
      'published here. The daily anchor is what ties it to an outside timestamp.',
      'Contact details are not part of the fingerprint and are not in this file.',
    ].join(' '),
    ...(forms.length ? { forms } : {}),
    reports,
  };
}

/** Canonical, so the same data written twice is the same bytes. */
export const serializeSnapshot = (s: Snapshot): string => `${canonicalJson(s)}\n`;

// ── the counts ───────────────────────────────────────────────────────────

/**
 * A SEPARATE FILE WITH ITS OWN TIMESTAMP, NOT A FIELD IN THE ANCHOR. The
 * anchor's signed digest is defined over {anchor_format, date, chains} and
 * every anchor already published is checked against exactly that. Folding
 * counts in would change what the format means, and the log is never
 * rewritten, not even to improve it.
 *
 * Computed here and not in lists/: an entry is not a report, and nothing
 * under lists/ may reach the sealing code, whose canonical JSON this uses.
 */
export interface CountsRecord {
  counts_format: number;
  date: string;
  lists: {
    slug: string;
    title: string;
    definition: { key: string; label: string; kind: string; options: string[] | null }[];
    totals: { received: number; approved: number };
    fields: {
      key: string;
      label: string;
      kind: string;
      values: { value: string; received: number; approved: number }[];
    }[];
  }[];
  /** SHA-256 of {counts_format, date, lists} under RFC 8785: what the authority signs. */
  digest: string;
}

type CountsDocument = Awaited<ReturnType<typeof snapshotDocument>>;

/**
 * Only the fields named here, copied one by one: the list module may add a
 * field to its summary for a screen, and that must not slip into a file that
 * is never rewritten without somebody deciding it should.
 */
export function countsRecord(date: string, doc: CountsDocument): CountsRecord {
  const lists = doc.lists.map((l) => ({
    slug: l.slug,
    title: l.title,
    definition: l.definition.map((d) => ({
      key: d.key,
      label: d.label,
      kind: d.kind,
      options: d.options,
    })),
    totals: { received: l.totals.received, approved: l.totals.approved },
    fields: l.fields.map((f) => ({
      key: f.key,
      label: f.label,
      kind: f.kind,
      values: f.values.map((v) => ({ value: v.value, received: v.received, approved: v.approved })),
    })),
  }));
  const signed = { counts_format: COUNTS_FORMAT, date, lists };
  return { ...signed, digest: sha256Hex(canonicalJson(signed)) };
}

/** Anybody's check: does a counts file's digest match its own contents? */
export function countsDigestMatches(
  record: Pick<CountsRecord, 'counts_format' | 'date' | 'lists' | 'digest'>,
): boolean {
  const { counts_format, date, lists } = record;
  return sha256Hex(canonicalJson({ counts_format, date, lists })) === record.digest;
}
