/**
 * One logbook's chain as a file anybody can check with `checkChainFile` from
 * @reportlog/seal, without this server.
 *
 * `complete` carries every version, published or not, and is for
 * administrators. `published` carries only what the public board shows.
 */
import {
  CHAIN_FILE_FORMAT,
  HOW_TO_CHECK,
  chainGenesis,
  rebuildSealedObject,
} from '@reportlog/seal';
import type { ChainFile } from '@reportlog/seal';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.gen.ts';
import { formVersions } from './forms.ts';
import { manifestFor, sealedReportRows, toStoredRecord } from './record.ts';

export async function buildChainFile(
  db: Kysely<DB>,
  logbookId: number,
  { publishedOnly = false }: { publishedOnly?: boolean } = {},
): Promise<ChainFile | null> {
  const lb = await db
    .selectFrom('logbooks')
    .select(['id', 'slug', 'title'])
    .where('id', '=', logbookId)
    .where('launched_at', 'is not', null)
    .executeTakeFirst();
  if (!lb) return null;

  let query = sealedReportRows(db).where('r.logbook_id', '=', lb.id);
  if (publishedOnly) {
    query = query
      .innerJoin('report_heads as h', 'h.current_report_id', 'r.id')
      .where('h.withdrawn', '=', false)
      .where('h.moderation_status', '=', 'valid')
      .where('r.may_publish', '=', true);
  }
  const rows = await query.orderBy('r.id').execute();

  const reports = [];
  for (const row of rows) {
    reports.push({
      public_ref: row.public_ref,
      hashed_fields: rebuildSealedObject(toStoredRecord(row), await manifestFor(db, row.id)),
      content_hash: row.content_hash,
      prev_chain_hash: row.prev_chain_hash,
      chain_hash: row.chain_hash,
    });
  }

  const anchors = await db
    .selectFrom('chain_anchor_heads as ah')
    .innerJoin('chain_anchors as a', 'a.id', 'ah.anchor_id')
    .select([
      'a.anchor_date',
      'a.root_chain_hash',
      'a.public_log_ref',
      'ah.head_chain_hash',
      'ah.report_count',
    ])
    .where('ah.logbook_slug', '=', lb.slug)
    .orderBy('a.id')
    .execute();
  const count = await db
    .selectFrom('reports')
    .select((e) => e.fn.countAll<string>().as('n'))
    .where('logbook_id', '=', lb.id)
    .executeTakeFirstOrThrow();

  return {
    chain_file_format: CHAIN_FILE_FORMAT,
    kind: publishedOnly ? 'published' : 'complete',
    logbook: lb.slug,
    title: lb.title,
    genesis: chainGenesis(lb.slug),
    // How many reports the whole chain holds, published or not.
    chain_length: Number(count.n),
    exported_at: new Date().toISOString(),
    forms: await formVersions(db, lb.id),
    how_to_check: HOW_TO_CHECK,
    anchors: anchors.map((a) => ({
      date: a.anchor_date,
      head: a.head_chain_hash,
      reports: a.report_count,
      root_chain_hash: a.root_chain_hash,
      public_log_ref: a.public_log_ref,
    })),
    reports,
  };
}
