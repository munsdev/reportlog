/**
 * THE LIST OF CHAINS, and the one value the daily timestamp covers.
 *
 * Every launched logbook is its own chain. Once a day scripts/anchor.js
 * takes this list — every launched logbook, its latest link, how many
 * reports are in it — and gets a timestamp from an outside authority over
 * its digest. One timestamp covers every chain, and each chain is checked
 * against its own line of the list without needing any other.
 *
 * A logbook with no reports yet is still listed, at its starting value
 * (chainGenesis) with a count of 0. It exists from the moment it launches,
 * and listing it from then on is what makes its later disappearance
 * visible.
 *
 * ONCE LISTED, ALWAYS LISTED. With separate chains, deleting a whole
 * logbook would leave every other chain intact and nothing inside them
 * would notice. The list notices: a logbook named in a published anchor
 * must be named in every later one, and its count can only grow.
 * `contradictions` finds any that break either rule, and the anchor script
 * refuses to publish a list that does.
 */
import canonicalize from 'canonicalize';
import { pool } from './db.js';
import { sha256Hex, chainGenesis } from './crypto.js';

export const ANCHOR_FORMAT = 2;

/** Every launched logbook's chain as it stands, sorted by slug. */
export async function currentHeads(client = pool) {
  const { rows } = await client.query(
    `SELECT l.slug,
            (SELECT r.chain_hash FROM reports r WHERE r.logbook_id = l.id
              ORDER BY r.id DESC LIMIT 1) AS head,
            (SELECT count(*) FROM reports r WHERE r.logbook_id = l.id)::int AS n
       FROM logbooks l
      WHERE l.launched_at IS NOT NULL
      ORDER BY l.slug`,
  );
  return rows.map((r) => ({
    logbook: r.slug,
    head: r.head || chainGenesis(r.slug),
    reports: r.n,
  }));
}

/**
 * The value that gets timestamped: SHA-256 of the list, serialized with
 * RFC 8785, lowercase hex. Anybody holding the published list can
 * recompute it.
 */
export function headsDigest(date, heads) {
  return sha256Hex(canonicalize({ anchor_format: ANCHOR_FORMAT, date, chains: heads }));
}

/**
 * What the most recent published anchor says that `heads` contradicts:
 * logbooks it named that are gone, and chains that now hold fewer reports
 * than it counted. Either is what deleting reports looks like, and neither
 * can happen honestly — nothing deletes a report or a logbook.
 */
export async function contradictions(heads, client = pool) {
  const { rows } = await client.query(
    `SELECT ah.logbook_slug, ah.report_count
       FROM chain_anchor_heads ah
      WHERE ah.anchor_id = (SELECT max(id) FROM chain_anchors)`,
  );
  const now = new Map(heads.map((h) => [h.logbook, h]));
  return {
    dropped: rows.filter((r) => !now.has(r.logbook_slug)).map((r) => r.logbook_slug),
    shrunk: rows
      .filter((r) => now.has(r.logbook_slug) && now.get(r.logbook_slug).reports < r.report_count)
      .map((r) => ({ logbook: r.logbook_slug, was: r.report_count, now: now.get(r.logbook_slug).reports })),
  };
}
