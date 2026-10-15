/**
 * The update button, against the real route and a real admin session.
 *
 * THE HALF THAT MATTERS, and the half a browser test cannot reach. Hiding
 * the button is the pane's job and is not enough on its own: a page left
 * open across an install that never happened, a second tab, or a plain curl
 * would each write a request into `var/` that nothing ever reads — while the
 * pane says it starts within a minute. So the ROUTE has to refuse, and that
 * refusal has to be checked against the route rather than against the page.
 *
 * WHY THE BUTTON DID NOTHING FOR REAL. The application cannot apply an
 * update: it writes a file naming a commit and a root systemd timer does the
 * fetching, backing up, installing and restarting. Nothing ever asked
 * whether that timer existed. A box reaches that state by being upgraded
 * with `contrib/deploy.sh` across the release that added the timer — which
 * is the release that added the feature. deploy.sh INSTALLS units now, so a
 * deployment cannot drift back into this state; it can only still be in it,
 * and then one command finishes it.
 *
 * THIS CONTAINER IS THAT BOX, conveniently: it has a systemctl that answers
 * `not-found` for the unit, so the not-listening path is the one these
 * assertions exercise for real rather than by stubbing.
 *
 *   npm run test:db
 */
import pg from 'pg';
import fs from 'node:fs/promises';
import path from 'node:path';
import { workerState, canApply, forgetWorkerCache } from '../src/updateWorker.js';
import { REQUEST_FILE } from '../src/updates.js';

const BASE = process.env.BASE || 'http://localhost:3000';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

let pass = 0, fail = 0;
const ok = (n, c, x) => {
  if (c) { pass += 1; console.log('  ok   ' + n); }
  else { fail += 1; console.log('  FAIL ' + n + (x ? ' — ' + x : '')); }
};

/* Sign in the way the app does, minus the emailed code. */
async function sessionFor(email, role) {
  const hmac = 'h_' + email;
  await pool.query(
    `INSERT INTO users (email, email_hmac, role) VALUES ($1, $2, $3)
     ON CONFLICT (email) DO UPDATE SET role = EXCLUDED.role`,
    [email, hmac, role],
  );
  const token = 'tok' + Math.random().toString(16).slice(2).padEnd(45, '0');
  await pool.query(
    "INSERT INTO self_sessions (token, email_hmac, expires_at) VALUES ($1, $2, now() + interval '1 hour')",
    [token, hmac],
  );
  return token;
}

const ADMIN = await sessionFor('upd-admin@example.org', 'admin');
const MOD = await sessionFor('upd-mod@example.org', 'moderator');

async function call(p, { method = 'GET', as = null } = {}) {
  const r = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(as ? { Cookie: `session_token=${as}` } : {}) },
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* html */ }
  return { status: r.status, body: json, text };
}

console.log('\nwhat this box actually answers');

forgetWorkerCache();
const here = await workerState({ force: true });
ok('the worker probe answers one of the three states',
  [true, false, null].includes(here.listening), JSON.stringify(here));
ok('and names the unit it looked for', here.unit === 'reportlog-update.timer');
ok('a state other than a confirmed yes offers no update',
  canApply(here) === (here.listening === true));
if (here.listening === false) {
  /* A MISSING TIMER IS AN UNFINISHED SETUP, so what it offers is the one
     command that finishes it — in its own field, because the pane prints it
     on a line to copy rather than leaving somebody to pick it out of a
     sentence. */
  ok('a missing timer offers the command that installs it',
    /install-units\.sh/.test(String(here.fix || '')), String(here.fix));
  ok('and does not describe itself as something the software cannot do',
    !/cannot/i.test(String(here.reason || '')), String(here.reason));
} else if (here.listening === null) {
  // The one case with nothing to install, so the one that sends somebody to
  // SSH instead.
  ok('a box with no systemd is sent to the SSH route',
    /contrib\/deploy\.sh/.test(String(here.reason || '')), String(here.reason));
  ok('and is not given a command that would not help', here.fix === null, String(here.fix));
}

console.log('\nthe pane is told, on every load');

{
  const r = await call('/api/admin/update', { as: ADMIN });
  ok('an admin can read the update state', r.status === 200, r.text.slice(0, 120));
  ok('and the answer carries the worker',
    r.body && r.body.worker && [true, false, null].includes(r.body.worker.listening),
    JSON.stringify(r.body && r.body.worker));
  /* AND THE COMMAND THAT FINISHES THE SETUP, as its own field. The pane
     prints it on its own line for copying; leaving somebody to pick it out
     of a sentence is how a fix that takes ten seconds goes undone. */
  if (r.body && r.body.worker && r.body.worker.listening === false) {
    ok('and the one command that fixes it',
      /install-units\.sh/.test(String(r.body.worker.fix || '')),
      JSON.stringify(r.body.worker));
  }
  /* THE PANE CANNOT WORK IT OUT FOR ITSELF — nothing else in the payload
     says anything about systemd — so if this key ever stops being sent the
     button comes back on every deployment, silently. */
  ok('which is the only thing in the payload that could tell it',
    Object.hasOwn(r.body || {}, 'worker'));
}

console.log('\nand a moderator is not told any of it');

{
  const r = await call('/api/admin/update', { as: MOD });
  ok('a moderator cannot read the update state', r.status === 401 || r.status === 403,
    String(r.status));
  const anon = await call('/api/admin/update');
  ok('nor can an anonymous caller', anon.status === 401 || anon.status === 403,
    String(anon.status));
}

console.log('\nasking for an update nothing would act on');

if (here.listening === true) {
  // A box that really can update. Nothing to assert about the refusal, and
  // saying so is better than skipping silently.
  ok('SKIPPED: this box has the timer enabled, so the refusal cannot be exercised here',
    true);
} else {
  const repo = path.resolve(new URL('..', import.meta.url).pathname);
  const requestPath = path.join(repo, REQUEST_FILE);
  // Whatever is there now, so this script cannot be the thing that leaves a
  // request behind.
  const before = await fs.readFile(requestPath, 'utf8').catch(() => null);

  const r = await call('/api/admin/update', { method: 'POST', as: ADMIN });
  ok('the route refuses it', r.status === 503, `${r.status} ${r.text.slice(0, 100)}`);
  ok('and says why in words an operator can act on',
    r.body && /never installed|no systemd/.test(String(r.body.error || '')),
    JSON.stringify(r.body));
  ok('and names the reason as a code, so a client need not read English',
    r.body && r.body.reason === 'no-worker', JSON.stringify(r.body));

  /* THE ASSERTION THAT IS THE WHOLE POINT. The old behaviour wrote this
     file and answered "it starts within a minute". If the refusal ever
     moves after the write, this is what notices. */
  const after = await fs.readFile(requestPath, 'utf8').catch(() => null);
  ok('and writes no request for nobody to read', after === before,
    after === before ? '' : 'a request file appeared');
}

console.log('\nthe probe is cached, because the pane polls');

{
  forgetWorkerCache();
  const t0 = Date.now();
  await workerState();
  const first = Date.now() - t0;
  const t1 = Date.now();
  await workerState();
  const second = Date.now() - t1;
  // A subprocess per poll, every five seconds while an update runs, is
  // waste. Not a timing assertion on the first call — a loaded container
  // makes those flaky — only that the second is not another subprocess.
  ok('a second look inside the window costs no subprocess',
    second <= Math.max(2, first), `${first}ms then ${second}ms`);
  ok('and forgetting the cache is possible, for a caller that just changed systemd',
    typeof forgetWorkerCache === 'function');
}

await pool.end();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
