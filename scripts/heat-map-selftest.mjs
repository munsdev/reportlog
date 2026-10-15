/**
 * Heat maps against a real database: does a location answer become a count,
 * and does the threshold actually withhold what it promises to withhold?
 *
 * THE PURE HALF IS IN THE MAIN SUITE — the gazetteer, the normalizer, the
 * slot list, the refusals that need no rows. What needs a database is the
 * half that cannot be reasoned about: a tally over real report heads,
 * through the three publication gates, with the suppression rules applied
 * to real counts.
 *
 * AND THE SUPPRESSION IS THE POINT OF THIS FILE. docs/map.md says a
 * payload carrying "Wyoming: 1" has published the number whatever the page
 * draws, so these assertions look at the PAYLOAD and not at a rendering.
 * A test that asked the browser whether it drew an area would pass against
 * the exact bug the mechanism exists to prevent.
 *
 *   npm run test:db
 */
import pg from 'pg';
import crypto from 'node:crypto';
import * as L from '../src/logbooks.js';
import { insertReportVersion, normalizeReportFields } from '../src/reportCore.js';
import {
  createHeatMap, updateHeatMap, deleteHeatMap, setFieldMapFlags, mapCandidates,
  HeatMapRefusal, MIN_AREA_FLOOR,
} from '../src/heatMaps.js';
import { computeMap, areaOf, filterKeyFor, clearMapCache } from '../src/mapData.js';
import { normalizeAnswer } from '../src/answers.js';
import { clearPublicationSettingsCache } from '../src/publication.js';
import { createFromTemplate, replaceFields } from '../src/lists/manage.js';
import { fileEntry } from '../src/lists/entries.js';
import { reviewEntries } from '../src/lists/review.js';
import { listMapCandidates, setListMapFlag } from '../src/heatMaps.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

let pass = 0, fail = 0;
const ok = (n, c, x) => {
  if (c) { pass += 1; console.log('  ok   ' + n); }
  else { fail += 1; console.log('  FAIL ' + n + (x ? ' — ' + x : '')); }
};

const DIGEST = crypto.createHash('sha256').update('heat-map-selftest').digest('hex');
const tag = `hm${Date.now().toString(36)}`;

await pool.query('INSERT INTO site_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING');
await pool.query('UPDATE site_settings SET public_archive_enabled = true WHERE id = true');
clearPublicationSettingsCache();

/* ---- a logbook that can be mapped ----------------------------------- */

async function logbook(slug, title) {
  const out = await L.createLogbook({ title, slug, blurb: '' });
  return out.ok ? out.logbook : await L.logbookBySlug(slug);
}

const mainSlug = `${tag}-main`;
const main = await logbook(mainSlug, 'Heat map main');
const otherSlug = `${tag}-other`;
const other = await logbook(otherSlug, 'Heat map other');

/* addField answers { ok, field }, so every id below comes through this
   rather than off the result. A bare `.id` reads fine and is undefined. */
const field = async (logbookId, spec) => {
  const out = await L.addField(logbookId, spec);
  if (!out.ok) throw new Error(`addField refused: ${out.reason}`);
  return out.field;
};

const placeField = await field(main.id, {
  key: 'where', kind: 'location', label: 'Where did it happen',
  settings: { scope: 'us' },
});
const outcomeField = await field(main.id, {
  key: 'served', kind: 'choice_one', label: 'Were you served?',
  settings: {
    options: ['Yes', 'No'],
    // The operator's own axis. Nothing is built in — a logbook that marks
    // nothing contributes no outcome, which is asserted further down.
    stances: { Yes: 'positive', No: 'negative' },
  },
});
// A free-text place on the same logbook, to prove it cannot be marked.
const proseField = await field(main.id, {
  key: 'roughly', kind: 'place', label: 'Whereabouts, roughly',
});
const otherPlace = await field(other.id, {
  key: 'where', kind: 'location', label: 'Where', settings: { scope: 'us' },
});
await L.launch(main.id);
await L.launch(other.id);

console.log('\nonly a location question can place a report');

await setFieldMapFlags(placeField.id, { map_location: true });
await setFieldMapFlags(outcomeField.id, { map_outcome: true });
await setFieldMapFlags(otherPlace.id, { map_location: true });

{
  let refused = null;
  try { await setFieldMapFlags(proseField.id, { map_location: true }); }
  catch (e) { refused = e; }
  ok('a free-text Place question cannot be marked as the map location',
    refused instanceof HeatMapRefusal && refused.reason === 'not-a-location-question',
    refused ? refused.reason : 'it was accepted');
}

{
  // A logbook can ask where twice; only one of them places the report,
  // because an aggregate that found both would have to guess.
  const second = await field(main.id, {
    key: 'lives', kind: 'location', label: 'Where do you live',
    settings: { scope: 'us' },
  });
  let refused = null;
  try { await setFieldMapFlags(second.id, { map_location: true }); }
  catch (e) { refused = e; }
  ok('a logbook cannot have two questions placing a report on a map',
    refused instanceof HeatMapRefusal && refused.reason === 'location-already-set',
    refused ? refused.reason : 'it was accepted');
}

/* ---- filing ---------------------------------------------------------- */

async function fileReport(logbookId, slug, answers, { publish = true, valid = true } = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const threadId = crypto.randomUUID();
    const report = await insertReportVersion(client, {
      threadId,
      correctsId: null,
      fields: normalizeReportFields({
        logbook: slug, answers, may_publish: publish, may_publish_digest: DIGEST,
      }),
      logbookId,
    });
    await client.query(
      `INSERT INTO report_heads (thread_id, current_report_id, moderation_status)
       VALUES ($1, $2, $3)`,
      [threadId, report.id, valid ? 'valid' : 'pending'],
    );
    await client.query('COMMIT');
    return { threadId, report };
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}

/* Arizona gets four, Nevada two, Wyoming one. At a threshold of 3 that is
   one shaded area, one suppressed area, and one that is only just over —
   which is exactly the shape needed to check every branch of the
   suppression rules in one archive. */
const plan = [
  ['US-AZ', 'Yes'], ['US-AZ', 'Yes'], ['US-AZ', 'No'], ['US-AZ', 'No'],
  ['US-NV', 'Yes'], ['US-NV', 'No'],
  ['US-WY', 'Yes'],
];
for (const [where, served] of plan) {
  await fileReport(main.id, mainSlug, { where, served });
}
// One on the other logbook, for the scoping assertions.
await fileReport(other.id, otherSlug, { where: 'US-CA' });
await fileReport(other.id, otherSlug, { where: 'US-CA' });
await fileReport(other.id, otherSlug, { where: 'US-CA' });

// And three that must never be counted, one per gate.
await fileReport(main.id, mainSlug, { where: 'US-TX' }, { publish: false });
await fileReport(main.id, mainSlug, { where: 'US-TX' }, { publish: false });
await fileReport(main.id, mainSlug, { where: 'US-TX' }, { valid: false });

/* ---- the aggregate --------------------------------------------------- */

console.log('\nthe tally, and what the three gates keep out of it');

const mapRow = await createHeatMap({
  slug: `${tag}-map`, title: 'Heat map test', enabled: true, min_area: 3,
  logbook_ids: [Number(main.id)], views: ['volume', 'outcome'], planes: ['us'],
  outcome_field_id: Number(outcomeField.id),
});
clearMapCache();
const agg = await computeMap(mapRow);

ok('the map publishes', agg.published === true, agg.reason);
ok('Arizona is counted, with its four', agg.areas['US-AZ']?.n === 4,
  JSON.stringify(agg.areas['US-AZ']));
ok('the outcome axis counts the operator\'s own stances',
  agg.areas['US-AZ']?.pos === 2 && agg.areas['US-AZ']?.neg === 2,
  JSON.stringify(agg.areas['US-AZ']));
ok('a report whose reporter did not permit publication is not on the map',
  !agg.areas['US-TX'] && !agg.suppressed.areas.includes('US-TX'),
  JSON.stringify({ tx: agg.areas['US-TX'], sup: agg.suppressed.areas }));
ok('a report no moderator has approved is not on the map either',
  !agg.areas['US-TX'], JSON.stringify(agg.areas['US-TX']));
ok('a logbook outside this map\'s scope is not counted',
  !agg.areas['US-CA'] && !agg.suppressed.areas.includes('US-CA'),
  JSON.stringify(agg.areas['US-CA']));

console.log('\nthe threshold, read off the payload and not off a drawing');

ok('an area under the threshold is not in `areas` at all',
  !Object.hasOwn(agg.areas, 'US-NV') && !Object.hasOwn(agg.areas, 'US-WY'),
  JSON.stringify(Object.keys(agg.areas)));
ok('it travels as a bare code in the suppressed list',
  agg.suppressed.areas.includes('US-NV') && agg.suppressed.areas.includes('US-WY'),
  JSON.stringify(agg.suppressed));
ok('and nothing anywhere in the payload carries a suppressed area\'s own count',
  /* THE ASSERTION THAT MATTERS, and it reads the serialized payload rather
     than a property, because the bug this guards against is a count
     reaching the wire somewhere nobody thought to look. A suppressed code
     may appear only as a bare string; the moment it appears as a key with
     an object behind it, its number has been published whatever the page
     chooses to draw. */
  (() => {
    const text = JSON.stringify(agg);
    return !/"US-NV"\s*:/.test(text) && !/"US-WY"\s*:/.test(text);
  })(),
  JSON.stringify(agg));
ok('two suppressed areas get a subtotal nobody can take apart',
  agg.suppressed.reports === 3, String(agg.suppressed.reports));

console.log('\nwith exactly one suppressed area the subtotal IS the count');

{
  // So it must not be sent. This is the subtler half of the same rule and
  // the one most likely to be "simplified" away later.
  const solo = await createHeatMap({
    slug: `${tag}-solo`, title: 'Solo', enabled: true, min_area: 3,
    logbook_ids: [Number(other.id)],
  });
  await fileReport(other.id, otherSlug, { where: 'US-OR' });
  clearMapCache();
  const a2 = await computeMap(solo);
  ok('one suppressed area, so the subtotal is withheld',
    a2.suppressed.areas.length === 1 && a2.suppressed.reports === null,
    JSON.stringify(a2.suppressed));
  await deleteHeatMap(solo.id);
}

console.log('\nthe threshold is the operator\'s, per map');

{
  // The same archive at two thresholds, which is the whole reason the
  // settings are per map rather than site-wide.
  const strict = await createHeatMap({
    slug: `${tag}-strict`, title: 'Strict', enabled: true, min_area: 5,
    logbook_ids: [Number(main.id)],
  });
  clearMapCache();
  const a3 = await computeMap(strict);
  ok('a threshold of 5 withholds the area a threshold of 3 showed',
    !a3.areas['US-AZ'] && a3.suppressed.areas.includes('US-AZ'),
    JSON.stringify(Object.keys(a3.areas)));
  ok('and the same archive still shows it on the other map',
    (await computeMap(mapRow)).areas['US-AZ']?.n === 4);
  await deleteHeatMap(strict.id);
}

console.log('\na map with no scope reads every launched logbook');

{
  const all = await createHeatMap({
    slug: `${tag}-all`, title: 'All', enabled: true, min_area: 3,
  });
  clearMapCache();
  const a4 = await computeMap(all);
  /* AT LEAST, NOT EXACTLY, AND THE REASON IS WORTH KEEPING. An unscoped
     map reads every launched logbook in the database — which on a
     development box includes whatever earlier runs and other scripts left
     behind, and `reports` is append-only so none of it can be cleaned up.
     The first version asserted exact totals here and passed once, then
     failed on the second run against unchanged code, which is a test
     reporting the environment.

     The claim being made is "an empty scope reaches both logbooks", and
     `>=` is the whole of it. The exact-count assertions are all on SCOPED
     maps, whose logbooks this script made in this run. */
  ok('an empty logbook_ids reaches both logbooks',
    a4.areas['US-AZ']?.n >= 4 && a4.areas['US-CA']?.n >= 3,
    JSON.stringify({ az: a4.areas['US-AZ']?.n, ca: a4.areas['US-CA']?.n }));
  await deleteHeatMap(all.id);
}

console.log('\nthe filter key a click hands the board');

{
  /* SCOPED DELIBERATELY TO THE TWO LOGBOOKS THIS SCRIPT MADE. An unscoped
     map reads every launched logbook in the database, so on a development
     box carrying other people's logbooks the key set is whatever is lying
     around — the first version of this assertion passed or failed
     depending on what an earlier script had left behind, which is a test
     that reports the environment rather than the code. */
  const agreed = await createHeatMap({
    slug: `${tag}-agreed`, title: 'Agreed', enabled: true, min_area: 3,
    logbook_ids: [Number(main.id), Number(other.id)],
  });
  clearMapCache();
  const a = await computeMap(agreed);
  ok('two logbooks that seal their place under the same key give the board one filter',
    a.filter_key === 'where', String(a.filter_key));

  // And when they differ there is none, because a filter on one key would
  // silently drop every report from the logbook that used the other.
  const third = await logbook(`${tag}-third`, 'Heat map third');
  const thirdPlace = await field(third.id, {
    key: 'county', kind: 'location', label: 'Which county', settings: { scope: 'us' },
  });
  await L.launch(third.id);
  await setFieldMapFlags(thirdPlace.id, { map_location: true });
  const mixed = await createHeatMap({
    slug: `${tag}-mixed`, title: 'Mixed', enabled: true, min_area: 3,
    logbook_ids: [Number(main.id), Number(third.id)],
  });
  clearMapCache();
  ok('and two that disagree give it none, rather than one that drops half the reports',
    (await computeMap(mixed)).filter_key === null);

  await deleteHeatMap(agreed.id);
  await deleteHeatMap(mixed.id);
}

console.log('\na disabled map and a map that does not exist answer alike');

{
  const off = await updateHeatMap(mapRow.id, { enabled: false });
  clearMapCache();
  const a5 = await computeMap(off);
  ok('a disabled map publishes nothing', a5.published === false, JSON.stringify(a5));
  const a6 = await computeMap(null);
  ok('and so does a slug nobody has', a6.published === false, JSON.stringify(a6));
  ok('neither leaks whether the other exists',
    typeof a5.reason === 'string' && typeof a6.reason === 'string');
  await updateHeatMap(mapRow.id, { enabled: true });
  clearMapCache();
}

console.log('\nthe archive\'s own switch outranks every map');

{
  await pool.query('UPDATE site_settings SET public_archive_enabled = false WHERE id = true');
  clearPublicationSettingsCache();
  clearMapCache();
  const a7 = await computeMap(mapRow);
  ok('an unpublished archive publishes no map, whatever the map says',
    a7.published === false, JSON.stringify(a7));
  ok('and it says the archive is unpublished rather than that the map is',
    /archive|publish/i.test(String(a7.reason || '')), String(a7.reason));
  await pool.query('UPDATE site_settings SET public_archive_enabled = true WHERE id = true');
  clearPublicationSettingsCache();
  clearMapCache();
}

console.log('\nthe cache is per map, which is the one thing it must not get wrong');

{
  const { getMap } = await import('../src/mapData.js');
  clearMapCache();
  const tight = await createHeatMap({
    slug: `${tag}-tight`, title: 'Tight', enabled: true, min_area: 2,
    logbook_ids: [Number(main.id)],
  });
  const a = await getMap(mapRow.slug);
  const b = await getMap(tight.slug);
  ok('a map with a threshold of 2 is not served the answer computed for 3',
    a.threshold === 3 && b.threshold === 2 && Boolean(b.areas['US-NV']),
    JSON.stringify({ a: a.threshold, b: b.threshold, nv: b.areas['US-NV'] }));
  await deleteHeatMap(tight.id);
}

console.log('\nthe pieces that need no rows but are easy to get wrong');

ok('areaOf takes the country off a subdivision code', areaOf('US-AZ') === 'US-AZ');
ok('areaOf ignores anything that is not a code', areaOf('Phoenix, Arizona') === null);
ok('a code is uppercased before it is sealed',
  normalizeAnswer('location', ' us-az ', { scope: 'us' }) === 'US-AZ');
ok('a place name is never accepted in place of a code',
  normalizeAnswer('location', 'Arizona', { scope: 'us' }) === null);
ok('a US-scoped question refuses a bare country',
  normalizeAnswer('location', 'US', { scope: 'us' }) === null);
ok('filterKeyFor withholds a key when two logbooks disagree',
  filterKeyFor([{ key: 'where' }, { key: 'location' }]) === null);
ok('the floor is what the migration says it is', MIN_AREA_FLOOR === 2);

{
  const names = (await mapCandidates()).find((c) => c.slug === mainSlug);
  ok('the panel is offered the location questions and not the prose one',
    names.places.every((p) => p.kind === 'location')
    && !names.places.some((p) => p.key === 'roughly'),
    JSON.stringify(names.places.map((p) => p.key)));
  ok('and the outcome question is offered with the stances already on it',
    names.outcomes.some((o) => o.key === 'served' && o.stances),
    JSON.stringify(names.outcomes.map((o) => o.key)));
}

console.log('\na list can feed a map, and only its approved entries count');

{
  /* THE WHOLE POINT OF DOING THIS AGAINST A DATABASE. Every claim below is
     about what a QUERY returns — which rows the gate lets through, which
     column the place code is read from — and a unit test with a stubbed
     pool would assert the stub. */
  const list = await createFromTemplate('tips', { slug: `${tag}-tips`, title: 'Tips' });
  await replaceFields(list.id, [
    { key: 'where', kind: 'location', label: 'Where', required: false, options: { scope: 'us' } },
    { key: 'what', kind: 'long_text', label: 'What happened', required: false },
  ]);

  const marks = (await listMapCandidates()).find((c) => c.id === Number(list.id));
  ok('the panel offers the list and its location question',
    !!marks && marks.places.some((f) => f.key === 'where'),
    JSON.stringify(marks && marks.places.map((f) => f.key)));
  await setListMapFlag(marks.places.find((f) => f.key === 'where').id, true);

  let refused = null;
  try {
    await setListMapFlag(marks.places.find((f) => f.key === 'where').id, true);
    const prose = (await listMapCandidates()).find((c) => c.id === Number(list.id));
    void prose;
  } catch (e) { refused = e; }
  ok('marking the same question again is not an error', refused === null,
    refused && refused.message);

  const filed = [];
  for (const where of ['US-AZ', 'US-AZ', 'US-AZ', 'US-TX']) {
    const r = await fileEntry(`${tag}-tips`, {
      answers: { where, what: 'something' },
      // The tip template keeps personal data, and a list that does refuses
      // an entry with no way to reach the person. Not what is under test.
      email: `tip-${filed.length}@example.invalid`, emailConsent: true,
    });
    if (r.ok) filed.push(r.id || r.entryId || (r.entry && r.entry.id));
    else console.log('    (filing refused: ' + r.reason + ')');
  }
  ok('four entries were filed', filed.length === 4, JSON.stringify(filed));

  /* SCOPED TO A DRAFT LOGBOOK so the logbook half contributes nothing and
     the numbers below are the list's alone. NOT `logbook_ids: [-1]`, which
     was the first attempt: the validator drops any id that is not a
     positive integer, so an empty array survived and empty means EVERY
     launched logbook — the map counted the whole archive and the test read
     as a wild failure of the list code. A draft logbook exists, so it
     passes validation, and has no published reports, so it adds none. */
  const made = await L.createLogbook({
    slug: `${tag}-empty`, title: 'Nothing in it', blurb: '',
  });
  const empty = made.logbook;
  /* CHECKED, BECAUSE THE FAILURE IS SILENT AND LOOKS LIKE A BUG IN THE
     FEATURE. An id that comes out undefined is dropped by the validator,
     an empty `logbook_ids` means EVERY launched logbook, and the map then
     counts the whole archive — which reads as the list code counting
     thousands of things. It cost a debugging round; it costs one line. */
  if (!empty || !empty.id) {
    throw new Error('the scratch logbook has no id; an empty scope would mean ALL');
  }
  const listMap = await createHeatMap({
    slug: `${tag}-list`, title: 'From a list', enabled: true, min_area: 3,
    logbook_ids: [Number(empty.id)], list_ids: [Number(list.id)],
  });
  clearMapCache();

  /* NOTHING IS COUNTED BEFORE A MODERATOR APPROVES IT, which is the same
     promise a logbook makes and the reason this is allowed at all. If this
     ever passes with entries counted, a list has an auto-publish path. */
  const before = await computeMap(listMap);
  ok('an entry nobody has approved is counted nowhere',
    !before.areas['US-AZ'] && !before.suppressed.areas.includes('US-AZ'),
    JSON.stringify({ areas: Object.keys(before.areas), sup: before.suppressed.areas }));

  await reviewEntries(list.id, filed, { state: 'approved' });
  clearMapCache();
  const after = await computeMap(listMap);
  ok('three approved entries in one state reach the threshold',
    after.areas['US-AZ'] && after.areas['US-AZ'].n === 3,
    JSON.stringify(after.areas));
  ok('and the single one is suppressed rather than sent with its count',
    after.suppressed.areas.includes('US-TX') && after.suppressed.reports === null,
    JSON.stringify(after.suppressed));

  /* AN ENTRY IS NOT A REPORT, and the page has to be able to say so. */
  ok('the map says it is counting entries, not reports',
    after.unit && after.unit.many === 'approved entries',
    JSON.stringify(after.unit));

  /* THE SWEEP MUST NOT TAKE THE MAP WITH IT. A place code lives in the
     durable `answers` column; if it ever moved to `erasable_answers` the
     count would fall away on its own months later and nothing would say
     why. Asserted against the column, not against behaviour over time. */
  const { rows: cols } = await pool.query(
    `SELECT answers ? 'where' AS durable, erasable_answers ? 'where' AS erasable
       FROM list_entries WHERE list_id = $1 LIMIT 1`, [list.id],
  );
  ok('the place code is in the durable half and not the erasable one',
    cols[0] && cols[0].durable === true && cols[0].erasable === false,
    JSON.stringify(cols[0]));

  /* EMPTY list_ids MEANS NO LISTS, where empty logbook_ids means all the
     logbooks. If this ever fails, every map that existed before migration
     051 has silently started counting entries. */
  const unscoped = await createHeatMap({
    slug: `${tag}-unscoped`, title: 'Unscoped', enabled: true, min_area: 3,
    logbook_ids: [Number(empty.id)],
  });
  clearMapCache();
  const none = await computeMap(unscoped);
  ok('a map that names no list counts no entries, unlike logbooks',
    !none.areas['US-AZ'] && !none.suppressed.areas.includes('US-AZ'),
    JSON.stringify({ areas: Object.keys(none.areas), sup: none.suppressed.areas }));

  await deleteHeatMap(unscoped.id);
  await deleteHeatMap(listMap.id);
}

/* ---- tidy up --------------------------------------------------------- */

await deleteHeatMap(mapRow.id);
await pool.end();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
