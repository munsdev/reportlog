/**
 * The journalist desk (J8 to J12, M5).
 *
 * WHO. A vetted journalist (the `journalist` role, which only the owner
 * grants) who has accepted the newest journalist agreement. Unlike the
 * moderator agreement, NO TEXT MEANS NO DESK: J8 says the agreement is
 * accepted before anything is shown, so until the owner publishes one the
 * desk is closed. Staff do not use the desk; they have their own screens.
 *
 * WHAT. Two read-only lists, a fixed page at a time (J11: no export, no
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
 * WHAT NEVER (J10). No email, no tip comment or any other free-text answer,
 * no entry id, no moderator's address, no other moderator note, nothing
 * from the erasable half of an entry. Each is left out by what is SELECTED,
 * not filtered afterwards, so a new column cannot leak by default.
 *
 * J12. Every link group and every report a page shows is written to the
 * staff access log BEFORE anything is decrypted, in the same request, so an
 * unlogged look is impossible: if the insert fails, nothing is shown.
 */
import { DESK_PAGE_SIZE } from '@reportlog/contracts';
import { placeLabel } from '@reportlog/fields';
import type { DeskLink, DeskReport } from '@reportlog/contracts';
import type { FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import type { Kysely } from 'kysely';
import { publishedReportIds } from '../board/published.ts';
import type { DB } from '../db/schema.gen.ts';
import { HttpError } from '../http/errors.ts';
import { requireRole } from '../identity/guards.ts';
import type { LinkKeys } from '../links/keys.ts';
import { checkedLinks } from '../links/reads.ts';
import { agreementRequired, hasAccepted, newestText } from '../moderation/agreement.ts';

/**
 * The kinds whose answers come from a fixed list, so none can carry somebody's
 * own words (J10): the operator's choices, a gazetteer code, a calendar date.
 */
const CONTEXT_KINDS = ['choice_one', 'choice_many', 'location', 'date'] as const;

/** An answer as a journalist reads it: a place by name, a date in words. */
function shown(kind: string, v: string): string {
  if (kind === 'location') return placeLabel(v);
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

const pageOf = (raw: number | undefined) => Math.max(1, Math.floor(raw ?? 1));
const pagesOf = (total: number) => Math.max(1, Math.ceil(total / DESK_PAGE_SIZE));

export async function deskLinkPage(
  db: Kysely<DB>,
  keys: LinkKeys,
  reader: string,
  rawPage: number | undefined,
): Promise<{ page: number; pages: number; links: DeskLink[] }> {
  const page = pageOf(rawPage);
  const checked = db
    .selectFrom('link_groups as g')
    .where('g.outcome', '=', 'checked')
    .where((eb) =>
      eb.exists(eb.selectFrom('links as l').select('l.id').whereRef('l.group_id', '=', 'g.id')),
    );
  const { n } = await checked
    .select((eb) => eb.fn.countAll<string>().as('n'))
    .executeTakeFirstOrThrow();
  const ids = (
    await checked
      .select('g.id')
      .orderBy('g.checked_at', 'desc')
      .orderBy('g.id', 'desc')
      .offset((page - 1) * DESK_PAGE_SIZE)
      .limit(DESK_PAGE_SIZE)
      .execute()
  ).map((r) => r.id);
  const pages = pagesOf(Number(n));
  if (!ids.length) return { page, pages, links: [] };

  await db
    .insertInto('contact_access_log')
    .values(ids.map((id) => ({ staff_email: reader, kind: 'desk_link', link_group_id: id })))
    .execute();

  const groups = await checkedLinks(db, keys, { groupIds: ids });
  const context = await choiceContext(db, [...new Set(groups.flatMap((g) => g.entry_ids))]);
  const byId = new Map(groups.map((g) => [g.group_id, g]));
  const links = ids.flatMap((id) => {
    const g = byId.get(id);
    if (!g) return [];
    return [
      {
        url: g.url,
        tips: g.entry_ids.length,
        comment: g.comment,
        checked_at: g.checked_at,
        context: summarize(g.entry_ids.map((e) => context.get(e) ?? [])),
      },
    ];
  });
  return { page, pages, links };
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
    .select(['list_id', 'key', 'kind', 'label', 'position'])
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
        .map((x) => shown(f.kind, x));
      if (values.length) mine.push({ question: f.label, answers: values });
    }
    out.set(e.id, mine);
  }
  return out;
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

/** Published reports with live Sources links, and the published note beside them. */
export async function deskSourcePage(
  db: Kysely<DB>,
  reader: string,
  rawPage: number | undefined,
): Promise<{ page: number; pages: number; reports: DeskReport[] }> {
  const page = pageOf(rawPage);
  const withSources = db
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
