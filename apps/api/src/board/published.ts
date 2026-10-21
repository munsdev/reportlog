/**
 * WHAT IS PUBLIC, once. Every reader of the published record uses this: the
 * board, the published chain file (D2), the daily snapshot in the
 * transparency log (D2) and the heat maps (I). If the rule gains a condition,
 * it gains it here and every one of them follows, so the board and the chain
 * file can never disagree about what is public.
 *
 * A report is public when the CURRENT version of its thread
 *   - was approved by a moderator (`moderation_status = 'valid'`),
 *   - has not been withdrawn, by its reporter or by staff, and
 *   - was filed with permission to publish (`may_publish`, sealed).
 *
 * The operator's public-archive switch (publication.ts) is a second gate,
 * asked by each public READ before it serves anything. It is deliberately not
 * in this rule: whether a report is published is a fact about the report, and
 * the switch is whether the site shows its archive this week.
 *
 * A LEAF MODULE: it imports nothing from the application, so the chain code,
 * which may not reach board/ (.dependency-cruiser.cjs), can be handed the
 * subquery without importing it.
 */
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.gen.ts';

/**
 * The ids of every published report version, as a subquery:
 * `.where('r.id', 'in', publishedReportIds(db))`. A scalar expression, so a
 * caller can be handed it typed as plain `Expression<number>`.
 */
export function publishedReportIds(db: Kysely<DB>) {
  return db
    .selectFrom('report_heads as published_h')
    .innerJoin('reports as published_r', 'published_r.id', 'published_h.current_report_id')
    .select('published_h.current_report_id')
    .where('published_h.withdrawn', '=', false)
    .where('published_h.moderation_status', '=', 'valid')
    .where('published_r.may_publish', '=', true)
    .$asScalar();
}

/**
 * PUBLISHED, AND SHOWN ONE BY ONE. A logbook set to "publish as counts only"
 * (board/countsOnly.ts) has its published reports counted on every count,
 * map and figure, and shown as an entry nowhere: not on the board, its
 * spreadsheet, one report's page, the verify page's text, the published
 * chain file, the daily snapshot, a digest or a published file. Every read
 * that shows a report itself asks this; every read that counts asks
 * `publishedReportIds`.
 */
export function listedReportIds(db: Kysely<DB>) {
  return db
    .selectFrom('report_heads as listed_h')
    .innerJoin('reports as listed_r', 'listed_r.id', 'listed_h.current_report_id')
    .select('listed_h.current_report_id')
    .where('listed_h.withdrawn', '=', false)
    .where('listed_h.moderation_status', '=', 'valid')
    .where('listed_r.may_publish', '=', true)
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom('logbook_publication as listed_p')
            .whereRef('listed_p.logbook_id', '=', 'listed_r.logbook_id')
            .where('listed_p.counts_only', '=', true),
        ),
      ),
    )
    .$asScalar();
}

/** The same rule over a thread's head row already in hand. */
export const isPublic = (r: {
  withdrawn: boolean;
  moderation_status: string;
  may_publish: boolean;
}) => !r.withdrawn && r.moderation_status === 'valid' && r.may_publish;
