/**
 * The list sweep: erasing COLUMNS, not deleting rows.
 *
 * WHY THIS IS NOT src/sweep.js. That file DELETEs whole rows from four
 * named tables keyed on `expires_at`, and its own comment is emphatic that
 * the list is hand-written so a future table cannot be swept merely because
 * it happens to have such a column. Both halves would be wrong here: the
 * operation is an UPDATE, and the row is meant to survive it.
 *
 * The links stay, the text and the contact details go.
 *
 * NOTHING HERE TOUCHES link_index. It holds no text and no submitter, so
 * there is nobody in it to erase — which is also why it is the durable
 * layer rather than a tidier copy of the entries table.
 */
import { pool } from '../db.js';
import { ERASABLE_COLUMNS } from './policy.js';
import { saltRetentionDays } from './retention.js';
import { forgetCachedSalts } from './salt.js';

/**
 * Erase the erasable half of every entry whose period has run out.
 *
 * `personal_expires_at IS NULL` means durable and is skipped — an entry an
 * operator chose to keep indefinitely is erased by its own holder through
 * the erasure link, never by the clock.
 */
export async function sweepPersonal({ client = pool } = {}) {
  const sets = ERASABLE_COLUMNS.map((c) => `${c} = NULL`).join(', ');
  try {
    const { rowCount } = await client.query(
      `UPDATE list_entries
          SET ${sets}, erased_at = now()
        WHERE erased_at IS NULL
          AND personal_expires_at IS NOT NULL
          AND personal_expires_at < now()`,
    );
    return { list_entries: rowCount };
  } catch (e) {
    // Reported rather than thrown, like src/sweep.js: this runs on a timer
    // and a failure to tidy must never take the rest of the run down.
    return { list_entries: { error: e.message } };
  }
}

/**
 * Destroy expired hashing secrets.
 *
 * THIS IS THE STEP THAT MAKES THE HASHES ONE-WAY. Until the day's secret is
 * gone, somebody holding the database can enumerate the 2^32 IPv4 space
 * against it and recover every address taken that day. After it is gone,
 * nothing can. Today's secret is never a candidate.
 */
export async function sweepSalts({ client = pool, env = process.env } = {}) {
  const days = saltRetentionDays(env);
  try {
    const { rowCount } = await client.query(
      `DELETE FROM list_salts WHERE day < (current_date - ($1 || ' days')::interval)`,
      [String(days)],
    );
    forgetCachedSalts();
    return { list_salts: rowCount };
  } catch (e) {
    return { list_salts: { error: e.message } };
  }
}

/**
 * Expired and spent erasure links.
 *
 * These ARE short-lived credentials, which is the one thing here that
 * src/sweep.js's shape would fit. Done here anyway, so everything with a
 * list's lifetime is in one module and an operator reads one list.
 */
export async function sweepErasureTokens({ client = pool } = {}) {
  try {
    const { rowCount } = await client.query(
      'DELETE FROM list_erasures WHERE expires_at < now() OR used_at IS NOT NULL',
    );
    return { list_erasures: rowCount };
  } catch (e) {
    return { list_erasures: { error: e.message } };
  }
}

/** Everything, for the timer. */
export async function sweepLists({ client = pool, env = process.env } = {}) {
  return {
    ...await sweepPersonal({ client }),
    ...await sweepSalts({ client, env }),
    ...await sweepErasureTokens({ client }),
  };
}
