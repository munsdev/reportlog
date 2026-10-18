/**
 * The review flag: a report whose own words say somebody more senior
 * should read it.
 *
 * ONE THING ONLY. A flag means "read this one next". It is not a severity,
 * not a finding, not a verdict, and it says nothing about anybody named in
 * the report. src/taxonomy.js withdrew the veracity verdict for that
 * reason and nothing here brings it back — the worst a flag can be wrong
 * about is the order of a reading list.
 *
 * WHAT IS READ. The prose a reporter typed, and only that. Not their
 * choices from a list, and the distinction is the difference between a
 * useful flag and one nobody trusts: an operator who writes a choice called
 * "Turned away" would otherwise flag every single report that ticked it,
 * and a term that fires on half of what arrives makes the whole thing
 * useless. Matching is for words somebody chose themselves.
 *
 * NOTHING HERE IS HASHED, and nothing that computes a fingerprint may
 * import this module. The keyword list is editable, so a flag in a report's
 * fingerprint would make it verify differently because an operator added a
 * word months later. Same rule as src/reportPermissions.js.
 */
import { pool } from './db.js';
import { fieldsFor } from './logbooks.js';
import { matchedKeywords, reviewKeywords } from './reviewKeywords.js';

/**
 * The field kinds whose answers are somebody's own words.
 *
 * Deliberately short. A date is not prose, a place is a place, and a choice
 * is text the OPERATOR wrote — matching in any of them produces flags that
 * say more about the form than about the report.
 */
export const PROSE_KINDS = new Set(['short_text', 'long_text']);

/**
 * The prose in one report, as a single string to match against.
 *
 * `fields` are the logbook's questions, used only to decide which answers
 * are prose. The CURRENT questions are safe to use for this even though the
 * report was answered against a sealed version: a launched logbook can only
 * gain an optional question, so a key never changes kind under an answer.
 */
export function proseOf(answers, fields) {
  if (!answers || typeof answers !== 'object') return '';
  const prose = new Set((fields || [])
    .filter((f) => PROSE_KINDS.has(f.kind))
    .map((f) => f.key));
  const out = [];
  for (const [key, value] of Object.entries(answers)) {
    if (!prose.has(key)) continue;
    // A choice_many answer is an array; a prose one never is, but a value
    // arriving in a shape this did not expect must be skipped rather than
    // stringified into '[object Object]' and matched against.
    if (typeof value === 'string') out.push(value);
  }
  return out.join('\n');
}

/**
 * Look at one report version and flag it if its words ask for a look.
 *
 * Called inside the transaction that created the report, so a flag and the
 * report it is about can never disagree — and a report that failed to
 * insert leaves no flag behind.
 *
 * NEVER THROWS INTO THE CALLER. A report is the thing that matters; a
 * triage marker is not, and a reporter must not be told their report
 * failed because a word list could not be read. The failure direction is
 * stated at `reviewKeywords` too: a database that cannot answer falls back
 * to the shipped set, which flags more rather than less.
 */
export async function flagReport(client, { reportId, threadId, logbookId, answers }) {
  try {
    const terms = await reviewKeywords(client);
    if (!terms.length) return { flagged: false, terms: [] };
    const fields = await fieldsFor(logbookId, client);
    const matched = matchedKeywords(proseOf(answers, fields), terms);
    if (!matched.length) return { flagged: false, terms: [] };

    await client.query(
      `INSERT INTO report_review_flags (report_id, thread_id, terms)
       VALUES ($1, $2, $3)
       ON CONFLICT (report_id) DO NOTHING`,
      [reportId, threadId, matched],
    );
    // The projection the board reads. Set after the flag row rather than
    // before, so a marker never points at a flag that is not there.
    await client.query(
      'UPDATE report_heads SET needs_review = true, updated_at = now() WHERE thread_id = $1',
      [threadId],
    );
    return { flagged: true, terms: matched };
  } catch (e) {
    // Said out loud, because a flag that silently stops firing is the one
    // failure nobody notices: the queue simply looks quiet.
    console.error('[review-flag] could not flag report ' + reportId + ': ' + e.message);
    return { flagged: false, terms: [], error: true };
  }
}

/**
 * The flag standing against a thread's current version, if any.
 *
 * Keyed to the CURRENT report rather than the thread, because a correction
 * gets its own look — text that was unremarkable in the original and
 * alarming in the correction must not pass because the thread had already
 * been seen.
 */
export async function flagForThread(threadId, client = pool) {
  const { rows } = await client.query(
    `SELECT f.terms, f.created_at, f.cleared_at, f.cleared_by
       FROM report_review_flags f
       JOIN report_heads h ON h.current_report_id = f.report_id
      WHERE h.thread_id = $1`,
    [threadId],
  );
  return rows[0] || null;
}

/**
 * A moderator says they have read it.
 *
 * NOT A DELETE. A flag that vanishes when it is dealt with leaves nothing
 * to count, and the question an operator will eventually ask is how many of
 * these were worth raising — which needs the cleared ones as much as the
 * open ones. The table's own CHECK refuses an anonymous clear.
 */
export async function clearFlag(threadId, { byEmail }, client = pool) {
  if (!byEmail) return { ok: false, reason: 'no-actor' };
  const { rows } = await client.query(
    `UPDATE report_review_flags f
        SET cleared_at = now(), cleared_by = $2
      WHERE f.cleared_at IS NULL
        AND f.report_id = (SELECT current_report_id FROM report_heads WHERE thread_id = $1)
      RETURNING f.id`,
    [threadId, byEmail],
  );
  await client.query(
    'UPDATE report_heads SET needs_review = false, updated_at = now() WHERE thread_id = $1',
    [threadId],
  );
  return { ok: true, cleared: rows.length };
}

/** How many reports are waiting for a second read. */
export async function openFlagCount(client = pool) {
  const { rows } = await client.query(
    `SELECT count(*)::int AS n
       FROM report_review_flags f
       JOIN report_heads h ON h.current_report_id = f.report_id
      WHERE f.cleared_at IS NULL`,
  );
  return rows[0] ? rows[0].n : 0;
}
