/**
 * The intake switch, against a real database and a real app.
 *
 * What is pure — NULL resolving to open — is asserted in the main suite.
 * What needs a database and a running server is the part that matters:
 * that BOTH doors into the chain actually refuse when the switch is off,
 * and that closing intake touches nothing that was already filed.
 *
 * The second half is the real check. A switch that closed the public form
 * while a coordinator could still file a batch of two hundred would not be
 * an intake switch; it would be a change to who is allowed to file.
 *
 *   npm run test:db
 */
import { pool } from '../src/db.js';
import { clearIntakeSettingsCache, intakeOpen } from '../src/intakeGate.js';

const BASE = process.env.BASE || 'http://localhost:3000';

let pass = 0, fail = 0;
const ok = (n, c, x) => {
  if (c) { pass += 1; console.log('  ok   ' + n); }
  else { fail += 1; console.log('  FAIL ' + n + (x ? ' — ' + x : '')); }
};

const call = (path, opts = {}) => fetch(BASE + path, {
  ...opts,
  headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
}).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

// The coordinator door is behind requireAuth, so testing it anonymously
// only ever proves that requireAuth works. Sign in the way intake-selftest
// does — mint the session row directly, which is where the OTP flow lands
// anyway — so the refusal under test is the switch and not the login.
const { rows: coordRows } = await pool.query(
  "SELECT email_hmac FROM users WHERE email = 'coord@example.org'",
);
const coord = coordRows[0];
if (!coord) {
  console.error('No coord@example.org. Run scripts/orgs-selftest.mjs against this database first.');
  await pool.end();
  process.exit(2);
}
const token = 'tok' + Math.random().toString(16).slice(2).padEnd(45, '0');
await pool.query(
  "INSERT INTO self_sessions (token, email_hmac, expires_at) VALUES ($1,$2, now() + interval '1 hour')",
  [token, coord.email_hmac],
).catch(() => {});
const asCoord = (path, opts = {}) => call(path, {
  ...opts,
  headers: { Cookie: `session_token=${token}`, ...(opts.headers || {}) },
});

async function setIntake(value) {
  await pool.query('UPDATE site_settings SET intake_enabled = $1 WHERE id = true', [value]);
  clearIntakeSettingsCache();
  await new Promise((r) => setTimeout(r, 250));
}

/* ---- the default ------------------------------------------------------ */
console.log('\na deployment that has never been asked');

await setIntake(null);
{
  const { rows } = await pool.query('SELECT intake_enabled FROM site_settings WHERE id = true');
  ok('stores NULL as NULL, not as a decision', rows[0].intake_enabled === null,
    JSON.stringify(rows[0]));
  ok('and NULL resolves to open', intakeOpen(rows[0]) === true);
}
{
  const r = await call('/api/reports/intake');
  ok('the form is told it is open', r.status === 200 && r.body?.open === true,
    r.status + ' ' + JSON.stringify(r.body));
}

/* ---- closed ----------------------------------------------------------- */
console.log('\nwith intake closed');

await setIntake(false);
{
  const r = await call('/api/reports/intake');
  ok('the form is told so before it draws a card',
    r.body?.open === false, JSON.stringify(r.body));
}
{
  // Deliberately an EMPTY body. A closed intake is not a badly filled form,
  // and answering "narrative is too short" to somebody the archive was never
  // going to accept is a lie about why they were refused.
  const r = await call('/api/reports', { method: 'POST', body: JSON.stringify({}) });
  ok('the public form door refuses', r.status === 503, r.status + ' ' + JSON.stringify(r.body));
  ok('and says it is the intake, not the submission',
    r.body?.intakeClosed === true && !r.body?.errors, JSON.stringify(r.body));
}
{
  // The second door into the chain. A switch that shut the public form
  // while a coordinator could still file a batch of two hundred would not
  // be an intake switch; it would be a change to who is allowed to file.
  //
  // The batch id is deliberately one that does not exist. The switch is
  // checked BEFORE the batch is looked up, so a closed intake answers 503
  // rather than 404 — which also proves the ordering, and the ordering is
  // the part that would rot silently.
  const r = await asCoord('/api/intake/batches/999999/submit', {
    method: 'POST', body: JSON.stringify({ attested: true }),
  });
  ok('the coordinator batch door refuses too, and before it looks anything up',
    r.status === 503 && r.body?.intakeClosed === true, r.status + ' ' + JSON.stringify(r.body));
}
{
  // And a signed-in coordinator is not locked out of their own work. They
  // keep transcribing; what they cannot do is file it into the chain.
  const r = await asCoord('/api/intake/organizations');
  ok('while a coordinator can still reach their drafts', r.status === 200, String(r.status));
}

/* ---- what closing must NOT do ----------------------------------------- */
// The half of this that is easy to get wrong by being too thorough.
console.log('\nwhat a closed intake leaves alone');

{
  const r = await call('/api/v1/stats');
  ok('the public record still answers', r.status === 200, String(r.status));
}
{
  const r = await call('/api/legal');
  ok('and so does everything else the site serves', r.status === 200, String(r.status));
}
{
  // Not a new report: an amendment to one this archive already holds.
  // Refusing it would leave the archive knowingly holding a version its own
  // author says is wrong.
  const r = await call('/api/reports/consent-text');
  ok('the consent card is still served, so corrections can still be made',
    r.status === 200, String(r.status));
}

/* ---- reopening -------------------------------------------------------- */
console.log('\nreopening');

await setIntake(true);
{
  const r = await call('/api/reports/intake');
  ok('the switch goes back the other way', r.body?.open === true, JSON.stringify(r.body));
}
{
  const r = await call('/api/reports', { method: 'POST', body: JSON.stringify({}) });
  ok('and an empty submission is judged on its own merits again',
    r.status === 400 && Array.isArray(r.body?.errors), r.status + ' ' + JSON.stringify(r.body));
}

// Leave the row as the rest of the suite expects to find it.
await setIntake(null);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
await pool.end();
process.exit(fail ? 1 : 0);
