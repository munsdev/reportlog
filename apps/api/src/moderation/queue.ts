/**
 * The moderation queue and the decisions made in it.
 *
 * STATES live on report_heads, which filing creates as 'pending' and a
 * correction sets back to 'pending'. A moderator moves a report between
 * 'valid' (approved), 'invalid' (declined) and 'unknown' (unclear), always
 * with a reason, and can always revisit: nothing about it is final.
 *
 * NOTHING IS PUBLIC UNTIL A MODERATOR APPROVES IT. There is no other path to
 * 'valid' than `decide`, and there must never be one. Approval is the floor;
 * the reporter's sealed `may_publish` is the ceiling; the operator's archive
 * switch sits beside both (board/publication.ts).
 *
 * FILES ARE A SECOND DECISION, made per file in workstream F's
 * files/publication.ts, under the same ceiling (the reporter's permission).
 * A published file is shown only while its report's text is public, so the
 * text can be public without its files and never the reverse.
 *
 * Every decision is written to moderation_log in the same transaction as the
 * change, with the version it was about.
 */
import type { Kysely, Transaction } from 'kysely';
import { sql } from 'kysely';
import { publishedReportIds } from '../board/published.ts';
import { normalizeSearch, searchMatches, sortDirection } from '../board/search.ts';
import type { DB } from '../db/schema.gen.ts';
import { HttpError, notFound } from '../http/errors.ts';
import { permissionsForMany } from '../permissions/log.ts';
import type { Severity } from './assessment.ts';
import { clearFlag } from './flags.ts';
import { WRITTEN_SKIP_WHY, holdsUndecided, undecidedWritten } from './texts/approval.ts';

export const DECISIONS = ['valid', 'invalid', 'unknown'] as const;
export type Decision = (typeof DECISIONS)[number];
export const RESTORE_TO = ['pending', 'valid', 'invalid', 'unknown'] as const;
export const STATUS_FILTERS = [
  'all',
  'pending',
  'valid',
  'invalid',
  'unknown',
  'withdrawn',
] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

const refuse = (status: number, code: string, message: string) =>
  new HttpError(status, code, message);
const noReport = () => notFound('There is no report with that reference.');

/**
 * A moderator's note on a decision: optional (decision 64), but never
 * longer than the column holds. Empty is "no note", stored as null.
 */
function noteOf(comment: unknown): string | null {
  const why = typeof comment === 'string' ? comment.trim() : '';
  if (why.length > 2000)
    throw refuse(400, 'reason_too_long', 'Keep the note under 2000 characters.');
  return why || null;
}

function reasonOf(comment: unknown): string {
  const why = typeof comment === 'string' ? comment.trim() : '';
  if (!why) throw refuse(400, 'reason_required', 'Give a reason. It stays on the record.');
  if (why.length > 2000)
    throw refuse(400, 'reason_too_long', 'Keep the reason under 2000 characters.');
  return why;
}

export interface QueueFilter {
  status?: StatusFilter | undefined;
  q?: string | undefined;
  flagged?: boolean | undefined;
  logbook?: string | undefined;
  /** A rating, or `none` for the reports nobody has rated yet. */
  severity?: Severity | 'none' | undefined;
  sort?: 'newest' | 'oldest' | undefined;
  /** One thread, for its detail page. */
  threadId?: string | undefined;
  // ── Plan E (PE3): the flood filters ──
  /** Arrival of the current version, inclusive. */
  from?: Date | undefined;
  to?: Date | undefined;
  /** A state (`US-AZ`, its counties too) or a county, in any location answer. */
  place?: string | undefined;
  /** One identical answer set (`answerSet` below). */
  answerSet?: string | undefined;
  /** One organization's reports, as a set. */
  organization?: number | undefined;
  lane?: 'organization' | 'open_form' | undefined;
}

/**
 * Reports with the same answers in the same logbook share this. jsonb keeps
 * its keys in one order, so two copies of one submission give one text, and
 * so one hash, whatever order the client sent them in.
 */
export const answerSet = sql<string>`md5(r.logbook_id::text || ':' || coalesce(r.answers::text, ''))`;

/**
 * The organization a thread was filed for: its intake draft's batch. Read
 * over `h`, the queue's own alias for report_heads.
 */
export const organizationOf = sql<number | null>`(
  select ob.organization_id from intake_drafts od
    join intake_batches ob on ob.id = od.batch_id
    join reports ov on ov.id = od.report_id
   where ov.thread_id = h.thread_id
   limit 1)`;

/**
 * A place in any of the report's location answers. A state takes its
 * counties by prefix (owner decision 44); a county is only itself.
 */
function inPlace(place: string) {
  return sql<boolean>`exists (
    select 1 from logbook_fields pf
     where pf.logbook_id = r.logbook_id and pf.kind = 'location'
       and (r.answers ->> pf.key = ${place} or r.answers ->> pf.key like ${`${place}-%`}))`;
}

/**
 * The queue's rows and every filter but the status, shared by the list and
 * the status buttons' counts, so a count can never disagree with the list
 * its button shows.
 */
function filtered(db: Kysely<DB>, filter: QueueFilter) {
  let q = db
    .selectFrom('report_heads as h')
    .innerJoin('reports as r', 'r.id', 'h.current_report_id')
    .innerJoin('logbooks as l', 'l.id', 'r.logbook_id')
    .leftJoin('report_review_flags as f', 'f.report_id', 'h.current_report_id')
    .leftJoin('logbook_editorial_notes as en', 'en.logbook_id', 'l.id')
    .leftJoin('report_assessments as sev', 'sev.thread_id', 'h.thread_id');
  const search = normalizeSearch(filter.q);
  if (search) q = q.where(searchMatches(search));
  if (filter.flagged) q = q.where('f.id', 'is not', null).where('f.cleared_at', 'is', null);
  if (filter.logbook) q = q.where('l.slug', '=', filter.logbook);
  if (filter.severity === 'none') q = q.where('sev.severity', 'is', null);
  else if (filter.severity) q = q.where('sev.severity', '=', filter.severity);
  if (filter.threadId) q = q.where('h.thread_id', '=', filter.threadId);
  if (filter.from) q = q.where('r.received_at', '>=', filter.from);
  if (filter.to) q = q.where('r.received_at', '<=', filter.to);
  if (filter.place) q = q.where(inPlace(filter.place));
  if (filter.answerSet) q = q.where(sql<boolean>`${answerSet} = ${filter.answerSet}`);
  if (filter.organization) {
    q = q.where(sql<boolean>`${organizationOf} = ${filter.organization}`);
  }
  if (filter.lane === 'organization') q = q.where('r.third_party', 'is', true);
  if (filter.lane === 'open_form') q = q.where('r.third_party', 'is not', true);

  return q;
}

/** Where a report stands for the status buttons: withdrawn first, as the filter reads it. */
const standing = sql<string>`case when h.withdrawn then 'withdrawn' else h.moderation_status end`;

/**
 * How many reports each status button would show under the same filters.
 * `all` is the sum, as the list under All shows every one of them.
 */
export async function queueCounts(
  db: Kysely<DB>,
  filter: QueueFilter = {},
): Promise<Record<StatusFilter, number>> {
  const rows = await filtered(db, filter)
    .select([standing.as('standing'), sql<string>`count(*)`.as('n')])
    .groupBy(standing)
    .execute();
  const out: Record<StatusFilter, number> = {
    all: 0,
    pending: 0,
    valid: 0,
    invalid: 0,
    unknown: 0,
    withdrawn: 0,
  };
  for (const r of rows) {
    const n = Number(r.n);
    if ((STATUS_FILTERS as readonly string[]).includes(r.standing)) {
      out[r.standing as StatusFilter] += n;
    }
    out.all += n;
  }
  return out;
}

/**
 * The queue. A moderator's search spans every status, unlike the board's:
 * finding the pending and declined ones is the point. Contact details are
 * never here; they open one at a time, logged (accessLog.ts).
 *
 * One page at a time (`limit` and `offset`); without them, the first 500,
 * as before paging existed.
 */
export async function listQueue(
  db: Kysely<DB>,
  filter: QueueFilter = {},
  page: { limit: number; offset: number } = { limit: 500, offset: 0 },
) {
  let q = filtered(db, filter).select((eb) => [
    'h.thread_id',
    'h.moderation_status',
    'h.withdrawn',
    'h.updated_at',
    'r.id as report_id',
    'r.public_ref',
    'r.received_at',
    'r.answers',
    'r.may_publish',
    'r.third_party',
    'r.filed_via',
    'r.intake_method',
    'r.collected_on',
    'l.slug as logbook_slug',
    'l.title as logbook_title',
    'f.terms as flag_terms',
    'f.cleared_at as flag_cleared_at',
    sql<boolean>`coalesce(en.enabled, false)`.as('notes_enabled'),
    'sev.severity',
    'sev.incident_id',
    // Published accounts in its incident, itself included when public:
    // the one rule in board/published.ts, so it is the number a reader
    // could count on the board.
    eb
      .selectFrom('report_assessments as inc')
      .innerJoin('report_heads as ih', 'ih.thread_id', 'inc.thread_id')
      .whereRef('inc.incident_id', '=', 'sev.incident_id')
      .where('ih.current_report_id', 'in', publishedReportIds(db))
      .select((e) => e.fn.countAll<string>().as('n'))
      .as('corroboration'),
    eb
      .selectFrom('report_assessments as inc2')
      .whereRef('inc2.incident_id', '=', 'sev.incident_id')
      .select((e) => e.fn.countAll<string>().as('n'))
      .as('incident_size'),
    eb
      .exists(eb.selectFrom('editorial_notes as n').whereRef('n.thread_id', '=', 'h.thread_id'))
      .as('has_note'),
    eb
      .exists(
        eb
          .selectFrom('reporter_actions as ra')
          .whereRef('ra.thread_id', '=', 'h.thread_id')
          .where('ra.action', '=', 'withdraw'),
      )
      .as('reporter_withdrew'),
    eb
      .exists(eb.selectFrom('report_contacts as c').whereRef('c.thread_id', '=', 'h.thread_id'))
      .as('has_contact'),
    eb
      .selectFrom('report_attachments as ra2')
      .whereRef('ra2.report_id', '=', 'h.current_report_id')
      .select((e) => e.fn.countAll<string>().as('n'))
      .as('file_count'),
    eb
      .selectFrom('report_attachments as ra3')
      .innerJoin('attachment_heads as fh', 'fh.attachment_id', 'ra3.attachment_id')
      .whereRef('ra3.report_id', '=', 'h.current_report_id')
      .where('fh.publication', '=', 'published')
      .select((e) => e.fn.countAll<string>().as('n'))
      .as('published_files'),
    eb
      .selectFrom('reports as v')
      .whereRef('v.thread_id', '=', 'h.thread_id')
      .select((e) => e.fn.countAll<string>().as('n'))
      .as('versions'),
    answerSet.as('answer_set'),
    organizationOf.as('organization_id'),
    // Holds a written account or link nobody has decided yet: it cannot be
    // approved in a batch (approval.ts). Ids only; nothing is decrypted.
    sql<boolean>`exists (
      select 1 from report_values wv
       where wv.report_id = h.current_report_id
         and ((wv.kind = 'private_text'
               and not exists (select 1 from text_items wt
                                where wt.fingerprint = wv.fingerprint and wt.outcome is not null))
           or (wv.kind = 'private_link'
               and exists (select 1 from link_groups wg
                            where wg.id = wv.group_id and wg.outcome is null))))`.as(
      'has_undecided_written',
    ),
  ]);

  const status = filter.status ?? 'all';
  if (status === 'withdrawn') q = q.where('h.withdrawn', '=', true);
  else if (status !== 'all') {
    q = q.where('h.withdrawn', '=', false).where('h.moderation_status', '=', status);
  }

  const rows = await q
    // THE ORGANIZATION LANE FIRST (Plan E): on a flood day, open-form reports
    // wait behind the accounts an accountable organization filed. Within
    // each lane, the order asked for.
    .orderBy(sql`(r.third_party is true)`, 'desc')
    .orderBy('r.received_at', sortDirection(filter.sort))
    .orderBy('r.id', sortDirection(filter.sort))
    .limit(page.limit)
    .offset(page.offset)
    .execute();
  const perms = await permissionsForMany(
    db,
    rows.map((r) => r.thread_id),
  );
  return rows.map((r) => ({
    ...r,
    versions: Number(r.versions ?? 1),
    file_count: Number(r.file_count ?? 0),
    published_files: Number(r.published_files ?? 0),
    severity: (r.severity ?? null) as Severity | null,
    corroboration: Number(r.corroboration ?? 0),
    incident_size: Number(r.incident_size ?? 0),
    files_permitted: perms.get(r.thread_id)?.attachment_publication === true,
    needs_review: r.flag_terms !== null && r.flag_cleared_at === null,
    has_note: Boolean(r.has_note),
    has_contact: Boolean(r.has_contact),
    reporter_withdrew: Boolean(r.reporter_withdrew),
    origin: r.third_party === true ? ('organization' as const) : ('open_form' as const),
    organization_id: r.organization_id,
    has_undecided_written: r.has_undecided_written,
  }));
}

/** The head of a thread, locked for a decision. */
async function lockedHead(trx: Transaction<DB>, threadId: string) {
  const head = await trx
    .selectFrom('report_heads as h')
    .innerJoin('reports as r', 'r.id', 'h.current_report_id')
    .select([
      'h.thread_id',
      'h.current_report_id',
      'h.withdrawn',
      'h.moderation_status',
      'r.may_publish',
    ])
    .where('h.thread_id', '=', threadId)
    .forUpdate('h')
    .executeTakeFirst();
  if (!head) throw noReport();
  return head;
}

async function log(
  trx: Transaction<DB>,
  entry: {
    thread_id: string;
    report_id: number;
    action: string;
    new_status?: string | null;
    actor_email: string;
    comment?: string | null;
    reason_code?: string | null;
    bulk_id?: number | null;
  },
): Promise<void> {
  await trx
    .insertInto('moderation_log')
    .values({ new_status: null, comment: null, ...entry })
    .execute();
}

/**
 * Approve, decline, or mark unclear. Always with a reason; always revisitable.
 * Says what it replaced, so a caller can tell a new decline (which emails the
 * reporter, rejection.ts) from the same decline made twice.
 */
export async function decide(
  db: Kysely<DB>,
  threadId: string,
  status: unknown,
  comment: unknown,
  actor: string,
  /** A decline's reason from the fixed list, kept on the decision (public counts by reason). */
  reasonCode: string | null = null,
): Promise<{ previous: string; report_id: number }> {
  if (!DECISIONS.includes(status as Decision)) {
    throw refuse(400, 'invalid_status', 'A decision is approve, decline or unclear.');
  }
  const why = noteOf(comment);
  return db.transaction().execute(async (trx) => {
    const head = await lockedHead(trx, threadId);
    await trx
      .updateTable('report_heads')
      .set({ moderation_status: status as Decision, updated_at: new Date() })
      .where('thread_id', '=', threadId)
      .execute();
    await log(trx, {
      thread_id: threadId,
      report_id: head.current_report_id,
      action: 'review',
      new_status: status as Decision,
      actor_email: actor,
      comment: why,
      reason_code: status === 'invalid' ? reasonCode : null,
    });
    return { previous: head.moderation_status, report_id: head.current_report_id };
  });
}

/** What a batch approval writes as each report's reason: the log says it was a batch. */
export const BATCH_REASON = 'Approved in a batch.';

/**
 * Approve many reports at once (M2). Each report is its own transaction and
 * writes its own moderation_log row, exactly the row a single approval
 * writes, so the record cannot tell a batch from a hundred clicks except by
 * the comment. No reason is asked: the moderator has read them, and the
 * reason for approving is the standard.
 *
 * A report holding a written account or link nobody has decided yet is
 * skipped too: those need their own look, with a reason.
 *
 * A report that cannot be approved here is skipped with the reason, never
 * approved anyway: one withdrawn report must not stop the other ninety-nine,
 * and must not be put back on the board by being in the same list.
 */
export async function decideBatch(db: Kysely<DB>, threadIds: readonly string[], actor: string) {
  const approved: string[] = [];
  const skipped: { thread_id: string; why: string }[] = [];
  for (const threadId of new Set(threadIds)) {
    try {
      await db.transaction().execute(async (trx) => {
        const head = await lockedHead(trx, threadId);
        if (head.withdrawn) throw refuse(409, 'withdrawn', 'It is withdrawn.');
        if (head.moderation_status === 'valid')
          throw refuse(409, 'already', 'It is already approved.');
        // Words and links are decided on their own, with a reason (approval.ts).
        if (holdsUndecided(await undecidedWritten(trx, head.current_report_id))) {
          throw refuse(409, 'written_needs_look', WRITTEN_SKIP_WHY);
        }
        await trx
          .updateTable('report_heads')
          .set({ moderation_status: 'valid', updated_at: new Date() })
          .where('thread_id', '=', threadId)
          .execute();
        await log(trx, {
          thread_id: threadId,
          report_id: head.current_report_id,
          action: 'review',
          new_status: 'valid',
          actor_email: actor,
          comment: BATCH_REASON,
        });
      });
      approved.push(threadId);
    } catch (e) {
      if (!(e instanceof HttpError)) throw e;
      skipped.push({ thread_id: threadId, why: e.message });
    }
  }
  return { approved, skipped };
}

/**
 * Take a report off the public board. The report and its versions are never
 * touched: withdrawal is a flag on report_heads, not a deletion.
 */
export async function withdraw(db: Kysely<DB>, threadId: string, comment: unknown, actor: string) {
  const why = reasonOf(comment);
  await db.transaction().execute(async (trx) => {
    const head = await lockedHead(trx, threadId);
    if (head.withdrawn) throw refuse(409, 'already_withdrawn', 'That report is already withdrawn.');
    await trx
      .updateTable('report_heads')
      .set({ withdrawn: true, updated_at: new Date() })
      .where('thread_id', '=', threadId)
      .execute();
    await log(trx, {
      thread_id: threadId,
      report_id: head.current_report_id,
      action: 'withdraw',
      actor_email: actor,
      comment: why,
    });
  });
}

/**
 * Put a withdrawn report back, with its status set explicitly (back to
 * pending for a fresh look, or straight to a decision).
 *
 * NEVER A REPORTER'S OWN WITHDRAWAL. Legacy let a moderator restore anything.
 * Here a report its reporter withdrew stays withdrawn: putting it
 * back on the board would be the operator overruling the one person whose
 * account it is. Erasing contact details is not a withdrawal (decision 39).
 */
export async function restore(
  db: Kysely<DB>,
  threadId: string,
  status: unknown,
  comment: unknown,
  actor: string,
) {
  if (!RESTORE_TO.includes(status as (typeof RESTORE_TO)[number])) {
    throw refuse(
      400,
      'invalid_status',
      'Say what it goes back as: pending, approved, declined or unclear.',
    );
  }
  const why = reasonOf(comment);
  await db.transaction().execute(async (trx) => {
    const head = await lockedHead(trx, threadId);
    if (!head.withdrawn) throw refuse(409, 'not_withdrawn', 'That report is not withdrawn.');
    const byReporter = await trx
      .selectFrom('reporter_actions')
      .select('id')
      .where('thread_id', '=', threadId)
      .where('action', '=', 'withdraw')
      .executeTakeFirst();
    if (byReporter) {
      throw refuse(
        409,
        'reporter_withdrew',
        'Its reporter withdrew this report. Only they can decide it goes back, and nothing here can do that for them.',
      );
    }
    await trx
      .updateTable('report_heads')
      .set({
        withdrawn: false,
        moderation_status: status as (typeof RESTORE_TO)[number],
        updated_at: new Date(),
      })
      .where('thread_id', '=', threadId)
      .execute();
    await log(trx, {
      thread_id: threadId,
      report_id: head.current_report_id,
      action: 'restore',
      new_status: status as string,
      actor_email: actor,
      comment: why,
    });
  });
}

/**
 * "I have read it." Separate from the moderation decision on purpose, and no
 * reason is asked: the flag is a reading list.
 */
export async function markRead(db: Kysely<DB>, threadId: string, actor: string) {
  const head = await db
    .selectFrom('report_heads')
    .select('current_report_id')
    .where('thread_id', '=', threadId)
    .executeTakeFirst();
  if (!head) throw noReport();
  const out = await clearFlag(db, threadId, actor);
  if (!out.ok) throw refuse(400, 'no_actor', 'Somebody has to be signed in to clear a flag.');
  if (out.cleared) {
    await db
      .insertInto('moderation_log')
      .values({
        thread_id: threadId,
        report_id: head.current_report_id,
        action: 'reviewed',
        actor_email: actor,
      })
      .execute();
  }
  return out.cleared;
}

/** What moderators and the reporter did to one thread, oldest first, for staff. */
export async function historyFor(db: Kysely<DB>, threadId: string) {
  const staff = await db
    .selectFrom('moderation_log')
    .select(['action', 'new_status', 'actor_email', 'comment', 'created_at'])
    .where('thread_id', '=', threadId)
    .execute();
  // The reporter's own actions carry no address: none is stored, by design.
  const reporter = await db
    .selectFrom('reporter_actions')
    .select(['action', 'comment', 'created_at'])
    .where('thread_id', '=', threadId)
    .execute();
  return [
    ...staff.map((s) => ({ ...s, by: 'staff' as const })),
    ...reporter.map((r) => ({
      ...r,
      new_status: null,
      actor_email: null,
      by: 'reporter' as const,
    })),
  ].sort((a, b) => a.created_at.getTime() - b.created_at.getTime());
}
