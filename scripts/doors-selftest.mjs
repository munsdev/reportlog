/**
 * What gets past the site password, and what does not — against a real app
 * with the password ON.
 *
 * The rest of the database suite runs with the gate lifted so its scripts
 * can reach their routes, which means none of them can see this. So this one
 * puts the gate back for its own duration, like setup-selftest, and walks:
 *
 *   - a list set to `door`: readable and fileable without the password, and
 *     linked from the password page; a list left `closed` answers LOCKED;
 *   - a logbook set to `link`: its filing form, the report POST and THE
 *     CONFIRMATION LINK all work without the password — a path that only
 *     runs when somebody clicks a link in an email, aimed at deliberately —
 *     while the board, the list of logbooks and a closed logbook stay shut;
 *   - naming a different address for a list's new-entry email: nothing
 *     changes until the link is clicked, and opening it changes nothing.
 *
 * Run through the database suite, which starts the app:  npm run test:db
 */
import 'dotenv/config';
import crypto from 'node:crypto';
import pg from 'pg';

const BASE = process.env.BASE || 'http://localhost:3000';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const { nameRecipient } = await import('../src/lists/notify.js');

let pass = 0, fail = 0;
const ok = (n, c, x) => {
  if (c) { pass += 1; console.log('  ok   ' + n); }
  else { fail += 1; console.log('  FAIL ' + n + (x ? ' — ' + x : '')); }
};
async function call(path, { method = 'GET', body } = {}) {
  const r = await fetch(BASE + path, {
    method, headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* html */ }
  return { status: r.status, body: json, text };
}
const say = (r) => `${r.status} ${r.text.slice(0, 160)}`;
const locked = (r) => r.status === 401 && r.body && r.body.locked === true;

const tag = Date.now().toString(36);
const OPEN_LIST = `door-${tag}`;
const SHUT_LIST = `shut-${tag}`;
const OPEN_LB = `open-${tag}`;
const SHUT_LB = `shut-${tag}`;

try {
  /* A PASSWORD IS SET, NOT JUST THE FLAG, and that is the whole point of
     this line now. This used to enable the gate and leave the hash NULL,
     which locked everything out — so every assertion below passed, for a
     reason that had nothing to do with the doors.
     Since the gate treats "enabled with no password" as no gate at all
     (a locked door with no key is what a fresh install used to be), a
     hash-less gate here would make every one of these tests go green by
     letting EVERYTHING through. Either way round, without a password this
     file would be testing nothing. */
  await pool.query(
    'UPDATE site_settings SET access_enabled = true, access_password_hash = $1',
    [crypto.createHash('sha256').update('doors-selftest-password').digest('hex')],
  );

  /* ---- a gate with no password is not a gate ---------------------------
     THE STATE EVERY NEW INSTALL STARTS IN. `access_enabled` defaults to
     true in migration 001 and no password exists until somebody sets one,
     so a freshly migrated database was gated with a null hash — and no
     password can match a null hash. Nobody could get in, including the
     first-run setup wizard, which sits behind this.
     Nothing caught it because tools/container-setup.sh turns the gate off
     for the suites, so every test ran on a deployment that had already
     stepped around the problem. It was found on a test box the first time a
     database was wiped and migrated without the wizard running. */
  {
    const { hasSiteAccess, getSiteSettings } = await import('../src/siteAccess.js');
    await pool.query('UPDATE site_settings SET access_enabled = true, access_password_hash = NULL');
    ok('a gate turned on with NO PASSWORD lets people in rather than locking everyone out',
      (await hasSiteAccess({ cookies: {} })) === true);

    const live = await getSiteSettings();
    ok('and the settings row is not mistaken for a missing one',
      live.missing !== true && live.access_enabled === true);

    /* THE DANGEROUS CASE IS UNCHANGED, and this asks the rule directly
       rather than contriving a deployment with no settings row. The
       fallback exists because a missing row once read as "gate off" and
       ungated a whole deployment with nothing on screen saying so. */
    const { gateApplies } = await import('../src/siteAccess.js');
    ok('NO SETTINGS ROW AT ALL still refuses everyone',
      gateApplies({ access_enabled: true, access_password_hash: null, missing: true }) === true);
    ok('a gate turned off is off whether or not a password exists',
      gateApplies({ access_enabled: false, access_password_hash: null }) === false
      && gateApplies({ access_enabled: false, access_password_hash: 'abc' }) === false);
    ok('and on with a password is the only state that actually gates',
      gateApplies({ access_enabled: true, access_password_hash: 'abc' }) === true
      && gateApplies({ access_enabled: true, access_password_hash: null }) === false);

    await pool.query(
      'UPDATE site_settings SET access_enabled = true, access_password_hash = $1',
      [crypto.createHash('sha256').update('doors-selftest-password').digest('hex')],
    );
    ok('and with a password set, it is a gate again',
      (await hasSiteAccess({ cookies: {} })) === false);
  }

  /* ---- lists ----------------------------------------------------------- */
  console.log('\na list opened without the password, and one that is not');
  const { rows: [ol] } = await pool.query(
    `INSERT INTO lists (slug, title, visibility, outside_access) VALUES ($1, 'Open list', 'listed', 'door') RETURNING id`, [OPEN_LIST]);
  await pool.query(
    `INSERT INTO list_fields (list_id, key, kind, label, required, options, retention)
     VALUES ($1, 'pick', 'choice_one', 'Pick', true, '{"options":["A","B"],"allowOther":false}', 'durable')`, [ol.id]);
  const { rows: [sl] } = await pool.query(
    `INSERT INTO lists (slug, title, visibility) VALUES ($1, 'Shut list', 'listed') RETURNING id`, [SHUT_LIST]);
  await pool.query(
    `INSERT INTO list_fields (list_id, key, kind, label, required, options, retention)
     VALUES ($1, 'pick', 'choice_one', 'Pick', true, '{"options":["A"],"allowOther":false}', 'durable')`, [sl.id]);

  let r = await call(`/api/lists/${OPEN_LIST}`);
  ok('an open list\'s form is readable without the password', r.status === 200 && r.body.slug === OPEN_LIST, say(r));
  r = await call(`/api/lists/${OPEN_LIST}/entries`, { method: 'POST', body: { elapsed_ms: 9000, answers: { pick: 'A' } } });
  ok('and somebody without the password can send to it', r.status === 201, say(r));
  r = await call(`/api/lists/${SHUT_LIST}`);
  ok('a list left behind the password answers exactly what the gate would', locked(r), say(r));
  r = await call(`/api/lists/${SHUT_LIST}/entries`, { method: 'POST', body: { elapsed_ms: 9000, answers: { pick: 'A' } } });
  ok('and takes nothing from outside', locked(r), say(r));
  r = await call('/api/lists/no-such-list-at-all');
  ok('an address with no list behind it looks the same as a shut one', locked(r), say(r));
  r = await call('/api/lists');
  ok('the front page\'s list of lists is behind the password', locked(r), say(r));
  r = await call('/api/list-review');
  ok('the review queue is behind the password', locked(r), say(r));

  r = await call('/api/doors');
  ok('the password page offers the open list', r.status === 200 && r.body.some((d) => d.href === `/list/${OPEN_LIST}`), say(r));
  ok('and not the shut one', !r.body.some((d) => d.href === `/list/${SHUT_LIST}`));

  let threw = false;
  try {
    await pool.query("UPDATE lists SET visibility = 'hidden' WHERE id = $1", [ol.id]);
  } catch (e) { threw = e.code === '23514'; }
  ok('the database refuses a hidden list that is open outside', threw);

  /* ---- logbooks -------------------------------------------------------- */
  console.log('\na logbook open for filing without the password');
  r = await call('/api/reports/consent-text');
  ok('with no logbook open outside, even the consent text is behind the password', locked(r), say(r));

  await pool.query(
    `INSERT INTO logbooks (slug, title, launched_at, outside_access) VALUES ($1, 'Open logbook', now(), 'link')`, [OPEN_LB]);
  await pool.query(
    `INSERT INTO logbooks (slug, title, launched_at) VALUES ($1, 'Shut logbook', now())`, [SHUT_LB]);

  r = await call(`/api/logbooks/${OPEN_LB}`);
  ok('its form is readable without the password', r.status === 200 && r.body.slug === OPEN_LB, say(r));
  r = await call(`/api/logbooks/${SHUT_LB}`);
  ok('another logbook\'s is not', locked(r), say(r));
  r = await call('/api/logbooks');
  ok('nor is the list of logbooks, which would name the others', locked(r), say(r));
  r = await call('/api/reports');
  ok('nor the board', locked(r), say(r));
  r = await call('/api/moderators/reports?status=all');
  ok('nor anything staff use', locked(r), say(r));
  r = await call('/api/uploads/draft', { method: 'POST', body: {} });
  ok('uploads stay shut while no open logbook takes files', locked(r), say(r));

  r = await call('/api/doors');
  ok('a `link` logbook is NOT on the password page', r.status === 200 && !r.body.some((d) => d.href === `/file/${OPEN_LB}`), say(r));
  await pool.query("UPDATE logbooks SET outside_access = 'door' WHERE slug = $1", [OPEN_LB]);
  r = await call('/api/doors');
  ok('a `door` one is', r.status === 200 && r.body.some((d) => d.href === `/file/${OPEN_LB}`), say(r));

  const consent = await call('/api/reports/consent-text');
  ok('the consent text the form needs is readable now', consent.status === 200 && consent.body.digest, say(consent));
  const email = `door-${tag}@example.org`;
  r = await call('/api/reports', { method: 'POST', body: {
    logbook: OPEN_LB, email, consent: true, may_publish: true, may_publish_digest: consent.body?.digest,
  } });
  ok('a report to it is accepted without the password', r.status >= 200 && r.status < 300, say(r));
  r = await call('/api/reports', { method: 'POST', body: {
    logbook: SHUT_LB, email, consent: true, may_publish: true, may_publish_digest: consent.body?.digest,
  } });
  ok('a report to the shut one meets the password', locked(r), say(r));

  const { rows: [tok] } = await pool.query(
    'SELECT token FROM report_submission_tokens WHERE email = $1 ORDER BY created_at DESC LIMIT 1', [email]);
  ok('a confirmation was staged for it', Boolean(tok), 'no token row');
  if (tok) {
    r = await call(`/api/reports/confirm/${tok.token}`);
    ok('AND THE CONFIRMATION LINK WORKS WITHOUT THE PASSWORD', r.status === 200 && !locked(r), say(r));
  }

  /* ---- who a list emails ----------------------------------------------- */
  console.log('\nnaming somebody else to receive a list\'s entries');
  const named = await nameRecipient(ol.id, `team-${tag}@example.org`, { env: { ADMIN_EMAIL: 'admin@example.org' } });
  let row = (await pool.query('SELECT notify_email, notify_pending_email FROM lists WHERE id = $1', [ol.id])).rows[0];
  ok('the new address is held as pending and receives nothing yet',
    named.pending && row.notify_email === null && row.notify_pending_email === `team-${tag}@example.org`, JSON.stringify(row));
  r = await call(`/api/list-mail/${named.token}`);
  ok('opening the link shows a button and changes nothing — a mail scanner opens links',
    r.status === 200 && /method="post"/.test(r.text)
    && (await pool.query('SELECT notify_email FROM lists WHERE id = $1', [ol.id])).rows[0].notify_email === null, say(r));
  r = await call(`/api/list-mail/${named.token}`, { method: 'POST' });
  row = (await pool.query('SELECT notify_email, notify_pending_email FROM lists WHERE id = $1', [ol.id])).rows[0];
  ok('pressing it confirms the address, and works without the site password',
    r.status === 200 && row.notify_email === `team-${tag}@example.org` && row.notify_pending_email === null, `${say(r)} ${JSON.stringify(row)}`);
  r = await call(`/api/list-mail/${named.token}`, { method: 'POST' });
  ok('the link works once', r.status === 404, say(r));

  const second = await nameRecipient(ol.id, `typo-${tag}@example.org`, { env: { ADMIN_EMAIL: 'admin@example.org' } });
  const third = await nameRecipient(ol.id, `right-${tag}@example.org`, { env: { ADMIN_EMAIL: 'admin@example.org' } });
  r = await call(`/api/list-mail/${second.token}`, { method: 'POST' });
  ok('naming another address makes the earlier link worthless', r.status === 404, say(r));
  row = (await pool.query('SELECT notify_email FROM lists WHERE id = $1', [ol.id])).rows[0];
  ok('and mail keeps going to the confirmed address meanwhile', row.notify_email === `team-${tag}@example.org`);
  ok('the newest link is still good', Boolean(third.token));
  await nameRecipient(ol.id, 'admin@example.org', { env: { ADMIN_EMAIL: 'admin@example.org' } });
  row = (await pool.query('SELECT notify_email, notify_pending_email FROM lists WHERE id = $1', [ol.id])).rows[0];
  ok('naming the admin address applies at once, with no link', row.notify_email === null && row.notify_pending_email === null);
} finally {
  await pool.query('UPDATE site_settings SET access_enabled = false');
}

await pool.end();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
