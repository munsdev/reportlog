/**
 * The review-flag keyword list, against a real database.
 *
 * The matching itself is pure and is tested in scripts/selftest.js. What
 * only exists once a row round-trips through Postgres is the THREE-STATE
 * column: NULL meaning "we have not chosen, use the shipped set", an array
 * meaning "this is our list", and an EMPTY array meaning "we have chosen,
 * and the answer is no keyword matching". The last two are the same value
 * in JavaScript's eyes often enough that only the database can settle it.
 *
 *   DATABASE_URL="postgres://…/scratch" node scripts/review-keywords-selftest.mjs
 */
if (!process.env.DATABASE_URL) {
  console.error('Set DATABASE_URL to a scratch database with the migrations applied.');
  process.exit(2);
}
process.env.TIER_B_ENCRYPTION_KEY ||= 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=';
process.env.CONTACT_HMAC_KEY ||= '0123456789abcdef0123456789abcdef';
const { pool } = await import('../src/db.js');
const K = await import('../src/reviewKeywords.js');
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log('  FAIL ' + n + (x ? ' — ' + x : ''))); };

await pool.query('INSERT INTO site_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING');

console.log('\nthe three states');

// Cleared first, because an earlier script in the shared scratch database
// may have set it — a test that assumes a pristine row fails for a reason
// that has nothing to do with what it is checking.
await pool.query('UPDATE site_settings SET review_keywords = NULL WHERE id = true');
let terms = await K.reviewKeywords();
ok('an untouched install uses the shipped set',
  terms.length === K.DEFAULT_REVIEW_KEYWORDS.length, terms.length + ' terms');

let out = await K.setReviewKeywords(['Turned Away', 'threatened', 'turned away'],
  { byEmail: 'moderator@example.org' });
ok('an operator list is stored normalized', out.ok && out.terms.join('|') === 'threatened|turned away');
terms = await K.reviewKeywords();
ok('and read back as stored', terms.join('|') === 'threatened|turned away');

out = await K.setReviewKeywords([], { byEmail: 'moderator@example.org' });
terms = await K.reviewKeywords();
ok('an EMPTY list is honoured as a choice, not read as unset', terms.length === 0,
  terms.length + ' terms came back');

out = await K.setReviewKeywords(null, { byEmail: 'moderator@example.org' });
terms = await K.reviewKeywords();
ok('and null puts the shipped set back', terms.length === K.DEFAULT_REVIEW_KEYWORDS.length);
ok('null is reported as using the default', out.usingDefault === true);

console.log('\nwho changed it');
await K.setReviewKeywords(['harassed'], { byEmail: 'someone@example.org' });
let { rows } = await pool.query(
  'SELECT review_keywords_set_by, review_keywords_set_at FROM site_settings WHERE id = true');
ok('the person is recorded', rows[0].review_keywords_set_by === 'someone@example.org');
ok('and when they did it', rows[0].review_keywords_set_at instanceof Date);

console.log('\nwhat the database refuses');
// The ceiling is a sanity bound, not an opinion: every term goes into one
// regular expression that runs on every submission.
const huge = Array.from({ length: 2001 }, (_, i) => 'term' + i);
out = await K.setReviewKeywords(huge, { byEmail: 'moderator@example.org' });
ok('2001 terms are refused before the query runs', out.ok === false && out.reason === 'too-many');
terms = await K.reviewKeywords();
ok('and the refusal left the stored list alone', terms.join('|') === 'harassed');

let threw = false;
try {
  await pool.query('UPDATE site_settings SET review_keywords = $1 WHERE id = true', [huge]);
} catch { threw = true; }
ok('the CHECK stops it at the database too, not only in the module', threw);

// 2000 exactly is the boundary and must be allowed, or the stated ceiling
// is off by one in the direction nobody tests.
out = await K.setReviewKeywords(huge.slice(0, 2000), { byEmail: 'moderator@example.org' });
ok('2000 exactly is allowed', out.ok === true && out.terms.length === 2000);

console.log('\nthe flag reads the operator list, not the shipped one');
await K.setReviewKeywords(['turned me away'], { byEmail: 'moderator@example.org' });
terms = await K.reviewKeywords();
ok('a term the operator kept fires',
  K.matchedKeywords('They turned me away at the door', terms).join('|') === 'turned me away');
ok('a term the operator CUT does not',
  K.matchedKeywords('He had a gun.', terms).length === 0,
  'the shipped list is still being consulted');

// Left as it was found, so the next script in the runner sees an untouched
// row rather than this one's last experiment.
await pool.query('UPDATE site_settings SET review_keywords = NULL WHERE id = true');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
await pool.end(); process.exit(fail ? 1 : 0);
