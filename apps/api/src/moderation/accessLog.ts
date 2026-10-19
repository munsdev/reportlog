/**
 * Who opened a reporter's contact details, when, and why.
 *
 * The log covers what a reporter would care about: somebody on staff reading
 * how to reach them. Ordinary browsing of the queue is NOT logged: recording
 * every glance would bury the entries that matter under thousands that do
 * not. The log means "somebody opened something protected", and it keeps
 * meaning that only while it stays narrow. (Workstream F adds the opening of
 * a file's unstripped original here, as legacy did.)
 *
 * THE ONLY WAY TO READ CONTACT DETAILS FOR STAFF IS `openContactLogged`. It
 * writes the entry first and decrypts second, so if the write fails nothing
 * is disclosed: an unlogged look is the one outcome this must not have.
 *
 * The reporter sees each entry with its reason and WITHOUT the staff
 * member's address: `accessesForThreads` never selects it. Naming a
 * volunteer to a reporter unhappy with a decision is a risk to that volunteer
 * that no care at the display layer would be worth.
 */
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { DB } from '../db/schema.gen.ts';
import { openContact } from '../filing/contactKeys.ts';
import type { ContactKeyring, OpenedContact } from '../filing/contactKeys.ts';

export const MAX_REASON = 500;
const MIN_REASON = 10;

/** A reason that is required but never checked becomes "." within a week. */
export function validateReason(raw: unknown): string | null {
  const reason = typeof raw === 'string' ? raw.trim() : '';
  if (!reason) return 'A reason is required, and the reporter will see it.';
  if (reason.length < MIN_REASON) {
    return 'Please give a real reason: the reporter whose details these are will read it.';
  }
  if (reason.length > MAX_REASON) {
    return `Please keep the reason under ${String(MAX_REASON)} characters.`;
  }
  return null;
}

export type OpenResult =
  | { ok: true; contact: OpenedContact }
  | { ok: false; reason: 'reason'; message: string }
  | { ok: false; reason: 'not-found' };

/**
 * Open a thread's contact details for a member of staff, logging it first.
 * The entry and the read are one transaction's worth of ordering: the entry
 * is committed before a single byte is decrypted.
 */
export async function openContactLogged(
  db: Kysely<DB>,
  ring: ContactKeyring,
  input: { threadId: string; staffEmail: string; reason: unknown },
): Promise<OpenResult> {
  const problem = validateReason(input.reason);
  if (problem) return { ok: false, reason: 'reason', message: problem };
  const head = await db
    .selectFrom('report_heads as h')
    .innerJoin('report_contacts as c', 'c.thread_id', 'h.thread_id')
    .select(['h.thread_id', 'h.current_report_id'])
    .where('h.thread_id', '=', input.threadId)
    .executeTakeFirst();
  if (!head) return { ok: false, reason: 'not-found' };
  await db
    .insertInto('contact_access_log')
    .values({
      staff_email: input.staffEmail,
      kind: 'contact',
      thread_id: head.thread_id,
      report_id: head.current_report_id,
      reason: (input.reason as string).trim(),
    })
    .execute();
  const contact = await openContact(db, ring, head.thread_id);
  if (!contact) return { ok: false, reason: 'not-found' };
  return { ok: true, contact };
}

const DEFAULT_MONTHS = 12;

/**
 * The administrators' view: everything, with the staff member named. Reading
 * it is itself recorded, exactly one level deep: the caller writes one
 * 'audit_log' entry, and nothing reads the log but that route, so the
 * recursion stops by construction.
 */
export async function recentAccesses(
  db: Kysely<DB>,
  opts: { months?: number; threadId?: string | null; limit?: number } = {},
) {
  const months = opts.months ?? DEFAULT_MONTHS;
  let q = db
    .selectFrom('contact_access_log as a')
    .leftJoin('reports as r', 'r.id', 'a.report_id')
    .select([
      'a.id',
      'a.staff_email',
      'a.kind',
      'a.reason',
      'a.accessed_at',
      'a.thread_id',
      'r.public_ref',
    ])
    .where('a.accessed_at', '>', sql<Date>`now() - make_interval(months => ${months})`)
    .orderBy('a.accessed_at', 'desc')
    .orderBy('a.id', 'desc')
    .limit(opts.limit ?? 500);
  if (opts.threadId) q = q.where('a.thread_id', '=', opts.threadId);
  return q.execute();
}

export async function recordAuditRead(db: Kysely<DB>, staffEmail: string): Promise<void> {
  await db
    .insertInto('contact_access_log')
    .values({ staff_email: staffEmail, kind: 'audit_log' })
    .execute();
}

/**
 * The reporter's view: the same events with every trace of WHO removed.
 * staff_email is not selected rather than selected and dropped later: a
 * field never fetched cannot be leaked by a later change to serializing.
 */
export async function accessesForThreads(
  db: Kysely<DB>,
  threadIds: readonly string[],
  months = DEFAULT_MONTHS,
): Promise<{ thread_id: string; kind: string; reason: string | null; accessed_at: Date }[]> {
  if (!threadIds.length) return [];
  const rows = await db
    .selectFrom('contact_access_log as a')
    .select(['a.thread_id', 'a.kind', 'a.reason', 'a.accessed_at'])
    .where('a.thread_id', 'in', threadIds)
    .where('a.kind', '=', 'contact')
    .where('a.accessed_at', '>', sql<Date>`now() - make_interval(months => ${months})`)
    .orderBy('a.accessed_at', 'desc')
    .execute();
  return rows.flatMap((r) => (r.thread_id ? [{ ...r, thread_id: r.thread_id }] : []));
}
