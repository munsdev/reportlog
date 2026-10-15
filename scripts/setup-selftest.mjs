/**
 * First-run setup, against a real database and a real app.
 *
 * The pure half — what counts as a curtain password — is in the main suite.
 * What needs a database and a running server is the half that matters: that
 * a fresh install really is locked out of itself, that the installer script
 * is the way in, and that the wizard can be walked from one end to the
 * other exactly once.
 *
 * Run it through the database suite, which provides both:
 *
 *   npm run test:db
 *
 * It expects a database where setup has NOT been completed, and it completes
 * it. Never point it at a deployment.
 */
import pg from 'pg';
import { sha256Hex } from '../src/crypto.js';

const BASE = process.env.BASE || 'http://localhost:3000';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

let pass = 0, fail = 0;
const ok = (n, c, x) => {
  if (c) { pass += 1; console.log('  ok   ' + n); }
  else { fail += 1; console.log('  FAIL ' + n + (x ? ' — ' + x : '')); }
};

// The suite runs with the gate lifted so the other scripts can reach their
// routes. Setup is a story about a gated deployment, so it puts the gate
// back for its own duration and takes it down again at the end.
const INSTALL_PW = 'INSTALLPW1';
await pool.query(
  'UPDATE site_settings SET access_enabled = true, access_password_hash = $1, setup_completed_at = NULL',
  [sha256Hex(INSTALL_PW)],
);
// Anybody who would make this deployment look already set up. The wizard
// mints an OWNER now, so clearing only admins left the seat occupied and
// every check below failed with a 409 that named the wrong cause.
await pool.query("DELETE FROM users WHERE role IN ('admin', 'owner')").catch(() => {});

const call = (path, opts = {}) => fetch(BASE + path, {
  ...opts,
  headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
}).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null), raw: r }));

/* ---- the deadlock ---------------------------------------------------- */
console.log('\nwhat a stranger installing this walks into');

let out = await call('/api/setup/status');
ok('setup is unreachable from in front of the curtain',
  out.status === 401 && out.body?.locked === true, out.status + ' ' + JSON.stringify(out.body));

out = await call('/api/site-access/unlock', { method: 'POST', body: JSON.stringify({ password: 'guess' }) });
ok('and a wrong password does not lift it', out.status === 401, String(out.status));

/* ---- the way in ------------------------------------------------------ */
console.log('\nthe curtain password the installer set');

out = await call('/api/site-access/unlock', { method: 'POST', body: JSON.stringify({ password: INSTALL_PW }) });
ok('lifts the curtain', out.status === 200, out.status + ' ' + JSON.stringify(out.body));
const curtainCookie = (out.raw.headers.get('set-cookie') || '').split(';')[0];
ok('and issues a token', curtainCookie.startsWith('site_access='), curtainCookie);

const behind = (path, opts = {}) => call(path, {
  ...opts,
  headers: { Cookie: curtainCookie, ...(opts.headers || {}) },
});

out = await behind('/api/setup/status');
ok('setup is needed, and has no owner yet',
  out.body?.needed === true && out.body?.hasAdmin === false, JSON.stringify(out.body));

/* ---- the wizard ------------------------------------------------------ */
console.log('\nwalking the wizard');

out = await behind('/api/setup/request-code', { method: 'POST', body: JSON.stringify({ email: 'not-an-email' }) });
ok('an address that is not one is refused', out.status === 400, String(out.status));

const EMAIL = 'owner-selftest@example.org';
out = await behind('/api/setup/request-code', { method: 'POST', body: JSON.stringify({ email: EMAIL }) });
ok('a code is issued for a real address', out.status === 200, out.status + ' ' + JSON.stringify(out.body));

// Read the code the way the app stored it rather than scraping a log.
const { rows: codeRows } = await pool.query(
  'SELECT code_hash FROM otp_codes ORDER BY id DESC LIMIT 1',
).catch(() => ({ rows: [] }));

// The code is six digits; recovering it from its hash is a 10^6 search and
// is how this asserts the real flow rather than a mocked one.
let code = null;
if (codeRows[0]) {
  for (let i = 0; i < 1000000 && code === null; i += 1) {
    const candidate = String(i).padStart(6, '0');
    if (sha256Hex(candidate) === codeRows[0].code_hash) code = candidate;
  }
}
ok('and the code that was stored is the one that was sent', code !== null,
  codeRows[0] ? 'no six-digit code hashes to the stored value' : 'no code row was written');

out = await behind('/api/setup/verify-code', { method: 'POST', body: JSON.stringify({ email: EMAIL, code: '000000' }) });
ok('a wrong code mints nobody', out.status === 401, String(out.status));

out = await behind('/api/setup/verify-code', { method: 'POST', body: JSON.stringify({ email: EMAIL, code }) });
ok('the right code makes that address the administrator',
  out.status === 200 && out.body?.role === 'admin', out.status + ' ' + JSON.stringify(out.body));
const sessionCookie = (out.raw.headers.get('set-cookie') || '').split(';')[0];

const asOwner = (path, opts = {}) => call(path, {
  ...opts,
  headers: { Cookie: `${curtainCookie}; ${sessionCookie}`, ...(opts.headers || {}) },
});

// This is the check the first version of this feature failed. Minting the
// admin used to make the wizard decide it was no longer needed, and the
// last screen — the one the whole feature exists for — refused itself.
out = await behind('/api/setup/status');
ok('setup is STILL needed after the owner exists',
  out.body?.needed === true && out.body?.hasAdmin === true, JSON.stringify(out.body));

out = await behind('/api/setup/request-code', { method: 'POST', body: JSON.stringify({ email: 'someone-else@example.org' }) });
ok('and a second person cannot mint themselves an account', out.status === 409, String(out.status));

/* ---- the questions the wizard asks in between ------------------------ */
// Screens three to five write through the ordinary admin routes rather
// than through setup-only ones, so the operator mid-wizard is exercising
// the same code the settings panels use. What is worth checking against a
// real database is that the session minted two steps ago is actually
// allowed through them, and that the answers land in the row.
console.log('\nthe three questions between the code and the password');

out = await asOwner('/api/admin/identity', {
  method: 'POST', body: JSON.stringify({ siteName: 'Munich Incident Archive' }),
});
ok('the owner minted by the wizard may set the site name',
  out.status === 200, out.status + ' ' + JSON.stringify(out.body));

out = await asOwner('/api/admin/publication', {
  method: 'POST', body: JSON.stringify({ publicArchive: false }),
});
ok('and answer whether this deployment publishes', out.status === 200, String(out.status));

out = await asOwner('/api/admin/attachments', {
  method: 'POST', body: JSON.stringify({ enabled: false }),
});
ok('and whether it accepts attachments', out.status === 200, String(out.status));

{
  const { rows } = await pool.query(
    'SELECT site_name, public_archive_enabled, attachments_enabled FROM site_settings WHERE id = true',
  );
  const row = rows[0] || {};
  ok('the name is in the row', row.site_name === 'Munich Incident Archive', JSON.stringify(row));
  // NULL and false are different answers here: NULL is "nobody was asked",
  // which is the state the wizard exists to end.
  ok('and publishing is false rather than merely unset',
    row.public_archive_enabled === false, JSON.stringify(row));
  ok('and attachments are false rather than merely unset',
    row.attachments_enabled === false, JSON.stringify(row));
}

// Still behind the curtain and still not finished. These screens are part
// of setup, not the end of it.
out = await behind('/api/setup/status');
ok('answering them does not finish setup', out.body?.needed === true, JSON.stringify(out.body));

// Somebody behind the curtain who is not the owner cannot answer them.
out = await behind('/api/admin/identity', {
  method: 'POST', body: JSON.stringify({ siteName: 'Not Theirs' }),
});
ok('and nobody but the owner can answer them', out.status === 401 || out.status === 403,
  out.status + ' ' + JSON.stringify(out.body));

/* ---- the decision ---------------------------------------------------- */
console.log('\nthe curtain password decision, which cannot be skipped');

out = await asOwner('/api/setup/curtain', { method: 'POST', body: JSON.stringify({}) });
ok('no decision is refused', out.status === 400, out.status + ' ' + JSON.stringify(out.body));

out = await asOwner('/api/setup/curtain', { method: 'POST', body: JSON.stringify({ decision: 'maybe' }) });
ok('and so is a decision that is neither', out.status === 400, String(out.status));

out = await asOwner('/api/setup/curtain', { method: 'POST', body: JSON.stringify({ decision: 'change', password: 'abc' }) });
ok('changing to something too short is refused', out.status === 400, String(out.status));

// The confirmation is a server rule, not a convenience the page offers. A
// mistype on this screen locks the operator out of the deployment they were
// just handed, with the installer's password already dead.
out = await asOwner('/api/setup/curtain', {
  method: 'POST',
  body: JSON.stringify({ decision: 'change', password: 'OPERATORPW2', passwordConfirm: 'OPERATORPW3' }),
});
ok('a password that does not match its confirmation is refused',
  out.status === 400, out.status + ' ' + JSON.stringify(out.body));

out = await asOwner('/api/setup/curtain', {
  method: 'POST',
  body: JSON.stringify({ decision: 'change', password: 'OPERATORPW2' }),
});
ok('and so is one with no confirmation at all', out.status === 400, String(out.status));

// The refusals above must not have ended setup or changed the password —
// otherwise the rest of this file is testing a deployment that was already
// handed over by a request that was supposed to fail.
out = await behind('/api/setup/status');
ok('none of those refusals ended setup', out.body?.needed === true, JSON.stringify(out.body));

out = await call('/api/site-access/unlock', { method: 'POST', body: JSON.stringify({ password: INSTALL_PW }) });
ok("and none of them changed the password", out.status === 200, String(out.status));

out = await behind('/api/setup/status');
ok('the minimum password length travels with the status',
  out.body?.minPassword === 8, JSON.stringify(out.body));

out = await behind('/api/setup/curtain', { method: 'POST', body: JSON.stringify({ decision: 'keep' }) });
ok('and somebody behind the curtain who is not the owner cannot finish setup',
  out.status === 401, out.status + ' ' + JSON.stringify(out.body));

const NEW_PW = 'OPERATORPW2';
out = await asOwner('/api/setup/curtain', {
  method: 'POST',
  body: JSON.stringify({ decision: 'change', password: NEW_PW, passwordConfirm: NEW_PW }),
});
ok('the owner changes the password and setup ends', out.status === 200 && out.body?.changed === true,
  out.status + ' ' + JSON.stringify(out.body));

/* ---- after ----------------------------------------------------------- */
console.log('\nafter the handover');

out = await call('/api/site-access/unlock', { method: 'POST', body: JSON.stringify({ password: INSTALL_PW }) });
ok("the installer's password no longer works", out.status === 401, String(out.status));

out = await call('/api/site-access/unlock', { method: 'POST', body: JSON.stringify({ password: NEW_PW }) });
ok("the operator's does", out.status === 200, String(out.status));

out = await behind('/api/setup/status');
ok('setup is no longer needed', out.body?.needed === false, JSON.stringify(out.body));

out = await behind('/api/setup/request-code', { method: 'POST', body: JSON.stringify({ email: 'attacker@example.org' }) });
ok('and the wizard cannot be replayed', out.status === 409, String(out.status));

/* ---- the other door onto the same secret ----------------------------- */
// The admin Site access panel sets the same password the wizard just set,
// and it used to accept anything non-empty while the wizard refused seven
// characters. Two doors onto one secret disagreeing about what a password
// is means the weaker one is the real rule. Checked here because this is
// the file that already has an administrator's session behind a curtain.
console.log('\nthe admin panel sets the same password, under the same rule');

out = await call('/api/site-access/unlock', { method: 'POST', body: JSON.stringify({ password: NEW_PW }) });
const curtain2 = (out.raw.headers.get('set-cookie') || '').split(';')[0];
const asOwnerNow = (path, opts = {}) => call(path, {
  ...opts,
  headers: { Cookie: `${curtain2}; ${sessionCookie}`, ...(opts.headers || {}) },
});

out = await asOwnerNow('/api/admin/site-access');
ok('the panel states the same minimum the wizard does',
  out.status === 200 && out.body?.minPassword === 8, out.status + ' ' + JSON.stringify(out.body));

out = await asOwnerNow('/api/admin/site-access', {
  method: 'POST',
  body: JSON.stringify({ password: 'short', passwordConfirm: 'short' }),
});
ok('and refuses a password under it, which it once accepted',
  out.status === 400, out.status + ' ' + JSON.stringify(out.body));

out = await asOwnerNow('/api/admin/site-access', {
  method: 'POST',
  body: JSON.stringify({ password: 'LONGENOUGH1', passwordConfirm: 'LONGENOUGH2' }),
});
ok('and refuses one that does not match its confirmation', out.status === 400, String(out.status));

out = await asOwnerNow('/api/admin/site-access', {
  method: 'POST',
  body: JSON.stringify({ password: 'LONGENOUGH1' }),
});
ok('and refuses one with no confirmation at all', out.status === 400, String(out.status));

// None of those three may have changed anything.
out = await call('/api/site-access/unlock', { method: 'POST', body: JSON.stringify({ password: NEW_PW }) });
ok('none of those refusals changed the password', out.status === 200, String(out.status));

// An empty password is "leave it as it is", which is what the field says.
out = await asOwnerNow('/api/admin/site-access', {
  method: 'POST',
  body: JSON.stringify({ enabled: true, password: '' }),
});
ok('a blank password is not an attempt to set one', out.status === 200, out.status + ' ' + JSON.stringify(out.body));

out = await call('/api/site-access/unlock', { method: 'POST', body: JSON.stringify({ password: NEW_PW }) });
ok('and leaves the password alone', out.status === 200, String(out.status));

// Put the instance back the way the rest of the suite expects to find it.
await pool.query('UPDATE site_settings SET access_enabled = false');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
await pool.end();
process.exit(fail ? 1 : 0);
