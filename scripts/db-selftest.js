// The database half of the suite.
//
//   npm run test:db
//
// `npm test` is pure: no database, no network, no server, so it runs on a
// box with nothing provisioned. That is worth keeping, and it is why these
// four checks sat unrun for weeks — there was nowhere for them to go.
// This is that place.
//
// It does NOT use the database in DATABASE_URL. It creates a throwaway one
// beside it, migrates it, runs everything against that, and drops it at the
// end. That is deliberate: three of these scripts write reports, and each
// carries a comment warning a human not to point it at real data. A warning
// in a comment is prose standing in for a check. This removes the aim.
// dotenv, so the documented invocation actually works. Every other entry
// point either imports src/db.js (which loads it) or is started with
// --env-file; this one talks to pg directly and did neither, so
// `npm run test:db` — the exact line in CLAUDE.md and in the standing
// orders — exited with "Set DATABASE_URL" on a correctly configured box.
// The failure reads like a database problem and is not.
import 'dotenv/config';
import { spawn } from 'node:child_process';
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Set DATABASE_URL. It names the cluster to create a scratch database on;');
  console.error('the database it points at is never touched.');
  process.exit(2);
}

// Same cluster, same connection options, different database.
//
// Done by hand rather than with `new URL`, which rejects the socket form
// `postgres://user@/db?host=/tmp/pgrun` outright — a URL with userinfo and
// an empty host is invalid, and that is exactly the string the container
// writes into .env.
function withDatabase(conn, name) {
  const q = conn.indexOf('?');
  const base = q === -1 ? conn : conn.slice(0, q);
  const query = q === -1 ? '' : conn.slice(q);
  return base.replace(/\/[^/]*$/, '/' + name) + query;
}

const scratchName = `reportlog_selftest_${process.pid}`;
const admin = withDatabase(url, 'postgres');
const scratch = withDatabase(url, scratchName);

// The child scripts need these; two of them default them and two do not.
const childEnv = {
  ...process.env,
  DATABASE_URL: scratch,
  TIER_B_ENCRYPTION_KEY: process.env.TIER_B_ENCRYPTION_KEY
    || 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
  CONTACT_HMAC_KEY: process.env.CONTACT_HMAC_KEY
    || '0123456789abcdef0123456789abcdef',
};

function run(cmd, args, env, opts = {}) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { env, stdio: opts.quiet ? 'ignore' : 'inherit' });
    p.on('exit', (code) => resolve(code ?? 1));
    p.on('error', () => resolve(1));
  });
}

const adminPool = new pg.Pool({ connectionString: admin });
let created = false;

async function dropScratch() {
  if (!created) return;
  try { await adminPool.query(`DROP DATABASE IF EXISTS "${scratchName}" WITH (FORCE)`); } catch { /* best effort */ }
}

// The suite writes reports into append-only tables guarded against DELETE,
// UPDATE and TRUNCATE. Dropping the whole database is the only clean way to
// reset it, which is the same conclusion the reset runbook reached.
process.on('SIGINT', async () => { await dropScratch(); process.exit(130); });

let failed = 0;
try {
  await adminPool.query(`CREATE DATABASE "${scratchName}"`);
  created = true;
  console.log(`scratch database: ${scratchName}\n`);
} catch (e) {
  console.error(`Could not create a scratch database: ${e.message}`);
  // NAME THE RIGHT CAUSE. This said "the role needs CREATEDB" whatever went
  // wrong, so a server that was simply not running — the commonest failure
  // by far on a development container, where Postgres does not survive the
  // container being suspended — read as a permissions problem, and the next
  // twenty minutes went on grants.
  if (['ECONNREFUSED', 'ENOENT'].includes(e.code) || /ECONNREFUSED|ENOENT|could not connect/i.test(e.message)) {
    console.error('Nothing is listening there. Postgres is not running, or DATABASE_URL');
    console.error('points somewhere else. This is not a permissions problem.');
  } else if (e.code === '42501' || /permission denied/i.test(e.message)) {
    console.error('The role in DATABASE_URL needs CREATEDB. This suite is for development.');
  } else {
    console.error('This suite creates a throwaway database beside the one in DATABASE_URL.');
  }
  await adminPool.end();
  process.exit(2);
}

if (await run(process.execPath, ['scripts/migrate.js'], childEnv, { quiet: true })) {
  console.error('migrations failed against the scratch database');
  failed = 1;
}

// Order matters once: orgs-selftest seeds the coordinator account and the
// organization that intake-selftest then files through. Run alone, intake
// fails on an empty table and the failure names the wrong thing.
const scripts = [
  'scripts/orgs-selftest.mjs',
  'scripts/ownership-selftest.mjs',
  'scripts/logbook-selftest.mjs',
  // Questions asked only sometimes: stored, sealed into the form, carried
  // through a logbook file, and honoured by a report that verifies.
  'scripts/conditions-selftest.mjs',
  // One chain per logbook: links, starts, the anchor's list, chain files.
  'scripts/chain-selftest.mjs',
  // A correction keeps its files. chain-selftest has always exercised
  // corrections on reports with NO files, which is how a correction
  // silently orphaning every photograph stayed green for weeks.
  'scripts/correction-selftest.mjs',
  'scripts/alliance-selftest.mjs',
  'scripts/attachment-settings-selftest.mjs',
  // The keyword list's three states. NULL, a list, and an EMPTY list are
  // three different answers, and only Postgres can tell the last two apart.
  'scripts/review-keywords-selftest.mjs',
  'scripts/permissions-selftest.mjs',
  // The archive's own statement about a report: append-only versions, the
  // house byline in SQL, and a note that survives its report's withdrawal.
  'scripts/editorial-notes-selftest.mjs',
  // Per-logbook upload caps, and that the client cannot choose which cap
  // applies to it.
  'scripts/evidence-caps-selftest.mjs',
  // Every upload limit as something an operator sets: the three layers, and
  // that LIMIT_RANGES and migration 038's CHECKs still state the same bounds.
  'scripts/upload-limits-selftest.mjs',
  // The review flag: raised in the report's own transaction, re-raised by a
  // correction, cleared without being deleted, and reading a reporter's
  // prose rather than the operator's own choice labels.
  'scripts/review-flag-selftest.mjs',
  // Intake hardening: the staging quota keyed on an address rather than on
  // a free draft token, and `released_at` — the column the media worker
  // filters on, which is what let the form's Ready gate go. All three
  // claims are about rows belonging to a DIFFERENT draft, which is the part
  // no unit test can see.
  'scripts/intake-hardening-selftest.mjs',
  // Asking a reporter for the evidence they declared: the three gates, and
  // that taking the permission back closes a link already sent.
  'scripts/evidence-request-selftest.mjs',
  // Last in this group, so it replays an archive that already holds reports
  // with files and corrections among them. Exporting and replaying the whole
  // archive is the claim that it survives this operator; nothing exercised
  // the pair until migration 033 made it possible to break it silently.
  'scripts/archive-roundtrip-selftest.mjs',
  // Lists, which share nothing with any of the above and sit after the
  // roundtrip so they cannot be mistaken for part of the archive it
  // replays. Their claims are the ones no unit test can see: that the sweep
  // ERASES COLUMNS AND LEAVES THE ROW, that a count reads only the durable
  // half, that destroying a day's hashing secret makes its hashes
  // unrecomputable, that an erasure link mailed to somebody works, and that
  // none of it moves the archive.
  'scripts/lists-selftest.mjs',
  // What this database has run against what the checkout carries. Needs a
  // database because the whole value is the two DRIFT cases, and drift only
  // exists once schema_migrations disagrees with the files on disk.
  'scripts/schema-state-selftest.mjs',
  // contrib/update-apply.sh run the way a real box runs it: as root,
  // against a checkout somebody else owns. Not a database test — it is here
  // because this is the suite that runs where root is available, and the
  // first real install found what no test running as its own checkout's
  // owner could: git refuses to read a repository another user owns.
  'scripts/update-apply-selftest.mjs',
  // Heat maps: a location answer becoming a count, and the threshold
  // actually withholding what it promises to. Needs a database because the
  // whole value is a tally over real report heads through the three
  // publication gates — the suppression rules cannot be reasoned about,
  // and the assertions read the PAYLOAD rather than a drawing, because a
  // test that asked the browser whether it drew an area would pass against
  // the exact bug the mechanism exists to prevent.
  'scripts/heat-map-selftest.mjs',

  /* WHERE THE PROOF GOES. Needs a database because the destination lives
     in one, and needs a real filesystem because the deploy key's private
     half is a file with a mode — the two claims that matter most here are
     "that file is 0600" and "nothing resembling a private key is in the
     row", and neither can be made against a stub. */
  'scripts/translog-selftest.mjs',
  // The front page's buttons. Needs a database because the rule that
  // matters is about a logbook created AFTER an arrangement was saved: if
  // it is not appended, arranging the page once quietly opts an operator
  // out of every logbook they make afterwards, and nothing says so.
  'scripts/home-buttons-selftest.mjs',
];

// Migration 005 seeds the gate ON, so a fresh database comes up behind the
// curtain and every route answers 401 before it reaches its own auth. Left
// on, it made intake-selftest's "refuses an anonymous caller" check pass
// against the site gate rather than against intake, which is a green check
// for something it never exercised.
if (!failed) {
  const scratchPool = new pg.Pool({ connectionString: scratch });
  try {
    await scratchPool.query('UPDATE site_settings SET access_enabled = false');
  } catch (e) {
    console.error(`could not lift the gate on the scratch database: ${e.message}`);
    failed = 1;
  }
  await scratchPool.end();
}

if (!failed) {
  for (const s of scripts) {
    console.log(`\n───── ${s}`);
    if (await run(process.execPath, [s], childEnv)) failed += 1;
  }
}

// intake-selftest and setup-selftest drive real HTTP routes, so they need
// the app. Start one
// against the scratch database on a port nothing else is using, rather than
// borrowing whatever happens to answer on 3000 — that server is pointed at
// the development database and would file this suite's reports into it.
if (!failed) {
  const port = 3100 + (process.pid % 500);
  const server = spawn(process.execPath, ['server.js'], {
    env: {
      ...childEnv,
      PORT: String(port),
      SITE_ORIGIN: `http://localhost:${port}`,
      // So publication-selftest can see a switch take effect immediately
      // instead of waiting out a 30-second cache after every write.
      PUBLICATION_SETTINGS_TTL_MS: '0',
      SITE_IDENTITY_TTL_MS: '0',
      LEGAL_TEXT_TTL_MS: '0',
      INTAKE_SETTINGS_TTL_MS: '0',
      VOLUNTEER_CATALOGUE_TTL_MS: '0',
      SITE_COPY_TTL_MS: '0',
      /* STORAGE THAT IS CONFIGURED AND UNREACHABLE, so the attachment paths
         are REACHABLE AT ALL in this app.

         Without it `attachmentsEnabled()` is false, which does not disable
         one check — it removes whole branches from the suite's reach. The
         submit route drops the draft token, so confirm-selftest could never
         reach the confirmation that waits for a file still being prepared,
         and that branch decides whether a reporter's photograph makes it
         into a sealed report. Nothing else gets near it.

         The hostname cannot resolve on purpose: a URL is built and signed
         locally, and anything that actually tried to fetch it fails loudly
         rather than reaching somebody's bucket. No test here uploads a byte.

         Overridable, so a run with real credentials in the environment keeps
         them — it still uploads nothing. */
      S3_ENDPOINT: process.env.S3_ENDPOINT || 'https://storage.invalid',
      S3_ACCESS_KEY: process.env.S3_ACCESS_KEY || 'selftest',
      S3_SECRET_KEY: process.env.S3_SECRET_KEY || 'selftest',
      S3_BUCKET_EVIDENCE: process.env.S3_BUCKET_EVIDENCE || 'evidence',
      S3_BUCKET_RENDITIONS: process.env.S3_BUCKET_RENDITIONS || 'renditions',
      S3_BUCKET_STAGING: process.env.S3_BUCKET_STAGING || 'staging',
      ATTACHMENTS_ENABLED: process.env.ATTACHMENTS_ENABLED || 'true',
    },
    stdio: 'ignore',
  });
  let up = false;
  for (let i = 0; i < 40 && !up; i += 1) {
    await new Promise((r) => setTimeout(r, 250));
    up = await fetch(`http://localhost:${port}/api/health`).then((r) => r.ok).catch(() => false);
  }
  if (!up) {
    console.error(`\nthe app did not come up on ${port}`);
    failed += 1;
  } else {
    for (const s of ['scripts/intake-selftest.mjs', 'scripts/publication-selftest.mjs',
      'scripts/invitations-selftest.mjs', 'scripts/identity-selftest.mjs',
      // Before setup-selftest, which puts the gate back up for its own
      // duration and mints an administrator. This one wants the ordinary
      // state the rest of the suite runs in.
      'scripts/legal-selftest.mjs',
      'scripts/intake-switch-selftest.mjs',
      'scripts/template-selftest.mjs',
      // Walks a confirmation link, which nothing else does.
      'scripts/confirm-selftest.mjs',
      // Lists over HTTP, and the erasure link a list's email carries —
      // aimed at for the same reason as the confirmation link above.
      'scripts/lists-routes-selftest.mjs',
      // The site password ON: what an open list or logbook lets through, what
      // stays shut, and the confirmation links that must work outside it.
      'scripts/doors-selftest.mjs',
      // The update button, against the real route and a real admin session:
      // that the ROUTE refuses when nothing would act on the request. In
      // THIS list and not the one above, because it needs the running app —
      // registered in the wrong one first, where `sessionFor` wrote its
      // admin into the throwaway database while the app it then called was
      // reading another, so every call answered 401 and the suite's total
      // fell by 336 with six failures.
      'scripts/update-worker-selftest.mjs',
      'scripts/setup-selftest.mjs']) {
      console.log(`\n───── ${s}`);
      if (await run(process.execPath, [s], { ...childEnv, BASE: `http://localhost:${port}` })) failed += 1;
    }
  }
  server.kill();
}

await dropScratch();
await adminPool.end();
console.log(failed ? `\n${failed} script(s) failed\n` : '\nall database checks passed\n');
process.exit(failed ? 1 : 0);
