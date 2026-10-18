/**
 * Logbooks and their fields, against a real database.
 *
 * The unit suite checks the rules that are pure — what a date normalizes to,
 * what a filterable flag means. What needs Postgres is the part where the
 * schema enforces something JavaScript cannot: that a field key is unique
 * within its logbook and shaped the way the seal requires, that a draft is
 * not public, and that the freeze guard actually refuses.
 *
 *   createdb logbooktest
 *   DATABASE_URL=postgres://…/logbooktest node scripts/migrate.js
 *   DATABASE_URL=postgres://…/logbooktest \
 *   CONTACT_HMAC_KEY=$(openssl rand -base64 32) \
 *   TIER_B_ENCRYPTION_KEY=$(openssl rand -base64 32) \
 *     node scripts/logbook-selftest.mjs
 *
 * Never point it at a database with real reports in it: it writes.
 */
import 'dotenv/config';
const { pool } = await import('../src/db.js');
const L = await import('../src/logbooks.js');
const A = await import('../src/answers.js');

let pass = 0; let fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
};

/* ---- deleting one ----------------------------------------------------
   THE ASYMMETRY IS THE WHOLE TEST. A draft is a half-built form and
   removing one costs nothing. A LAUNCHED logbook is its own hash chain,
   is named on every anchor published since, and `reports` is append-only
   — so "delete" is not a permission an operator could be given. If the
   launched case below ever passes, the archive's strongest guarantee has
   become a button. */
{
  const draft = await L.createLogbook({ slug: 'selftest-doomed', title: 'Doomed' });
  await L.addField(draft.logbook.id, { key: 'q', kind: 'short_text', label: 'Q', required: false });
  const { rows: before } = await pool.query(
    'SELECT count(*)::int AS n FROM logbook_fields WHERE logbook_id = $1', [draft.logbook.id],
  );
  const gone = await L.deleteDraft(draft.logbook.id);
  ok('a draft that was never launched can be deleted', gone.ok === true, JSON.stringify(gone));
  const { rows: after } = await pool.query(
    'SELECT count(*)::int AS n FROM logbook_fields WHERE logbook_id = $1', [draft.logbook.id],
  );
  ok('and its questions go with it', before[0].n === 1 && after[0].n === 0,
    `${before[0].n} before, ${after[0].n} after`);
  ok('deleting one that is not there says so rather than succeeding quietly',
    (await L.deleteDraft(draft.logbook.id)).reason === 'no-logbook');

  const live = await L.createLogbook({ slug: 'selftest-live', title: 'Live' });
  await L.addField(live.logbook.id, { key: 'q', kind: 'short_text', label: 'Q', required: false });
  await L.launch(live.logbook.id);
  const refused = await L.deleteDraft(live.logbook.id);
  ok('A LAUNCHED LOGBOOK CANNOT BE DELETED, at any level, ever',
    refused.ok === false && refused.reason === 'launched', JSON.stringify(refused));
  const { rows: still } = await pool.query(
    'SELECT count(*)::int AS n FROM logbooks WHERE id = $1', [live.logbook.id],
  );
  ok('and it is still there afterwards', still[0].n === 1);
}

await pool.query("DELETE FROM logbooks WHERE slug LIKE 'selftest-%'");

console.log('\nmaking one');
let r = await L.createLogbook({ title: 'Selftest: Munich 2026', slug: 'selftest-munich' });
ok('a logbook is created as a draft', r.ok && r.logbook.state === 'draft', JSON.stringify(r));
const lb = r.logbook;

r = await L.createLogbook({ title: 'Again', slug: 'selftest-munich' });
ok('two logbooks cannot share an address', !r.ok && r.reason === 'slug-taken');
r = await L.createLogbook({ title: 'Bad', slug: 'Not A Slug' });
ok('and an address has to be one', !r.ok && r.reason === 'slug');

console.log('\nquestions are made, not built in');
r = await L.addField(lb.id, { kind: 'date', label: 'When did it happen?', required: true });
ok('a date field is added', r.ok && r.field.key === 'when_did_it_happen', JSON.stringify(r.field || r));
r = await L.addField(lb.id, { kind: 'place', label: 'Where it started', filterable: true });
ok('and a place field', r.ok && r.field.filterable === true);
r = await L.addField(lb.id, { kind: 'place', label: 'Where it ended', filterable: true });
ok('AND A SECOND PLACE FIELD — the thing a fixed column could never do', r.ok);
r = await L.addField(lb.id, { kind: 'long_text', label: 'Notes', filterable: true });
ok('a filterable flag on a type with no filter control is not honoured',
  r.ok && r.field.filterable === false, JSON.stringify(r.field || r));
r = await L.addField(lb.id, { kind: 'not_a_type', label: 'X' });
ok('an unknown field type is refused', !r.ok && r.reason === 'kind');
r = await L.addField(lb.id, { kind: 'date', label: 'When did it happen?' });
ok('two fields cannot share a key inside one logbook', !r.ok && r.reason === 'key-taken');

const fields = await L.fieldsFor(lb.id);
ok('the field set is in the operator’s order', fields.length === 4
  && fields[0].key === 'when_did_it_happen' && fields[3].key === 'notes',
  fields.map((f) => f.key).join(','));

const filters = await L.filterableFields(lb.id);
ok('and only the marked ones become filters', filters.length === 2
  && filters.every((f) => f.kind === 'place'), filters.map((f) => f.key).join(','));

console.log('\nanswers, against the real field set');
const built = A.buildAnswers(fields, {
  when_did_it_happen: '2026-11-03',
  where_it_started: 'Precinct 12',
  where_it_ended: 'The car park',
});
ok('both places are answered independently',
  built.answers.where_it_started === 'Precinct 12' && built.answers.where_it_ended === 'The car park');
ok('and an unanswered field has no key', !('notes' in built.answers));
ok('a required field that is missing is refused',
  A.buildAnswers(fields, { where_it_started: 'X' }).errors.length === 1);

console.log('\nthe lifecycle');
ok('a draft is not accepting', !L.isAccepting(lb));

// THE ONE-WAY DOOR, through the real function rather than an UPDATE.
{
  const empty = await L.createLogbook({ slug: 'selftest-empty', title: 'Asks nothing' });
  const r0 = await L.launch(empty.logbook.id);
  ok('a logbook with no questions cannot launch', !r0.ok && r0.reason === 'no-fields',
    JSON.stringify(r0));
}
const launched = await L.launch(lb.id);
ok('a logbook with questions launches', launched.ok === true, JSON.stringify(launched));
ok('and is no longer a draft', launched.logbook?.state !== 'draft', launched.logbook?.state);
{
  const again = await L.launch(lb.id);
  ok('launching twice is refused rather than restamped',
    !again.ok && again.reason === 'already-launched', JSON.stringify(again));
}
await pool.query('UPDATE logbooks SET opens_at = now() WHERE id = $1', [lb.id]);
let live = await L.logbookById(lb.id);
ok('a launched, opened logbook is accepting', L.isAccepting(live) && live.state === 'open');

await L.setSchedule(lb.id, { opensAt: new Date(Date.now() + 864e5).toISOString(), closesAt: null });
live = await L.logbookById(lb.id);
ok('one that opens tomorrow reads as scheduled, not open', live.state === 'scheduled');
await L.setSchedule(lb.id, { opensAt: new Date(Date.now() - 864e5).toISOString(),
  closesAt: new Date(Date.now() - 1000).toISOString() });
live = await L.logbookById(lb.id);
ok('and one whose closing time has passed reads as closed', live.state === 'closed');
ok('WITHOUT a timer having run — the clock is the only authority', true);

await L.setSchedule(lb.id, { opensAt: new Date(Date.now() - 864e5).toISOString(), closesAt: null });
await L.setClosed(lb.id, true);
live = await L.logbookById(lb.id);
ok('a deliberate close overrides the schedule', live.state === 'closed');
await L.setClosed(lb.id, false);
live = await L.logbookById(lb.id);
ok('and reopening is one call, because closing is reversible', live.state === 'open');

console.log('\nthe freeze guard');
r = await L.updateField(lb.id, fields[0].id, { label: 'Reworded' });
ok('a launched logbook refuses to reword a question', !r.ok && r.reason === 'launched');
r = await L.removeField(lb.id, fields[0].id);
ok('and refuses to remove one', !r.ok && r.reason === 'launched');
r = await L.updateField(lb.id, fields[0].id, { required: true });
ok('and refuses to make one required after the fact', !r.ok && r.reason === 'launched');
r = await L.reorderFields(lb.id, fields.map((f) => f.id).reverse());
ok('and refuses to reorder them', !r.ok && r.reason === 'launched');

// THE ONE OPENING, and the reason it is safe: a key enters the hashed
// object only when it applies, so a question added now leaves every report
// already filed hashing exactly as it did.
r = await L.addField(lb.id, { kind: 'short_text', label: 'Anything else?', required: true });
ok('a REQUIRED question after launch is refused',
  !r.ok && r.reason === 'launched-required', JSON.stringify(r));
r = await L.addField(lb.id, { kind: 'short_text', label: 'Anything else?' });
ok('but an OPTIONAL one is allowed, because an absent key costs nothing',
  r.ok === true && r.field.required === false, JSON.stringify(r));

const after = await L.fieldsFor(lb.id);
ok('so every question that was there at launch is still there, unchanged',
  fields.every((f, i) => after[i] && after[i].key === f.key && after[i].label === f.label),
  after.map((f) => f.key).join(','));
ok('and the new one is on the end rather than among them',
  after.length === fields.length + 1 && after[after.length - 1].key === 'anything_else',
  after.map((f) => f.key).join(','));

/* ---- jsonb and the seal ------------------------------------------------ */
console.log('\nanswers survive the round trip through jsonb');

/* THE OBJECTION THE CAMPAIGNS SPEC RAISED, tested rather than argued.
 *
 * It warned that `jsonb` does not round-trip — it reorders keys, drops
 * duplicates, and rewrites 1e2 as 100 — and concluded answers must be stored
 * as `json` or `text` or every report would fail its own verification at
 * once. Migration 027 stores them as `jsonb` anyway, so this has to be shown
 * safe rather than assumed.
 *
 * It is safe for one specific reason, and the reason is what makes it worth
 * a permanent check: the value is a JavaScript object on the way in and a
 * JavaScript object on the way back, and RFC 8785 canonicalizes BOTH sides.
 * Everything jsonb rewrites — key order, number spelling, unicode escapes —
 * is something JCS normalizes anyway, so the rewrite is erased before the
 * hash sees it. The spec's warning is about storing raw JSON text and
 * re-serializing it, which this path never does.
 *
 * If the storage type or the canonicalizer ever changes, this goes red
 * first, which is the point. It is also the September time bug in a new
 * costume — `09:30` hashed, `09:30:00` returned — and that one was found by
 * a stranger failing to verify a report.
 */
{
  const canonicalize = (await import('canonicalize')).default;
  const cases = [
    ['keys out of order',   { b: 'two', a: 'one' }],
    ['a trailing zero',     { n: 1.50 }],
    ['an exponent',         { x: 1e2, y: 1.0 }],
    ['a unicode escape',    { s: '\u0041b' }],
    ['a multiple choice',   { tags: ['Police', 'Staff'] }],
    ['yes and no',          { hurt: true, ok: false }],
    ['the largest safe integer', { n: 9007199254740991 }],
    ['float arithmetic',    { n: 0.1 + 0.2 }],
    ['accents and emoji',   { s: 'M\u00fcller \ud83d\udea9 stra\u00dfe' }],
    ['an empty string',     { s: '' }],
    ['text that looks like JSON', { s: '{"a":1}' }],
  ];
  for (const [what, value] of cases) {
    const { rows } = await pool.query('SELECT $1::jsonb AS j', [JSON.stringify(value)]);
    ok(`${what} hashes the same after jsonb`,
      canonicalize(value) === canonicalize(rows[0].j),
      `${canonicalize(value)} vs ${canonicalize(rows[0].j)}`);
  }
}

console.log('\nthe schema holds the line JavaScript cannot');
let threw = null;
try {
  await pool.query(
    `INSERT INTO logbook_fields (logbook_id, key, kind, label) VALUES ($1, 'Bad Key', 'date', 'X')`,
    [lb.id]);
} catch (e) { threw = e; }
ok('a field key that could not be sealed is refused by the database',
  !!threw && /logbook_fields_key_check/.test(threw.message), threw && threw.message);

await pool.query("DELETE FROM logbooks WHERE slug LIKE 'selftest-%'");
console.log('\n' + pass + ' passed, ' + fail + ' failed');
await pool.end();
process.exit(fail ? 1 : 0);
