/**
 * Heat maps as operator configuration: making them, changing them, and
 * saying which questions feed them.
 *
 * THE COUNTING IS NOT HERE. `src/mapData.js` turns one of these rows into
 * an aggregate and holds every rule about what may be published —
 * the three publication gates, the threshold, and sending a suppressed
 * area without its count. This file decides what an operator is allowed to
 * ASK FOR; that one decides what a reader is allowed to SEE, and keeping
 * them apart is why a mistake in a panel cannot become a disclosure.
 *
 * NOTHING HERE IS HASHED. Migration 049 says it at length: a heat map is a
 * view of the record and not part of it, no fingerprint reads one, and
 * deleting a map takes no report with it. `npm test` asserts the four
 * fingerprint modules never import this.
 *
 * EVERY WRITE VALIDATES, AND REFUSES BY NAME. These are operator settings
 * reached through an authenticated panel, so the refusals are not a
 * security boundary — they are what stops a map being configured into a
 * state that silently shows nothing, which is the failure this feature is
 * most prone to. A view with no question behind it, a threshold under the
 * floor, a slot the interface does not have: each of those draws an empty
 * panel and reports no fault, so each is refused where it is set.
 */
import { pool } from './db.js';
import { LOCATION_TYPE } from './fieldTypes.js';
import { isMapSlot, DEFAULT_MAP_SLOT } from './mapSlots.js';

/** The planes the outline data has. docs/map.md says why there are two. */
export const MAP_PLANES = ['us', 'world'];

/**
 * What a map's colour can show.
 *
 * `volume`   — how many reports, which every map can draw.
 * `outcome`  — the operator's positive/neutral/negative axis, which needs
 *              a question marked `map_outcome` behind it.
 * `severity` — the moderator's assessment. ITS OWN VIEW AND NEVER A
 *              WEIGHTING: docs/map.md records that decision and the reason,
 *              which is that one channel carrying both a reporter's sealed
 *              answer and a moderator's mutable judgement has nothing in it
 *              saying which half is which.
 */
export const MAP_VIEWS = ['volume', 'outcome', 'severity'];

/** The floor, matching the CHECK in migration 049. */
export const MIN_AREA_FLOOR = 2;

export class HeatMapRefusal extends Error {
  constructor(reason, message) {
    super(message || reason);
    this.reason = reason;
  }
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

function cleanList(value, allowed, what) {
  const list = Array.isArray(value) ? value : [];
  const kept = [...new Set(list.map((v) => String(v)))];
  for (const v of kept) {
    if (!allowed.includes(v)) throw new HeatMapRefusal(what, `There is no ${what} called "${v}".`);
  }
  // An empty list is refused rather than defaulted: a map offering no view
  // and a map offering every view are both coherent, and quietly picking
  // one of them for an operator who cleared the box is how a setting comes
  // to mean something other than what the panel shows.
  if (!kept.length) throw new HeatMapRefusal(`${what}-empty`, `Choose at least one ${what}.`);
  return kept;
}

/**
 * The fields a map may be fed by, for the panel's two pickers.
 *
 * Returns only questions on LAUNCHED logbooks for the location list,
 * because a draft logbook has no published reports and never will until it
 * launches — offering one is offering a feed that is empty by definition.
 * The flags themselves can be set on a draft, which is how a logbook
 * arrives already mapped.
 */
export async function mapFeedFields(client = pool) {
  const { rows } = await client.query(
    `SELECT lf.id, lf.logbook_id, lf.key, lf.kind, lf.label,
            lf.map_location, lf.map_outcome, lf.settings,
            lb.slug AS logbook_slug, lb.title AS logbook_title,
            lb.launched_at IS NOT NULL AS launched
       FROM logbook_fields lf
       JOIN logbooks lb ON lb.id = lf.logbook_id
      WHERE lf.map_location = true OR lf.map_outcome = true
      ORDER BY lb.title, lf.position, lf.id`,
  );
  return rows;
}

/**
 * Every question an operator could mark, grouped by logbook, for the panel.
 *
 * Two lists per logbook and they are not the same shape of thing:
 *
 *   `places` — its `location` questions, one of which may feed a map.
 *   `outcomes` — its closed-vocabulary questions, any of which may colour
 *     an outcome view. A free-text answer has no positive or negative, so
 *     only the kinds with a fixed option list are offered.
 *
 * A LOGBOOK WITH NO LOCATION QUESTION IS STILL LISTED, with an empty
 * `places`, because that is the thing an operator most needs to see: "this
 * logbook cannot be mapped yet, and here is the one reason why". A panel
 * that silently omitted it would leave somebody looking for a logbook that
 * is right there.
 */
export async function mapCandidates(client = pool) {
  const { rows } = await client.query(
    `SELECT lb.id AS logbook_id, lb.slug AS logbook_slug, lb.title AS logbook_title,
            lb.launched_at IS NOT NULL AS launched,
            lf.id, lf.key, lf.kind, lf.label, lf.map_location, lf.map_outcome, lf.settings
       FROM logbooks lb
       LEFT JOIN logbook_fields lf ON lf.logbook_id = lb.id
      ORDER BY lb.title, lb.id, lf.position, lf.id`,
  );
  const OUTCOME_KINDS = new Set(['choice_one', 'yes_no', 'evidence_declaration']);
  const books = new Map();
  for (const r of rows) {
    if (!books.has(r.logbook_id)) {
      books.set(r.logbook_id, {
        id: Number(r.logbook_id),
        slug: r.logbook_slug,
        title: r.logbook_title,
        launched: r.launched,
        places: [],
        outcomes: [],
      });
    }
    if (!r.id) continue;
    const book = books.get(r.logbook_id);
    const field = {
      id: Number(r.id),
      key: r.key,
      kind: r.kind,
      label: r.label,
      map_location: r.map_location,
      map_outcome: r.map_outcome,
      // Which of its options the operator called positive or negative.
      // Sent so the panel can say "marked, but no stances set yet", which
      // is a configured outcome question that colours nothing.
      stances: (r.settings && r.settings.stances) || null,
      options: (r.settings && r.settings.options) || null,
    };
    if (r.kind === LOCATION_TYPE) book.places.push(field);
    if (OUTCOME_KINDS.has(r.kind)) book.outcomes.push(field);
  }
  return [...books.values()];
}

/**
 * The same, for lists.
 *
 * SEPARATE FROM `mapCandidates` AND NOT MERGED INTO IT. A list id and a
 * logbook id are two id spaces, so one array holding both would need a tag
 * to tell list 7 from logbook 7 — and an untagged one would feed the wrong
 * rows the first time the sequences overlapped. The panel ticks them in
 * two groups for the same reason it stores them in two columns.
 *
 * NO `outcomes`. A list has no `map_outcome` column at all; migration 051
 * says why, and it is not an omission to be tidied up later.
 *
 * A LIST WITH NO LOCATION QUESTION IS STILL LISTED, as a logbook is, so an
 * operator sees "this one cannot be mapped yet" rather than wondering
 * where it went. Unlike a logbook, the fix is easy and the panel can say
 * so: a list's form stays editable, so the question can simply be added.
 *
 * A DEPLOYMENT THAT HAS NOT RUN 051 gets an empty array rather than a
 * failure. The logbook half of the panel still works, which is the right
 * behaviour for a box part-way through an upgrade.
 */
export async function listMapCandidates(client = pool) {
  let rows;
  try {
    ({ rows } = await client.query(
      `SELECT l.id AS list_id, l.slug AS list_slug, l.title AS list_title,
              lf.id, lf.key, lf.kind, lf.label, lf.map_location, lf.options
         FROM lists l
         LEFT JOIN list_fields lf ON lf.list_id = l.id
        ORDER BY l.title, l.id, lf.position, lf.id`,
    ));
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
  const out = new Map();
  for (const r of rows) {
    if (!out.has(r.list_id)) {
      out.set(r.list_id, {
        id: Number(r.list_id),
        slug: r.list_slug,
        title: r.list_title,
        places: [],
      });
    }
    if (!r.id || r.kind !== LOCATION_TYPE) continue;
    out.get(r.list_id).places.push({
      id: Number(r.id),
      key: r.key,
      kind: r.kind,
      label: r.label,
      map_location: r.map_location,
    });
  }
  return [...out.values()];
}

/**
 * Mark a list's question as the one that places an entry.
 *
 * NO LAUNCH GATE, which is the difference from the logbook version and not
 * an oversight: a list's form stays editable for its whole life — that is
 * half of what a list IS — and nothing about a list entry is sealed, so
 * there is no fingerprint for this to disturb.
 *
 * The one-per-list rule is the partial unique index in migration 051,
 * translated here rather than re-checked, so the database stays the thing
 * that decides it.
 */
export async function setListMapFlag(fieldId, on, client = pool) {
  const { rows } = await client.query(
    'SELECT id, kind, list_id FROM list_fields WHERE id = $1', [fieldId],
  );
  const field = rows[0];
  if (!field) throw new HeatMapRefusal('field', 'There is no such question.');
  if (on && field.kind !== LOCATION_TYPE) {
    throw new HeatMapRefusal('field',
      'Only a “Location on a map” question can place an entry. A written Place '
      + 'answer is prose, so a map could not count it.');
  }
  try {
    await client.query(
      'UPDATE list_fields SET map_location = $2 WHERE id = $1', [fieldId, !!on],
    );
  } catch (e) {
    if (e.code === '23505') {
      throw new HeatMapRefusal('field',
        'That list already has a question placing its entries. Unmark that one first.');
    }
    throw e;
  }
  return { id: Number(field.id), list_id: Number(field.list_id), map_location: !!on };
}

/**
 * Mark a question as the one that places a report, or as one that can
 * colour an outcome view.
 *
 * ONLY A `location` QUESTION MAY PLACE A REPORT. A free-text `place`
 * answer is prose — the whole reason the location type exists — so marking
 * one would produce a map whose every report is unplaced, which draws a
 * blank map and reports no fault.
 *
 * The one-per-logbook rule for `map_location` is a partial unique index in
 * migration 049 and is translated here rather than re-checked, so the
 * database stays the thing that decides it.
 */
export async function setFieldMapFlags(fieldId, flags, client = pool) {
  const { rows } = await client.query(
    'SELECT id, kind, logbook_id FROM logbook_fields WHERE id = $1', [fieldId],
  );
  const field = rows[0];
  if (!field) throw new HeatMapRefusal('no-field', 'That question does not exist.');

  const wantsLocation = Boolean(flags.map_location);
  if (wantsLocation && field.kind !== LOCATION_TYPE) {
    throw new HeatMapRefusal('not-a-location-question',
      'Only a "Location on a map" question can place a report on a map. '
      + 'A Place question is free text, so its answers cannot be counted.');
  }

  try {
    const { rows: out } = await client.query(
      `UPDATE logbook_fields SET map_location = $2, map_outcome = $3
        WHERE id = $1 RETURNING id, map_location, map_outcome`,
      [fieldId, wantsLocation, Boolean(flags.map_outcome)],
    );
    return out[0];
  } catch (e) {
    if (e.code === '23505') {
      throw new HeatMapRefusal('location-already-set',
        'This logbook already has a question that places a report on a map. '
        + 'Unmark that one first — a report can only be in one place.');
    }
    throw e;
  }
}

/* ---------------- the maps themselves ---------------- */

export async function allHeatMaps(client = pool) {
  const { rows } = await client.query(
    'SELECT * FROM heat_maps ORDER BY slot, position, id',
  );
  return rows;
}

/**
 * The maps that are placed, for the front end.
 *
 * NO COUNTS AND NO SETTINGS A READER MUST NOT HAVE. The threshold is not
 * in here: it reaches the browser in the aggregate, where it is needed to
 * label the legend, and a reader who could change it could undo the only
 * thing it is for. This is the placement list — what exists, what it is
 * called, and where it goes.
 */
export async function placedHeatMaps(client = pool) {
  const { rows } = await client.query(
    `SELECT slug, title, blurb, slot, position, planes
       FROM heat_maps WHERE enabled ORDER BY slot, position, id`,
  );
  return rows;
}

export async function heatMapBySlug(slug, client = pool) {
  const { rows } = await client.query(
    'SELECT * FROM heat_maps WHERE slug = $1', [String(slug || '')],
  );
  return rows[0] || null;
}

export async function heatMapById(id, client = pool) {
  const { rows } = await client.query('SELECT * FROM heat_maps WHERE id = $1', [id]);
  return rows[0] || null;
}

/**
 * Everything a write has to agree about, in one place.
 *
 * Returns the columns to write. Throws a HeatMapRefusal naming the field,
 * so the panel can say which box is wrong rather than "invalid".
 */
async function validate(patch, { client = pool, current = null } = {}) {
  const out = {};
  const has = (k) => Object.hasOwn(patch, k);

  if (has('slug') || !current) {
    const slug = String(patch.slug || '').trim().toLowerCase();
    if (!SLUG_RE.test(slug)) {
      throw new HeatMapRefusal('slug',
        'A short name in lowercase letters, numbers and hyphens — it goes in the address.');
    }
    out.slug = slug;
  }

  if (has('title') || !current) {
    const title = String(patch.title || '').trim();
    if (title.length < 1 || title.length > 160) {
      throw new HeatMapRefusal('title', 'Give the map a title between 1 and 160 characters.');
    }
    out.title = title;
  }

  if (has('blurb')) {
    const blurb = String(patch.blurb || '').trim();
    out.blurb = blurb ? blurb.slice(0, 2000) : null;
  }

  if (has('enabled')) out.enabled = Boolean(patch.enabled);

  if (has('min_area')) {
    const n = Number(patch.min_area);
    if (!Number.isInteger(n) || n < MIN_AREA_FLOOR) {
      throw new HeatMapRefusal('min_area',
        `The threshold is a whole number and cannot be below ${MIN_AREA_FLOOR}. `
        + 'A threshold of 1 is the protection switched off while still claiming to be on.');
    }
    out.min_area = n;
  }

  if (has('planes')) out.planes = cleanList(patch.planes, MAP_PLANES, 'plane');
  if (has('views')) out.views = cleanList(patch.views, MAP_VIEWS, 'view');

  if (has('slot')) {
    const slot = String(patch.slot || DEFAULT_MAP_SLOT);
    if (!isMapSlot(slot)) throw new HeatMapRefusal('slot', 'There is no such place on the site.');
    out.slot = slot;
  }

  if (has('position')) {
    const n = Number(patch.position);
    if (!Number.isInteger(n)) throw new HeatMapRefusal('position', 'The order is a whole number.');
    out.position = n;
  }

  if (has('logbook_ids')) {
    const ids = (Array.isArray(patch.logbook_ids) ? patch.logbook_ids : [])
      .map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0);
    const unique = [...new Set(ids)];
    if (unique.length) {
      // CHECKED ON THE WAY IN even though the aggregate skips an id that no
      // longer exists. The aggregate is forgiving because a map must not
      // break when a draft logbook is deleted; a panel that accepted an id
      // nobody has would be storing a feed that was wrong from the start,
      // and the operator would see an empty map and blame the threshold.
      const { rows } = await client.query(
        'SELECT id FROM logbooks WHERE id = ANY($1::bigint[])', [unique],
      );
      if (rows.length !== unique.length) {
        throw new HeatMapRefusal('logbook_ids', 'One of those logbooks does not exist.');
      }
    }
    out.logbook_ids = unique;
  }

  if (has('list_ids')) {
    /* THE SAME CHECK AND THE OPPOSITE DEFAULT. Empty here means NO lists,
       where empty `logbook_ids` means every launched logbook — migration
       051 carries the reason: the logbook rule applied to lists would
       have opted every existing map into counting entries the moment it
       ran, on behalf of an operator who never chose it. */
    const ids = (Array.isArray(patch.list_ids) ? patch.list_ids : [])
      .map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0);
    const unique = [...new Set(ids)];
    if (unique.length) {
      const { rows } = await client.query(
        'SELECT id FROM lists WHERE id = ANY($1::bigint[])', [unique],
      );
      if (rows.length !== unique.length) {
        throw new HeatMapRefusal('list_ids', 'One of those lists does not exist.');
      }
    }
    out.list_ids = unique;
  }

  if (has('outcome_field_id')) {
    const id = patch.outcome_field_id === null || patch.outcome_field_id === ''
      ? null : Number(patch.outcome_field_id);
    if (id !== null) {
      if (!Number.isInteger(id)) {
        throw new HeatMapRefusal('outcome_field_id', 'That is not a question.');
      }
      const { rows } = await client.query(
        'SELECT id, map_outcome FROM logbook_fields WHERE id = $1', [id],
      );
      if (!rows.length) throw new HeatMapRefusal('outcome_field_id', 'That question does not exist.');
      // The flag is what makes a question available to a map at all, and
      // the operator sets it on the question. A map naming an unmarked one
      // would be reading a question nobody offered it.
      if (!rows[0].map_outcome) {
        throw new HeatMapRefusal('outcome_field_id',
          'That question is not marked as one that can colour a map. Mark it on the '
          + 'logbook first, and set which of its answers are positive and negative.');
      }
    }
    out.outcome_field_id = id;
  }

  /* AN OUTCOME VIEW WITH NO QUESTION IS REFUSED HERE, not quietly dropped.
     `resolveViews` in mapData.js drops it at read time, which is the right
     behaviour for a map whose question was deleted afterwards — the map
     keeps working. But doing it silently at WRITE time means an operator
     ticks Outcome, saves, sees it apparently accepted, and gets a map
     without it. The two behaviours are not inconsistent: one is a map
     degrading, the other is a panel lying. */
  const views = out.views || (current && current.views) || [];
  const outcomeField = Object.hasOwn(out, 'outcome_field_id')
    ? out.outcome_field_id
    : (current && current.outcome_field_id) || null;
  if (views.includes('outcome') && !outcomeField) {
    throw new HeatMapRefusal('outcome-needs-a-question',
      'An outcome view needs a question to colour it. Pick one, or untick Outcome.');
  }

  return out;
}

export async function createHeatMap(spec, client = pool) {
  const cols = await validate(spec || {}, { client });
  const keys = Object.keys(cols);
  const values = keys.map((k) => cols[k]);
  const places = keys.map((_, i) => `$${i + 1}`);
  try {
    const { rows } = await client.query(
      `INSERT INTO heat_maps (${keys.join(', ')}) VALUES (${places.join(', ')}) RETURNING *`,
      values,
    );
    return rows[0];
  } catch (e) {
    if (e.code === '23505') {
      throw new HeatMapRefusal('slug-taken', 'There is already a map with that short name.');
    }
    throw e;
  }
}

export async function updateHeatMap(id, patch, client = pool) {
  const current = await heatMapById(id, client);
  if (!current) throw new HeatMapRefusal('no-map', 'That map does not exist.');
  const cols = await validate(patch || {}, { client, current });
  const keys = Object.keys(cols);
  if (!keys.length) return current;
  const sets = keys.map((k, i) => `${k} = $${i + 2}`);
  try {
    const { rows } = await client.query(
      `UPDATE heat_maps SET ${sets.join(', ')}, updated_at = now()
        WHERE id = $1 RETURNING *`,
      [id, ...keys.map((k) => cols[k])],
    );
    return rows[0];
  } catch (e) {
    if (e.code === '23505') {
      throw new HeatMapRefusal('slug-taken', 'There is already a map with that short name.');
    }
    throw e;
  }
}

/**
 * Delete one.
 *
 * SAFE IN A WAY ALMOST NOTHING ELSE HERE IS, and worth saying so: a heat
 * map holds no reports and is referenced by none. Removing one removes a
 * view. That is why this is an ordinary DELETE on a repository where
 * `reports` refuses both UPDATE and DELETE at the database.
 */
export async function deleteHeatMap(id, client = pool) {
  const { rowCount } = await client.query('DELETE FROM heat_maps WHERE id = $1', [id]);
  return rowCount > 0;
}
