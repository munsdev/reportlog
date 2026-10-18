/* Where published reports came from, as counts, for ONE heat map.
 *
 * A sibling of src/stats.js and built the same way for the same reasons.
 * Read that file's header before changing this one; the design review is
 * already in it.
 *
 * ============================================================
 * THE THREE THINGS THIS USED TO SAY WERE MISSING ARE BUILT.
 *
 *   1. the `location` field type and its gazetteer — src/gazetteer.js,
 *      derived from the map's own outlines so a form cannot offer a place
 *      no map can draw;
 *   2. the settings, which turned out NOT to be four columns on
 *      `site_settings`. They are per map, in `heat_maps` (migration 049),
 *      because one site-wide map answers one question and an operator with
 *      two kinds of report wants two maps at two thresholds;
 *   3. `logbook_fields.map_location` / `map_outcome` — the two operator
 *      flags, beside `filterable` and not in `settings`, which is what
 *      lets a LAUNCHED logbook be put on a map without rehashing the form
 *      definition every one of its reports was sealed against.
 *
 * What has NOT changed is every rule about what may be published. The
 * three publication gates, the threshold, and a suppressed area travelling
 * without its count are all exactly as they were, and they are the reason
 * this module is separate from src/heatMaps.js: that one decides what an
 * operator may ASK FOR, this one decides what a reader may SEE.
 * ============================================================
 */
import { pool } from './db.js';
import { publicArchiveAvailable, PUBLICATION_OFF } from './publication.js';
import { LOCATION_TYPE } from './fieldTypes.js';

/* The same predicate stats.js uses, and it must stay the same. A report
   is on the map when a moderator approved it AND its reporter permitted
   publication AND the deployment publishes. Three gates; this is two of
   them, and publicArchiveAvailable() is the third. */
const PUBLISHED = "h.withdrawn = false AND h.moderation_status = 'valid' AND r.may_publish = true";

const SEVERITIES = ['note', 'irregularity', 'serious', 'systemic'];

/**
 * What this map counts, in words, singular and plural.
 *
 * Not cosmetic. A list entry called a report reads as the invariant being
 * broken by whoever looks next, and a map that mixes the two has to say
 * so rather than pick whichever noun came first.
 */
export function unitFor(hasReports, hasEntries) {
  if (hasReports && hasEntries) {
    return { one: 'published report or entry', many: 'published reports and entries' };
  }
  if (hasEntries) return { one: 'approved entry', many: 'approved entries' };
  return { one: 'published report', many: 'published reports' };
}

/** The shipped defaults for a map nobody has configured. */
export const MAP_DEFAULTS = {
  enabled: false,
  minArea: 3,              // floor of 2, enforced at the database
  views: ['volume'],
  planes: ['us'],
};

/**
 * Which questions place a report, and which can colour an outcome.
 *
 * ONLY A `location` QUESTION PLACES ONE, checked here as well as where the
 * flag is set. A `place` question marked by hand in the database would
 * otherwise feed prose into `areaOf` and place nothing, which draws an
 * empty map and reports no fault — the exact failure this whole type
 * exists to avoid.
 */
async function mapFields(client = pool) {
  const { rows } = await client.query(
    `SELECT lf.id, lf.logbook_id, lf.key, lf.kind, lf.label,
            lf.map_location, lf.map_outcome, lf.settings
       FROM logbook_fields lf
      WHERE lf.map_location = true OR lf.map_outcome = true`,
  );
  return rows.filter((f) => !f.map_location || f.kind === LOCATION_TYPE);
}

/**
 * Which LIST questions place an entry. The mirror of `mapFields`, and
 * separate from it for the reason the columns are separate: a list id and
 * a logbook id are two id spaces, and one function returning both would
 * hand the caller rows it could not tell apart.
 *
 * NO OUTCOME HERE. A list has no `map_outcome` and migration 051 says
 * why: the Outcome view colours by a judgement made one entry at a time,
 * and a list is approved in bulk, so there is no such judgement to read.
 * A list feeds the volume view.
 *
 * MISSING COLUMN IS NOT AN ERROR. A deployment that has run 046 but not
 * 051 has lists and no `map_location` on them, which is a box part-way
 * through an upgrade rather than a fault — the logbook half of the map
 * still works and should not be taken down by it.
 */
async function listMapFields(client = pool) {
  try {
    const { rows } = await client.query(
      `SELECT lf.id, lf.list_id, lf.key, lf.kind, lf.label, lf.options
         FROM list_fields lf
        WHERE lf.map_location = true`,
    );
    return rows.filter((f) => f.kind === LOCATION_TYPE);
  } catch (e) {
    /* FORGIVES EXACTLY ONE MISSING THING, and names it.
       This used to forgive ANY undefined column, and the first thing it
       did was hide a typo: the query asked for `lf.settings`, the column
       is `lf.options`, and the panel simply showed no lists at all —
       which looks identical to a deployment that has not migrated. A
       catch wide enough to mean "something is missing" cannot tell a box
       part-way through an upgrade from a query that was wrong when it was
       written, and it reports the reassuring one. */
    const missingTheNewColumn = e.code === '42703'
      && /map_location/.test(String(e.message || ''));
    if (missingTheNewColumn || e.code === '42P01') return [];
    throw e;
  }
}

/**
 * A sealed location answer is ONE HIERARCHICAL STRING — `US`, `US-AZ`,
 * `DE` — so rolling a county up to its state, or a state up to its
 * country, is prefix work and nothing else. No join, no gazetteer
 * lookup, no second column. This is the whole reason the code is
 * hierarchical rather than an object.
 */
export function areaOf(answer) {
  if (typeof answer !== 'string') return null;
  const m = answer.match(/^[A-Z]{2}(-[A-Z0-9]{1,3})?/);
  return m ? m[0] : null;
}

/**
 * The aggregate for one map. Counts only — no identifiers, no dates, no
 * answers. Clicking an area hands the board a filter; it never hands over
 * a list of reports.
 *
 * Takes a `heat_maps` row. A caller with a slug uses getMap().
 */
export async function computeMap(map) {
  /* TWO DIFFERENT NOTS, AND A READER IS OWED THE RIGHT ONE. A deployment
     that publishes nothing and one that publishes an archive without a
     map are not the same thing, and telling somebody the archive is
     unpublished when it is plainly there reads as a fault. */
  if (!await publicArchiveAvailable()) return { ...PUBLICATION_OFF };

  if (!map) return { published: false, reason: 'There is no map at that address.' };
  if (!map.enabled) {
    return { published: false, reason: 'This map is not published.' };
  }

  const k = Math.max(2, Number(map.min_area) || MAP_DEFAULTS.minArea);

  let fields;
  try {
    fields = await mapFields();
  } catch (e) {
    /* THE DATABASE HAS NOT RUN 049. Not a 500 and not a silent empty map:
       a deployment that pulled without migrating is a real state — the
       Updates pane reports it loudly for the same reason — and the honest
       answer names it, because "no reports anywhere" and "this box has not
       migrated" look identical on a drawn map. */
    if (e.code === '42703' || e.code === '42P01') {
      return {
        published: false,
        reason: 'This deployment is running code its database has not caught up with, '
          + 'so the map cannot be built yet. An administrator needs to run the migrations.',
      };
    }
    throw e;
  }

  /* WHICH LOGBOOKS FEED THIS MAP. Empty means every launched one, which is
     what the single map did. An id naming a logbook that no longer exists
     is skipped rather than fatal: a map is a view, and deleting a draft
     logbook must not take every map that named it down with it. */
  const scope = Array.isArray(map.logbook_ids) ? map.logbook_ids.map(Number) : [];
  const inScope = (logbookId) => !scope.length || scope.includes(Number(logbookId));

  const locFields = fields.filter((f) => f.map_location && inScope(f.logbook_id));
  const outField = map.outcome_field_id
    ? fields.find((f) => Number(f.id) === Number(map.outcome_field_id)
      && f.map_outcome && inScope(f.logbook_id)) || null
    : null;

  // COMPUTED LIVE, never materialised into a table that can drift. A
  // withdrawal or a revoked permission must take an area's count down
  // with it on the next read.
  //
  // SCOPED IN THE QUERY rather than filtered afterwards: a map of one
  // logbook on an archive of fifty should not walk the other forty-nine.
  const params = [];
  let scopeClause = '';
  if (scope.length) {
    params.push(scope);
    scopeClause = ' AND r.logbook_id = ANY($1::bigint[])';
  }
  const { rows } = await pool.query(
    `SELECT r.logbook_id, r.answers, h.assessed_severity AS severity
       FROM report_heads h JOIN reports r ON r.id = h.current_report_id
      WHERE ${PUBLISHED}${scopeClause}`,
    params,
  );

  const byLogbook = new Map();
  for (const f of locFields) byLogbook.set(Number(f.logbook_id), f.key);

  const tally = new Map();
  const unplaced = { no_question: 0, country_only: 0 };

  /* ONE PLACE THAT DECIDES WHAT AN AREA DOES WITH A ROW, so the logbook
     loop below and the list loop under it cannot drift into counting
     differently. Returns the bucket, or null when the row is unplaced —
     and increments the right `unplaced` reason on the way. */
  const place = (code) => {
    if (!code) { unplaced.no_question++; return null; }
    /* A REPORTER WHO STOPPED AT THE COUNTRY IS ON NO MAP OF STATES, and
       that is true of every country rather than only the US. The test is
       "a country code where a subdivision was needed", which is any
       two-letter answer. On a world plane a country IS the area, so this
       only applies where a map draws subdivisions. */
    if (code.length === 2 && !map.planes.includes('world')) {
      unplaced.country_only++; return null;
    }
    let a = tally.get(code);
    if (!a) {
      /* `assessed` IS THE OUTCOME VIEW'S DENOMINATOR, and it is not `n`.
         The page divided by `n` — every row in the area — while only rows
         from the OUTCOME logbook can carry a stance. On a map fed by three
         logbooks where one is the outcome one, two thirds of the rows
         dragged the colour toward neutral, and the view was quietly wrong
         rather than visibly broken. Lists made it unmissable: an approved
         entry has no stance at all and never can.
         So an area carries the number of rows that WERE assessed, and the
         colour is a proportion of those. */
      a = { n: 0, assessed: 0, pos: 0, neg: 0, neu: 0, sev: { note: 0, irregularity: 0, serious: 0, systemic: 0 } };
      tally.set(code, a);
    }
    return a;
  };

  for (const row of rows) {
    const key = byLogbook.get(Number(row.logbook_id));
    if (!key) { unplaced.no_question++; continue; }
    const a = place(areaOf(row.answers ? row.answers[key] : undefined));
    if (!a) continue;
    a.n++;
    if (row.severity && SEVERITIES.includes(row.severity)) a.sev[row.severity]++;
    if (outField && Number(row.logbook_id) === Number(outField.logbook_id)) {
      const v = row.answers ? row.answers[outField.key] : undefined;
      const stance = stanceOf(v, outField.settings);
      a.assessed++;
      if (stance === 'positive') a.pos++;
      else if (stance === 'negative') a.neg++;
      else if (stance === 'neutral') a.neu++;
    }
  }

  /* AND THE LIST HALF, in its own query with its own gate.
     ================================================================
     AN ENTRY IS NOT A REPORT, and this is the code that has to keep
     meaning it. It is a second query rather than a UNION with the one
     above for exactly that reason: the two have different gates, carry
     different columns, and must stay legible as two things. What they
     share is the tally, which was only ever counts.

     THE GATE IS `review_state = 'approved'`. Migration 046's own comment
     on that column is "may this be counted" — a list is approved in
     bulk, but it IS approved, and nothing is counted publicly before
     that. There is no auto-count path here any more than there is an
     auto-publish path for a report.

     IT READS `answers` AND NEVER `erasable_answers`. A place code is not
     personal data and belongs in the durable half; reading the erasable
     half would build a count that falls away on its own months later,
     and a published map whose numbers quietly shrink is worse than one
     that never drew. The two columns exist so that a query like this one
     CANNOT reach anything erasable — not so that it may choose not to.

     EMPTY `list_ids` MEANS NO LISTS, which is the opposite of what empty
     `logbook_ids` means. Migration 051 carries the reason: the same rule
     would have opted every map that already existed into counting list
     entries the moment the migration ran, on behalf of an operator who
     never chose it. */
  const listScope = Array.isArray(map.list_ids) ? map.list_ids.map(Number).filter(Boolean) : [];
  let countedLists = 0;
  if (listScope.length) {
    const listFields = (await listMapFields())
      .filter((f) => listScope.includes(Number(f.list_id)));
    if (listFields.length) {
      const byList = new Map();
      for (const f of listFields) byList.set(Number(f.list_id), f.key);
      countedLists = byList.size;
      const { rows: entries } = await pool.query(
        `SELECT e.list_id, e.answers
           FROM list_entries e
          WHERE e.review_state = 'approved'
            AND e.list_id = ANY($1::bigint[])`,
        [[...byList.keys()]],
      );
      for (const row of entries) {
        const key = byList.get(Number(row.list_id));
        if (!key) { unplaced.no_question++; continue; }
        const a = place(areaOf(row.answers ? row.answers[key] : undefined));
        if (!a) continue;
        /* THE COUNT AND NOTHING ELSE. No severity: that is a moderator's
           per-report judgement and a list has none. No stance: there is
           no `map_outcome` on a list, so an entry can never colour an
           Outcome view — it would be counted in the total and absent
           from the stance bars, which reads as a bug in the drawing. */
        a.n++;
      }
    }
  }

  /* THE THRESHOLD IS ENFORCED HERE, NOT IN THE BROWSER, AND AN AREA
     UNDER IT IS SENT WITHOUT ITS COUNT.
     This is the point of the whole mechanism. Sending "Wyoming: 1" and
     letting the page decline to shade it publishes the one thing the
     threshold exists to withhold — anyone can open the network tab. A
     suppressed area travels as a bare code, so a reader learns it has
     between one and k-1 reports and no more than that. */
  const areas = {};
  const suppressed = [];
  let suppressedReports = 0;
  for (const [code, a] of tally) {
    if (a.n >= k) areas[code] = a;
    else { suppressed.push(code); suppressedReports += a.n; }
  }

  /* AND THE SAME CARE ON THE SUBTOTAL. With one suppressed area its
     total is its count, which is the number we just declined to send.
     Two or more is a sum nobody can take apart. */
  const sup = suppressed.length >= 2
    ? { areas: suppressed, reports: suppressedReports }
    : { areas: suppressed, reports: null };

  return {
    published: true,
    slug: map.slug,
    title: map.title,
    blurb: map.blurb || null,
    as_of: new Date().toISOString(),
    note: 'These are reviewed first-hand accounts from people who chose to file '
      + 'them. Not a survey and not a sample. A dark area may mean more problems, '
      + 'or more people who knew the form existed.',
    threshold: k,
    /* WHAT THE THINGS BEING COUNTED ARE CALLED, decided here because only
       the server knows what feeds the map. The page said "published
       report" everywhere, and a map counting list entries would have been
       calling them reports — which is the one thing `an entry is not a
       report` exists to stop. It reads as the invariant being broken, and
       somebody would set out to fix a map that was working. */
    unit: unitFor(locFields.length > 0, countedLists > 0),
    planes: map.planes,
    views: resolveViews(map, outField),
    outcome_question: outField ? outField.label || null : null,
    outcome_labels: outField ? labelsOf(outField.settings) : null,
    /* THE QUESTION A CLICK FILTERS ON, so the board can be prefiltered
       from a link. One key, or null where the map is fed by several
       logbooks that do not share one — handing over a key that only some
       reports have would make a filter that silently drops the rest. */
    filter_key: filterKeyFor(locFields),
    areas,
    suppressed: sup,
    unplaced,
  };
}

/**
 * The one answer key a click can filter the board on.
 *
 * A map fed by several logbooks only has one if they all seal their place
 * under the same key, which happens often (a template gives them the same
 * question) and is not guaranteed. Where they differ there is no single
 * filter to hand over, and saying so is better than handing over one of
 * them: a filter on `where` would silently exclude every report from the
 * logbook that called it `location`.
 */
export function filterKeyFor(locFields) {
  const keys = [...new Set(locFields.map((f) => f.key))];
  return keys.length === 1 ? keys[0] : null;
}

function resolveViews(map, outField) {
  const asked = (Array.isArray(map.views) && map.views.length) ? map.views : MAP_DEFAULTS.views;
  // An outcome view with no question behind it is a view of nothing. It is
  // refused where it is SET (src/heatMaps.js) and dropped here, and the two
  // are not the same check: this one catches a question deleted afterwards,
  // which must degrade the map rather than break it.
  return asked.filter((v) => v !== 'outcome' || outField);
}

/**
 * Where one answer sits on the operator's positive/neutral/negative
 * scale. The operator marks each option; nothing here is built in, and
 * a logbook that marks nothing contributes no outcome.
 */
export function stanceOf(value, fieldSettings) {
  const stances = fieldSettings && fieldSettings.stances;
  if (!stances || value === undefined || value === null) return null;
  if (typeof value === 'boolean') return stances[value ? 'yes' : 'no'] || null;
  return stances[value] || null;
}

function labelsOf(fieldSettings) {
  const l = fieldSettings && fieldSettings.stance_labels;
  return l || { positive: 'no problem', neutral: 'neither', negative: 'a problem' };
}

/* One query serves every caller for a minute, the same arrangement and
   the same reason as getStats: the computation walks every report head,
   and a widget polling every few seconds would be a full scan each time.

   THE TTL IS THE WHOLE INVALIDATION, and this used to claim otherwise.
   The line here said the cache was "cleared wherever clearStatsCache is"
   — which was true in the emptiest possible way, because nothing calls
   clearStatsCache either. Both caches are bounded by the minute and by
   nothing else. So a withdrawal or a revoked permission leaves the map for
   up to sixty seconds after it has left the report, and that is the
   accepted cost of not scanning every head per request. Worth knowing
   before trusting the number on a screenshot; `clearMapCache` is here for
   a caller that cannot accept it.

   KEYED BY SLUG, because there can be several maps and two of them differ
   in the one thing a cache must not get wrong: a map with a threshold of
   10 must never be served an answer computed for a map with a threshold
   of 3. */
const TTL_MS = 60 * 1000;
const cached = new Map();

export async function getMap(slug) {
  const key = String(slug || '');
  const hit = cached.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  // Imported here rather than at the top: heatMaps.js is the operator's
  // side and nothing in the reading path should depend on it loading.
  const { heatMapBySlug } = await import('./heatMaps.js');
  const value = await computeMap(await heatMapBySlug(key));
  cached.set(key, { at: Date.now(), value });
  return value;
}

export function clearMapCache() { cached.clear(); }
