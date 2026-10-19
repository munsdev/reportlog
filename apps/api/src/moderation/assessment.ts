/**
 * A moderator's assessment of a report: how serious it is, and which other
 * reports describe the same incident.
 *
 * Both are JUDGEMENTS BY THE PEOPLE HANDLING A REPORT, not anything its
 * reporter said, so neither is ever inside a seal: a report's fingerprint
 * covers what was reported, and a moderator changing their mind must not make
 * it verify differently. Both are changeable, and every change is written to
 * moderation_log, with a reason, in the same transaction.
 *
 * INCIDENTS ARE LINKED BY HAND. Linking to a report that already has an
 * incident joins that group; linking two unlinked reports starts one.
 * Nothing is clustered automatically: a mistake there would silently overstate
 * corroboration, which is the number press is most likely to quote.
 *
 * CORROBORATION COUNTS PUBLISHED ACCOUNTS ONLY, through the one rule in
 * board/published.ts, so the figure a moderator sees is the one a reader
 * could check on the board. Linked reports that are not public are counted
 * separately and never added in.
 */
import { randomUUID } from 'node:crypto';
import type { Kysely, Transaction } from 'kysely';
import { publishedReportIds } from '../board/published.ts';
import type { DB } from '../db/schema.gen.ts';
import { HttpError, notFound } from '../http/errors.ts';

export const SEVERITIES = ['note', 'irregularity', 'serious', 'systemic'] as const;
export type Severity = (typeof SEVERITIES)[number];

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

async function headOf(trx: Transaction<DB>, threadId: string) {
  const head = await trx
    .selectFrom('report_heads')
    .select(['thread_id', 'current_report_id'])
    .where('thread_id', '=', threadId)
    .forUpdate()
    .executeTakeFirst();
  if (!head) throw noReport();
  return head;
}

/** Write one thread's assessment, creating the row the first time. */
async function put(
  trx: Transaction<DB>,
  threadId: string,
  set: { severity?: Severity | null; incident_id?: string | null },
) {
  await trx
    .insertInto('report_assessments')
    .values({ thread_id: threadId, ...set })
    .onConflict((oc) => oc.column('thread_id').doUpdateSet({ ...set, updated_at: new Date() }))
    .execute();
}

/**
 * Rate a report, or clear the rating (`null`). Only a value somebody chose is
 * ever stored: there is no default severity.
 */
export async function setSeverity(
  db: Kysely<DB>,
  threadId: string,
  severity: unknown,
  comment: unknown,
  actor: string,
): Promise<Severity | null> {
  if (severity !== null && !SEVERITIES.includes(severity as Severity)) {
    throw refuse(
      400,
      'invalid_severity',
      'A severity is a procedural note, an irregularity, serious, or systemic; or none, to clear it.',
    );
  }
  const why = reasonOf(comment);
  const value = severity as Severity | null;
  await db.transaction().execute(async (trx) => {
    const head = await headOf(trx, threadId);
    await put(trx, threadId, { severity: value });
    await trx
      .insertInto('moderation_log')
      .values({
        thread_id: threadId,
        report_id: head.current_report_id,
        action: 'severity',
        new_status: value ?? 'none',
        actor_email: actor,
        comment: why,
      })
      .execute();
  });
  return value;
}

/**
 * Link a report to another (by its public reference) as the same incident,
 * or unlink it (`linkTo` empty). Returns the incident it is now in.
 */
export async function linkIncident(
  db: Kysely<DB>,
  threadId: string,
  linkTo: unknown,
  comment: unknown,
  actor: string,
): Promise<string | null> {
  const why = reasonOf(comment);
  const ref = typeof linkTo === 'string' ? linkTo.trim() : '';
  return db.transaction().execute(async (trx) => {
    const target = ref
      ? await trx
          .selectFrom('report_heads as h')
          .innerJoin('reports as r', 'r.thread_id', 'h.thread_id')
          .select('h.thread_id')
          .where('r.public_ref', '=', ref)
          .executeTakeFirst()
      : null;
    if (ref && !target) throw notFound(`There is no report ${ref}.`);
    if (target?.thread_id === threadId) {
      throw refuse(400, 'same_report', 'A report cannot corroborate itself.');
    }
    // Both heads locked, always in the same order, so two moderators linking
    // the same pair from either end cannot deadlock.
    const ids = [threadId, ...(target ? [target.thread_id] : [])].sort();
    const heads = new Map<string, Awaited<ReturnType<typeof headOf>>>();
    for (const id of ids) heads.set(id, await headOf(trx, id));
    const head = heads.get(threadId);
    if (!head) throw noReport();

    let incident: string | null = null;
    if (target) {
      const theirs = await trx
        .selectFrom('report_assessments')
        .select('incident_id')
        .where('thread_id', '=', target.thread_id)
        .executeTakeFirst();
      incident = theirs?.incident_id ?? randomUUID();
      // A target that had no incident yet joins the new one too.
      if (!theirs?.incident_id) await put(trx, target.thread_id, { incident_id: incident });
    }
    await put(trx, threadId, { incident_id: incident });
    await trx
      .insertInto('moderation_log')
      .values({
        thread_id: threadId,
        report_id: head.current_report_id,
        action: 'incident',
        new_status: target ? `linked to ${ref}` : 'unlinked',
        actor_email: actor,
        comment: why,
      })
      .execute();
    return incident;
  });
}

/** One thread's assessment, and every other report linked to the same incident. */
export async function assessmentOf(db: Kysely<DB>, threadId: string) {
  const row = await db
    .selectFrom('report_assessments')
    .select(['severity', 'incident_id'])
    .where('thread_id', '=', threadId)
    .executeTakeFirst();
  const severity = (row?.severity ?? null) as Severity | null;
  const incident = row?.incident_id ?? null;
  if (!incident) return { severity, incident_id: null, linked: [], published_accounts: 0 };
  const linked = await db
    .selectFrom('report_assessments as a')
    .innerJoin('report_heads as h', 'h.thread_id', 'a.thread_id')
    .innerJoin('reports as r', 'r.id', 'h.current_report_id')
    .select((eb) => [
      'a.thread_id',
      'r.public_ref',
      'h.moderation_status',
      'h.withdrawn',
      eb('r.id', 'in', publishedReportIds(db)).as('published'),
    ])
    .where('a.incident_id', '=', incident)
    .orderBy('r.received_at')
    .execute();
  return {
    severity,
    incident_id: incident,
    linked: linked
      .filter((l) => l.thread_id !== threadId)
      .map((l) => ({ ...l, published: Boolean(l.published) })),
    // This report included, when it is itself public.
    published_accounts: linked.filter((l) => Boolean(l.published)).length,
  };
}

/**
 * Corroboration across the published record, broken out (never one headline
 * figure), and published reports by severity. Legacy's "By the numbers"
 * panels, for staff.
 */
export async function corroborationSummary(db: Kysely<DB>) {
  const rows = await db
    .selectFrom('report_heads as h')
    .leftJoin('report_assessments as a', 'a.thread_id', 'h.thread_id')
    .select(['a.severity', 'a.incident_id'])
    .where('h.current_report_id', 'in', publishedReportIds(db))
    .execute();
  const sizes = new Map<string, number>();
  for (const r of rows) {
    if (r.incident_id) sizes.set(r.incident_id, (sizes.get(r.incident_id) ?? 0) + 1);
  }
  const corroborated = rows.filter((r) => r.incident_id && (sizes.get(r.incident_id) ?? 0) > 1);
  const bySeverity: Record<string, number> = { none: 0 };
  for (const s of SEVERITIES) bySeverity[s] = 0;
  for (const r of rows) {
    const k = r.severity ?? 'none';
    bySeverity[k] = (bySeverity[k] ?? 0) + 1;
  }
  return {
    published: rows.length,
    corroborated_accounts: corroborated.length,
    single_accounts: rows.length - corroborated.length,
    incidents_with_several_accounts: [...sizes.values()].filter((n) => n > 1).length,
    by_severity: bySeverity,
  };
}
