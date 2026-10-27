/**
 * The journalist desk (J8 to J12, M5).
 *
 * WHO. A vetted journalist (the `journalist` role, which only the owner
 * grants) who has accepted the newest journalist agreement. Unlike the
 * moderator agreement, NO TEXT MEANS NO DESK: J8 says the agreement is
 * accepted before anything is shown, so until the owner publishes one the
 * desk is closed. Staff do not use the desk; they have their own screens.
 *
 * WHAT. Three read-only lists, a fixed page at a time (J11: no export, no
 * page size to ask for, nothing else to list):
 *   - checked links, one entry per link group, from `checkedLinks` and
 *     nothing else in links/ (so an unchecked, withheld or illegal link can
 *     never come out), with how many tips carried it, the moderator's
 *     comment for journalists, and the tips' answers to the questions
 *     whose answers come from a fixed list: choices, a location (named,
 *     state and county, never a bare code) and a date (owner decision 45);
 *   - moderators' Sources links and notes on PUBLISHED reports (owner
 *     decision 37: staff and vetted journalists only).
 *
 * WHAT NEVER (J10, as amended by owner decision D7). No email, no entry id,
 * no moderator's address, no other moderator note, nothing from the erasable
 * half of an entry EXCEPT the note a moderator wrote (below), no withheld
 * or unchecked item, and nothing from a report whose reporter does not allow
 * journalists to read it. Each is left out by what is SELECTED, not filtered
 * afterwards, so a new column cannot leak by default.
 *
 * WHAT NOW (W5, N3). Written accounts: only a NOTE a moderator wrote from a
 * report's text or a tip's description, only while the reporter's
 * `journalist_sharing` is granted. The reporter's own words are never passed
 * on, only quoted by the moderator inside the note. Report links join the checked links through `checkedLinks`,
 * under the same condition. Revoking, withdrawing or correcting takes them off
 * at once (reportValues/onDesk.ts; the permission is read live).
 *
 * J12. Every link group and every report a page shows is written to the
 * staff access log BEFORE anything is decrypted, in the same request, so an
 * unlogged look is impossible: if the insert fails, nothing is shown.
 */
import { DESK_PAGE_SIZE } from '@reportlog/contracts';
import { describeAnswer, placeLabel } from '@reportlog/fields';
import type { FieldSettings } from '@reportlog/fields';
import type { DeskLink, DeskReport, DeskText } from '@reportlog/contracts';
import type { FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import { sql } from 'kysely';
import type { Kysely } from 'kysely';
import { publishedReportIds } from '../board/published.ts';
import type { DB } from '../db/schema.gen.ts';
import { HttpError } from '../http/errors.ts';
import { requireRole } from '../identity/guards.ts';
import type { LinkKeys } from '../links/keys.ts';
import { checkedLinks } from '../links/reads.ts';
import { agreementRequired, hasAccepted, newestText } from '../moderation/agreement.ts';
import { clearedTexts, readCleared } from '../moderation/texts/clearance.ts';
import { sharedHeldValues } from '../reportValues/onDesk.ts';

/**
 * The kinds whose answers come from a fixed list, so none can carry somebody's
 * own words (J10): the operator's choices, a gazetteer code, a calendar date.
 */
const CONTEXT_KINDS = ['choice_one', 'choice_many', 'location', 'date'] as const;

/**
 * An answer as a journalist reads it: a choice by its label, a place by name,
 * a date in words. Never a code.
 */
function shown(kind: string, v: string, settings: FieldSettings): string {
  if (kind === 'location' || kind === 'choice_one' || kind === 'choice_many')
    return describeAnswer({ kind, settings }, v) || placeLabel(v);
  if (kind === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    return new Date(`${v}T00:00:00Z`).toLocaleDateString('en-US', {
      timeZone: 'UTC',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  }
  return v;
}

export const deskClosed = () =>
  new HttpError(
    403,
    'desk_closed',
    'The desk opens once the owner has published the journalist agreement.',
  );

export const accessEnded = () =>
  new HttpError(
    403,
    'desk_access_ended',
    'Your journalist access has ended. To read the desk again, join the alert list and ask for access.',
  );

/**
 * The desk scope's guard: the role, an approved request behind it, then the
 * agreement. Checked on every request (J13).
 *
 * THE APPROVED REQUEST IS A SECOND LINE (owner decision 46). Leaving the
 * alert list ends the role (`removeSubscribers`) and deletes the request
 * with the subscriber row; if a role were ever left behind without one, by a
 * path that forgot, this still refuses it.
 */
export function deskGuard(db: Kysely<DB>): preHandlerAsyncHookHandler {
  return async (request: FastifyRequest) => {
    const user = requireRole(request, ['journalist']);
    const approved = await db
      .selectFrom('journalist_access_requests as q')
      .innerJoin('users as u', 'u.id', 'q.user_id')
      .select('q.id')
      .where('u.email', '=', user.email)
      .where('q.status', '=', 'approved')
      .executeTakeFirst();
    if (!approved) throw accessEnded();
    if (!(await newestText(db, 'journalist'))) throw deskClosed();
    if (!(await hasAccepted(db, 'journalist', user.email))) throw agreementRequired('journalist');
  };
}

/**
 * The two ways to narrow a desk list, and the only two (decision 72): words
 * to find, and the journalist's own alert states.
 */
export interface DeskFilter {
  q?: string | undefined;
  /** Their alert states when "My states" is on. An item whose state cannot be derived is left out. */
  states?: readonly string[] | undefined;
}

/** A LIKE pattern for the words as typed: % and _ mean themselves. */
const likeOf = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/**
 * The state a location answer rolls up to, in SQL: the same rule as the
 * alert job's (journalists/alerts.ts), with the answers and field given.
 * A question written as bare FIPS has no state of its own, so it gives NULL.
 */
const stateOfAnswer = (answers: ReturnType<typeof sql.ref>, key: ReturnType<typeof sql.ref>) =>
  sql<string | null>`CASE f.settings ->> 'code'
    WHEN 'postal' THEN 'US-' || (${answers} ->> ${key})
    WHEN 'fips' THEN NULL
    ELSE regexp_replace(${answers} ->> ${key}, '-[0-9]{5}$', '') END`;

const pageOf = (raw: number | undefined) => Math.max(1, Math.floor(raw ?? 1));
const pagesOf = (total: number) => Math.max(1, Math.ceil(total / DESK_PAGE_SIZE));

export async function deskLinkPage(
  db: Kysely<DB>,
  keys: LinkKeys,
  reader: string,
  rawPage: number | undefined,
  filter: DeskFilter = {},
): Promise<{ page: number; pages: number; links: DeskLink[] }> {
  const page = pageOf(rawPage);
  const states = filter.states;
  // A group is on the desk when it is checked AND somebody the desk may show
  // carries it: a tip, or a report whose reporter allows journalists to read
  // its links (W5). A report that did not share does not make a group appear,
  // however the group was checked.
  let checked = db
    .selectFrom('link_groups as g')
    .where('g.outcome', '=', 'checked')
    .where((eb) =>
      eb.or([
        eb.exists(eb.selectFrom('links as l').select('l.id').whereRef('l.group_id', '=', 'g.id')),
        eb.exists(
          sharedHeldValues(db)
            .select('rv.id')
            .where('rv.kind', '=', 'private_link')
            .where(sql<boolean>`rv.group_id = g.id`),
        ),
      ]),
    );
  if (states) {
    // A tip's state is its list's location answer rolled up to the state; a
    // report's is its logbook's.
    checked = checked.where((eb) =>
      eb.or([
        eb.exists(
          eb
            .selectFrom('links as sl')
            .innerJoin('list_entries as e', 'e.id', 'sl.entry_id')
            .innerJoin('list_fields as f', (j) =>
              j.onRef('f.list_id', '=', 'e.list_id').on('f.kind', '=', 'location'),
            )
            .select('sl.id')
            .whereRef('sl.group_id', '=', 'g.id')
            .where(
              sql<boolean>`${stateOfAnswer(sql.ref('e.answers'), sql.ref('f.key'))} = any(${[...states]}::text[])`,
            ),
        ),
        eb.exists(
          sharedHeldValues(db)
            .innerJoin('logbook_fields as f', (j) =>
              j.onRef('f.logbook_id', '=', 'r.logbook_id').on('f.kind', '=', 'location'),
            )
            .select('rv.id')
            .where('rv.kind', '=', 'private_link')
            .where(sql<boolean>`rv.group_id = g.id`)
            .where(
              sql<boolean>`${stateOfAnswer(sql.ref('r.answers'), sql.ref('f.key'))} = any(${[...states]}::text[])`,
            ),
        ),
      ]),
    );
  }
  const words = filter.q?.trim().toLowerCase();
  let ids: number[];
  let total: number;
  if (words) {
    // The address is sealed in the database, so words in it can only be found
    // by opening the candidates here, in the server. Nothing is sent to the
    // reader but the groups that match, and those are logged below before
    // they go, as on any page.
    const all = (
      await checked.select('g.id').orderBy('g.checked_at', 'desc').orderBy('g.id', 'desc').execute()
    ).map((r) => r.id);
    const open = await checkedLinks(db, keys, { groupIds: all });
    const hits = new Set(
      open
        .filter(
          (g) =>
            g.url.toLowerCase().includes(words) || (g.comment ?? '').toLowerCase().includes(words),
        )
        .map((g) => g.group_id),
    );
    const found = all.filter((id) => hits.has(id));
    total = found.length;
    ids = found.slice((page - 1) * DESK_PAGE_SIZE, page * DESK_PAGE_SIZE);
  } else {
    const { n } = await checked
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .executeTakeFirstOrThrow();
    total = Number(n);
    ids = (
      await checked
        .select('g.id')
        .orderBy('g.checked_at', 'desc')
        .orderBy('g.id', 'desc')
        .offset((page - 1) * DESK_PAGE_SIZE)
        .limit(DESK_PAGE_SIZE)
        .execute()
    ).map((r) => r.id);
  }
  const pages = pagesOf(total);
  if (!ids.length) return { page, pages, links: [] };

  await db
    .insertInto('contact_access_log')
    .values(ids.map((id) => ({ staff_email: reader, kind: 'desk_link', link_group_id: id })))
    .execute();

  const groups = await checkedLinks(db, keys, { groupIds: ids });
  const context = await choiceContext(db, [...new Set(groups.flatMap((g) => g.entry_ids))]);
  const reportCtx = await reportContext(db, [...new Set(groups.flatMap((g) => g.report_ids))]);
  const kinds = await linkKinds(
    db,
    groups.flatMap((g) => g.types),
  );
  const byId = new Map(groups.map((g) => [g.group_id, g]));
  const links = ids.flatMap((id) => {
    const g = byId.get(id);
    if (!g) return [];
    return [
      {
        url: g.url,
        tips: g.entry_ids.length,
        reports: g.report_ids.length,
        comment: g.comment,
        checked_at: g.checked_at,
        context: summarize([
          ...g.entry_ids.map((e) => [
            // THE KIND OF LINK EACH TIP SAID IT IS, first, beside the link (J9).
            ...kinds(g.types.filter((t) => t.entry_id === e)),
            ...(context.get(e) ?? []),
          ]),
          // A report's fixed-list answers, the same way: choices, place, date.
          ...g.report_ids.map((r) => reportCtx.get(r) ?? []),
        ]),
      },
    ];
  });
  return { page, pages, links };
}

/**
 * A report's answers to its logbook's fixed-list questions, by report.
 * Reads `answers` and the questions' kinds; never a held value, an email, or
 * any question that takes the reporter's own words.
 */
async function reportContext(
  db: Kysely<DB>,
  reportIds: number[],
): Promise<Map<number, Answered[]>> {
  const out = new Map<number, Answered[]>();
  if (!reportIds.length) return out;
  const rows = await db
    .selectFrom('reports')
    .select(['id', 'logbook_id', 'answers'])
    .where('id', 'in', reportIds)
    .execute();
  const fields = await db
    .selectFrom('logbook_fields')
    .select(['logbook_id', 'key', 'kind', 'label', 'position', 'settings'])
    .where('logbook_id', 'in', [...new Set(rows.map((r) => r.logbook_id))])
    .where('kind', 'in', CONTEXT_KINDS)
    .orderBy('position')
    .execute();
  for (const r of rows) {
    const answers = (r.answers ?? {}) as Record<string, unknown>;
    const mine: Answered[] = [];
    for (const f of fields) {
      if (f.logbook_id !== r.logbook_id) continue;
      const v = answers[f.key];
      const values = (Array.isArray(v) ? v : [v])
        .filter((x): x is string => typeof x === 'string')
        .map((x) => shown(f.kind, x, f.settings as FieldSettings));
      if (values.length) mine.push({ question: f.label, answers: values });
    }
    out.set(r.id, mine);
  }
  return out;
}

interface Answered {
  question: string;
  answers: string[];
}

/**
 * Each tip's answers to its list's fixed-list questions, by entry.
 * Reads `answers` (the durable half) and the questions' kinds; never the
 * erasable half, the email or any other kind of question.
 */
async function choiceContext(db: Kysely<DB>, entryIds: number[]): Promise<Map<number, Answered[]>> {
  const out = new Map<number, Answered[]>();
  if (!entryIds.length) return out;
  const entries = await db
    .selectFrom('list_entries')
    .select(['id', 'list_id', 'answers'])
    .where('id', 'in', entryIds)
    .execute();
  const listIds = [...new Set(entries.map((e) => e.list_id))];
  const fields = await db
    .selectFrom('list_fields')
    .select(['list_id', 'key', 'kind', 'label', 'position', 'settings'])
    .where('list_id', 'in', listIds)
    .where('kind', 'in', CONTEXT_KINDS)
    .orderBy('position')
    .execute();
  for (const e of entries) {
    const answers = (e.answers ?? {}) as Record<string, unknown>;
    const mine: Answered[] = [];
    for (const f of fields) {
      if (f.list_id !== e.list_id) continue;
      const v = answers[f.key];
      const values = (Array.isArray(v) ? v : [v])
        .filter((x): x is string => typeof x === 'string')
        .map((x) => shown(f.kind, x, f.settings as FieldSettings));
      if (values.length) mine.push({ question: f.label, answers: values });
    }
    out.set(e.id, mine);
  }
  return out;
}

/**
 * The words for the kinds of link a group's copies were given, as one
 * question named for the link question's own kinds. A code its list no
 * longer names is shown as the code rather than hidden.
 */
async function linkKinds(
  db: Kysely<DB>,
  types: readonly { entry_id: number; field_key: string; type: string }[],
): Promise<(t: readonly { entry_id: number; field_key: string; type: string }[]) => Answered[]> {
  if (!types.length) return () => [];
  const entries = await db
    .selectFrom('list_entries as e')
    .innerJoin('list_fields as f', 'f.list_id', 'e.list_id')
    .select(['e.id', 'f.key', 'f.settings'])
    .where('e.id', 'in', [...new Set(types.map((t) => t.entry_id))])
    .where('f.kind', '=', 'url')
    .execute();
  const labelOf = (t: { entry_id: number; field_key: string; type: string }) => {
    const f = entries.find((x) => x.id === t.entry_id && x.key === t.field_key);
    const list = (f?.settings as FieldSettings | undefined)?.link_types ?? [];
    return list.find((o) => o.code === t.type)?.label ?? t.type;
  };
  return (mine) => (mine.length ? [{ question: 'Kind of link', answers: mine.map(labelOf) }] : []);
}

/** Per question, each answer and how many of the link's tips gave it. */
function summarize(perTip: Answered[][]): DeskLink['context'] {
  const questions = new Map<string, Map<string, number>>();
  for (const tip of perTip) {
    for (const { question, answers } of tip) {
      const counts = questions.get(question) ?? new Map<string, number>();
      for (const a of new Set(answers)) counts.set(a, (counts.get(a) ?? 0) + 1);
      questions.set(question, counts);
    }
  }
  return [...questions].map(([question, counts]) => ({
    question,
    answers: [...counts]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([answer, tips]) => ({ answer, tips })),
  }));
}

/**
 * Written accounts (W5, D7): report text and tip descriptions a moderator
 * wrote a note for, shown only while they remain cleared (moderation/texts/clearance.ts
 * reads the reporter's permission live). A page of ids is chosen from what
 * decrypts nothing; the page is written to the access log; only then is any
 * of it decrypted. A search has to open its candidates first, as the link
 * search does, and logs only what it then shows.
 *
 * WHAT THE JOURNALIST GETS: the moderator's note (never the original), a
 * report's public reference and a place. Not an email, not a thread or entry
 * id, not who wrote the note.
 */
export async function deskTextPage(
  db: Kysely<DB>,
  keys: LinkKeys,
  reader: string,
  rawPage: number | undefined,
  filter: DeskFilter = {},
): Promise<{ page: number; pages: number; texts: DeskText[] }> {
  const page = pageOf(rawPage);
  let cleared = await clearedTexts(db);
  if (filter.states) {
    const mine = new Set(filter.states);
    cleared = cleared.filter((c) => c.state !== null && mine.has(c.state));
  }
  const words = filter.q?.trim().toLowerCase();
  let reads: Awaited<ReturnType<typeof readCleared>> | undefined;
  if (words) {
    reads = await readCleared(db, keys, cleared);
    cleared = cleared.filter((c) => {
      const r = reads?.get(c.itemId);
      return (
        r !== undefined &&
        (r.text.toLowerCase().includes(words) || (c.reference ?? '').toLowerCase().includes(words))
      );
    });
  }
  const pages = pagesOf(cleared.length);
  const shown = cleared.slice((page - 1) * DESK_PAGE_SIZE, page * DESK_PAGE_SIZE);
  if (!shown.length) return { page, pages, texts: [] };

  await db
    .insertInto('contact_access_log')
    .values(
      shown.map((c) =>
        c.source === 'report'
          ? {
              staff_email: reader,
              kind: 'desk_text',
              thread_id: c.threadId,
              report_id: c.reportId,
              text_item_id: c.itemId,
            }
          : { staff_email: reader, kind: 'desk_tip_text', text_item_id: c.itemId },
      ),
    )
    .execute();

  const opened = reads ?? (await readCleared(db, keys, shown));
  return {
    page,
    pages,
    texts: shown.flatMap((c) => {
      const r = opened.get(c.itemId);
      if (!r) return [];
      return [
        {
          text: r.text,
          reference: c.reference,
          place: r.place,
          outcome: c.outcome,
          source: c.source,
          checked_at: c.checkedAt,
        },
      ];
    }),
  };
}

/** Published reports with live Sources links, and the published note beside them. */
export async function deskSourcePage(
  db: Kysely<DB>,
  reader: string,
  rawPage: number | undefined,
  filter: DeskFilter = {},
): Promise<{ page: number; pages: number; reports: DeskReport[] }> {
  const page = pageOf(rawPage);
  const states = filter.states;
  const words = filter.q?.trim();
  let withSources = db
    .selectFrom('editorial_notes as n')
    .innerJoin('report_heads as h', 'h.thread_id', 'n.thread_id')
    .where('h.current_report_id', 'in', publishedReportIds(db))
    .where((eb) =>
      eb.exists(
        eb
          .selectFrom('editorial_note_links as x')
          .select('x.id')
          .whereRef('x.note_id', '=', 'n.id')
          .where('x.removed_at', 'is', null),
      ),
    );
  if (words) {
    const like = likeOf(words);
    // The note's newest wording counts only while it is published: the desk
    // shows nothing of one under review or withdrawn, so it cannot be found by it.
    withSources = withSources.where((eb) =>
      eb.or([
        eb.exists(
          eb
            .selectFrom('editorial_note_links as x')
            .select('x.id')
            .whereRef('x.note_id', '=', 'n.id')
            .where('x.removed_at', 'is', null)
            .where(
              sql<boolean>`(x.title ILIKE ${like} OR x.url ILIKE ${like} OR x.publisher ILIKE ${like})`,
            ),
        ),
        sql<boolean>`(n.state = 'published' AND (SELECT v.body FROM editorial_note_versions v
          WHERE v.note_id = n.id ORDER BY v.id DESC LIMIT 1) ILIKE ${like})`,
      ]),
    );
  }
  if (states) {
    withSources = withSources.where((eb) =>
      eb.exists(
        eb
          .selectFrom('reports as sr')
          .innerJoin('logbook_fields as f', (j) =>
            j.onRef('f.logbook_id', '=', 'sr.logbook_id').on('f.kind', '=', 'location'),
          )
          .select('sr.id')
          .whereRef('sr.id', '=', 'h.current_report_id')
          .where(
            sql<boolean>`${stateOfAnswer(sql.ref('sr.answers'), sql.ref('f.key'))} = any(${[...states]}::text[])`,
          ),
      ),
    );
  }
  const { n } = await withSources
    .select((eb) => eb.fn.countAll<string>().as('n'))
    .executeTakeFirstOrThrow();
  const rows = await withSources
    .innerJoin('reports as r', 'r.id', 'h.current_report_id')
    .select(['n.id as note_id', 'n.state', 'n.thread_id', 'h.current_report_id', 'r.public_ref'])
    .orderBy('n.updated_at', 'desc')
    .orderBy('n.id', 'desc')
    .offset((page - 1) * DESK_PAGE_SIZE)
    .limit(DESK_PAGE_SIZE)
    .execute();
  const pages = pagesOf(Number(n));
  if (!rows.length) return { page, pages, reports: [] };

  await db
    .insertInto('contact_access_log')
    .values(
      rows.map((r) => ({
        staff_email: reader,
        kind: 'desk_report',
        thread_id: r.thread_id,
        report_id: r.current_report_id,
      })),
    )
    .execute();

  const noteIds = rows.map((r) => r.note_id);
  // Neither query selects an author's or a moderator's address.
  const bodies = await db
    .selectFrom('editorial_note_versions')
    .distinctOn('note_id')
    .select(['note_id', 'body'])
    .where('note_id', 'in', noteIds)
    .orderBy('note_id')
    .orderBy('id', 'desc')
    .execute();
  const sources = await db
    .selectFrom('editorial_note_links')
    .select(['note_id', 'title', 'publisher', 'published_on', 'url'])
    .where('note_id', 'in', noteIds)
    .where('removed_at', 'is', null)
    .orderBy('id')
    .execute();
  const body = new Map(bodies.map((b) => [b.note_id, b.body]));
  return {
    page,
    pages,
    reports: rows.map((r) => ({
      reference: r.public_ref,
      // A note under review or withdrawn is not shown, as on the board.
      note: r.state === 'published' ? (body.get(r.note_id) ?? null) : null,
      sources: sources
        .filter((s) => s.note_id === r.note_id)
        .map((s) => ({
          title: s.title,
          publisher: s.publisher,
          published_on: s.published_on ? toDay(s.published_on) : null,
          url: s.url,
        })),
    })),
  };
}

const toDay = (d: Date | string) =>
  typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10);
