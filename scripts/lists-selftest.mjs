/**
 * Lists against a real database.
 *
 * What only exists once rows round-trip through Postgres:
 *
 *   - THE ROW SURVIVES THE SWEEP AND THE PIECES DO NOT. This is the whole
 *     design, it is an UPDATE rather than a DELETE, and no unit test can
 *     see it. After the sweep a tip still has its links, its state and its
 *     category, and has lost its description, its address and its email.
 *   - THE TWO HALVES ARE TWO COLUMNS, so a count physically cannot reach
 *     anything erasable. Checked by counting AFTER the sweep and getting
 *     the same answer.
 *   - The CHECK that refuses a row marked erased which still holds the
 *     erasable half — the backstop for a sweep that marks before it clears.
 *   - Deduplication and the submission count, which is a concurrent upsert.
 *   - Destroying a day's hashing secret, after which a hash taken under it
 *     cannot be recomputed from anything that still exists.
 *   - THE ERASURE LINK, which is a path nothing reaches by accident. Report
 *     confirmation was broken in production for three days under three
 *     green suites because no test walked a link from an email.
 *   - Bulk review moving what is counted, and nothing else.
 *
 *   DATABASE_URL="postgres://…/scratch" node scripts/lists-selftest.mjs
 */
if (!process.env.DATABASE_URL) {
  console.error('Set DATABASE_URL to a scratch database with the migrations applied.');
  process.exit(2);
}
process.env.TIER_B_ENCRYPTION_KEY ||= 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=';
process.env.CONTACT_HMAC_KEY ||= 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=';

const { pool } = await import('../src/db.js');
const { applyListTemplate, shippedTemplates } = await import('../src/lists/templates.js');
const { fileEntry, isAccepting, listBySlug } = await import('../src/lists/entries.js');
const A = await import('../src/lists/aggregates.js');
const R = await import('../src/lists/review.js');
const { sweepPersonal, sweepSalts, sweepErasureTokens } = await import('../src/lists/sweep.js');
const { redeemErasureToken, mintErasureToken } = await import('../src/lists/erasure.js');
const { saltForDay, hashAddress, forgetCachedSalts, utcDay } = await import('../src/lists/salt.js');
const crypto = (await import('node:crypto')).default;

let pass = 0, fail = 0;
const ok = (n, c, x) => {
  c ? (pass++, console.log('  ok   ' + n))
    : (fail++, console.log('  FAIL ' + n + (x ? ' — ' + x : '')));
};
// A CHECK is only worth having if it actually refuses.
const refuses = async (n, sql, params = []) => {
  try { await pool.query(sql, params); ok(n, false, 'the database accepted it'); }
  catch { ok(n, true); }
};

for (const t of ['list_erasures', 'list_entry_links', 'list_entries',
  'list_fields', 'lists', 'link_index', 'list_salts']) {
  await pool.query(`DELETE FROM ${t}`);
}
forgetCachedSalts();

// THE ARCHIVE AS IT STANDS BEFORE ANY OF THIS. Asserting "no reports exist"
// would be a check on which script ran first: this runs in a shared scratch
// database and the scripts above it have filed reports on purpose. What
// lists claim is that they do not MOVE either number.
const before = (await pool.query(
  `SELECT (SELECT count(*) FROM reports) AS reports,
          (SELECT count(*) FROM logbooks) AS logbooks,
          (SELECT count(*) FROM report_heads) AS heads`)).rows[0];

console.log('\nthe three shipped templates apply');

const applied = {};
for (const t of shippedTemplates()) {
  const r = await applyListTemplate(t);
  applied[t.slug] = r;
  ok(`${t.slug} applies`, r.ok === true, JSON.stringify(r));
}
ok('re-applying over a live list is refused rather than overwriting an operator\'s edits',
  (await applyListTemplate(shippedTemplates()[0])).reason === 'slug-taken');

// Give the shipped placeholder vocabularies some real options, which is
// what an operator does before launching.
for (const [slug, key, options] of [
  ['tips', 'state', ['Ohio', 'Iowa', 'Not sure']],
  ['tips', 'category', ['Polling place', 'Ballot', 'Not sure']],
  ['check-ins', 'state', ['Ohio', 'Iowa', 'Not sure']],
]) {
  await pool.query(
    `UPDATE list_fields SET options = $3
       FROM lists l WHERE l.id = list_fields.list_id AND l.slug = $1 AND list_fields.key = $2`,
    [slug, key, JSON.stringify({ options, allowOther: false })],
  );
}

console.log('\nfiling on a list');

const first = await fileEntry('tips', {
  answers: {
    links: 'https://news.example.org/story?utm_source=twitter&id=4',
    state: 'Ohio',
    category: 'Polling place',
    description: 'A queue around the block at 7am, reported by a local paper.',
  },
  email: 'tipster@example.org',
  emailConsent: true,
  address: '203.0.113.7',
});
ok('an entry files and reports its id', first.ok === true && first.id > 0, JSON.stringify(first));

const row1 = (await pool.query('SELECT * FROM list_entries WHERE id = $1', [first.id])).rows[0];
ok('THE DURABLE HALF holds the links, the state and the category',
  Object.keys(row1.answers).sort().join(',') === 'category,links,state',
  JSON.stringify(row1.answers));
ok('THE ERASABLE HALF holds the description and nothing else',
  Object.keys(row1.erasable_answers).join(',') === 'description',
  JSON.stringify(row1.erasable_answers));
ok('the link is stored normalized, with the tracker gone',
  row1.answers.links[0] === 'https://news.example.org/story?id=4', JSON.stringify(row1.answers.links));
ok('it arrives needing review', row1.review_state === 'received' && row1.reviewed_at === null);

const link1 = (await pool.query('SELECT * FROM list_entry_links WHERE entry_id = $1', [first.id])).rows[0];
ok('url_raw keeps what was actually submitted', link1.url_raw.includes('utm_source'));
ok('url_key is the sha256 of the normalized form',
  link1.url_key === crypto.createHash('sha256')
    .update('https://news.example.org/story?id=4').digest('hex'));
ok('and the link remembers which question it answered', link1.field_key === 'links');

console.log('\nthe count is the useful fact');

const second = await fileEntry('tips', {
  answers: {
    links: 'https://NEWS.example.org/story?id=4&fbclid=zzz#top',
    state: 'Iowa', category: 'Ballot',
  },
  address: '203.0.113.9',
});
ok('a second entry with no free text needs no address', second.ok === true, JSON.stringify(second));
ok('and it mints no erasure link, because there is nothing to erase and nowhere to send it',
  second.erasureToken === null);

const idx = (await pool.query('SELECT * FROM link_index')).rows;
ok('forty people sending the same clip is ONE row with a count',
  idx.length === 1 && Number(idx[0].submission_count) === 2,
  JSON.stringify(idx.map((r) => r.submission_count)));

const dup = await fileEntry('tips', {
  answers: {
    links: ['https://ex.org/same?utm_source=a', 'https://EX.org/same#top'],
    state: 'Ohio', category: 'Ballot',
  },
  address: '203.0.113.20',
});
ok('one person pasting the same link twice adds one to the count, not two',
  Number((await pool.query('SELECT submission_count FROM link_index WHERE host = $1',
    ['ex.org'])).rows[0].submission_count) === 1, JSON.stringify(dup.links));

console.log('\nthe gate, enforced on the submission and not only on the form');

const noAddress = await fileEntry('tips', {
  answers: {
    links: 'https://ex.org/refused', state: 'Ohio', category: 'Ballot',
    description: 'Words with nobody to reach about them',
  },
});
ok('free text with no address to reach the writer is refused outright',
  noAddress.reason === 'email-required-for-personal-data', JSON.stringify(noAddress));
ok('and nothing at all was written when it was refused',
  Number((await pool.query(
    `SELECT count(*) c FROM list_entries WHERE erasable_answers::text LIKE '%nobody to reach%'`,
  )).rows[0].c) === 0);
ok('a link that is not a link is refused by the field, not by the form',
  (await fileEntry('tips', {
    answers: { links: 'http://bit.ly/x', state: 'Ohio', category: 'Ballot' },
  })).reason === 'shortener');
ok('an answer outside the operator\'s own option list is refused',
  (await fileEntry('tips', {
    answers: { links: 'https://ex.org/ok', state: 'Atlantis', category: 'Ballot' },
  })).reason === 'not-an-option');
ok('a required question left blank is refused and names itself',
  (await fileEntry('tips', { answers: { state: 'Ohio', category: 'Ballot' } }))
    .reason === 'missing-required');

console.log('\nintake is checked here, not trusted from the form');

await pool.query(`UPDATE lists SET closed_at = now() WHERE slug = 'contact'`);
ok('a form somebody had open when intake closed cannot submit',
  (await fileEntry('contact', {
    answers: { subject: 'Hello', message: 'Anybody there' }, email: 'a@b.co',
  })).reason === 'closed');
ok('and the state is computed rather than read from a flag a timer flipped',
  isAccepting({ closed_at: null, opens_at: null, closes_at: null }) === true
  && isAccepting({ closed_at: null, opens_at: new Date(Date.now() + 8.64e7) }) === false
  && isAccepting({ closed_at: null, closes_at: new Date(Date.now() - 1000) }) === false);
await pool.query(`UPDATE lists SET closed_at = NULL WHERE slug = 'contact'`);

console.log('\nthe address is never written');

ok('no column holds the address that was passed in',
  Number((await pool.query(
    `SELECT count(*) c FROM list_entries
      WHERE ip_hash LIKE '%203.0.113%' OR answers::text LIKE '%203.0.113%'
         OR coalesce(erasable_answers::text,'') LIKE '%203.0.113%'`)).rows[0].c) === 0);
ok('what is stored is a 64-character digest', /^[0-9a-f]{64}$/.test(row1.ip_hash));
ok('and two different addresses do not collide',
  Number((await pool.query('SELECT count(DISTINCT ip_hash) c FROM list_entries')).rows[0].c) >= 2);

console.log('\nrotating and then destroying the day\'s secret');

const today = utcDay();
const saltA = await saltForDay(today);
forgetCachedSalts();
ok('the same day gives the same secret, so a rate limit can see itself',
  Buffer.compare(saltA, await saltForDay(today)) === 0);
const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
ok('a different day gives a different secret',
  Buffer.compare(saltA, await saltForDay(yesterday)) !== 0);
ok('the secret is 32 bytes', saltA.length === 32);

const hashUnderYesterday = await hashAddress('203.0.113.7', { day: yesterday });
await pool.query('UPDATE list_salts SET day = current_date - 400 WHERE day = $1', [yesterday]);
ok('the sweep destroys an expired day\'s secret',
  (await sweepSalts({})).list_salts === 1);
ok('today\'s secret is never a candidate',
  Number((await pool.query('SELECT count(*) c FROM list_salts WHERE day = $1', [today]))
    .rows[0].c) === 1);
ok('and a hash taken under the destroyed secret cannot be recomputed from anything that exists',
  Number((await pool.query('SELECT count(*) c FROM list_salts WHERE day = current_date - 400'))
    .rows[0].c) === 0 && /^[0-9a-f]{64}$/.test(hashUnderYesterday));

console.log('\ncounting, which reads the durable half and only what was ticked');

const tips = await A.loadList('tips');
const sum = await A.summaryFor(tips);
ok('the definition names only the ticked fields, with their labels',
  sum.definition.map((d) => d.key).join(',') === 'state,category', JSON.stringify(sum.definition));
ok('received and approved are BOTH reported, always and separately',
  sum.totals.received === 3 && sum.totals.approved === 0,
  JSON.stringify(sum.totals));
const states = sum.fields.find((f) => f.key === 'state');
ok('a breakdown per ticked field, highest first',
  states.values[0].value === 'Ohio' && states.values[0].received === 2,
  JSON.stringify(states.values));
ok('and the breakdown carries the operator\'s label', states.label === 'Where');

let refusedKey = null;
try { await A.fieldValueCounts(tips, 'description'); } catch (e) { refusedKey = e.message; }
ok('asking for a field nobody ticked is an ERROR, not a silent disclosure',
  /not countable/.test(refusedKey || ''), refusedKey);
let refusedText = null;
try { await A.crossTabFor(tips, ['description']); } catch (e) { refusedText = e.message; }
ok('and free text cannot be crossed either', /not countable/.test(refusedText || ''));

const cross = await A.crossTabFor(tips, ['state', 'category']);
ok('a cross-tabulation groups by several ticked fields at once',
  cross.length === 3 && cross.every((c) => 'state' in c.values && 'category' in c.values),
  JSON.stringify(cross));

const contactSummary = await A.summaryFor('contact');
ok('A CONTACT FORM TICKS NOTHING, so a tool that asks it finds nothing there',
  contactSummary.definition.length === 0 && contactSummary.fields.length === 0);
ok('and that is an answer rather than a failure — it still reports its totals',
  typeof contactSummary.totals.received === 'number');

console.log('\nreview, in bulk');

const batch = await R.reviewBatch(tips.id, { knownHosts: ['news.example.org'] });
ok('the pane shows every link with its host', batch.entries.length === 3);
ok('an unfamiliar host is marked for the reviewer, not blocked',
  batch.entries.some((e) => e.links.some((l) => l.knownHost === true))
  && batch.entries.some((e) => e.links.some((l) => l.knownHost === false)));
ok('the moderator can read the erasable half, because that is their job',
  batch.entries.some((e) => e.erasableAnswers !== null));
ok('and how much is waiting is a number somebody can look at',
  (await R.pendingCount(tips.id)).waiting === 3);

const approved = await R.reviewEntries(tips.id, batch.entries.slice(0, 2).map((e) => e.id),
  { state: 'approved' });
ok('a page of entries is approved together', approved.changed === 2);
const after = await A.summaryFor(tips);
ok('APPROVING MOVES WHAT IS COUNTED, and received stays where it was',
  after.totals.approved === 2 && after.totals.received === 3,
  JSON.stringify(after.totals));
ok('rejecting stops a count without deleting anything',
  (await R.reviewEntries(tips.id, [batch.entries[2].id], { state: 'rejected' })).changed === 1
  && Number((await pool.query('SELECT count(*) c FROM list_entries WHERE list_id = $1',
    [tips.id])).rows[0].c) === 3);
let unreview = null;
try { await R.reviewEntries(tips.id, [batch.entries[0].id], { state: 'received' }); }
catch (e) { unreview = e.message; }
ok('an entry cannot be un-reviewed', /cannot be un-reviewed/.test(unreview || ''));

console.log('\nthe sweep erases the pieces and leaves the row');

await pool.query(
  `UPDATE list_entries SET personal_expires_at = now() - interval '1 day' WHERE id = $1`,
  [first.id]);
ok('the sweep reports one entry erased', (await sweepPersonal({})).list_entries === 1);

const swept = (await pool.query('SELECT * FROM list_entries WHERE id = $1', [first.id])).rows[0];
ok('THE ROW IS STILL THERE', Boolean(swept));
ok('the erasable half is gone', swept.erasable_answers === null);
ok('the email is gone', swept.email === null);
ok('the hashed address is gone', swept.ip_hash === null);
ok('erased_at records that it happened', swept.erased_at !== null);
ok('THE DURABLE HALF IS UNTOUCHED — links, state and category all survive',
  swept.answers.links.length === 1 && swept.answers.state === 'Ohio'
  && swept.answers.category === 'Polling place', JSON.stringify(swept.answers));
ok('AND THE LINKS STAY as rows of their own',
  Number((await pool.query('SELECT count(*) c FROM list_entry_links WHERE entry_id = $1',
    [first.id])).rows[0].c) === 1);
ok('the link index is untouched by any of it',
  Number((await pool.query('SELECT submission_count FROM link_index WHERE host = $1',
    ['news.example.org'])).rows[0].submission_count) === 2);
ok('the review decision survives the sweep too', swept.review_state === 'approved');

const afterSweep = await A.summaryFor(tips);
ok('AND THE COUNT IS UNCHANGED BY THE SWEEP, because it never read the erasable half',
  afterSweep.totals.approved === after.totals.approved
  && JSON.stringify(afterSweep.fields) === JSON.stringify(after.fields),
  JSON.stringify(afterSweep.totals));

console.log('\nwhat the database refuses');

await refuses('a row marked erased that still holds the erasable half',
  `UPDATE list_entries SET erased_at = now(), erasable_answers = '{"a":1}'::jsonb WHERE id = $1`,
  [second.id]);
await refuses('a row marked erased that still holds an email',
  `UPDATE list_entries SET erased_at = now(), email = 'a@b.c' WHERE id = $1`, [second.id]);
await refuses('a review state that is not one of the three',
  `UPDATE list_entries SET review_state = 'maybe' WHERE id = $1`, [second.id]);
await refuses('a reviewed row with no record of when',
  `UPDATE list_entries SET review_state = 'approved', reviewed_at = NULL WHERE id = $1`,
  [second.id]);
await refuses('a countable long_text field, which is free text',
  `INSERT INTO list_fields (list_id, key, kind, label, aggregatable, retention)
   VALUES ($1, 'sneaky', 'long_text', 'Sneaky', true, 'durable')`, [tips.id]);
await refuses('a countable field that is not collected',
  `INSERT INTO list_fields (list_id, key, kind, label, aggregatable, retention)
   VALUES ($1, 'absent_but_counted', 'choice_one', 'X', true, 'absent')`, [tips.id]);
await refuses('two fields sharing a key on one list',
  `INSERT INTO list_fields (list_id, key, kind, label, retention)
   VALUES ($1, 'state', 'choice_one', 'Again', 'durable')`, [tips.id]);
await refuses('a url_key that is not a sha256',
  `INSERT INTO link_index (url_key, host) VALUES ('nope', 'x.com')`);
await refuses('a hashing secret of the wrong length',
  `INSERT INTO list_salts (day, salt) VALUES (current_date - 7, $1)`, [Buffer.alloc(16)]);
await refuses('an unknown retention class',
  `INSERT INTO list_fields (list_id, key, kind, label, retention)
   VALUES ($1, 'weird', 'choice_one', 'X', 'forever')`, [tips.id]);
// No safe blanket default exists, so a writer that forgets fails loudly
// here rather than quietly in a year.
await refuses('a field that does not say how long its answers live',
  `INSERT INTO list_fields (list_id, key, kind, label)
   VALUES ($1, 'unstated', 'choice_one', 'X')`, [tips.id]);

console.log('\na durable entry is erased by its holder, never by the clock');

const kept = await fileEntry('contact', {
  answers: { subject: 'Keeping this', message: 'Indefinitely' },
  email: 'keeper@example.org', address: '203.0.113.11',
}, { env: { ...process.env, LIST_PERSONAL_DAYS: 'never' } });
ok('the durable profile stores no expiry', kept.ok && kept.personalExpiresAt === null,
  JSON.stringify(kept));
ok('and the sweep passes over it', (await sweepPersonal({})).list_entries === 0);
ok('its message is still there',
  (await pool.query('SELECT erasable_answers FROM list_entries WHERE id = $1', [kept.id]))
    .rows[0].erasable_answers.message === 'Indefinitely');

console.log('\nthe erasure link, which nothing reaches by accident');

ok('a wrong token erases nothing', (await redeemErasureToken('not-real')).ok === false);
ok('an absent token erases nothing', (await redeemErasureToken(null)).ok === false);
const redeemed = await redeemErasureToken(kept.erasureToken);
ok('the token from the email works', redeemed.ok === true && redeemed.entryId === kept.id,
  JSON.stringify(redeemed));
const erasedByHolder = (await pool.query('SELECT * FROM list_entries WHERE id = $1', [kept.id])).rows[0];
ok('it erased the message', erasedByHolder.erasable_answers === null);
ok('it erased the email', erasedByHolder.email === null);
ok('it left the row standing', Boolean(erasedByHolder));
ok('a token cannot be redeemed twice', (await redeemErasureToken(kept.erasureToken)).ok === false);

const expiredToken = await mintErasureToken({ entryId: second.id });
await pool.query(`UPDATE list_erasures SET expires_at = now() - interval '1 day' WHERE used_at IS NULL`);
ok('an expired link erases nothing', (await redeemErasureToken(expiredToken)).ok === false);
ok('and an expired or spent link is swept away',
  Object.values(await sweepErasureTokens({}))[0] >= 1);

console.log('\ncheck-ins, where what is left after the sweep is the count');

for (const [state, verdict, n] of [
  ['Ohio', 'It went fine', 5], ['Ohio', 'Something went wrong', 2], ['Iowa', 'It went fine', 3]]) {
  for (let i = 0; i < n; i++) {
    await fileEntry('check-ins', { answers: { state, verdict }, address: `198.51.100.${i}` });
  }
}
const checkins = await A.loadList('check-ins');
await pool.query(`UPDATE list_entries SET review_state = 'approved', reviewed_at = now()
                   WHERE list_id = $1`, [checkins.id]);
const ci = await A.summaryFor(checkins);
const fine = ci.fields.find((f) => f.key === 'verdict').values
  .find((v) => v.value === 'It went fine');
ok('the count is per verdict and per state',
  fine.approved === 8 && ci.totals.received === 10, JSON.stringify(ci.totals));
ok('and the denominator sits beside the numerator',
  ci.fields.find((f) => f.key === 'verdict').values.length === 2);
ok('a check-in needed no address to be filed, because nothing it collects is personal',
  (await pool.query('SELECT count(*) c FROM list_entries WHERE list_id = $1 AND email IS NOT NULL',
    [checkins.id])).rows[0].c === '0');

await pool.query(`UPDATE list_entries SET personal_expires_at = now() - interval '1 day'
                   WHERE list_id = $1`, [checkins.id]);
await sweepPersonal({});
ok('the sweep erases every check-in\'s address',
  (await pool.query('SELECT count(*) c FROM list_entries WHERE list_id = $1 AND ip_hash IS NOT NULL',
    [checkins.id])).rows[0].c === '0');
const ciAfter = await A.summaryFor(checkins);
ok('AND THE COUNT IS UNCHANGED, with no rule needed to say so',
  JSON.stringify(ciAfter.fields) === JSON.stringify(ci.fields));

console.log('\nwhat would be published, and what would not');

const snapNone = await A.snapshotDocument({});
ok('nothing is published until an operator says so', snapNone.lists.length === 0);
await pool.query(`UPDATE lists SET aggregates_published = true WHERE slug = 'check-ins'`);
ok('published but still hidden is NOT published: it goes into a log never rewritten',
  (await A.snapshotDocument({})).lists.length === 0);
await pool.query(`UPDATE lists SET visibility = 'listed' WHERE slug = 'check-ins'`);
const snap = await A.snapshotDocument({});
ok('the snapshot carries only the lists an operator published',
  snap.lists.length === 1 && snap.lists[0].slug === 'check-ins');
ok('and it SEALS THE DEFINITION it was computed under, like a report seals its form',
  snap.lists[0].definition.length === 2
  && snap.lists[0].definition.every((d) => d.key && d.label));
ok('it carries a format marker and a generated_at',
  snap.reportlog_list_aggregates === 1 && typeof snap.generated_at === 'string');
ok('the contact form is NOT in it, because nothing it holds is countable',
  !snap.lists.some((l) => l.slug === 'contact'));
ok('nothing in the snapshot is anything a submitter wrote',
  !JSON.stringify(snap).includes('queue around the block')
  && !JSON.stringify(snap).includes('Indefinitely'));

const links = await A.linkCounts({});
ok('the deduplicated link layer reports counts and no submitter',
  links.length === 2 && links[0].submissionCount === 2
  && !Object.keys(links[0]).some((k) => /email|ip|address/i.test(k)),
  JSON.stringify(links));

console.log('\nnothing here went near a chain');

const after2 = (await pool.query(
  `SELECT (SELECT count(*) FROM reports) AS reports,
          (SELECT count(*) FROM logbooks) AS logbooks,
          (SELECT count(*) FROM report_heads) AS heads`)).rows[0];
ok('not one report was created by any of this', after2.reports === before.reports,
  `${before.reports} -> ${after2.reports}`);
ok('no logbook either', after2.logbooks === before.logbooks);
ok('and no chain head moved', after2.heads === before.heads);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
await pool.end(); process.exit(fail ? 1 : 0);
