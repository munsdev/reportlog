/**
 * The public board: what the archive publishes, and nothing else.
 *
 * A report is public when ALL of these hold, and the query says so in one
 * place (`published`) so no read can forget one:
 *
 *   - a moderator approved it (`moderation_status = 'valid'`);
 *   - its reporter permitted publication (`may_publish`, sealed);
 *   - nobody has withdrawn it;
 *   - this deployment publishes an archive (board/publication.ts), asked by
 *     every exported read here before it queries.
 *
 * NOTHING IS FILTERABLE UNLESS AN OPERATOR SAID SO. What is built in is only
 * what every report has: which logbook, a reference, and a search over the
 * answers. An answer filter is accepted only for a question its logbook's
 * maker marked as a filter; there is no built-in date or place filter.
 *
 * Never served here: contact details, review flags, moderation reasons, who
 * moderated, and an editorial note's author.
 */
import type { FormQuestion } from '@reportlog/contracts';
import type { Kysely, RawBuilder } from 'kysely';
import { sql } from 'kysely';
import type { DB } from '../db/schema.gen.ts';
import { HttpError } from '../http/errors.ts';
import { filterableFields, launchedLogbooks, logbookBySlug } from '../logbooks/logbooks.ts';
import { forForm } from '../logbooks/routes.ts';
import { publicLinksFor, publicNoteFor, publicNotesForMany } from '../moderation/notes.ts';
import type { PublicNote } from '../moderation/notes.ts';
import { permissionsForMany } from '../permissions/log.ts';
import { publicArchiveAvailable } from './publication.ts';
import { isPublic, publishedReportIds } from './published.ts';
import {
  ANSWER_KEY,
  answerMatches,
  normalizeSearch,
  searchMatches,
  sortDirection,
} from './search.ts';

export const PAGE_SIZE = 100;
const MAX_ANSWER_FILTERS = 10;

/** Published reports, joined the way every board read reads them. */
export function published(db: Kysely<DB>) {
  return db
    .selectFrom('report_heads as h')
    .innerJoin('reports as r', 'r.id', 'h.current_report_id')
    .innerJoin('logbooks as l', 'l.id', 'r.logbook_id')
    .where('r.id', 'in', publishedReportIds(db));
}

type Published = ReturnType<typeof published>;

function columns(q: Published) {
  return q.select((eb) => [
    'h.thread_id',
    'h.current_report_id',
    'r.public_ref',
    'r.received_at',
    'r.answers',
    'r.third_party',
    'r.filed_via',
    'r.intake_method',
    'r.collected_on',
    'r.chain_hash',
    'r.corrects_id',
    'l.slug as logbook_slug',
    'l.title as logbook_title',
    // Whether a moderator published this version's files. The reporter's
    // permission is checked beside it, freshly, in `withFiles`.
    eb
      .selectFrom('file_publication_log as fp')
      .whereRef('fp.thread_id', '=', 'h.thread_id')
      .whereRef('fp.report_id', '=', 'h.current_report_id')
      .select('fp.published')
      .orderBy('fp.id', 'desc')
      .limit(1)
      .as('files_published'),
    eb
      .selectFrom('report_attachments as ra')
      .whereRef('ra.report_id', '=', 'h.current_report_id')
      .select((e) => e.fn.countAll<string>().as('n'))
      .as('file_count'),
  ]);
}

type Row = Awaited<ReturnType<ReturnType<typeof columns>['execute']>>[number];

export interface PublicReport {
  public_ref: string;
  received_at: string;
  logbook_slug: string;
  logbook_title: string;
  answers: Record<string, unknown>;
  corrected: boolean;
  chain_hash: string;
  third_party?: { filed_via: string; intake_method: string; collected_on?: string };
  /** How many files are public on it: published by a moderator AND permitted now. */
  files: number;
  editorial_note?: PublicNote;
}

const iso = (d: Date) => d.toISOString();

/**
 * Files count only while both layers say yes: the moderator published them
 * on this version, and the reporter's permission stands right now. Taking
 * the permission back takes them down on the next read, with nobody having
 * to remember to.
 */
async function withFiles(db: Kysely<DB>, rows: Row[]) {
  const perms = await permissionsForMany(
    db,
    rows.map((r) => r.thread_id),
  );
  return (r: Row) =>
    r.files_published === true && perms.get(r.thread_id)?.attachment_publication === true
      ? Number(r.file_count ?? 0)
      : 0;
}

function present(r: Row, files: number, note: PublicNote | undefined): PublicReport {
  return {
    public_ref: r.public_ref,
    received_at: iso(r.received_at),
    logbook_slug: r.logbook_slug,
    logbook_title: r.logbook_title,
    answers: (r.answers ?? {}) as Record<string, unknown>,
    corrected: r.corrects_id !== null,
    chain_hash: r.chain_hash,
    // Public provenance: which organization an account came through, and
    // how. Never which person in it typed it up.
    ...(r.third_party && r.filed_via && r.intake_method
      ? {
          third_party: {
            filed_via: r.filed_via,
            intake_method: r.intake_method,
            ...(r.collected_on ? { collected_on: r.collected_on.slice(0, 10) } : {}),
          },
        }
      : {}),
    files,
    ...(note ? { editorial_note: note } : {}),
  };
}

export interface BoardQuery {
  q?: string | undefined;
  logbook?: string | undefined;
  sort?: 'newest' | 'oldest' | undefined;
  page?: number | undefined;
  /** Question key → answer, only for questions an operator marked as filters. */
  answers?: Record<string, string> | undefined;
}

const refuse = (message: string) => new HttpError(400, 'invalid_filter', message);

/** Check answer filters against what the logbook's maker marked. */
async function answerFilters(db: Kysely<DB>, query: BoardQuery) {
  const entries = Object.entries(query.answers ?? {}).filter(([, v]) => v !== '');
  if (!entries.length) return [];
  if (!query.logbook) throw refuse('Choose a logbook before filtering by its answers.');
  if (entries.length > MAX_ANSWER_FILTERS)
    throw refuse('That is more filters than any logbook has.');
  const lb = await logbookBySlug(db, query.logbook ?? '');
  if (!lb?.launched_at) throw refuse('There is no logbook with that name.');
  const allowed = new Set((await filterableFields(db, lb.id)).map((f) => f.key));
  for (const [key] of entries) {
    if (!ANSWER_KEY.test(key) || !allowed.has(key)) {
      throw refuse('That question is not one this logbook offers as a filter.');
    }
  }
  return entries;
}

/** Every narrowing the board allows, as one condition. */
function narrowing(query: BoardQuery, answers: [string, string][]): RawBuilder<boolean> {
  const parts: RawBuilder<boolean>[] = [sql<boolean>`true`];
  const search = normalizeSearch(query.q);
  if (search) parts.push(searchMatches(search));
  if (query.logbook) parts.push(sql<boolean>`l.slug = ${query.logbook}`);
  for (const [key, value] of answers) parts.push(answerMatches(key, value));
  return sql<boolean>`(${sql.join(parts, sql` AND `)})`;
}

export type BoardPage =
  | { published: true; reports: PublicReport[]; total: number; page: number; page_size: number }
  | { published: false; reason: string };

/** The board: a page of published reports, newest first unless asked otherwise. */
export async function boardPage(db: Kysely<DB>, query: BoardQuery): Promise<BoardPage> {
  if (!(await publicArchiveAvailable(db))) return { ...OFF };
  const answers = await answerFilters(db, query);
  const page = Math.max(1, Math.trunc(query.page ?? 1));
  const dir = sortDirection(query.sort);
  const rows = await columns(published(db))
    .where(narrowing(query, answers))
    .orderBy('r.received_at', dir)
    .orderBy('r.id', dir)
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE)
    .execute();
  const counted = await published(db)
    .where(narrowing(query, answers))
    .select((eb) => eb.fn.countAll<string>().as('n'))
    .executeTakeFirst();
  const files = await withFiles(db, rows);
  const notes = await publicNotesForMany(
    db,
    rows.map((r) => r.thread_id),
  );
  return {
    published: true,
    reports: rows.map((r) => present(r, files(r), notes.get(r.thread_id))),
    total: Number(counted?.n ?? 0),
    page,
    page_size: PAGE_SIZE,
  };
}

const OFF = { published: false as const, reason: 'This site does not publish a public archive.' };

export type OneReport =
  | { published: true; report: PublicReport; links: Awaited<ReturnType<typeof publicLinksFor>> }
  | { published: false; reason: string };

/** One published report. Anything else, in any state, is "not found". */
export async function boardReport(db: Kysely<DB>, publicRef: string): Promise<OneReport | null> {
  if (!(await publicArchiveAvailable(db))) return { ...OFF };
  const row = await columns(published(db)).where('r.public_ref', '=', publicRef).executeTakeFirst();
  if (!row) return null;
  const files = await withFiles(db, [row]);
  const note = (await publicNoteFor(db, row.thread_id)) ?? undefined;
  return {
    published: true,
    report: present(row, files(row), note),
    links: note ? await publicLinksFor(db, row.thread_id) : [],
  };
}

/**
 * The published files on one report: metadata only. Serving the bytes is
 * workstream F's (renditions, never originals), and it must ask this first.
 */
export async function boardFiles(db: Kysely<DB>, publicRef: string) {
  if (!(await publicArchiveAvailable(db))) return null;
  const row = await columns(published(db)).where('r.public_ref', '=', publicRef).executeTakeFirst();
  if (!row) return null;
  if ((await withFiles(db, [row]))(row) === 0) return [];
  return db
    .selectFrom('report_attachments as ra')
    .innerJoin('attachments as a', 'a.id', 'ra.attachment_id')
    .select(['a.id', 'a.ordinal', 'a.media_type', 'a.byte_size', 'a.sha256'])
    .where('ra.report_id', '=', row.current_report_id)
    .orderBy('a.ordinal')
    .execute();
}

/** Every logbook a report could have been filed to, with ONLY its operator's filters. */
export async function boardLogbooks(
  db: Kysely<DB>,
): Promise<{ slug: string; title: string; blurb: string | null; filters: FormQuestion[] }[]> {
  const out = [];
  for (const lb of await launchedLogbooks(db)) {
    out.push({
      slug: lb.slug,
      title: lb.title,
      blurb: lb.blurb,
      filters: (await filterableFields(db, lb.id)).map(forForm),
    });
  }
  return out;
}

// ── the CSV ──────────────────────────────────────────────────────────────

/**
 * The board as a spreadsheet. A CSV is the form in which this data most often
 * gets re-published, so it carries the same answers the board filtered by:
 * one column per question when narrowed to one logbook (headed by the
 * question's KEY, which is what the seal carries), one column of JSON across
 * several, where a shared key need not mean the same question.
 *
 * Cells that a spreadsheet would read as a formula (=, +, -, @) are prefixed
 * with an apostrophe: report text is a stranger's text.
 */
export async function boardCsv(db: Kysely<DB>, query: BoardQuery): Promise<string | null> {
  if (!(await publicArchiveAvailable(db))) return null;
  const answers = await answerFilters(db, query);
  const rows = await columns(published(db))
    .where(narrowing(query, answers))
    .orderBy('r.received_at', sortDirection(query.sort))
    .orderBy('r.id', sortDirection(query.sort))
    .limit(10000)
    .execute();
  const cols = [
    'public_ref',
    'received_at',
    'logbook',
    'filed_via',
    'intake_method',
    'collected_on',
    'corrected',
    'chain_hash',
  ];
  let keys: string[] | null = null;
  if (query.logbook) {
    const lb = await logbookBySlug(db, query.logbook);
    if (lb) {
      keys = (
        await db
          .selectFrom('logbook_fields')
          .select('key')
          .where('logbook_id', '=', lb.id)
          .where('kind', '<>', 'file')
          .orderBy('position')
          .orderBy('id')
          .execute()
      ).map((f) => f.key);
    }
  }
  const header = [...cols, ...(keys ? keys.map((k) => `answer.${k}`) : ['answers'])];
  const text = (v: unknown): string => {
    if (v === undefined || v === null) return '';
    if (Array.isArray(v)) return v.map(text).join('; ');
    if (v instanceof Date) return v.toISOString();
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
    return JSON.stringify(v);
  };
  const cell = (v: unknown) => {
    let s = text(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const lines = [header.join(',')];
  for (const r of rows) {
    const a = (r.answers ?? {}) as Record<string, unknown>;
    lines.push(
      [
        r.public_ref,
        r.received_at,
        r.logbook_slug,
        r.filed_via,
        r.intake_method,
        r.collected_on ? r.collected_on.slice(0, 10) : '',
        r.corrects_id !== null ? 'yes' : 'no',
        r.chain_hash,
        ...(keys ? keys.map((k) => a[k]) : [r.answers ? JSON.stringify(r.answers) : '']),
      ]
        .map(cell)
        .join(','),
    );
  }
  return lines.join('\n') + '\n';
}

/** For stats and figures: one row per thread, with whether it is public. */
export async function everyHead(db: Kysely<DB>) {
  return db
    .selectFrom('report_heads as h')
    .innerJoin('reports as r', 'r.id', 'h.current_report_id')
    .select((eb) => [
      'h.thread_id',
      'h.withdrawn',
      'h.moderation_status',
      'r.may_publish',
      'r.logbook_id',
      'r.answers',
      eb
        .selectFrom('reports as x')
        .whereRef('x.thread_id', '=', 'h.thread_id')
        .select((e) => e.fn.min('x.received_at').as('t'))
        .as('first_filed_at'),
    ])
    .execute();
}

export { isPublic };
