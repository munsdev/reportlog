/**
 * The publication switches, against a real database and a real app.
 *
 * The pure half — what NULL resolves to, in each direction — is in the main
 * suite. What needs a database and a running server is the half that
 * matters: that switching the archive off actually stops every door it is
 * supposed to stop, and that it stops them the same way.
 *
 * A tri-state only exists once a row round-trips through Postgres, where
 * NULL and false are genuinely different values, which is the same reason
 * attachment-settings-selftest.mjs exists.
 *
 *   npm run test:db
 */
import pg from 'pg';
import { clearPublicationSettingsCache } from '../src/publication.js';

const BASE = process.env.BASE || 'http://localhost:3000';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

let pass = 0, fail = 0;
const ok = (n, c, x) => {
  if (c) { pass += 1; console.log('  ok   ' + n); }
  else { fail += 1; console.log('  FAIL ' + n + (x ? ' — ' + x : '')); }
};

// Every public read the archive has. Listed here rather than spot-checked,
// because the failure this guards against is a door somebody forgot: one
// route left ungated publishes the record on a deployment that said not to,
// and it would be the quietest possible bug.
const DOORS = [
  '/api/v1/stats',
  '/api/stats',
  '/api/reports',
  '/api/reports/export.csv',
  '/api/reports/RL-NOTHING-AA',
  '/api/reports/RL-NOTHING-AA/attachments',
];

const get = (p) => fetch(BASE + p).then(async (r) => ({
  status: r.status, text: await r.text(),
}));

// The reader caches, and the app is a separate process, so a write here is
// not visible there until the cache expires. The suite starts that app with
// PUBLICATION_SETTINGS_TTL_MS=0 so this is a moment rather than half a
// minute three times over — a test that takes ninety seconds to assert two
// booleans is a test somebody eventually deletes.
const SETTLE_MS = Number(process.env.PUBLICATION_SETTLE_MS ?? 250);
async function set(value) {
  await pool.query('UPDATE site_settings SET public_archive_enabled = $1 WHERE id = true', [value]);
  clearPublicationSettingsCache();
  await new Promise((r) => setTimeout(r, SETTLE_MS));
}

/* ---- no opinion ------------------------------------------------------ */
console.log('\nan untouched deployment');

await set(null);
{
  const { rows } = await pool.query('SELECT public_archive_enabled FROM site_settings WHERE id = true');
  ok('stores NULL as NULL, not as false', rows[0].public_archive_enabled === null,
    JSON.stringify(rows[0]));
}
for (const door of DOORS) {
  const r = await get(door);
  ok(`${door} answers normally`, !r.text.includes('does not publish a public archive'),
    r.status + ' ' + r.text.slice(0, 80));
}

/* ---- switched off ---------------------------------------------------- */
console.log('\nwith the archive switched off');

await set(false);
for (const door of DOORS) {
  const r = await get(door);
  // The board list answers with an empty array rather than a notice: it
  // asked for the published record and there is none to give, which is not
  // an error and renders as an empty board.
  const withheld = door === '/api/reports'
    ? r.text.trim() === '[]'
    : r.text.includes('does not publish a public archive');
  ok(`${door} withholds`, withheld, r.status + ' ' + r.text.slice(0, 80));
}

/* ---- switched back on ------------------------------------------------ */
console.log('\nand switched back on');

await set(true);
for (const door of DOORS) {
  const r = await get(door);
  ok(`${door} publishes again`, !r.text.includes('does not publish a public archive'),
    r.status + ' ' + r.text.slice(0, 80));
}

/* ---- distribution ---------------------------------------------------- */
console.log('\ndistribution');

{
  const { rows } = await pool.query('SELECT distribution_enabled FROM site_settings WHERE id = true');
  // Nothing in this suite has touched it, and nothing else may have either.
  // A deployment that started distributing because a migration ran would be
  // the one unrecoverable mistake this column exists to prevent.
  ok('is untouched by every migration that has run', rows[0].distribution_enabled === null,
    JSON.stringify(rows[0]));
}

// Put it back to the documented no-opinion state for whatever runs next.
await pool.query('UPDATE site_settings SET public_archive_enabled = NULL WHERE id = true');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
await pool.end();
process.exit(fail ? 1 : 0);
