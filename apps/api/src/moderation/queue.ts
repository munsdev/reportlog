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
import { normalizeSearch, searchMatches, sortDirection } from '../board/search.ts';
import type { DB } from '../db/schema.gen.ts';
import { HttpError, notFound } from '../http/errors.ts';
import { permissionsForMany } from '../permissions/log.ts';
import { clearFlag } from './flags.ts';

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
  sort?: 'newest' | 'oldest' | undefined;
  /** One thread, for its detail page. */
  threadId?: string | undefined;
}

/**
 * The queue. A moderator's search spans every status, unlike the board's:
 * finding the pending and declined ones is the point. Contact details are
 * never here; they open one at a time, logged (accessLog.ts).
 */
export async function listQueue(db: Kysely<DB>, filter: QueueFilter = {}) {
  let q = db
    .selectFrom('report_heads as h')
    .innerJoin('reports as r', 'r.id', 'h.current_report_id')
    .innerJoin('logbooks as l', 'l.id', 'r.logbook_id')
    .leftJoin('report_review_flags as f', 'f.report_id', 'h.current_report_id')
    .leftJoin('logbook_editorial_notes as en', 'en.logbook_id', 'l.id')
    .select((eb) => [
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
      eb
        .exists(eb.selectFrom('editorial_notes as n').whereRef('n.thread_id', '=', 'h.thread_id'))
        .as('has_note'),
      eb
        .exists(
          eb
            .selectFrom('reporter_actions as ra')
            .whereRef('ra.thread_id', '=', 'h.thread_id')
            .where('ra.action', 'in', ['withdraw', 'erase']),
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
    ]);

  const status = filter.status ?? 'all';
  if (status === 'withdrawn') q = q.where('h.withdrawn', '=', true);
  else if (status !== 'all') {
    q = q.where('h.withdrawn', '=', false).where('h.moderation_status', '=', status);
  }
  const search = normalizeSearch(filter.q);
  if (search) q = q.where(searchMatches(search));
  if (filter.flagged) q = q.where('f.id', 'is not', null).where('f.cleared_at', 'is', null);
  if (filter.logbook) q = q.where('l.slug', '=', filter.logbook);
  if (filter.threadId) q = q.where('h.thread_id', '=', filter.threadId);

  const rows = await q
    .orderBy('r.received_at', sortDirection(filter.sort))
    .orderBy('r.id', sortDirection(filter.sort))
    .limit(500)
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
    files_permitted: perms.get(r.thread_id)?.attachment_publication === true,
    needs_review: r.flag_terms !== null && r.flag_cleared_at === null,
    has_note: Boolean(r.has_note),
    has_contact: Boolean(r.has_contact),
    reporter_withdrew: Boolean(r.reporter_withdrew),
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
  },
): Promise<void> {
  await trx
    .insertInto('moderation_log')
    .values({ new_status: null, comment: null, ...entry })
    .execute();
}

/** Approve, decline, or mark unclear. Always with a reason; always revisitable. */
export async function decide(
  db: Kysely<DB>,
  threadId: string,
  status: unknown,
  comment: unknown,
  actor: string,
): Promise<void> {
  if (!DECISIONS.includes(status as Decision)) {
    throw refuse(400, 'invalid_status', 'A decision is approve, decline or unclear.');
  }
  const why = reasonOf(comment);
  await db.transaction().execute(async (trx) => {
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
    });
  });
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
 * Here a report its reporter withdrew (or erased) stays withdrawn: putting it
 * back on the board would be the operator overruling the one person whose
 * account it is.
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
      .where('action', 'in', ['withdraw', 'erase'])
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
