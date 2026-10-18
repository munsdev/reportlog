/**
 * Every launched logbook's chain as it stands, and what the last published
 * anchor said. The rule they are compared under is `contradictions` in
 * @reportlog/seal.
 */
import { chainGenesis } from '@reportlog/seal';
import type { ChainHead } from '@reportlog/seal';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.gen.ts';

/** Sorted by slug. A logbook with no reports is listed at its genesis with 0. */
export async function currentHeads(db: Kysely<DB>): Promise<ChainHead[]> {
  const rows = await db
    .selectFrom('logbooks as l')
    .select((eb) => [
      'l.slug',
      eb
        .selectFrom('reports as r')
        .select('r.chain_hash')
        .whereRef('r.logbook_id', '=', 'l.id')
        .orderBy('r.id', 'desc')
        .limit(1)
        .as('head'),
      eb
        .selectFrom('reports as r')
        .select((e) => e.fn.countAll<string>().as('n'))
        .whereRef('r.logbook_id', '=', 'l.id')
        .as('n'),
    ])
    .where('l.launched_at', 'is not', null)
    .orderBy('l.slug')
    .execute();
  return rows.map((r) => ({
    logbook: r.slug,
    head: r.head ?? chainGenesis(r.slug),
    reports: Number(r.n ?? 0),
  }));
}

/** The chains the most recent published anchor listed. Empty before the first. */
export async function lastPublishedHeads(
  db: Kysely<DB>,
): Promise<{ logbook: string; reports: number }[]> {
  const rows = await db
    .selectFrom('chain_anchor_heads')
    .select(['logbook_slug', 'report_count'])
    .where('anchor_id', '=', (eb) =>
      eb.selectFrom('chain_anchors').select((e) => e.fn.max('id').as('id')),
    )
    .execute();
  return rows.map((r) => ({ logbook: r.logbook_slug, reports: r.report_count }));
}
