/**
 * ONE LOGBOOK'S CHAIN, AS A FILE ANYBODY CAN CHECK.
 *
 * Every logbook is its own chain, so each one can be downloaded and checked
 * on its own — without this server, without any other logbook, and without
 * trusting anything the file says about itself. The checker is in
 * src/chainCheck.js and needs the file and nothing else — no database, no
 * network — and scripts/check-chain.js runs it from the command line.
 *
 * TWO KINDS OF FILE, and the checker says which it was given.
 *
 *   complete   every version of every report in the logbook, published or
 *              not, in chain order. Every link can be checked, from the
 *              logbook's starting value to its head, so a report inserted,
 *              removed or altered anywhere shows. Administrators only: it
 *              carries the answers of reports that were never published.
 *              Only Tier A — nothing here names or reaches a reporter.
 *
 *   published  only what the public board shows. Each report's own
 *              fingerprint and its own link can be checked, but the chain
 *              between them has gaps where unpublished reports sit, so the
 *              run from start to head cannot be.
 *
 * Either kind carries the anchors that covered this logbook, so the head the
 * file ends at can be compared with the head the outside timestamp signed.
 */
import { pool } from './db.js';
import { immutableFieldsFor, manifestFor, FORM_JOIN, FORM_COLUMN } from './verify.js';
import { formVersions } from './logbookForms.js';
import { CHAIN_FILE_FORMAT, genesisOf } from './chainCheck.js';

export { CHAIN_FILE_FORMAT, checkChainFile } from './chainCheck.js';

export async function buildChainFile(logbookId, { publishedOnly = false } = {}, client = pool) {
  const { rows: [lb] } = await client.query(
    'SELECT id, slug, title FROM logbooks WHERE id = $1 AND launched_at IS NOT NULL', [logbookId],
  );
  if (!lb) return null;
  const { rows } = await client.query(
    publishedOnly
      ? `SELECT r.*, $2::text AS logbook_slug, ${FORM_COLUMN}
           FROM report_heads h JOIN reports r ON r.id = h.current_report_id ${FORM_JOIN}
          WHERE r.logbook_id = $1 AND h.withdrawn = false
            AND h.moderation_status = 'valid' AND r.may_publish = true
          ORDER BY r.id`
      : `SELECT r.*, $2::text AS logbook_slug, ${FORM_COLUMN}
           FROM reports r ${FORM_JOIN}
          WHERE r.logbook_id = $1 ORDER BY r.id`,
    [lb.id, lb.slug],
  );
  const reports = [];
  for (const row of rows) {
    reports.push({
      public_ref: row.public_ref,
      hashed_fields: immutableFieldsFor(row, await manifestFor(row.id, client)),
      content_hash: row.content_hash,
      prev_chain_hash: row.prev_chain_hash,
      chain_hash: row.chain_hash,
    });
  }
  const { rows: anchors } = await client.query(
    `SELECT a.anchor_date, a.root_chain_hash, a.public_log_ref,
            ah.head_chain_hash, ah.report_count
       FROM chain_anchor_heads ah JOIN chain_anchors a ON a.id = ah.anchor_id
      WHERE ah.logbook_slug = $1 ORDER BY a.id`,
    [lb.slug],
  );
  const { rows: [count] } = await client.query(
    'SELECT count(*)::int AS n FROM reports WHERE logbook_id = $1', [lb.id],
  );
  return {
    chain_file_format: CHAIN_FILE_FORMAT,
    kind: publishedOnly ? 'published' : 'complete',
    logbook: lb.slug,
    title: lb.title,
    genesis: genesisOf(lb.slug),
    // How many reports the whole chain holds, published or not. On a
    // complete file this is the number of entries; on a published one it is
    // what the gaps add up to.
    chain_length: count.n,
    exported_at: new Date().toISOString(),
    // Every version of this logbook's questions, exactly as hashed. A report
    // names the version it was answered against in `logbook_form`; this is
    // what that hash is the SHA-256 of.
    forms: (await formVersions(lb.id, client)).map((f) => ({ hash: f.hash, definition: f.definition })),
    how_to_check: 'For each report: serialize hashed_fields with RFC 8785 and take its '
      + 'SHA-256, which must equal content_hash; then SHA-256 of content_hash followed by '
      + 'prev_chain_hash (both as hex text) must equal chain_hash. On a complete file each '
      + 'prev_chain_hash is the chain_hash before it, and the first is genesis: SHA-256 of '
      + '"reportlog-chain:" followed by the logbook\'s slug. A report with a logbook_form names '
      + 'the questions it was answered against: the SHA-256 of that entry\'s definition in forms, '
      + 'text exactly as written, must equal it, and every answer must be to a question it asks.',
    anchors: anchors.map((a) => ({
      date: a.anchor_date instanceof Date ? a.anchor_date.toISOString().slice(0, 10)
        : String(a.anchor_date).slice(0, 10),
      head: a.head_chain_hash,
      reports: a.report_count,
      root_chain_hash: a.root_chain_hash,
      public_log_ref: a.public_log_ref,
    })),
    reports,
  };
}
