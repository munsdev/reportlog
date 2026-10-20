/**
 * Re-derive a report's fingerprint from what is stored and say whether it
 * still matches what was recorded.
 *
 * Built from the same functions that sealed it (`rebuildSealedObject`,
 * `contentHash`), not a second implementation that could drift into agreeing
 * when it should not. Nothing here reads anything that names or reaches a
 * reporter: the fingerprint has never covered that, so verification never
 * becomes a route to it.
 */
import type { Verification } from '@reportlog/contracts';
import {
  canonicalJson,
  chainGenesis,
  chainHash,
  contentHash,
  rebuildSealedObject,
} from '@reportlog/seal';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.gen.ts';
import { manifestFor, sealedReportRows, toStoredRecord } from './record.ts';

/**
 * The whole answer, text included. Whether a caller may SEE the text is not
 * decided here (routes/verify.ts, decisions.md §1).
 */
export type FullVerification = Verification & {
  hashed_fields: Record<string, unknown>;
  canonical_json: string;
};

export async function verifyReport(
  db: Kysely<DB>,
  publicRef: string,
): Promise<FullVerification | null> {
  const row = await sealedReportRows(db).where('r.public_ref', '=', publicRef).executeTakeFirst();
  if (!row) return null;

  const sealed = rebuildSealedObject(toStoredRecord(row), await manifestFor(db, row.id));
  const computedContent = contentHash(sealed);
  const computedChain = chainHash(computedContent, row.prev_chain_hash);

  // The row immediately before this one IN ITS LOGBOOK'S CHAIN.
  const prev = await db
    .selectFrom('reports')
    .select('chain_hash')
    .where('logbook_id', '=', row.logbook_id)
    .where('id', '<', row.id)
    .orderBy('id', 'desc')
    .limit(1)
    .executeTakeFirst();
  const expectedPrev = prev?.chain_hash ?? chainGenesis(row.logbook_slug);

  // An anchor covers this report when the head it recorded for this logbook
  // is this report or a later one in the same chain. The earliest such anchor
  // is the tightest claim about when the report demonstrably existed.
  const anchor = await db
    .selectFrom('chain_anchor_heads as ah')
    .innerJoin('chain_anchors as a', 'a.id', 'ah.anchor_id')
    .innerJoin('reports as r2', 'r2.chain_hash', 'ah.head_chain_hash')
    .select(['a.anchor_date', 'a.public_log_ref', 'a.root_chain_hash', 'ah.head_chain_hash'])
    .where('ah.logbook_slug', '=', row.logbook_slug)
    .where('r2.logbook_id', '=', row.logbook_id)
    .where('r2.id', '>=', row.id)
    .orderBy('a.anchor_date')
    .limit(1)
    .executeTakeFirst();

  return {
    public_ref: row.public_ref,
    recipe: row.recipe,
    received_at: sealed.received_at,
    chain: {
      logbook: row.logbook_slug,
      logbook_title: row.logbook_title,
      genesis: chainGenesis(row.logbook_slug),
    },
    // What was hashed, and the exact bytes it was hashed as, so anyone can
    // run sha256 over this string themselves.
    hashed_fields: { ...sealed },
    canonical_json: canonicalJson(sealed),
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
      is_first: !prev,
    },
    // Not being anchored yet is not a failure: the chain is anchored once a
    // day, and a report filed this morning is genuinely not covered yet.
    anchor: anchor
      ? {
          anchored: true,
          date: anchor.anchor_date,
          root_chain_hash: anchor.root_chain_hash,
          logbook_head: anchor.head_chain_hash,
          public_log_ref: anchor.public_log_ref,
        }
      : { anchored: false },
  };
}
