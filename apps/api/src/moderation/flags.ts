/**
 * The review flag: a report whose own words say somebody more senior should
 * read it.
 *
 * ONE THING ONLY. A flag means "read this one next". It is not a severity,
 * not a finding, not a verdict, and it says nothing about anybody named in
 * the report. The worst a flag can be wrong about is the order of a reading
 * list. It is never served to the public.
 *
 * WHAT IS READ. The prose a reporter typed, and only that. Not their choices
 * from a list: an operator who writes a choice called "Turned away" would
 * otherwise flag every report that ticked it, and a term that fires on half
 * of what arrives is how a flag gets switched off.
 *
 * NOTHING HERE IS SEALED, and the seal and chain code may never reach this
 * folder (a boundary rule). The open marker is DERIVED from the flag rows
 * rather than stored on report_heads, so the two can never disagree.
 */
import type { Kysely, Transaction } from 'kysely';
import { sql } from 'kysely';
import type { DB } from '../db/schema.gen.ts';
import { matchedKeywords, reviewKeywords } from './keywords.ts';

/**
 * The kinds whose answers are somebody's own words. Deliberately short: a
 * date is not prose, a place is a place, and a choice is the operator's text.
 */
export const PROSE_KINDS: ReadonlySet<string> = new Set(['short_text', 'long_text']);

/**
 * The prose in one report, as one string to match against. The CURRENT
 * questions are safe to use even though the report was answered against a
 * sealed version: a launched logbook only ever gains an optional question,
 * so a key never changes kind under an answer.
 */
export function proseOf(
  answers: unknown,
  questions: readonly { key: string; kind: string }[] | null,
): string {
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return '';
  const prose = new Set((questions ?? []).filter((q) => PROSE_KINDS.has(q.kind)).map((q) => q.key));
  const out: string[] = [];
  for (const [key, value] of Object.entries(answers as Record<string, unknown>)) {
    // A value in a shape this did not expect is skipped, never stringified
    // into "[object Object]" and quietly matched against.
    if (prose.has(key) && typeof value === 'string') out.push(value);
  }
  return out.join('\n');
}

export interface FlagOutcome {
  flagged: boolean;
  terms: string[];
  error?: true;
}

/**
 * Look at one report version and flag it if its words ask for a look.
 *
 * Called INSIDE the transaction that files the version, so a flag and its
 * report can never disagree, and a report that failed to file leaves no flag.
 *
 * NEVER THROWS INTO THE CALLER. A report is what matters; a triage marker is
 * not, and a reporter must not be told their report failed because a word
 * list could not be read. A savepoint keeps a failure here from aborting the
 * filing transaction around it. The failure is logged, because a flag that
 * silently stops firing is the one nobody notices: the queue just looks quiet.
 */
export async function flagReport(
  trx: Transaction<DB>,
  input: { reportId: number; threadId: string; logbookId: number; answers: unknown },
): Promise<FlagOutcome> {
  await sql`SAVEPOINT review_flag`.execute(trx);
  try {
    const terms = await reviewKeywords(trx);
    if (!terms.length) return await done({ flagged: false, terms: [] });
    const questions = await trx
      .selectFrom('logbook_fields')
      .select(['key', 'kind'])
      .where('logbook_id', '=', input.logbookId)
      .execute();
    const matched = matchedKeywords(proseOf(input.answers, questions), terms);
    if (!matched.length) return await done({ flagged: false, terms: [] });
    await trx
      .insertInto('report_review_flags')
      .values({ report_id: input.reportId, thread_id: input.threadId, terms: matched })
      .onConflict((oc) => oc.column('report_id').doNothing())
      .execute();
    return await done({ flagged: true, terms: matched });
  } catch (e) {
    await sql`ROLLBACK TO SAVEPOINT review_flag`.execute(trx);
    console.error(
      `[review-flag] could not flag report ${String(input.reportId)}: ${(e as Error).message}`,
    );
    return { flagged: false, terms: [], error: true };
  }

  async function done(outcome: FlagOutcome): Promise<FlagOutcome> {
    await sql`RELEASE SAVEPOINT review_flag`.execute(trx);
    return outcome;
  }
}

export interface StandingFlag {
  terms: string[];
  created_at: Date;
  cleared_at: Date | null;
  cleared_by: string | null;
}

/**
 * The flag standing against a thread's CURRENT version, if any. A correction
 * gets its own look: text unremarkable in the original and alarming in the
 * correction must not pass because the thread had already been seen.
 */
export async function flagForThread(
  db: Kysely<DB>,
  threadId: string,
): Promise<StandingFlag | null> {
  const row = await db
    .selectFrom('report_review_flags as f')
    .innerJoin('report_heads as h', 'h.current_report_id', 'f.report_id')
    .select(['f.terms', 'f.created_at', 'f.cleared_at', 'f.cleared_by'])
    .where('h.thread_id', '=', threadId)
    .executeTakeFirst();
  return row ?? null;
}

/**
 * A moderator says they have read it. NOT A DELETE, and not the moderation
 * decision either: "I have read this" and "this may be published" are
 * different statements. Clearing twice clears nothing more, so the first
 * reader keeps their name on it.
 */
export async function clearFlag(
  db: Kysely<DB>,
  threadId: string,
  byEmail: string | null,
): Promise<{ ok: true; cleared: number } | { ok: false; reason: 'no-actor' }> {
  if (!byEmail) return { ok: false, reason: 'no-actor' };
  const out = await db
    .updateTable('report_review_flags')
    .set({ cleared_at: new Date(), cleared_by: byEmail })
    .where('cleared_at', 'is', null)
    .where('report_id', '=', (eb) =>
      eb.selectFrom('report_heads').select('current_report_id').where('thread_id', '=', threadId),
    )
    .executeTakeFirst();
  return { ok: true, cleared: Number(out.numUpdatedRows) };
}

/** How many current versions are waiting for a second read. */
export async function openFlagCount(db: Kysely<DB>): Promise<number> {
  const row = await db
    .selectFrom('report_review_flags as f')
    .innerJoin('report_heads as h', 'h.current_report_id', 'f.report_id')
    .select((eb) => eb.fn.countAll<string>().as('n'))
    .where('f.cleared_at', 'is', null)
    .executeTakeFirst();
  return Number(row?.n ?? 0);
}
