/**
 * Fill an empty deployment with something to look at.
 *
 *   npm run demo-data
 *   npm run demo-data -- --reports 400
 *
 * WHAT THIS IS FOR. A freshly installed ReportLog is correct and
 * completely blank, and a blank archive is the one state where you cannot
 * see whether anything works: no board, no map, no counts, no review
 * queue, nothing to moderate. This builds a deployment that looks like one
 * that has been running for a few months, so a test server can be looked
 * at rather than imagined.
 *
 * NOT A FIXTURE FOR THE TEST SUITES. They build exactly what they assert
 * against; this builds something plausible, which is a different job. The
 * suites must never depend on it.
 *
 * IT GOES THROUGH THE REAL CODE. Reports are filed with
 * `insertReportVersion`, so every one of them is sealed and chained the
 * way a real report is — the chain it produces verifies. Nothing here
 * writes a hash by hand, because data that was not sealed by the sealing
 * code is data that proves nothing when somebody checks the map against
 * the archive.
 *
 * IT REFUSES A POPULATED ARCHIVE, by the rule import-archive.js states:
 * adding invented reports to real ones mixes two histories, and on an
 * append-only table there is no taking them out again.
 */
import 'dotenv/config';
import crypto from 'node:crypto';
import { pool } from '../src/db.js';
import * as L from '../src/logbooks.js';
import { insertReportVersion, normalizeReportFields } from '../src/reportCore.js';
import { createFromTemplate, replaceFields } from '../src/lists/manage.js';
import { fileEntry } from '../src/lists/entries.js';
import { reviewEntries } from '../src/lists/review.js';
import { createHeatMap, updateHeatMap, setFieldMapFlags, setListMapFlag, listMapCandidates } from '../src/heatMaps.js';
import { sealRestricted } from '../src/contactKeys.js';
import { writeNote } from '../src/editorialNotes.js';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : fallback;
};
const WANT = Math.max(1, Math.min(5000, arg('reports', 240)));
const FORCE = process.argv.includes('--force');

/* A PREFIX, so this can be run beside things that are already there.
   Every slug it makes starts with it. Default `demo-`, because the point
   of the prefix is that an operator can see at a glance which logbooks
   came from here. */
const PREFIX = (() => {
  const i = process.argv.indexOf('--prefix');
  const v = i > 0 && process.argv[i + 1] ? String(process.argv[i + 1]).trim() : 'demo-';
  if (!/^[a-z0-9-]*$/.test(v)) {
    console.error('--prefix takes lowercase letters, numbers and hyphens.');
    process.exit(1);
  }
  return v;
})();
const demoSlug = (s) => `${PREFIX}${s}`;

/* ---- WHAT IS ALREADY HERE ---------------------------------------------
   CHECKED BEFORE ANYTHING IS CREATED, AND ALL OF IT AT ONCE.
   The first version of this counted `reports` and nothing else. A box
   with logbooks and no reports in them passed the check and then died on
   the first slug collision, several steps in — which is the worst place
   to stop, because a logbook this script makes is LAUNCHED, and a
   launched logbook can never be deleted. Half a demo is permanent.
   So: every collision is found and named together, before the first
   write. */
const { rows: counts } = await pool.query('SELECT count(*)::int AS n FROM reports');
const WANTED_SLUGS = [demoSlug('election-incidents')];
const WANTED_LISTS = [demoSlug('check-ins'), demoSlug('tip-line'), demoSlug('get-involved')];
const { rows: clashLb } = await pool.query(
  'SELECT slug FROM logbooks WHERE slug = ANY($1::text[])', [WANTED_SLUGS],
);
const { rows: clashList } = await pool.query(
  'SELECT slug FROM lists WHERE slug = ANY($1::text[])', [WANTED_LISTS],
);
const { rows: anyLb } = await pool.query('SELECT count(*)::int AS n FROM logbooks');

const blockers = [];
if (counts[0].n > 0) {
  blockers.push(`this archive already holds ${counts[0].n} report(s) — \`reports\` is `
    + 'append-only, so invented rows mixed into real ones cannot be taken out again');
}
for (const c of clashLb) blockers.push(`there is already a logbook called “${c.slug}”`);
for (const c of clashList) blockers.push(`there is already a list called “${c.slug}”`);

if (blockers.length && !FORCE) {
  console.error('Not building demo data:\n');
  for (const b of blockers) console.error(`  * ${b}`);
  console.error('\nThis is checked up front because every logbook here is LAUNCHED, and');
  console.error('a launched logbook can never be deleted — stopping halfway would leave');
  console.error('part of a demo on this deployment permanently.\n');
  console.error('Either run it under its own names:');
  console.error('    npm run demo-data -- --prefix demo2-\n');
  console.error('or, on a scratch box you are willing to empty, start from a clean');
  console.error('database and migrate it again. `--force` overrides the report count');
  console.error('but CANNOT override a slug that is taken.');
  process.exit(1);
}
if (clashLb.length || clashList.length) {
  // --force does not help here and saying so beats failing again mid-run.
  console.error('Those slugs are taken and --force cannot change that. Use --prefix.');
  process.exit(1);
}

if (anyLb[0].n > 0) {
  console.log(`Note: this deployment already has ${anyLb[0].n} logbook(s). The demo adds`);
  console.log(`its own under “${PREFIX}” and leaves those alone.\n`);
}

/* SAID BEFORE IT HAPPENS, not in a summary afterwards. Launching is a
   one-way door for a logbook and this script walks through it twice. */
console.log('This creates 1 LAUNCHED logbook, 3 lists and 2 maps.');
console.log('A launched logbook cannot be deleted afterwards — only closed.\n');

/* A SEEDED GENERATOR, so two runs of this produce the same archive. A
   demo whose numbers move every time it is rebuilt is one nobody can
   describe to somebody else, and "the map looked different yesterday" is
   a bug report nobody can answer. */
let seed = 0x5eed1e;
function rnd() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}
const pick = (a) => a[Math.floor(rnd() * a.length)];
const chance = (p) => rnd() < p;

/* WEIGHTED, because a real archive is not spread evenly and a map drawn
   from a flat distribution shades every state the same and demonstrates
   nothing. The weights also put two places UNDER the threshold on
   purpose, so the suppression behaviour is visible rather than theoretical. */
const PLACES = [
  ['US-AZ', 16], ['US-GA', 14], ['US-PA', 12], ['US-MI', 11], ['US-WI', 9],
  ['US-NV', 8], ['US-NC', 7], ['US-TX', 6], ['US-FL', 6], ['US-OH', 4],
  ['US-MN', 3], ['US-CO', 2], ['US-WY', 1], ['US-VT', 1],
];
const PLACE_BAG = PLACES.flatMap(([code, w]) => Array(w).fill(code));

const WHAT = [
  'The line was out of the door when the polls were due to close.',
  'Two machines were down and nobody could say when they would be back.',
  'A poll worker told people in line they could not vote without a passport.',
  'The address on the register did not match the one on the card, and no provisional was offered.',
  'Someone was filming people as they went in. Nobody asked them to stop.',
  'The ballot drop box was taped shut with no notice on it.',
  'They ran out of provisional ballots about an hour before closing.',
  'The interpreter did not arrive and three people left without voting.',
  'The accessible booth was being used for storage.',
  'I was told my registration had been cancelled. It had not.',
  'The hours posted on the door did not match the hours on the county site.',
  'A man outside was telling people the line was closed. It was not.',
];
const OUTCOMES = ['Yes, in the end', 'No', 'I am not sure'];

/* THE SPINE IS ASKED OF EVERY REPORT — an address to reach the reporter,
   their consent, and whether it may be published — and the first version
   of this filled none of it. The reports existed and every moderator
   screen opened on a blank: no reporter, no contact, no severity, no
   notes. A demo whose whole job is "see what this looks like" has to
   carry what a real report carries.
   INVENTED NAMES AT A RESERVED DOMAIN. `example.invalid` can never be a
   real address, so nothing here can mail a real person by accident. */
const PEOPLE = [
  'A. Okonjo', 'R. Delgado', 'M. Haddad', 'J. Whitfield', 'S. Nakamura',
  'T. Brennan', 'L. Petrova', 'D. Mbeki', 'K. Lindqvist', 'C.Варга',
  'N. Al-Rashid', 'P. Oyelaran', 'E. Castellanos', 'H. Nguyen', 'B. Kowalski',
];
const ORGS = [
  null, null, null, null,
  'Neighbours for Fair Elections', 'County Legal Aid',
  'Students for the Vote', 'Retired Teachers Association',
];
/* SEVERITY IS A MODERATOR'S JUDGEMENT, not a reporter's answer, and it
   drives the map's Severity view — which drew nothing at all while this
   was left unset. Weighted so most things are small and a few are not,
   because an archive where everything is systemic is one nobody reads. */
const SEVERITY = ['note', 'note', 'note', 'irregularity', 'irregularity', 'serious', 'systemic'];
const VERACITY = [
  'undetermined', 'undetermined', 'likely_true', 'likely_true',
  'proven_true', 'likely_false',
];
const NOTES = [
  'Called the county on the 4th. They confirmed two machines were replaced that morning.',
  'Second report from the same precinct. Cross-referenced; different reporter, same hour.',
  'Reporter sent a photograph of the posted hours. Kept with the thread.',
  'Could not reach the reporter for a follow-up. Leaving as filed.',
  'Clerk’s office disputes the timing. Noted here rather than changing the account.',
];
const WHEN = ['Morning', 'Midday', 'Afternoon', 'Just before closing'];

function spreadDate(i, n) {
  // Across about five months, bunched toward the recent end, because an
  // archive that is perfectly even over time looks generated.
  const days = Math.round(150 * (1 - Math.sqrt(rnd())) + (150 * (n - i)) / n / 6);
  const d = new Date(Date.now() - days * 86400000);
  return d.toISOString();
}

const DIGEST = crypto.createHash('sha256').update('demo-data-consent').digest('hex');

async function field(logbookId, spec) {
  const r = await L.addField(logbookId, spec);
  if (!r.ok) throw new Error(`field ${spec.key}: ${r.reason}`);
  return r.field;
}

async function logbook(slug, title, blurb, fields) {
  const made = await L.createLogbook({ slug, title, blurb });
  if (!made.ok) throw new Error(`logbook ${slug}: ${made.reason}`);
  const lb = made.logbook;
  const out = {};
  for (const spec of fields) out[spec.key] = await field(lb.id, spec);
  await L.launch(lb.id);
  return { lb, fields: out };
}

console.log('Building a demo archive…\n');

/* ---- ONE logbook, and three lists -------------------------------------
   This is the shape a real deployment has:
   the thing that must be permanent and verifiable is a LOGBOOK, and the
   three things that must not be are LISTS. Building two logbooks instead
   made the demo argue for the wrong default. */

const incidents = await logbook(
  demoSlug('election-incidents'), 'Election incidents',
  'Something that went wrong at a polling place, in your own words.',
  [
    { key: 'where', kind: 'location', label: 'Which state', required: true, settings: { scope: 'us' } },
    { key: 'when', kind: 'choice_one', label: 'When in the day', required: false,
      settings: { options: WHEN } },
    { key: 'what', kind: 'long_text', label: 'What happened', required: true },
    { key: 'voted', kind: 'choice_one', label: 'Were you able to vote', required: false,
      settings: {
        options: OUTCOMES,
        // The stances are what the Outcome view colours by. Without them
        // the view is offered and shades nothing, which is the state the
        // admin panel warns about — not the one to ship a demo in.
        stances: { 'Yes, in the end': 'positive', No: 'negative', 'I am not sure': 'neutral' },
      } },
  ],
);

await setFieldMapFlags(incidents.fields.where.id, { map_location: true });
await setFieldMapFlags(incidents.fields.voted.id, { map_outcome: true });
console.log(`  logbook      ${incidents.lb.slug}`);

/* ---- reports ---------------------------------------------------------- */

async function fileReport(book, answers, { state, filedAt, contact }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const threadId = crypto.randomUUID();
    /* THE DATE IS SEALED WITH THE REPORT, not written over it afterwards.
       `received_at` IS in the hashed object — `buildImmutableFields` puts
       it there — so an UPDATE moving it would leave every demo report
       hashing to something its stored hash does not match, and the whole
       point of this script is an archive that verifies. (`reports` is
       append-only anyway and a trigger refuses the UPDATE; the first
       version of this had the UPDATE wrapped in a catch that would have
       swallowed exactly that refusal and produced a broken archive
       silently.) `insertReportVersion` takes the date for this reason. */
    const report = await insertReportVersion(client, {
      threadId,
      correctsId: null,
      receivedAt: filedAt,
      fields: normalizeReportFields({
        logbook: book.lb.slug, answers, may_publish: true, may_publish_digest: DIGEST,
      }),
      logbookId: book.lb.id,
    });
    await client.query(
      `INSERT INTO report_heads (thread_id, current_report_id, moderation_status,
                                 veracity, assessed_severity, needs_review)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [threadId, report.id, state,
        // A moderator's two judgements. Only on something they have looked
        // at: a pending report has not been assessed, and pretending
        // otherwise would make the queue meaningless.
        state === 'pending' ? 'pending' : pick(VERACITY),
        state === 'pending' ? null : pick(SEVERITY),
        chance(0.08)],
    );

    /* THE CONTACT DETAILS, UNDER A KEY OF THEIR OWN. Exactly the call the
       real filing path makes — `sealRestricted` writes the encrypted
       address into reports_restricted and its key into contact_keys, so
       the reporter can have it erased later without the append-only table
       being touched. Doing it any other way here would produce reports
       that look right and cannot be erased. */
    await sealRestricted(client, {
      threadId,
      email: contact.email,
      observerId: contact.name,
      org: contact.org,
    });
    await client.query('COMMIT');
    return threadId;
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}

/* A CORRECTION IS A NEW ROW POINTING AT THE OLD ONE, and the head moves
   to it. Nothing is ever edited: `reports` refuses an UPDATE at the
   database. */
async function correct(book, threadId, answers) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT r.id FROM report_heads h JOIN reports r ON r.id = h.current_report_id
        WHERE h.thread_id = $1`, [threadId],
    );
    const report = await insertReportVersion(client, {
      threadId,
      correctsId: rows[0].id,
      fields: normalizeReportFields({
        logbook: book.lb.slug, answers, may_publish: true, may_publish_digest: DIGEST,
      }),
      logbookId: book.lb.id,
    });
    await client.query(
      'UPDATE report_heads SET current_report_id = $2, updated_at = now() WHERE thread_id = $1',
      [threadId, report.id],
    );
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}

let valid = 0; let pending = 0; let withheld = 0;
let withdrawnCount = 0; let corrections = 0;
for (let i = 0; i < WANT; i += 1) {
  const book = incidents;
  const answers = {
    where: pick(PLACE_BAG),
    what: pick(WHAT),
    // Optional questions are left unanswered sometimes, because every
    // report being complete is not what an archive looks like.
    ...(chance(0.8) ? { when: pick(WHEN) } : {}),
    ...(chance(0.85) ? { voted: pick(OUTCOMES) } : {}),
  };
  /* A REVIEW QUEUE WITH SOMETHING IN IT, and a few withheld, because an
     archive where everything is published shows neither screen doing its
     job. Roughly one in six is still waiting. */
  /* THE STATES THE DATABASE ALLOWS, which are pending/valid/invalid/
     unknown — not the words the screens use. `withheld` was invented here
     and the CHECK constraint refused it, which is the constraint doing
     exactly its job. */
  const r = rnd();
  const state = r < 0.70 ? 'valid' : r < 0.88 ? 'pending' : 'invalid';
  if (state === 'valid') valid += 1; else if (state === 'pending') pending += 1; else withheld += 1;
  const who = pick(PEOPLE);
  const contact = {
    name: who,
    org: pick(ORGS),
    email: `${who.toLowerCase().replace(/[^a-z]+/g, '.')}@example.invalid`,
  };
  const thread = await fileReport(book, answers, {
    state, filedAt: spreadDate(i, WANT), contact,
  });

  /* A FEW ARE WITHDRAWN. A reporter can take a report back, and the
     board has to go on behaving — the row stays, the chain is untouched,
     and nothing public shows it. With none of them in the archive that
     path is never looked at. */
  if (chance(0.03)) {
    await pool.query('UPDATE report_heads SET withdrawn = true WHERE thread_id = $1', [thread]);
    withdrawnCount += 1;
  }

  /* AND A FEW ARE CORRECTIONS: a second version on the same thread,
     because `reports` is append-only and a correction is a NEW ROW
     pointing at the one it corrects. A demo with no corrected report
     never shows the one thing that makes the append-only rule visible. */
  if (state === 'valid' && chance(0.05)) {
    await correct(book, thread, {
      ...answers,
      what: `${answers.what} (Correcting an earlier version: the time was closer to 6pm.)`,
    });
    corrections += 1;
  }

  // A few carry an editorial note, which is the other half of the
  // moderator's screen and was empty in every report.
  if (state === 'valid' && chance(0.12)) {
    await writeNote({
      threadId: thread, body: pick(NOTES), authorEmail: 'moderator@example.invalid',
    }).catch((e) => { throw new Error(`editorial note: ${e.message}`); });
  }
  if ((i + 1) % 50 === 0) console.log(`  …${i + 1} reports`);
}
console.log(`  reports      ${WANT} (${valid} published, ${pending} WAITING FOR A MODERATOR, `
  + `${withheld} marked invalid)`);
console.log(`  of those     ${corrections} corrected, ${withdrawnCount} withdrawn by the reporter`);

/* ---- THREE LISTS, each answering a different question ------------------
   A list seals nothing, keeps an editable form, erases the personal half
   of its entries on a timer and publishes counts rather than content. All
   three of these are things you want counted and do not need to prove in
   five years, which is exactly the test for which format a thing belongs
   in.
   TWO OF THEM FEED THE MAP and one deliberately does not, because "where"
   is a question some lists ask and not a fixed part of being a list. */

async function makeList(template, slug, title, fields) {
  const list = await createFromTemplate(template, { slug, title });
  await replaceFields(list.id, fields);
  return list;
}

/** Mark the question that places an entry, where the list has one. */
async function placeBy(listId, key) {
  const found = (await listMapCandidates()).find((c) => Number(c.id) === Number(listId));
  const field = (found.places || []).find((f) => f.key === key);
  if (!field) throw new Error(`no location question “${key}” on list ${listId}`);
  await setListMapFlag(field.id, true);
}

/** File a run of entries and approve most of them. */
async function fillList(list, slug, count, answersFor, { approve = 0.78 } = {}) {
  const filed = [];
  for (let i = 0; i < count; i += 1) {
    const r = await fileEntry(slug, {
      answers: answersFor(i),
      email: `person${i}@example.invalid`,
      emailConsent: true,
    });
    if (r.ok) filed.push(r.id || r.entryId || (r.entry && r.entry.id));
  }
  // MOST APPROVED, SOME LEFT WAITING. A list approved in bulk still has a
  // queue, and an empty queue shows nothing of how review works.
  const upTo = Math.round(filed.length * approve);
  if (upTo) await reviewEntries(list.id, filed.slice(0, upTo), { state: 'approved' });
  console.log(`  list         ${slug} (${filed.length} entries, ${upTo} approved)`);
  return filed.length;
}

/* 1. CHECK-INS — "I voted and it went ok". On the map. */
const checkins = await makeList('check-ins', demoSlug('check-ins'), 'How did it go?', [
  { key: 'verdict', kind: 'choice_one', label: 'How did it go', required: true,
    options: { options: ['Fine, no trouble', 'Slow but I voted', 'There was a problem'] } },
  { key: 'where', kind: 'location', label: 'Which state', required: true,
    options: { scope: 'us' } },
  { key: 'when', kind: 'choice_one', label: 'When did you go', required: false,
    options: { options: WHEN } },
]);
await placeBy(checkins.id, 'where');
const VERDICTS = [
  'Fine, no trouble', 'Fine, no trouble', 'Fine, no trouble',
  'Slow but I voted', 'Slow but I voted', 'There was a problem',
];
await fillList(checkins, demoSlug('check-ins'), 120, () => ({
  verdict: pick(VERDICTS),
  where: pick(PLACE_BAG),
  ...(chance(0.75) ? { when: pick(WHEN) } : {}),
}));

/* 2. THE TIP LINE — a link and what it is. NOT on the map: a tip is about
      something published elsewhere, and where the SENDER is is not where
      the thing happened. Putting it on a map would be counting the wrong
      geography and nothing on the page would say so. */
const tips = await makeList('tips', demoSlug('tip-line'), 'Send a link', [
  { key: 'link', kind: 'url', label: 'A link', required: true },
  { key: 'note', kind: 'long_text', label: 'What is it, in a sentence or two',
    required: false },
]);
const TIPS = [
  'Local paper covering the queue at the community centre.',
  'Clip from a council meeting where the hours were discussed.',
  'Thread from a poll worker describing the machine outage.',
  'County statement, posted the day after.',
  'Photograph of the notice on the door, reposted.',
];
await fillList(tips, demoSlug('tip-line'), 45, (i) => ({
  link: `https://example.invalid/story/${1000 + i}`,
  ...(chance(0.85) ? { note: pick(TIPS) } : {}),
}));

/* 3. GETTING INVOLVED — built on the contact template, which is the
      closest shipped shape: a form that collects an intention and an
      address to answer it on. Volunteering is a LIST and not a logbook
      because an offer of help is a thing to act on and then erase, not a
      thing to prove in five years. */
const involved = await makeList('contact', demoSlug('get-involved'), 'Get involved', [
  { key: 'how', kind: 'choice_many', label: 'How would you like to help', required: true,
    options: {
      options: [
        'Be a poll observer', 'Drive people to vote', 'Translate or interpret',
        'Help with data entry', 'Give legal advice', 'Something else',
      ],
    } },
  { key: 'where', kind: 'location', label: 'Which state are you in', required: false,
    options: { scope: 'us' } },
  { key: 'note', kind: 'long_text', label: 'Anything we should know', required: false },
]);
await placeBy(involved.id, 'where');
const HELP = [
  'Be a poll observer', 'Drive people to vote', 'Translate or interpret',
  'Help with data entry', 'Give legal advice', 'Something else',
];
const OFFERS = [
  'Free most weekends. I have a car.',
  'I speak Spanish and Portuguese.',
  'Retired paralegal, happy to read things over.',
  'Can do evenings after 6.',
];
await fillList(involved, demoSlug('get-involved'), 35, () => ({
  how: [pick(HELP), ...(chance(0.35) ? [pick(HELP)] : [])],
  ...(chance(0.8) ? { where: pick(PLACE_BAG) } : {}),
  ...(chance(0.5) ? { note: pick(OFFERS) } : {}),
}), { approve: 0.6 });

/* ---- two maps, because one map is not the feature ---------------------- */

/* PUBLISHED IN A SECOND STEP, because `createHeatMap` will not do it in
   the first — a new map always opens unpublished so nothing is drawn by
   accident, which is right and is not something to work around. The demo
   takes the same two steps an operator takes: make it, look at it, turn
   it on. Passing `enabled: true` to the create silently did nothing, and
   the demo shipped with two maps that drew nothing at all. */
async function publishedMap(spec) {
  const made = await createHeatMap(spec);
  await updateHeatMap(made.id, { enabled: true });
  return made;
}

await publishedMap({
  slug: demoSlug('where-it-happened'), title: 'Where incidents came from',
  blurb: 'Published reports, by state.',
  enabled: true, min_area: 3, planes: ['us'], views: ['volume', 'outcome'],
  logbook_ids: [Number(incidents.lb.id)],
  outcome_field_id: Number(incidents.fields.voted.id),
  slot: 'board_tab', position: 0,
});

/* THE SECOND MAP ANSWERS A DIFFERENT QUESTION, which is the whole reason
   there is more than one: the first is "where did things go wrong", this
   is "where did we hear from at all" — reports and check-ins together, at
   a higher threshold because it has far more in it. */
await publishedMap({
  slug: demoSlug('everywhere'), title: 'Everywhere we heard from',
  blurb: 'Reports and check-ins together, by state.',
  enabled: true, min_area: 5, planes: ['us'], views: ['volume'],
  logbook_ids: [Number(incidents.lb.id)],
  list_ids: [Number(checkins.id), Number(involved.id)],
  slot: 'home', position: 0,
});
console.log(`  maps         2 (${demoSlug('where-it-happened')}, ${demoSlug('everywhere')})`);

console.log('\nDone. The board, the map and both review queues now have something in them.');
console.log('Every report here was sealed and chained by the real code, so the archive verifies.');
await pool.end();
