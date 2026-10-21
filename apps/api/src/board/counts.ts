/**
 * The public counts Plan E adds (session PE3): published reports by where
 * they came from, by place and by arrival time; and declined reports by the
 * reason given.
 *
 * COUNTS ONLY. No reference, no answer text, no time finer than the hour,
 * and nothing about who filed or who moderated. A place under the
 * logbook's small-area threshold, or a heat map's, is named without its
 * count, as on the numbers page (board/places.ts, `countGuards`).
 *
 * PUBLISHED MEANS THE BOARD'S RULE (`publishedReportIds`), counts-only
 * logbooks included: that setting changes how a report is shown, not
 * whether it is counted. Nothing pending or unclear is counted anywhere.
 *
 * DECLINED REPORTS ARE COUNTED BY REASON (Plan E, owner decisions of
 * 2026-10-21, which amend decision 36 for this one route, recorded as a
 * decision row of its own in docs/decisions.md): how many a
 * moderator turned down and why, so a reader can see a flood was refused
 * rather than quietly dropped. Only the number and the reason from the
 * fixed list; never which report, never its words, never the moderator's
 * own sentence.
 *
 * BOTH ASK THE ARCHIVE SWITCH: a site that publishes no archive publishes no
 * counts over it (board/routes.ts says why).
 */
import { REJECTION_REASONS } from '@reportlog/contracts';
import { LOCATION_TYPE, placeLabel } from '@reportlog/fields';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.gen.ts';
import { launchedLogbooks } from '../logbooks/logbooks.ts';
import { countsOnlyLogbooks } from '../moderation/switches.ts';
import { originLabels, originOf } from './origin.ts';
import type { Origin } from './origin.ts';
import { countGuards } from './places.ts';
import { publicArchiveAvailable } from './publication.ts';
import { publishedReportIds } from './published.ts';

export const COUNTS_NOTE =
  'Counts of reports a moderator accepted for publication, by where they came from. Reports from the open form are not checked: anybody could have sent them. Times are when each report first arrived, in UTC.';

export const DECLINED_NOTE =
  'How many reports a moderator declined, by the reason given. Declined reports stay in the sealed record and are never published; only these numbers are.';

/** How far back the hourly arrivals go. The daily counts cover the whole life. */
export const HOURLY_DAYS = 14;

interface Split {
  organization: number;
  open_form: number;
}
const zero = (): Split => ({ organization: 0, open_form: 0 });
const add = (m: Map<string, Split>, key: string, origin: Origin) => {
  const s = m.get(key) ?? zero();
  s[origin] += 1;
  m.set(key, s);
};
const sorted = <K extends string>(m: Map<string, Split>, as: K) =>
  [...m.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => ({ [as]: k, ...v }) as Record<K, string> & Split);

export async function publicCounts(db: Kysely<DB>) {
  if (!(await publicArchiveAvailable(db))) return null;
  const heads = await db
    .selectFrom('report_heads as h')
    .innerJoin('reports as r', 'r.id', 'h.current_report_id')
    .select((eb) => [
      'r.logbook_id',
      'r.third_party',
      'r.answers',
      // When the thread first arrived: a correction is not a new arrival.
      eb
        .selectFrom('reports as x')
        .whereRef('x.thread_id', '=', 'h.thread_id')
        .select((e) => e.fn.min('x.received_at').as('t'))
        .as('first_at'),
    ])
    .where('r.id', 'in', publishedReportIds(db))
    .execute();
  const countsOnly = await countsOnlyLogbooks(db);
  const guards = await countGuards(db);
  const hourlyFrom = Date.now() - HOURLY_DAYS * 86_400_000;

  const logbooks = [];
  for (const lb of await launchedLogbooks(db)) {
    const mine = heads.filter((h) => h.logbook_id === lb.id);
    const published = zero();
    const byHour = new Map<string, Split>();
    const byDay = new Map<string, Split>();
    const byPlace = new Map<string, Split>();
    const only = countsOnly.has(lb.id);
    const placeKeys = only
      ? (
          await db
            .selectFrom('logbook_fields')
            .select('key')
            .where('logbook_id', '=', lb.id)
            .where('kind', '=', LOCATION_TYPE)
            .execute()
        ).map((f) => f.key)
      : [];
    for (const h of mine) {
      const origin = originOf(h);
      published[origin] += 1;
      const at = h.first_at ? new Date(h.first_at) : null;
      if (at && at.getTime() >= hourlyFrom) {
        const hour = new Date(at);
        hour.setUTCMinutes(0, 0, 0);
        add(byHour, hour.toISOString(), origin);
      }
      if (!only) continue;
      if (at) add(byDay, at.toISOString().slice(0, 10), origin);
      const answers = (h.answers ?? {}) as Record<string, unknown>;
      // Once per place per report, whichever of its place questions said it.
      const places = new Set(
        placeKeys.map((k) => answers[k]).filter((v): v is string => typeof v === 'string'),
      );
      for (const p of places) add(byPlace, p, origin);
    }

    // THE SMALL-AREA THRESHOLD, or the map's if higher, on every place
    // question of a counts-only logbook (board/places.ts). A place under it
    // travels as a name with no number. Only counts-only logbooks count by
    // place here at all.
    const guard = only ? guards.get(lb.id) : undefined;
    const shown: { place: string; label: string; organization: number; open_form: number }[] = [];
    const thin: string[] = [];
    let thinSum = 0;
    for (const p of sorted(byPlace, 'place')) {
      const n = p.organization + p.open_form;
      if (guard && n < guard.threshold) {
        thin.push(placeLabel(p.place));
        thinSum += n;
      } else shown.push({ ...p, label: placeLabel(p.place) });
    }
    logbooks.push({
      slug: lb.slug,
      title: lb.title,
      counts_only: only,
      published,
      by_place: shown,
      ...(guard && thin.length
        ? {
            withheld_places: {
              threshold: guard.threshold,
              areas: thin.sort((a, b) => a.localeCompare(b)),
              // With one area the sum IS its count, as the map says.
              reports: thin.length >= 2 ? thinSum : null,
            },
          }
        : {}),
      by_day: sorted(byDay, 'day'),
      by_hour: sorted(byHour, 'hour'),
    });
  }
  return {
    published: true as const,
    as_of: new Date().toISOString(),
    note: COUNTS_NOTE,
    labels: await originLabels(db),
    logbooks,
  };
}

/** The label of a reason code, or the plain fact that none was recorded. */
export const NO_REASON = 'Declined before reasons were recorded.';
const reasonText = (code: string) =>
  REJECTION_REASONS.find((r) => r.code === code)?.label ?? NO_REASON;

export async function declinedCounts(db: Kysely<DB>) {
  if (!(await publicArchiveAvailable(db))) return null;
  // Declined NOW: a decline put back to pending, or approved, is not one.
  const declined = await db
    .selectFrom('report_heads as h')
    .innerJoin('reports as r', 'r.id', 'h.current_report_id')
    .select(['h.thread_id', 'r.logbook_id'])
    .where('h.moderation_status', '=', 'invalid')
    .where('h.withdrawn', '=', false)
    .execute();
  const threads = declined.map((d) => d.thread_id);
  // The reason of each thread's newest decline: on the decision itself, or,
  // for a decline made before decisions carried it, its notice.
  const reason = new Map<string, string>();
  if (threads.length) {
    const fromNotices = await db
      .selectFrom('decision_notices')
      .select(['thread_id', 'reason_code', 'created_at'])
      .where('thread_id', 'in', threads)
      .execute();
    const fromLog = await db
      .selectFrom('moderation_log')
      .select(['thread_id', 'reason_code', 'created_at'])
      .where('thread_id', 'in', threads)
      .where('action', '=', 'review')
      .where('new_status', '=', 'invalid')
      .where('reason_code', 'is not', null)
      .execute();
    // Oldest first, so the newest decline's reason is the one left standing.
    const all = [...fromNotices, ...fromLog].sort(
      (a, b) => a.created_at.getTime() - b.created_at.getTime(),
    );
    for (const r of all) if (r.reason_code) reason.set(r.thread_id, r.reason_code);
  }
  const logbooks = [];
  for (const lb of await launchedLogbooks(db)) {
    const tally = new Map<string, number>();
    for (const d of declined) {
      if (d.logbook_id !== lb.id) continue;
      const code = reason.get(d.thread_id) ?? 'not_recorded';
      tally.set(code, (tally.get(code) ?? 0) + 1);
    }
    logbooks.push({
      slug: lb.slug,
      title: lb.title,
      // In the fixed list's order, so the page reads the same every day.
      by_reason: [...REJECTION_REASONS.map((r) => r.code as string), 'not_recorded']
        .filter((code) => tally.has(code))
        .map((code) => ({ code, label: reasonText(code), reports: tally.get(code) ?? 0 })),
    });
  }
  return {
    published: true as const,
    as_of: new Date().toISOString(),
    note: DECLINED_NOTE,
    logbooks,
  };
}
