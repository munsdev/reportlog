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
import { publicNoteFor, publicNotesForMany } from '../moderation/notes.ts';
import type { PublicNote } from '../moderation/notes.ts';
import { countsOnlyLogbooks } from '../moderation/switches.ts';
import { originLabels, originOf } from './origin.ts';
import type { Origin } from './origin.ts';
import { placeGuards, withheldReason } from './places.ts';
import { publicArchiveAvailable } from './publication.ts';
import { isPublic, listedReportIds } from './published.ts';
import {
  ANSWER_KEY,
  answerMatches,
  normalizeSearch,
  searchMatches,
  sortDirection,
} from './search.ts';

export const PAGE_SIZE = 100;
const MAX_ANSWER_FILTERS = 10;

/**
 * Published reports, joined the way every board read reads them. LISTED ones
 * only: a counts-only logbook's reports are on the numbers, never here.
 */
export function published(db: Kysely<DB>) {
  return db
    .selectFrom('report_heads as h')
    .innerJoin('reports as r', 'r.id', 'h.current_report_id')
    .innerJoin('logbooks as l', 'l.id', 'r.logbook_id')
    .where('r.id', 'in', listedReportIds(db));
}

type Published = ReturnType<typeof published>;

function columns(q: Published) {
  return q.select([
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
  editorial_note?: PublicNote;
  origin: Origin;
  label: string;
}

const iso = (d: Date) => d.toISOString();

function present(
  r: Row,
  note: PublicNote | undefined,
  labels: Record<Origin, string>,
): PublicReport {
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
    ...(note ? { editorial_note: note } : {}),
    // Beside every entry, so a reader never has to work out which kind of
    // account they are looking at (Plan E).
    origin: originOf(r),
    label: labels[originOf(r)],
  };
}

export interface BoardQuery {
  q?: string | undefined;
  logbook?: string | undefined;
  sort?: 'newest' | 'oldest' | undefined;
  page?: number | undefined;
  /** Question key → answer, only for questions an operator marked as filters. */
  answers?: Record<string, string> | undefined;
  /**
   * Place codes (`US-AZ`) the report must be in. NOT a public filter: only the
   * journalist reports list sets it, from the signed-in journalist's own
   * alert states (decision 72, 81), never from a request.
   */
  states?: readonly string[] | undefined;
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

/**
 * In one of these states, by any location question the report's logbook asks
 * (a county rolls up to its state; a bare FIPS has no state of its own, so it
 * is left out). The same rule as the alert job's and the desk's.
 */
function inStates(states: readonly string[]): RawBuilder<boolean> {
  return sql<boolean>`EXISTS (
    SELECT 1 FROM logbook_fields f
    WHERE f.logbook_id = r.logbook_id AND f.kind = 'location'
      AND (CASE f.settings ->> 'code'
        WHEN 'postal' THEN 'US-' || (r.answers ->> f.key)
        WHEN 'fips' THEN NULL
        ELSE regexp_replace(r.answers ->> f.key, '-[0-9]{5}$', '') END) = ANY(${[...states]}::text[])
  )`;
}

/** Every narrowing the board allows, as one condition. */
function narrowing(query: BoardQuery, answers: [string, string][]): RawBuilder<boolean> {
  const parts: RawBuilder<boolean>[] = [sql<boolean>`true`];
  const search = normalizeSearch(query.q);
  if (search) parts.push(searchMatches(search));
  if (query.logbook) parts.push(sql<boolean>`l.slug = ${query.logbook}`);
  for (const [key, value] of answers) parts.push(answerMatches(key, value));
  if (query.states) parts.push(inStates(query.states));
  return sql<boolean>`(${sql.join(parts, sql` AND `)})`;
}

export type BoardPage =
  | { published: true; reports: PublicReport[]; total: number; page: number; page_size: number }
  | { published: true; withheld: true; threshold: number; reason: string }
  | { published: false; reason: string };

/**
 * The threshold to keep, when this narrowing names a place question a heat
 * map reads (board/places.ts), or null. Only an answer filter on that
 * question counts: a board narrowed by anything else is not "one place".
 */
async function placeThreshold(
  db: Kysely<DB>,
  query: BoardQuery,
  answers: [string, string][],
): Promise<number | null> {
  // NARROWED BY STATE IS NARROWED BY PLACE. A journalist's "My states" must not
  // hand over the count a heat map withholds for a thin area, so the highest
  // threshold any map keeps applies to it, whichever logbook it falls in.
  if (query.states) {
    const thresholds = [...(await placeGuards(db)).values()].map((g) => g.threshold);
    return thresholds.length ? Math.max(...thresholds) : null;
  }
  if (!answers.length || !query.logbook) return null;
  const lb = await logbookBySlug(db, query.logbook);
  if (!lb) return null;
  const guard = (await placeGuards(db)).get(lb.id);
  return guard && answers.some(([k]) => k === guard.key) ? guard.threshold : null;
}

/**
 * How many published reports this narrowing matches, unless it is one place
 * with fewer than the map's threshold: then null, and the caller sends
 * neither the reports nor the count. Zero is not withheld: the map says
 * "none counted" for an empty area too.
 */
async function countUnlessThin(
  db: Kysely<DB>,
  query: BoardQuery,
  answers: [string, string][],
): Promise<{ total: number } | { withheld: number }> {
  const counted = await published(db)
    .where(narrowing(query, answers))
    .select((eb) => eb.fn.countAll<string>().as('n'))
    .executeTakeFirst();
  const total = Number(counted?.n ?? 0);
  const threshold = total > 0 ? await placeThreshold(db, query, answers) : null;
  return threshold !== null && total < threshold ? { withheld: threshold } : { total };
}

/** The board: a page of published reports, newest first unless asked otherwise. */
export async function boardPage(db: Kysely<DB>, query: BoardQuery): Promise<BoardPage> {
  if (!(await publicArchiveAvailable(db))) return { ...OFF };
  const answers = await answerFilters(db, query);
  // COUNTED FIRST, so a thin place sends nothing at all: not the reports, whose
  // number is the count, and not the total.
  const counted = await countUnlessThin(db, query, answers);
  if ('withheld' in counted) {
    return {
      published: true,
      withheld: true,
      threshold: counted.withheld,
      reason: withheldReason(counted.withheld),
    };
  }
  const page = Math.max(1, Math.trunc(query.page ?? 1));
  const dir = sortDirection(query.sort);
  const rows = await columns(published(db))
    .where(narrowing(query, answers))
    .orderBy('r.received_at', dir)
    .orderBy('r.id', dir)
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE)
    .execute();
  const notes = await publicNotesForMany(
    db,
    rows.map((r) => r.thread_id),
  );
  const labels = await originLabels(db);
  return {
    published: true,
    reports: rows.map((r) => present(r, notes.get(r.thread_id), labels)),
    total: counted.total,
    page,
    page_size: PAGE_SIZE,
  };
}

const OFF = { published: false as const, reason: 'This site does not publish a public archive.' };

export type OneReport =
  { published: true; report: PublicReport } | { published: false; reason: string };

/** One published report. Anything else, in any state, is "not found". */
export async function boardReport(db: Kysely<DB>, publicRef: string): Promise<OneReport | null> {
  if (!(await publicArchiveAvailable(db))) return { ...OFF };
  const row = await columns(published(db)).where('r.public_ref', '=', publicRef).executeTakeFirst();
  if (!row) return null;
  const note = (await publicNoteFor(db, row.thread_id)) ?? undefined;
  // No source links here (decision 37): they are for staff and vetted journalists.
  return { published: true, report: present(row, note, await originLabels(db)) };
}

/** Every logbook a report could have been filed to, with ONLY its operator's filters. */
export async function boardLogbooks(db: Kysely<DB>): Promise<
  {
    slug: string;
    title: string;
    blurb: string | null;
    filters: FormQuestion[];
    counts_only: boolean;
  }[]
> {
  const out = [];
  const countsOnly = await countsOnlyLogbooks(db);
  for (const lb of await launchedLogbooks(db)) {
    out.push({
      slug: lb.slug,
      title: lb.title,
      blurb: lb.blurb,
      filters: (await filterableFields(db, lb.id)).map(forForm),
      counts_only: countsOnly.has(lb.id),
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
  // A thin place is withheld here as on the board: the header and no rows,
  // which says nothing about how many there are.
  const thin = 'withheld' in (await countUnlessThin(db, query, answers));
  const rows = thin
    ? []
    : await columns(published(db))
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
    // Where it came from, in the operator's words (Plan E): a spreadsheet is
    // where an entry most often loses its context.
    'origin',
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
  const labels = await originLabels(db);
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
        labels[originOf(r)],
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
