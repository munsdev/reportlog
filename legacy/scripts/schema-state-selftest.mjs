/**
 * What this database has run, against what this checkout carries.
 *
 * WHY THIS NEEDS A DATABASE: the whole value of `schemaState` is the two
 * DRIFT cases, and drift only exists once `schema_migrations` has rows that
 * disagree with the files on disk. The in-step case is the one that proves
 * nothing, and it is the only one a unit test could see.
 *
 * THE STORY IT GUARDS. A deployment installed from `stable` on 10 October
 * and the operator could not tell whether the feature he had just built was
 * on it. The commit hash does not answer that — `git pull` moves the
 * checkout and `npm run migrate` moves the database, so a deploy that did
 * the first and not the second runs new code against an old schema with
 * every new feature simply absent and nothing reporting a fault.
 *
 *   DATABASE_URL="postgres://…/scratch" node scripts/schema-state-selftest.mjs
 */
if (!process.env.DATABASE_URL) {
  console.error('Set DATABASE_URL to a scratch database with the migrations applied.');
  process.exit(2);
}
process.env.TIER_B_ENCRYPTION_KEY ||= 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=';
process.env.CONTACT_HMAC_KEY ||= 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=';

const { pool } = await import('../src/db.js');
const { schemaState, migrationFiles } = await import('../src/schemaState.js');

let pass = 0, fail = 0;
const ok = (n, c, x) => {
  c ? (pass++, console.log('  ok   ' + n))
    : (fail++, console.log('  FAIL ' + n + (x ? ' — ' + x : '')));
};

console.log('\nin step, which is the state that proves nothing');

const files = migrationFiles();
const base = await schemaState();
ok('it reads the migrations in the order migrate.js runs them',
  files.length > 0 && files.every((f) => f.endsWith('.sql'))
  && JSON.stringify(files) === JSON.stringify([...files].sort()));
ok('a migrated database reports nothing pending and nothing unknown',
  base.reachable === true && base.pending.length === 0 && base.unknown.length === 0,
  JSON.stringify(base));
ok('and it names the newest migration the database has actually run',
  base.newest === files[files.length - 1], `${base.newest} vs ${files[files.length - 1]}`);
ok('applied matches what is on disk', base.applied === base.onDisk);

console.log('\nthe database BEHIND the code — the fault that is invisible');

const last = files[files.length - 1];
await pool.query('DELETE FROM schema_migrations WHERE filename = $1', [last]);
const behind = await schemaState();
ok('it notices a migration the checkout carries and the database has not run',
  behind.pending.length === 1 && behind.pending[0] === last, JSON.stringify(behind.pending));
ok('applied is one short of what is on disk',
  behind.applied === behind.onDisk - 1);
ok('and newest reports what the DATABASE has, not what the checkout has',
  behind.newest !== last,
  'newest must be the database\'s answer, or the drift is invisible again');
await pool.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [last]);

console.log('\nthe code BEHIND the database — a different fault, named separately');

await pool.query("INSERT INTO schema_migrations (filename) VALUES ('099_from_the_future.sql')");
const ahead = await schemaState();
ok('it notices a migration the database ran that this checkout does not carry',
  ahead.unknown.length === 1 && ahead.unknown[0] === '099_from_the_future.sql',
  JSON.stringify(ahead.unknown));
ok('and does NOT report it as pending, because migrating is the wrong fix',
  ahead.pending.length === 0,
  'telling somebody to migrate here would be telling them to do nothing useful');
await pool.query("DELETE FROM schema_migrations WHERE filename = '099_from_the_future.sql'");

console.log('\nno schema at all, which is a real state and not an error');

// A database that has never been migrated. Pointed at a schema-less
// database rather than dropping the table, so this script never damages
// the scratch database the rest of the suite is using.
const bare = await schemaState({
  client: { query: async () => { throw new Error('relation does not exist'); } },
});
ok('an unmigrated database reports every migration as pending',
  bare.reachable === false && bare.pending.length === bare.onDisk);
ok('and says so rather than throwing', bare.applied === 0 && bare.newest === null);

console.log('\nit left the database as it found it');
const after = await schemaState();
ok('nothing pending, nothing unknown',
  after.pending.length === 0 && after.unknown.length === 0
  && after.applied === base.applied, JSON.stringify(after));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
await pool.end(); process.exit(fail ? 1 : 0);
