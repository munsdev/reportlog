// Re-derive a report's fingerprint from the stored row and say whether it
// still matches what was recorded.
//
// This is the part of the system that has to be checkable by someone who
// does not trust us, so it is deliberately built out of the same functions
// that wrote the hash in the first place — buildImmutableFields and
// contentHash — rather than a second implementation that could drift into
// agreeing when it should not. A verifier that reimplements the recipe can
// be wrong in the same direction as the bug it is meant to catch.
//
// Nothing here reads Tier B. The fingerprint has never covered observer
// identity or contact details, so verification never needs to touch them
// and this path never becomes an unaudited route to them.

import canonicalize from 'canonicalize';
import { pool } from './db.js';
import { buildImmutableFields } from './reportCore.js';
import { contentHash, chainHash, chainGenesis } from './crypto.js';

/**
 * The exact field set that was hashed, rebuilt from a stored row.
 *
 * Match normalizeReportFields in reportCore.js key for key. The
 * conditional keys are the whole subtlety: `answers` and the provenance
 * block are written only when they apply, so rebuilding them
 * unconditionally — even as null — produces "does not verify" for a report
 * that is perfectly intact.
 */
export function immutableFieldsFor(row, manifest) {
  const ordered = {
    // Rebuilt from the join in verifyReport, not from an id: the slug is
    // what was sealed. A logbook row can never be deleted out from under a
    // report because reports.logbook_id references it with no cascade.
    logbook: row.logbook_slug,
    // The version of the questions this was answered against, when it has
    // one. `logbook_form` comes from a join on logbook_forms; a row that has
    // a form_id and no hash was fetched without the join, which would
    // silently rebuild a different object, so it is refused instead.
    ...(row.form_id ? { logbook_form: requireFormHash(row) } : {}),
    ...(row.answers && Object.keys(row.answers).length ? { answers: row.answers } : {}),
    // Third-party provenance, under the same condition as it was written.
    ...(row.third_party ? {
      third_party: true,
      filed_via: row.filed_via,
      intake_method: row.intake_method,
      attested_at: row.attested_at instanceof Date
        ? row.attested_at.toISOString() : row.attested_at,
      ...(row.collected_on ? { collected_on: toDateString(row.collected_on) } : {}),
    } : {}),
    may_publish: row.may_publish,
    may_publish_digest: row.may_publish_digest,
  };

  return buildImmutableFields({
    publicRef: row.public_ref,
    receivedAt: row.received_at.toISOString(),
    threadId: row.thread_id,
    correctsId: row.corrects_id,
    recipe: row.recipe || 1,
    fields: ordered,
    attachmentManifest: manifest,
  });
}

function requireFormHash(row) {
  if (!row.logbook_form) {
    throw new Error('immutableFieldsFor: the row has a form_id but no logbook_form — join logbook_forms (FORM_JOIN)');
  }
  return row.logbook_form;
}

/** The join every query that feeds immutableFieldsFor must include. */
export const FORM_JOIN = 'LEFT JOIN logbook_forms lf ON lf.id = r.form_id';
export const FORM_COLUMN = 'lf.form_hash AS logbook_form';

function toDateString(v) {
  if (!v) return v;
  if (typeof v === 'string') return v.slice(0, 10);
  return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, '0')}-${String(v.getUTCDate()).padStart(2, '0')}`;
}

/**
 * The attachment manifest exactly as buildManifest produced it at confirm
 * time — ordered, and null rather than [] when there is nothing, because
 * an empty array hashes differently from an absent key.
 */
export async function manifestFor(reportId, client = pool) {
  // THROUGH report_attachments, which is what a version commits to.
  // `attachments.report_id` names only the version a file first arrived
  // with, so rebuilding a corrected report's manifest from it produced an
  // empty manifest — an absent `attachments` key, and a version that
  // verified cleanly while its files had become unreachable. Migration 033.
  const { rows } = await client.query(
    `SELECT a.ordinal, a.sha256, a.byte_size, a.media_type
     FROM report_attachments ra JOIN attachments a ON a.id = ra.attachment_id
     WHERE ra.report_id = $1 ORDER BY a.ordinal`,
    [reportId],
  );
  if (!rows.length) return null;
  return rows.map((a) => ({
    ordinal: a.ordinal,
    sha256: a.sha256,
    byte_size: Number(a.byte_size),
    media_type: a.media_type,
  }));
}

/*
 * There was a hand-written column list here, naming every column
 * immutableFieldsFor reads. It had already drifted three times: a column
 * added to the hashed object but forgotten in the list comes back
 * `undefined`, which is not the same as the value that was sealed, so the
 * report fails to verify — or worse, quietly rebuilds a different object.
 * The list existed only so one query could avoid `*`, and it had to agree
 * with a function fifty lines above it that nothing forced it to match.
 *
 * It is gone. This is a single row fetched by unique key, the function's
 * whole job is "rebuild from the row", and a column added by a future
 * migration is now picked up automatically rather than silently missed.
 */

/**
 * Check one report, by its public reference.
 *
 * Reports four separate things rather than one verdict, because they fail
 * for different reasons and a reader deserves to know which:
 *
 *   content   the report's own contents still hash to the recorded value.
 *             This is the one that says the text has not been edited.
 *   link      chain_hash really is this report's content hash combined
 *             with the one before it.
 *   position  the report before it in the chain is the one this row claims
 *             follows. This is what makes an insertion or deletion visible
 *             rather than just an edit.
 *   anchor    a timestamp from an outside authority that covers this
 *             report, so the whole chain could not have been rebuilt after
 *             the fact.
 */
export async function verifyReport(publicRef, client = pool) {
  const { rows } = await client.query(
    `SELECT r.*, l.slug AS logbook_slug, l.title AS logbook_title, ${FORM_COLUMN}
       FROM reports r JOIN logbooks l ON l.id = r.logbook_id ${FORM_JOIN}
      WHERE r.public_ref = $1`, [publicRef],
  );
  const row = rows[0];
  if (!row) return null;

  const manifest = await manifestFor(row.id, client);
  const fields = immutableFieldsFor(row, manifest);
  const canonical = canonicalize(fields);
  const computedContent = contentHash(fields);
  const computedChain = chainHash(computedContent, row.prev_chain_hash);

  // The row immediately before this one IN ITS LOGBOOK'S CHAIN. Ordering by
  // id is the order insertReportVersion appends in, under that logbook's
  // lock, so there is exactly one predecessor. The first report of a
  // logbook links to that logbook's starting value, not to zeros.
  const { rows: prevRows } = await client.query(
    `SELECT chain_hash FROM reports
      WHERE logbook_id = $1 AND id < $2 ORDER BY id DESC LIMIT 1`,
    [row.logbook_id, row.id],
  );
  const expectedPrev = prevRows[0]?.chain_hash || chainGenesis(row.logbook_slug);

  // An anchor covers this report when the head it recorded for this
  // logbook is this report or one after it in the same chain — that is
  // what it means for this row to already have been folded into the value
  // that was timestamped. The earliest such anchor is the tightest claim
  // about when the report demonstrably existed.
  const { rows: anchorRows } = await client.query(
    `SELECT a.anchor_date, a.public_log_ref, a.root_chain_hash, ah.head_chain_hash
     FROM chain_anchor_heads ah
     JOIN chain_anchors a ON a.id = ah.anchor_id
     JOIN reports r2 ON r2.chain_hash = ah.head_chain_hash
     WHERE ah.logbook_slug = $1 AND r2.logbook_id = $2 AND r2.id >= $3
     ORDER BY a.anchor_date ASC
     LIMIT 1`,
    [row.logbook_slug, row.logbook_id, row.id],
  );

  return {
    public_ref: row.public_ref,
    recipe: row.recipe || 1,
    received_at: row.received_at.toISOString(),
    // WHICH CHAIN. Every logbook is its own; the start is recomputable from
    // the slug by anybody (see chainGenesis).
    chain: {
      logbook: row.logbook_slug,
      logbook_title: row.logbook_title,
      genesis: chainGenesis(row.logbook_slug),
    },
    // What was hashed, and the exact bytes it was hashed as — so anyone can
    // run sha256 over this string themselves and compare, without needing
    // our code or taking our word for the result.
    hashed_fields: fields,
    canonical_json: canonical,
    content: {
      recorded: row.content_hash,
      computed: computedContent,
      ok: computedContent === row.content_hash,
    },
    link: {
      recorded: row.chain_hash,
      computed: computedChain,
      prev_chain_hash: row.prev_chain_hash,
      ok: computedChain === row.chain_hash,
    },
    position: {
      expected_prev: expectedPrev,
      recorded_prev: row.prev_chain_hash,
      ok: expectedPrev === row.prev_chain_hash,
      is_first: !prevRows[0],
    },
    anchor: anchorRows[0]
      ? {
        anchored: true,
        date: anchorRows[0].anchor_date instanceof Date
          ? anchorRows[0].anchor_date.toISOString().slice(0, 10)
          : String(anchorRows[0].anchor_date).slice(0, 10),
        root_chain_hash: anchorRows[0].root_chain_hash,
        // The head this logbook had in that day's list. The list itself is
        // what root_chain_hash is the digest of.
        logbook_head: anchorRows[0].head_chain_hash,
        public_log_ref: anchorRows[0].public_log_ref,
      }
      // Not a failure. The chain is anchored once a day, so a report filed
      // this morning is genuinely not covered yet, and saying "no" plainly
      // is better than implying something is wrong with it.
      : { anchored: false },
  };
}
