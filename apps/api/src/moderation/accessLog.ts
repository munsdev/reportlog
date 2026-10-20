/**
 * Who opened a reporter's contact details, when, and why.
 *
 * The log covers what a reporter would care about: somebody on staff reading
 * how to reach them. Ordinary browsing of the queue is NOT logged: recording
 * every glance would bury the entries that matter under thousands that do
 * not. The log means "somebody opened something protected", and it keeps
 * meaning that only while it stays narrow.
 *
 * WHAT COUNTS AS OPENED, and where each is written:
 *   - contact details read by staff: `openContactLogged`, here ('contact');
 *   - contact details opened by the server because staff asked the reporter
 *     for files: `recordContactUsed`, called by F's evidence ask before it
 *     decrypts ('contact_used');
 *   - a file's unstripped original: F writes it to attachment_events
 *     ('viewed_original'), with its reason, and both views read it there;
 *   - a file's re-encoded copy, a still or a page: `recordFilePreview`,
 *     called by F's view route ('file_preview'). For oversight only; the
 *     reporter is not shown these;
 *   - a read of this log by an administrator ('audit_log').
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

/**
 * The server is about to open a reporter's contact details because a member
 * of staff asked them for files (F's evidence ask). Nobody on staff sees the
 * address, but it is opened on their say-so, so it is recorded, BEFORE the
 * decryption, and the reporter is shown it. If the ask then fails, the entry
 * stays: this log over-reports rather than under-reports.
 */
export async function recordContactUsed(
  db: Kysely<DB>,
  input: { threadId: string; staffEmail: string },
): Promise<void> {
  const head = await db
    .selectFrom('report_heads')
    .select('current_report_id')
    .where('thread_id', '=', input.threadId)
    .executeTakeFirst();
  if (!head) return;
  await db
    .insertInto('contact_access_log')
    .values({
      staff_email: input.staffEmail,
      kind: 'contact_used',
      thread_id: input.threadId,
      report_id: head.current_report_id,
    })
    .execute();
}

/** One look at a file is one entry, however many requests the browser makes for it. */
export const PREVIEW_WINDOW_MINUTES = 15;

/**
 * A member of staff is about to see a file's re-encoded copy (or a still or a
 * page of it). Written before the bytes are sent. A video or a document asks
 * for itself in pieces, so a second entry for the same person and file
 * within PREVIEW_WINDOW_MINUTES is not written: otherwise one look reads as
 * forty, and the log stops meaning anything.
 */
export async function recordFilePreview(
  db: Kysely<DB>,
  input: { attachmentId: number; threadId: string; staffEmail: string },
): Promise<void> {
  const recent = await db
    .selectFrom('contact_access_log')
    .select('id')
    .where('kind', '=', 'file_preview')
    .where('attachment_id', '=', input.attachmentId)
    .where('staff_email', '=', input.staffEmail)
    .where('accessed_at', '>', sql<Date>`now() - make_interval(mins => ${PREVIEW_WINDOW_MINUTES})`)
    .executeTakeFirst();
  if (recent) return;
  const head = await db
    .selectFrom('report_heads')
    .select('current_report_id')
    .where('thread_id', '=', input.threadId)
    .executeTakeFirst();
  if (!head) return;
  await db
    .insertInto('contact_access_log')
    .values({
      staff_email: input.staffEmail,
      kind: 'file_preview',
      thread_id: input.threadId,
      report_id: head.current_report_id,
      attachment_id: input.attachmentId,
    })
    .execute();
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
  const limit = opts.limit ?? 500;
  const since = sql<Date>`now() - make_interval(months => ${months})`;
  let looks = db
    .selectFrom('contact_access_log as a')
    .leftJoin('reports as r', 'r.id', 'a.report_id')
    .leftJoin('logbooks as l', 'l.id', 'a.logbook_id')
    .select([
      'l.slug as logbook',
      'a.id',
      'a.staff_email',
      'a.kind',
      'a.reason',
      'a.accessed_at',
      'a.thread_id',
      'a.attachment_id',
      'r.public_ref',
    ])
    .where('a.accessed_at', '>', since)
    .orderBy('a.accessed_at', 'desc')
    .orderBy('a.id', 'desc')
    .limit(limit);
  if (opts.threadId) looks = looks.where('a.thread_id', '=', opts.threadId);
  // Originals are on F's record of the file; the reference is the version
  // the file arrived with.
  let originals = db
    .selectFrom('attachment_events as e')
    .innerJoin('attachments as f', 'f.id', 'e.attachment_id')
    .innerJoin('reports as r', 'r.id', 'f.report_id')
    .select([
      'e.id',
      'e.actor_email',
      'e.reason',
      'e.created_at',
      'e.thread_id',
      'e.attachment_id',
      'r.public_ref',
    ])
    .where('e.action', '=', 'viewed_original')
    .where('e.created_at', '>', since)
    .orderBy('e.created_at', 'desc')
    .orderBy('e.id', 'desc')
    .limit(limit);
  if (opts.threadId) originals = originals.where('e.thread_id', '=', opts.threadId);
  return [
    ...(await looks.execute()).map((a) => ({ ...a, id: `a${String(a.id)}` })),
    ...(await originals.execute()).map((e) => ({
      id: `f${String(e.id)}`,
      // A moderator's event always carries the address (F's CHECK).
      staff_email: e.actor_email ?? '',
      kind: 'file_original',
      reason: e.reason,
      accessed_at: e.created_at,
      thread_id: e.thread_id,
      attachment_id: e.attachment_id,
      public_ref: e.public_ref,
      logbook: null,
    })),
  ]
    .sort((x, y) => y.accessed_at.getTime() - x.accessed_at.getTime())
    .slice(0, limit);
}

/**
 * A download of a logbook's complete chain file (decision 34): every
 * version's sealed answers, published or not. Written BEFORE the file is
 * built, so a download that was not recorded cannot happen.
 */
export async function recordChainFileDownload(
  db: Kysely<DB>,
  staffEmail: string,
  logbookId: number,
): Promise<void> {
  await db
    .insertInto('contact_access_log')
    .values({ staff_email: staffEmail, kind: 'chain_file', logbook_id: logbookId })
    .execute();
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
): Promise<
  {
    thread_id: string;
    kind: 'contact' | 'contact_used' | 'file_original';
    reason: string | null;
    accessed_at: Date;
  }[]
> {
  if (!threadIds.length) return [];
  const since = sql<Date>`now() - make_interval(months => ${months})`;
  const contact = await db
    .selectFrom('contact_access_log as a')
    .select(['a.thread_id', 'a.kind', 'a.reason', 'a.accessed_at'])
    .where('a.thread_id', 'in', threadIds)
    // Previews are oversight, not a disclosure of anything the reporter gave.
    .where('a.kind', 'in', ['contact', 'contact_used'])
    .where('a.accessed_at', '>', since)
    .execute();
  // Opening a file's unstripped original (where it was taken, on what
  // device) is the other look a reporter would care about. Workstream F
  // records it, with its reason, in attachment_events; the staff address
  // there is not selected either.
  const originals = await db
    .selectFrom('attachment_events as e')
    .select(['e.thread_id', 'e.reason', 'e.created_at as accessed_at'])
    .where('e.thread_id', 'in', threadIds)
    .where('e.action', '=', 'viewed_original')
    .where('e.created_at', '>', since)
    .execute();
  return [
    ...contact.flatMap((r) =>
      r.thread_id
        ? [
            {
              ...r,
              thread_id: r.thread_id,
              kind: r.kind === 'contact_used' ? ('contact_used' as const) : ('contact' as const),
            },
          ]
        : [],
    ),
    ...originals.map((r) => ({ ...r, kind: 'file_original' as const })),
  ].sort((a, b) => b.accessed_at.getTime() - a.accessed_at.getTime());
}
