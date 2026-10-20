/**
 * The published counts.
 *
 * NO BARE TOTAL. Every count arrives already broken out: by what happened to
 * it, by logbook, and within a logbook by the questions its maker marked as
 * filters. A number quoted from here carries its own qualification, because
 * no unqualified number is on offer.
 *
 * THE DENOMINATOR IS VISIBLE. Declined, still-under-review, withdrawn and
 * not-permitted reports are counted beside the published ones, with no
 * content and no identity. Every confirmed report already holds a place in a
 * chain, so this exposes only what the chain records, and it turns "trust
 * our moderation" into "audit our moderation".
 *
 * Never-confirmed submissions are absent by design: they never entered the
 * record. One implementation serves the site's own page and anybody outside,
 * so the two figures can never disagree.
 */
import { placeLabel } from '@reportlog/fields';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.gen.ts';
import { filterableFields, launchedLogbooks } from '../logbooks/logbooks.ts';
import { everyHead, isPublic } from './board.ts';
import { placeGuards } from './places.ts';

export const STATS_NOTE =
  'Counts of reviewed first-hand accounts, not verified facts. Published means a moderator judged a report publishable, which is a weaker claim than true.';

type Head = Awaited<ReturnType<typeof everyHead>>[number];

export type Disposition =
  'published' | 'not_permitted' | 'under_review' | 'declined' | 'unclear' | 'withdrawn';

/**
 * Checked in this order on purpose: withdrawn first, and "approved but its
 * reporter did not permit publishing" before "published". Consent is the
 * ceiling, moderation is the floor.
 */
export function disposition(
  r: Pick<Head, 'withdrawn' | 'moderation_status' | 'may_publish'>,
): Disposition {
  if (r.withdrawn) return 'withdrawn';
  if (r.moderation_status === 'valid') return r.may_publish ? 'published' : 'not_permitted';
  if (r.moderation_status === 'invalid') return 'declined';
  if (r.moderation_status === 'unknown') return 'unclear';
  return 'under_review';
}

/** One answer as the words a count is listed under. */
export function answerText(kind: string, v: unknown): string {
  if (kind === 'location' && typeof v === 'string') return placeLabel(v);
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  return JSON.stringify(v);
}

export interface Stats {
  as_of: string;
  note: string;
  confirmed_reports: {
    by_disposition: Record<Disposition, number>;
    excludes: string;
  };
  published_reports: {
    by_logbook: Record<
      string,
      {
        title: string;
        published: number;
        by_question: Record<
          string,
          {
            label: string;
            counts: Record<string, number>;
            unanswered: number;
            withheld?: { threshold: number; areas: string[]; reports: number | null };
          }
        >;
      }
    >;
  };
}

export async function computeStats(db: Kysely<DB>): Promise<Stats> {
  const heads = await everyHead(db);
  const by: Record<Disposition, number> = {
    published: 0,
    not_permitted: 0,
    under_review: 0,
    declined: 0,
    unclear: 0,
    withdrawn: 0,
  };
  for (const h of heads) by[disposition(h)] += 1;
  const pub = heads.filter(isPublic);

  const byLogbook: Stats['published_reports']['by_logbook'] = {};
  const guards = await placeGuards(db);
  for (const lb of await launchedLogbooks(db)) {
    const mine = pub.filter((r) => r.logbook_id === lb.id);
    const byQuestion: Stats['published_reports']['by_logbook'][string]['by_question'] = {};
    // NOTHING IS BROKEN OUT UNLESS AN OPERATOR SAID SO, the board's rule.
    for (const f of await filterableFields(db, lb.id)) {
      const counts: Record<string, number> = {};
      let unanswered = 0;
      for (const r of mine) {
        const v = (r.answers as Record<string, unknown> | null)?.[f.key];
        if (v === undefined) {
          unanswered += 1;
          continue;
        }
        // A multiple choice counts once under each choice ticked: "how many
        // reports mention this", which is why these can add up to more.
        for (const one of Array.isArray(v) ? (v as unknown[]) : [v]) {
          const k = answerText(f.kind, one);
          counts[k] = (counts[k] ?? 0) + 1;
        }
      }
      const guard = guards.get(lb.id);
      if (guard?.key !== f.key) {
        byQuestion[f.key] = { label: f.label, counts, unanswered };
        continue;
      }
      // THE MAP'S THRESHOLD, KEPT (board/places.ts): an area under it is
      // named without its count, and the sum is given only for two or more.
      const shown: Record<string, number> = {};
      const areas: string[] = [];
      let sum = 0;
      for (const [area, n] of Object.entries(counts)) {
        if (n >= guard.threshold) shown[area] = n;
        else {
          areas.push(area);
          sum += n;
        }
      }
      byQuestion[f.key] = {
        label: f.label,
        counts: shown,
        unanswered,
        ...(areas.length
          ? {
              withheld: {
                threshold: guard.threshold,
                areas: areas.sort((a, b) => a.localeCompare(b)),
                reports: areas.length >= 2 ? sum : null,
              },
            }
          : {}),
      };
    }
    byLogbook[lb.slug] = { title: lb.title, published: mine.length, by_question: byQuestion };
  }

  return {
    as_of: new Date().toISOString(),
    note: STATS_NOTE,
    confirmed_reports: {
      by_disposition: by,
      excludes:
        'Submissions never confirmed by email are not counted: they never entered the record.',
    },
    published_reports: { by_logbook: byLogbook },
  };
}

/**
 * One computation serves every caller for a while: it walks every report
 * head, and a widget polling every few seconds should not be a full scan each
 * time. A minute is well under how often these numbers meaningfully change.
 */
export function cachedStats(db: Kysely<DB>, ttlMs: number) {
  let cached: { at: number; value: Stats } | null = null;
  return async (): Promise<Stats> => {
    if (cached && Date.now() - cached.at < ttlMs) return cached.value;
    const value = await computeStats(db);
    cached = { at: Date.now(), value };
    return value;
  };
}
