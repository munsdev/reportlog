/**
 * The operator's imprint and privacy policy, against a real database and a
 * real app.
 *
 * What is pure — the NULL-versus-empty resolution, the skeleton not being
 * the stored value — is asserted in the main suite. What needs a database
 * is that NULL and '' stay different values once a row round-trips through
 * Postgres, and that an operator taking a notice down really does leave the
 * page saying nothing has been published rather than publishing a blank.
 *
 * What needs a running app is the part that matters most: that the outline
 * the editor opens with is NEVER what the public endpoint serves. Somebody
 * who opens the editor, reads the outline and closes the tab must not have
 * published it.
 *
 *   npm run test:db
 */
import { pool } from '../src/db.js';
import { clearLegalTextCache, SKELETONS, MAX_LEGAL_TEXT } from '../src/legalText.js';

const BASE = process.env.BASE || 'http://localhost:3000';

let pass = 0, fail = 0;
const ok = (n, c, x) => {
  if (c) { pass += 1; console.log('  ok   ' + n); }
  else { fail += 1; console.log('  FAIL ' + n + (x ? ' — ' + x : '')); }
};

const published = () => fetch(`${BASE}/api/legal`).then((r) => r.json());

async function store(kind, value) {
  const column = kind === 'impressum' ? 'impressum_text' : 'privacy_text';
  await pool.query(`UPDATE site_settings SET ${column} = $1 WHERE id = true`, [value]);
  clearLegalTextCache();
  await new Promise((r) => setTimeout(r, 250));
}

/* ---- a deployment that has written nothing --------------------------- */
console.log('\na deployment that has published no legal text');

await store('impressum', null);
await store('privacy', null);
{
  const { rows } = await pool.query(
    'SELECT impressum_text, privacy_text FROM site_settings WHERE id = true',
  );
  ok('stores NULL as NULL for both', rows[0].impressum_text === null && rows[0].privacy_text === null,
    JSON.stringify(rows[0]));
}
{
  const d = await published();
  ok('and serves null rather than a placeholder', d.impressum === null && d.privacy === null,
    JSON.stringify(d));
}

/* ---- the outline is never published ---------------------------------- */
// The whole reason the skeleton is served to the editor instead of being
// the column's default. A default would have published our dummy as every
// operator's own legal notice the moment migration 013 ran.
console.log('\nthe outline the editor starts on');

{
  const d = await published();
  const served = JSON.stringify(d);
  ok('is not what an unwritten imprint serves', !served.includes('outline to complete'), served);
  ok('and is not what an unwritten policy serves',
    d.privacy === null && !served.includes('OUTLINE'), served);
}
ok('and is recognisably an outline rather than prose',
  /\[.+\]/.test(SKELETONS.impressum) && /\[.+\]/.test(SKELETONS.privacy));
ok('and says at the top that it is not a legal notice',
  /not a legal notice/i.test(SKELETONS.impressum) && /not a policy/i.test(SKELETONS.privacy));

/* ---- what an operator wrote ------------------------------------------ */
console.log('\nwhat an operator actually wrote');

const IMPRESSUM = 'Munich Incident Archive e.V.\nBeispielstraße 1\n80331 München';
await store('impressum', IMPRESSUM);
{
  const d = await published();
  ok('is served back exactly as typed, newlines and all', d.impressum === IMPRESSUM,
    JSON.stringify(d.impressum));
  ok('and the other page is still unwritten', d.privacy === null, JSON.stringify(d.privacy));
}

// Nothing about the content is checked, and that is the design: there is
// nothing this software could check it against.
await store('privacy', 'we do not have one, ask me');
{
  const d = await published();
  ok('a policy nobody would call complete is published unchanged',
    d.privacy === 'we do not have one, ask me', JSON.stringify(d.privacy));
}

/* ---- taking one down -------------------------------------------------- */
console.log('\ntaking a notice down');

// Whitespace is not a published notice. A page containing one space would
// otherwise read as an imprint that exists and says nothing.
await store('impressum', '   \n  ');
{
  const d = await published();
  ok('whitespace alone reads as nothing published', d.impressum === null, JSON.stringify(d.impressum));
}
await store('impressum', '');
{
  const d = await published();
  ok('and so does an empty string', d.impressum === null, JSON.stringify(d.impressum));
}

/* ---- the ceiling ------------------------------------------------------ */
// Not a rule about content. A bound on what one row holds.
ok('the ceiling is far above any real notice', MAX_LEGAL_TEXT >= 50000, String(MAX_LEGAL_TEXT));

// Leave the row as the rest of the suite expects to find it.
await store('impressum', null);
await store('privacy', null);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
await pool.end();
process.exit(fail ? 1 : 0);
