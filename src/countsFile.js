/**
 * The daily counts file: what the lists an operator published add up to,
 * timestamped beside the reports anchor.
 *
 * A SEPARATE FILE WITH ITS OWN TIMESTAMP, NOT A FIELD IN THE ANCHOR. The
 * anchor's signed digest is defined over {anchor_format, date, chains} and
 * every anchor already published is checked against exactly that. Folding
 * counts into it would change what the anchor format means; the
 * transparency log is never rewritten, not even to improve it. So the
 * counts get their own digest and their own token from the same authority,
 * in the same commit, and the anchor is untouched.
 *
 * WHAT IT FIXES. A list's rows are editable by whoever runs the server; a
 * logbook's are not. Once a day's counts are timestamped and mirrored, a
 * later edit to the rows behind them shows as a disagreement with the
 * published file — the same property the reports have, one day coarser.
 *
 * Nothing here reads a report, and nothing under src/lists/ imports this.
 */
import canonicalize from 'canonicalize';
import { sha256Hex } from './crypto.js';

export const COUNTS_FORMAT = 1;

/**
 * The record for one day, minus the token. `digest` is what the authority
 * is asked to sign: sha256 of {counts_format, date, lists} under RFC 8785,
 * recomputable by anybody from the file itself.
 */
export function countsRecord(date, doc) {
  const lists = doc.lists.map((l) => ({
    slug: l.slug,
    title: l.title,
    definition: l.definition,
    totals: { received: l.totals.received, approved: l.totals.approved },
    fields: l.fields.map((f) => ({
      key: f.key, label: f.label, kind: f.kind,
      values: f.values.map((v) => ({ value: v.value, received: v.received, approved: v.approved })),
    })),
  }));
  const signed = { counts_format: COUNTS_FORMAT, date, lists };
  return { ...signed, digest: sha256Hex(canonicalize(signed)) };
}

/** Anybody's check: does this file's digest match its own contents. */
export function countsDigestMatches(record) {
  const { counts_format: f, date, lists } = record;
  return sha256Hex(canonicalize({ counts_format: f, date, lists })) === record.digest;
}
