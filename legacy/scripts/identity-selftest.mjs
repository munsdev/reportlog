/**
 * The deployment's name, against a real database and a real app.
 *
 * The resolution order is pure and is asserted in the main suite. What needs
 * a database is the tri-state — a stored name, NULL meaning defer, and an
 * empty string meaning go back to the default — because NULL and '' are
 * genuinely different values only once a row round-trips through Postgres.
 * And what needs a running app is that the name reaches the one endpoint
 * every page reads before it renders.
 *
 *   npm run test:db
 */
import { pool } from '../src/db.js';
import { clearIdentityCache, SOFTWARE_NAME } from '../src/siteIdentity.js';

const BASE = process.env.BASE || 'http://localhost:3000';

let pass = 0, fail = 0;
const ok = (n, c, x) => {
  if (c) { pass += 1; console.log('  ok   ' + n); }
  else { fail += 1; console.log('  FAIL ' + n + (x ? ' — ' + x : '')); }
};

const status = () => fetch(`${BASE}/api/site-access/status`).then((r) => r.json());

// The reader caches and the app is a separate process, so the suite runs it
// with SITE_IDENTITY_TTL_MS=0 and this only has to clear its own copy.
async function setName(value) {
  await pool.query('UPDATE site_settings SET site_name = $1 WHERE id = true', [value]);
  clearIdentityCache();
  await new Promise((r) => setTimeout(r, 250));
}

/* ---- the default -------------------------------------------------- */
console.log('\na deployment that has never been asked');

await setName(null);
{
  const { rows } = await pool.query('SELECT site_name FROM site_settings WHERE id = true');
  ok('stores NULL as NULL, not as the default string', rows[0].site_name === null,
    JSON.stringify(rows[0]));
}
{
  const s = await status();
  // The app under test has no SITE_NAME in its environment, so the answer
  // falls all the way through to the software's own name.
  ok('and is served the software name', s.siteName === SOFTWARE_NAME, JSON.stringify(s.siteName));
  ok('while still naming the software separately', s.software === SOFTWARE_NAME,
    JSON.stringify(s.software));
}

/* ---- named --------------------------------------------------------- */
console.log('\nonce it has a name');

const NAME = 'Wahlbeobachtung Berlin';
await setName(NAME);
{
  const s = await status();
  ok('the deployment name is served', s.siteName === NAME, JSON.stringify(s.siteName));
  ok('and the software name is unchanged beside it', s.software === SOFTWARE_NAME,
    JSON.stringify(s.software));
}

/* ---- back to the default ------------------------------------------- */
console.log('\nclearing it again');

// The admin route turns an empty submission into NULL rather than storing
// '', because '' would be a name that renders as nothing.
await setName('');
{
  const s = await status();
  ok('an empty stored name falls back rather than blanking the site',
    s.siteName === SOFTWARE_NAME, JSON.stringify(s.siteName));
}

await setName('   ');
{
  const s = await status();
  ok('and so does whitespace', s.siteName === SOFTWARE_NAME, JSON.stringify(s.siteName));
}

/* ---- never part of the record -------------------------------------- */
console.log('\nthe name is presentation, not archive');

{
  // The one thing that would be unrecoverable: a rename changing how a
  // report verifies. Asserted against the live schema rather than the
  // migration, so a column added by hand later is caught too.
  //
  // NOT a wildcard on "site": `reports.site_text` is the POLLING SITE — the
  // physical place an incident happened — and it is properly part of the
  // sealed content. The collision between that sense of "site" and the
  // deployment's own name is confusing enough that this names exactly the
  // columns it refuses.
  const { rows } = await pool.query(`
    SELECT column_name FROM information_schema.columns
     WHERE table_name = 'reports'
       AND column_name IN ('site_name', 'sitename', 'deployment_name', 'brand')
  `);
  ok('no deployment name is stored on a report', rows.length === 0,
    JSON.stringify(rows.map((r) => r.column_name)));
}

{
  const { rows } = await pool.query(`
    SELECT column_name FROM information_schema.columns
     WHERE table_name = 'site_settings' AND column_name = 'site_name'
  `);
  ok('and the name lives on site_settings, where presentation belongs',
    rows.length === 1, JSON.stringify(rows));
}

// Leave it as the suite found it.
await setName(null);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
await pool.end();
process.exit(fail ? 1 : 0);
