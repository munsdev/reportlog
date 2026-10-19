/**
 * The feedback tracker: issues about the site itself, filed by testers.
 *
 * NOT REPORTS. Nothing here is evidence, nothing here is sealed, and nothing
 * here can reach a report: a tester sees issues and never a report. That
 * matters because the tester list is the list most likely to be handled
 * casually (an address added during a demo and forgotten), so it is worth it
 * being structurally unable to expose anything else.
 *
 * What a tester wrote is never changed afterwards, by anybody: only the
 * status moves, and every move carries a note the tester is sent. The
 * database holds both rules (migration 20261019180450).
 */
import {
  FEEDBACK_SEVERITIES,
  FEEDBACK_STATUSES,
  FEEDBACK_TYPES,
  MAX_FEEDBACK_BODY,
  MAX_FEEDBACK_TITLE,
  OPEN_FEEDBACK_STATUSES,
} from '@reportlog/contracts';
import type {
  AdminFeedbackDetail,
  FeedbackContext,
  FeedbackDetail,
  FeedbackIssue,
  FeedbackSeverity,
  FeedbackStatus,
  FeedbackType,
} from '@reportlog/contracts';
import { sql } from 'kysely';
import type { Database } from '../db/database.ts';
import { HttpError, notFound } from '../http/errors.ts';

const refused = (message: string) => new HttpError(400, 'refused', message);

const isType = (v: string): v is FeedbackType => (FEEDBACK_TYPES as readonly string[]).includes(v);
const isSeverity = (v: string): v is FeedbackSeverity =>
  (FEEDBACK_SEVERITIES as readonly string[]).includes(v);
export const isFeedbackStatus = (v: string): v is FeedbackStatus =>
  (FEEDBACK_STATUSES as readonly string[]).includes(v);

/**
 * A name testers can recognise each other by, without handing everybody with
 * the flag a list of addresses.
 *
 * COSMETIC, NOT ANONYMITY. A group that knows each other decodes every
 * handle almost at once, and that is fine: recognition inside a small known
 * group is the point. It must not be mistaken later for a privacy promise.
 */
export function maskedHandle(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  if (!local) return '—';
  const head = local.slice(0, Math.min(3, local.length));
  const host = domain.split('.')[0] ?? '';
  return `${head}${'*'.repeat(Math.max(2, local.length - head.length))}@${host}`;
}

/**
 * Only what the form captures, each shortened. The client may send anything;
 * nothing else is stored. Empty values are left out rather than kept empty.
 */
export function sanitizeContext(raw: FeedbackContext | undefined): FeedbackContext {
  const take = (v: unknown, n: number) =>
    typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : undefined;
  const page = take(raw?.page, 200);
  const viewport = take(raw?.viewport, 40);
  const browser = take(raw?.browser, 400);
  return {
    ...(page ? { page } : {}),
    ...(viewport ? { viewport } : {}),
    ...(browser ? { browser } : {}),
  };
}

export interface NewFeedback {
  type: string;
  severity: string;
  title: string;
  body: string;
  related_ref?: string | undefined;
  context?: FeedbackContext | undefined;
}

export interface CheckedFeedback {
  type: FeedbackType;
  severity: FeedbackSeverity;
  title: string;
  body: string;
  related_ref: string | null;
  context: FeedbackContext;
}

/** Every problem at once, in sentences, so a tester fixes the form in one go. */
export function checkFeedback(input: NewFeedback): CheckedFeedback {
  const problems: string[] = [];
  const title = input.title.trim();
  const body = input.body.trim();
  if (!isType(input.type)) problems.push('Choose what kind of feedback this is.');
  if (!isSeverity(input.severity)) problems.push('Choose how much it gets in your way.');
  if (title.length < 3) problems.push('Give it a title of a few words.');
  if (title.length > MAX_FEEDBACK_TITLE) {
    problems.push(`Keep the title under ${String(MAX_FEEDBACK_TITLE)} characters.`);
  }
  if (body.length < 10) problems.push('Describe what happened in a little more detail.');
  if (body.length > MAX_FEEDBACK_BODY) {
    problems.push(`Keep the description under ${String(MAX_FEEDBACK_BODY)} characters.`);
  }
  if (problems.length || !isType(input.type) || !isSeverity(input.severity)) {
    throw refused(problems.join(' '));
  }
  const ref = (input.related_ref ?? '').trim().slice(0, 60);
  return {
    type: input.type,
    severity: input.severity,
    title,
    body,
    related_ref: ref || null,
    context: sanitizeContext(input.context),
  };
}

export async function fileFeedback(
  db: Database,
  submitterId: number,
  input: NewFeedback,
): Promise<{ id: number; checked: CheckedFeedback }> {
  const checked = checkFeedback(input);
  const id = await db.transaction().execute(async (trx) => {
    const row = await trx
      .insertInto('feedback')
      .values({
        submitter_id: submitterId,
        type: checked.type,
        severity: checked.severity,
        title: checked.title,
        body: checked.body,
        related_ref: checked.related_ref,
        context: JSON.stringify(checked.context),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await trx
      .insertInto('feedback_events')
      .values({ feedback_id: row.id, action: 'created', actor_id: submitterId })
      .execute();
    return row.id;
  });
  return { id, checked };
}

const iso = (d: Date) => d.toISOString();

function issueQuery(db: Database) {
  return db
    .selectFrom('feedback as f')
    .innerJoin('users as u', 'u.id', 'f.submitter_id')
    .select([
      'f.id',
      'f.type',
      'f.severity',
      'f.title',
      'f.body',
      'f.related_ref',
      'f.status',
      'f.context',
      'f.created_at',
      'f.status_changed_at',
      'f.submitter_id',
      'u.email as submitter_email',
      (eb) =>
        eb
          .selectFrom('feedback_comments as c')
          .select(sql<number>`count(*)::int`.as('n'))
          .whereRef('c.feedback_id', '=', 'f.id')
          .as('comment_count'),
    ]);
}

type IssueRow = Awaited<ReturnType<ReturnType<typeof issueQuery>['executeTakeFirstOrThrow']>>;

function toIssue(row: IssueRow, viewerId: number): FeedbackIssue {
  return {
    id: row.id,
    // The table's CHECKs hold these to the same lists the contract names.
    type: row.type as FeedbackType,
    severity: row.severity as FeedbackSeverity,
    title: row.title,
    body: row.body,
    related_ref: row.related_ref,
    status: row.status as FeedbackStatus,
    created_at: iso(row.created_at),
    status_changed_at: iso(row.status_changed_at),
    author: maskedHandle(row.submitter_email),
    mine: row.submitter_id === viewerId,
    comment_count: row.comment_count ?? 0,
  };
}

/** Every tester's issues, not only their own: duplicates drop when people can see what is filed. */
export async function listIssues(db: Database, viewerId: number): Promise<FeedbackIssue[]> {
  const rows = await issueQuery(db).orderBy('f.created_at', 'desc').limit(200).execute();
  return rows.map((r) => toIssue(r, viewerId));
}

async function issueRow(db: Database, id: number): Promise<IssueRow> {
  const row = await issueQuery(db).where('f.id', '=', id).executeTakeFirst();
  if (!row) throw notFound('There is no feedback with that number.');
  return row;
}

async function historyOf(db: Database, id: number) {
  const [changes, comments] = await Promise.all([
    db
      .selectFrom('feedback_events as e')
      .innerJoin('users as u', 'u.id', 'e.actor_id')
      .select(['e.new_status', 'e.note', 'e.created_at', 'u.email'])
      .where('e.feedback_id', '=', id)
      .where('e.action', '=', 'status_change')
      .orderBy('e.created_at')
      .orderBy('e.id')
      .execute(),
    db
      .selectFrom('feedback_comments as c')
      .innerJoin('users as u', 'u.id', 'c.author_id')
      .select(['c.body', 'c.created_at', 'c.author_id', 'u.email'])
      .where('c.feedback_id', '=', id)
      .orderBy('c.created_at')
      .orderBy('c.id')
      .execute(),
  ]);
  return { changes, comments };
}

export async function issueDetail(
  db: Database,
  id: number,
  viewerId: number,
): Promise<FeedbackDetail> {
  const row = await issueRow(db, id);
  const { changes, comments } = await historyOf(db, id);
  return {
    ...toIssue(row, viewerId),
    context: row.context as FeedbackContext,
    // Who moved it is not shown to testers: the note is the reply, and the
    // administrator's address is not theirs to collect.
    changes: changes.map((c) => ({
      status: c.new_status as FeedbackStatus,
      note: c.note ?? '',
      created_at: iso(c.created_at),
    })),
    comments: comments.map((c) => ({
      author: maskedHandle(c.email),
      mine: c.author_id === viewerId,
      body: c.body,
      created_at: iso(c.created_at),
    })),
  };
}

export async function adminDetail(
  db: Database,
  id: number,
  viewerId: number,
): Promise<AdminFeedbackDetail> {
  const row = await issueRow(db, id);
  const { changes, comments } = await historyOf(db, id);
  return {
    ...toIssue(row, viewerId),
    submitter_email: row.submitter_email,
    context: row.context as FeedbackContext,
    changes: changes.map((c) => ({
      status: c.new_status as FeedbackStatus,
      note: c.note ?? '',
      created_at: iso(c.created_at),
      by: c.email,
    })),
    comments: comments.map((c) => ({
      author: maskedHandle(c.email),
      author_email: c.email,
      mine: c.author_id === viewerId,
      body: c.body,
      created_at: iso(c.created_at),
    })),
  };
}

export async function addComment(
  db: Database,
  id: number,
  authorId: number,
  text: string,
): Promise<void> {
  const body = text.trim();
  if (!body) throw refused('Write something first.');
  if (body.length > MAX_FEEDBACK_BODY) {
    throw refused(`Keep a comment under ${String(MAX_FEEDBACK_BODY)} characters.`);
  }
  await issueRow(db, id);
  await db
    .insertInto('feedback_comments')
    .values({ feedback_id: id, author_id: authorId, body })
    .execute();
}

/** The administrator's queue: everything, or one status, or every open one. Newest first. */
export async function queue(db: Database, filter: string | undefined, viewerId: number) {
  let q = issueQuery(db);
  const which = filter ?? 'all';
  if (which === 'open') q = q.where('f.status', 'in', [...OPEN_FEEDBACK_STATUSES]);
  else if (isFeedbackStatus(which)) q = q.where('f.status', '=', which);
  else if (which !== 'all') throw refused('That is not a status feedback can have.');
  const [rows, tally] = await Promise.all([
    q.orderBy('f.created_at', 'desc').limit(500).execute(),
    db
      .selectFrom('feedback')
      .select(['status', sql<number>`count(*)::int`.as('n')])
      .groupBy('status')
      .execute(),
  ]);
  const counts = Object.fromEntries(tally.map((t) => [t.status, t.n]));
  return {
    counts,
    open: OPEN_FEEDBACK_STATUSES.reduce((sum, s) => sum + (counts[s] ?? 0), 0),
    issues: rows.map((r) => ({ ...toIssue(r, viewerId), submitter_email: r.submitter_email })),
  };
}

/**
 * Move an issue. Always changeable, in any direction: something marked fixed
 * can go back to being fixed. The note is required because it is the reply:
 * the tester is sent it and sees it on the issue.
 */
export async function changeStatus(
  db: Database,
  id: number,
  actorId: number,
  status: string,
  noteText: string,
) {
  if (!isFeedbackStatus(status)) throw refused('Choose one of the statuses offered.');
  const note = noteText.trim();
  if (!note) throw refused('Write a note. The person who filed this is sent it.');
  if (note.length > MAX_FEEDBACK_BODY) {
    throw refused(`Keep the note under ${String(MAX_FEEDBACK_BODY)} characters.`);
  }
  return db.transaction().execute(async (trx) => {
    const row = await trx
      .updateTable('feedback')
      .set({ status, status_changed_at: new Date() })
      .where('id', '=', id)
      .returning(['id', 'title', 'type', 'submitter_id'])
      .executeTakeFirst();
    if (!row) throw notFound('There is no feedback with that number.');
    await trx
      .insertInto('feedback_events')
      .values({
        feedback_id: id,
        action: 'status_change',
        new_status: status,
        actor_id: actorId,
        note,
      })
      .execute();
    const submitter = await trx
      .selectFrom('users')
      .select('email')
      .where('id', '=', row.submitter_id)
      .executeTakeFirstOrThrow();
    return { ...row, status, note, submitter_email: submitter.email };
  });
}
