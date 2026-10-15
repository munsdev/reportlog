// The daily public snapshot: every published report, in full, as text.
//
// The anchor alone proves the archive has not been altered. It does not
// prove what the archive SAID — a hash is only checkable against content
// you already have. Publishing the content next to the anchor is what
// closes that gap: anyone can recompute each report's fingerprint from the
// snapshot and check each link, logbook by logbook, without asking this
// server for anything.
//
// Two properties worth being explicit about, because they are choices and
// not accidents:
//
//   Withdrawal is forward-only. A withdrawn report stops appearing in the
//   next day's snapshot. It does not vanish from yesterday's, which is
//   already published and, being in a public git repository, is not ours
//   to unpublish. That is the honest bargain of a tamper-evident archive
//   and it is stated plainly in the file itself rather than left for
//   someone to discover.
//
//   Only Tier A. Observer identity and contact details have never been
//   part of the fingerprint and are not here. The snapshot is exactly what
//   is already public on the board, in a form that can be checked.

import canonicalize from 'canonicalize';
import { pool } from './db.js';
import { immutableFieldsFor, manifestFor, FORM_JOIN, FORM_COLUMN } from './verify.js';
import { contentHash } from './crypto.js';
import { currentHeads } from './chainHeads.js';

export const SNAPSHOT_FORMAT = 2;

// EVERY COLUMN, AND THE JOIN. Not a list.
//
// This was a hand-kept list of twenty-two columns and it had drifted, in the
// one file where drift is worst. `5c371c9` added `r.may_publish = true` to
// the WHERE clause and never added `may_publish` to the SELECT, so
// immutableFieldsFor saw the column as absent, read that as "the question
// was never asked", and left both publication keys out of the object it
// rebuilt. The result: every report in every snapshot since 11 September
// was published with the wrong hashed_fields and flagged as not matching
// its own hash.
//
// It is the same drift that was deleted from verify.js, for the same
// reason, and it is fixed the same way. `immutableFieldsFor` decides which
// keys apply by looking at the row; a query that hands it a partial row
// makes that decision on missing data. There is no version of this that is
// safe to maintain by hand, so it is not maintained by hand.
const SNAPSHOT_SELECT = `r.*, l.slug AS logbook_slug, l.title AS logbook_title, ${FORM_COLUMN}`;

/**
 * Build the snapshot for a given day.
 *
 * Each entry carries the fields that were hashed and the hash that was
 * recorded, so a reader can check any single report on its own. Entries are
 * grouped by logbook and in chain order within each, because every logbook
 * is its own chain.
 */
export async function buildSnapshot(date, client = pool, heads = null) {
  const { rows } = await client.query(
    `SELECT ${SNAPSHOT_SELECT}
     FROM report_heads h
     JOIN reports r ON r.id = h.current_report_id
     JOIN logbooks l ON l.id = r.logbook_id ${FORM_JOIN}
     WHERE h.withdrawn = false AND h.moderation_status = 'valid' AND r.may_publish = true
     ORDER BY l.slug, r.id`,
  );

  const reports = [];
  let mismatches = 0;
  for (const row of rows) {
    const manifest = await manifestFor(row.id, client);
    const fields = immutableFieldsFor(row, manifest);
    const computed = contentHash(fields);
    // A report whose stored hash does not match its own contents is the
    // one thing this file must never quietly normalise away. It is
    // published with the disagreement visible, because a snapshot that
    // silently prints the recomputed value would hide exactly the event
    // the whole system exists to reveal.
    if (computed !== row.content_hash) mismatches += 1;
    reports.push({
      public_ref: row.public_ref,
      logbook: row.logbook_slug,
      recipe: row.recipe || 1,
      hashed_fields: fields,
      content_hash: row.content_hash,
      prev_chain_hash: row.prev_chain_hash,
      chain_hash: row.chain_hash,
      ...(computed === row.content_hash ? {} : { content_hash_recomputed: computed }),
    });
  }

  // The questions the reports above were answered against, by the hash each
  // one seals as `logbook_form`. Only the versions in use here.
  const wanted = [...new Set(reports.map((r) => r.hashed_fields.logbook_form).filter(Boolean))];
  const { rows: forms } = wanted.length
    ? await client.query(
      'SELECT form_hash AS hash, definition FROM logbook_forms WHERE form_hash = ANY($1::text[]) ORDER BY id',
      [wanted])
    : { rows: [] };

  return {
    snapshot_format: SNAPSHOT_FORMAT,
    date,
    // Every logbook's chain as it stands: its latest link and how many
    // reports it holds, published or not. This is the list the day's anchor
    // timestamps. A chain usually cannot be recomputed end to end from this
    // file alone, because unpublished reports sit in it too — normal, and
    // said so below rather than left to look like an error.
    // The anchor passes the exact list it timestamped, so the two files
    // committed together can never disagree about it.
    chains: heads || await currentHeads(client),
    report_count: reports.length,
    ...(mismatches ? { reports_not_matching_their_own_hash: mismatches } : {}),
    how_to_check: [
      'Each report lists hashed_fields exactly as they were hashed.',
      'Serialize hashed_fields with RFC 8785 (JCS) and take its SHA-256:',
      'that is content_hash. Then chain_hash = SHA256(content_hash + prev_chain_hash).',
      'Every logbook is its own chain. Its first report links to',
      'SHA256("reportlog-chain:" + the logbook\'s slug), not to zeros.',
    ].join(' '),
    notes: [
      'Published reports only. A report withdrawn after a snapshot was',
      'published stops appearing in later snapshots; it is not removed from',
      'earlier ones, which are already public.',
      'chains covers every report in each logbook, including any not',
      'published here. The daily anchor is what ties it to an outside timestamp.',
      'Observer identity and contact details are not part of the',
      'fingerprint and are not in this file.',
    ].join(' '),
    ...(forms.length ? { forms } : {}),
    reports,
  };
}

export function serializeSnapshot(snapshot) {
  // Canonical JSON, so a snapshot regenerated from the same data is
  // byte-identical and the git history shows only real changes.
  return `${canonicalize(snapshot)}\n`;
}
