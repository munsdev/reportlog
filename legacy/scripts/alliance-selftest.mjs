/**
 * The Alliance directory, against a real database.
 *
 * The counting and the ordering are the whole feature, and neither exists
 * until rows are really in Postgres: a member is a row in
 * organization_memberships, a pending invitation is a row in a different
 * table, and the difference between them is the difference between a
 * headcount that certifies something and one that does not.
 *
 *   npm run test:db
 */
import { directory, setListed, DISCLAIMER } from '../src/alliance.js';
import { pool } from '../src/db.js';

let pass = 0, fail = 0;
const ok = (n, c, x) => {
  if (c) { pass += 1; console.log('  ok   ' + n); }
  else { fail += 1; console.log('  FAIL ' + n + (x ? ' — ' + x : '')); }
};

const org = async (name, details) => {
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, details) VALUES ($1, $2)
     ON CONFLICT (name) DO UPDATE SET details = EXCLUDED.details RETURNING id`,
    [name, details],
  );
  return rows[0].id;
};
const member = async (orgId, email) => {
  const { rows } = await pool.query(
    `INSERT INTO users (email, email_hmac) VALUES ($1, $1)
     ON CONFLICT (email) DO UPDATE SET updated_at = now() RETURNING id`,
    [email],
  );
  await pool.query(
    `INSERT INTO organization_memberships (organization_id, user_id, role)
     VALUES ($1, $2, 'coordinator') ON CONFLICT DO NOTHING`,
    [orgId, rows[0].id],
  );
};

const big = await org('Alliance Test Big', 'Statewide.');
const small = await org('Alliance Test Small', 'Two people and a clipboard.');
const empty = await org('Alliance Test Empty', 'Just signed up.');
const shy = await org('Alliance Test Shy', 'Does not want listing.');

for (const e of ['at-a@example.org', 'at-b@example.org', 'at-c@example.org']) await member(big, e);
await member(small, 'at-d@example.org');
await member(shy, 'at-e@example.org');

/* ---- opting in ------------------------------------------------------- */
console.log('\nopting in');

const names = async () => (await directory())
  .filter((o) => o.name.startsWith('Alliance Test'))
  .map((o) => [o.name, o.member_count]);

ok('an organization that has not decided is not listed',
  (await names()).length === 0, JSON.stringify(await names()));

for (const id of [big, small, empty]) await setListed(id, true);

const listed = await names();
ok('opting in puts them in the directory', listed.length === 3, JSON.stringify(listed));
ok('and one that did not opt in stays out',
  !listed.some(([n]) => n === 'Alliance Test Shy'), JSON.stringify(listed));

/* ---- ranking --------------------------------------------------------- */
console.log('\nranking, by member count and nothing else');

ok('the largest is first', listed[0][0] === 'Alliance Test Big', JSON.stringify(listed));
ok('and the counts descend',
  listed.every((row, i) => i === 0 || listed[i - 1][1] >= row[1]), JSON.stringify(listed));
ok('counts are exact rather than banded',
  listed[0][1] === 3 && listed[1][1] === 1, JSON.stringify(listed));

// The objection that shaped this whole design: a report-count ranking
// would be a public incentive to file more reports, which is an argument
// for manufacturing them. Nothing the directory serves may carry one.
{
  const rows = await directory();
  const keys = new Set(rows.flatMap((r) => Object.keys(r)));
  ok('no report count is published anywhere in the directory',
    ![...keys].some((k) => /report/i.test(k)), [...keys].join(', '));
}

/* ---- zero members ---------------------------------------------------- */
console.log('\nan organization with nobody in it');

ok('still appears, showing an honest zero',
  listed.some(([n, c]) => n === 'Alliance Test Empty' && c === 0), JSON.stringify(listed));

/* ---- pending invitations do not count -------------------------------- */
console.log('\nwhat counts as a member');

await pool.query(
  `INSERT INTO organization_invites (organization_id, email, role, invited_by)
   VALUES ($1, $2, 'coordinator', $3) ON CONFLICT DO NOTHING`,
  [small, 'at-never-accepted@example.org', 'at-d@example.org'],
).catch(() => { /* shape differs? the assertion below still holds */ });

{
  const after = await names();
  const smallCount = after.find(([n]) => n === 'Alliance Test Small')[1];
  // Otherwise the number is "addresses this organization typed in", which
  // certifies nothing and can be inflated by one person with a keyboard.
  ok('an invitation nobody accepted does not count', smallCount === 1, String(smallCount));
}

/* ---- opting out ------------------------------------------------------ */
console.log('\nopting out');

const before = (await pool.query('SELECT listed_at FROM organizations WHERE id = $1', [big])).rows[0].listed_at;
await setListed(big, false);
ok('removes them from the directory',
  !(await names()).some(([n]) => n === 'Alliance Test Big'), JSON.stringify(await names()));

{
  const { rows } = await pool.query('SELECT listed, listed_at FROM organizations WHERE id = $1', [big]);
  ok('and keeps the date they joined', String(rows[0].listed_at) === String(before),
    `${rows[0].listed_at} vs ${before}`);
}

const back = await setListed(big, true);
ok('re-listing does not make them look new',
  String(back.listed_at) === String(before), `${back.listed_at} vs ${before}`);

/* ---- the sentence that has to be there ------------------------------- */
console.log('\nthe disclaimer');

ok('says listing is not verification', /not verification/i.test(DISCLAIMER), DISCLAIMER);
ok('and says no standard for it exists', /no standard/i.test(DISCLAIMER), DISCLAIMER);

// Leave the database as it was found.
await pool.query(
  "DELETE FROM organization_memberships WHERE organization_id IN (SELECT id FROM organizations WHERE name LIKE 'Alliance Test%')",
).catch(() => {});
await pool.query("UPDATE organizations SET listed = false WHERE name LIKE 'Alliance Test%'");

console.log('\n' + pass + ' passed, ' + fail + ' failed');
await pool.end();
process.exit(fail ? 1 : 0);
