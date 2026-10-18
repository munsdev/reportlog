/**
 * The form a report was answered against, as bytes that can be hashed.
 *
 * A logbook's questions are frozen at launch, with one opening: a new
 * OPTIONAL question may be added later. So a logbook's form has versions,
 * and every report seals the hash of the version its reporter was asked
 * (`logbook_form` in the hashed object, migration 031).
 *
 * The pure half — what a definition is and how it hashes — is src/formText.js.
 */
import { pool } from './db.js';
import { formText } from './formText.js';

/**
 * The version row for a question set, written if it is new.
 *
 * Takes the `fields` the caller already read and validated answers against,
 * not a fresh read, so the version sealed is the one the answers were
 * checked against even if a question was added a moment later. Idempotent
 * and lock-free: the unique key on (logbook, hash) makes two callers with
 * the same questions land on one row.
 *
 * Only a launched logbook has versions. A draft's questions are still
 * changing and nothing may be filed to it.
 */
export async function ensureFormVersion(logbook, fields, client = pool) {
  if (!logbook || !logbook.launched_at) {
    throw new Error('ensureFormVersion: only a launched logbook has a form version');
  }
  const { definition, hash } = formText(logbook.slug, fields);
  await client.query(
    `INSERT INTO logbook_forms (logbook_id, form_hash, definition)
     VALUES ($1, $2, $3) ON CONFLICT (logbook_id, form_hash) DO NOTHING`,
    [logbook.id, hash, definition],
  );
  const { rows } = await client.query(
    'SELECT id, form_hash FROM logbook_forms WHERE logbook_id = $1 AND form_hash = $2',
    [logbook.id, hash],
  );
  return { id: rows[0].id, hash: rows[0].form_hash };
}

/** Every version of a logbook's form, oldest first. */
export async function formVersions(logbookId, client = pool) {
  const { rows } = await client.query(
    `SELECT form_hash AS hash, definition, created_at
       FROM logbook_forms WHERE logbook_id = $1 ORDER BY id`,
    [logbookId],
  );
  return rows;
}
