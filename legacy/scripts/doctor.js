/**
 * Tell me what is missing, and the command that fixes it.
 *
 *   npm run doctor
 *
 * This is the first thing to run on a new box and the first thing to run
 * when something is wrong. It checks Node, the configuration, the database,
 * the migrations, the media tools, mail and object storage, and for anything
 * missing it prints the command for THIS machine — Debian and Fedora and
 * Arch do not agree on what the packages are called, and four of the six
 * binaries come from a package with a different name.
 *
 * IT CHANGES NOTHING. No installing, no creating databases, no writing
 * files. It is somebody else's server: a script that apt-installs and
 * creates database roles without being asked is exactly what a developer
 * should distrust from security software. Everything it suggests is printed
 * for a person to read first.
 *
 * Exit code is 0 when the deployment can run, 1 when something required is
 * missing, so it can be a gate in a deploy script.
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  detectFamily, familyLabel, installCommand, installNotes,
  databaseSetupCommands, nodeVersionOk,
  PROXIED_PATHS, whoAnswered, parseEnabledUnits, missingUnits, EXPECTED_UNITS,
  updaterProblems,
} from '../src/doctor.js';
import { backupSettings, backupHealth } from '../src/backup.js';
import { anchorHealth, anchorFault, DEFAULT_MAX_AGE_HOURS } from '../src/anchorHealth.js';
import { toolsAvailable, scannerAvailable } from '../src/media.js';
import { readiness } from '../src/installConfig.js';
import { cleanTyped, hasKeystrokes, looksUnclean } from '../src/lineEdit.js';
import { emailConfig, emailReadiness } from '../src/email.js';
import { isConfigured as storageConfigured, storageConfig } from '../src/storage.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const have = (bin) => {
  try {
    execFileSync('sh', ['-c', `command -v ${bin}`], { stdio: 'ignore' });
    return true;
  } catch { return false; }
};

const osRelease = (() => {
  try { return fs.readFileSync('/etc/os-release', 'utf8'); } catch { return ''; }
})();
const family = detectFamily({ osRelease, have });

/* Collected rather than printed as we go, so the fixes can be grouped at
   the end — a reader wants the list of problems, then the list of commands,
   not the two interleaved. */
const problems = [];
const fixes = [];
let required = 0;

const OK = '  ok   ';
const NO = '  --   ';
const line = (good, text) => console.log((good ? OK : NO) + text);

console.log('\nReportLog — checking this machine\n');
console.log(`  system      ${familyLabel(family)}${family ? '' : ' (unrecognised — no install commands will be offered)'}`);
console.log('');

/* ---- node ------------------------------------------------------------ */
{
  const v = nodeVersionOk(process.version, pkg.engines.node);
  line(v.ok, `node ${process.version} (needs ${pkg.engines.node})`);
  if (!v.ok) {
    required += 1;
    problems.push(`Node ${v.have} is too old; this needs ${v.min} or newer.`);
    fixes.push('Install Node 22 or newer. Your distribution\'s package is often older\n'
      + '  than that — https://github.com/nodesource/distributions is the usual\n'
      + '  route. Not a version manager (nvm, fnm, asdf): they put Node in a home\n'
      + '  directory, and the service cannot run it from there. INSTALL.md §3.2.');
  }
}

/* ---- configuration --------------------------------------------------- */
const envPath = path.join(root, '.env');
const envExists = fs.existsSync(envPath);
line(envExists, envExists ? '.env present' : '.env missing');
if (!envExists) {
  required += 1;
  problems.push('There is no .env, so the app cannot start.');
  fixes.push('npm run configure');
}

const r = readiness(process.env);
if (envExists) {
  line(r.bootable, r.bootable
    ? 'DATABASE_URL and SITE_ORIGIN set'
    : `missing ${r.bootMissing.join(', ')}`);
  if (!r.bootable) {
    required += 1;
    problems.push(`${r.bootMissing.join(' and ')} must be set before anything runs.`);
    fixes.push('npm run configure -- --check');
  }
  line(r.secrets, r.secrets
    ? 'encryption keys present'
    : `missing ${r.secretsMissing.join(', ')}`);
  if (!r.secrets) {
    required += 1;
    problems.push('The encryption keys are missing. Without them nothing can be stored.');
    fixes.push('npm run configure    (it generates them; never type them by hand)');
  }
}

/* ---- keystrokes saved as text ------------------------------------------
   The install prompt once saved the arrow keys pressed while typing a value,
   and a test box's email went out from "Test Log 2 [D [D [D …". The app now reads
   the two names through src/lineEdit.js, which replays them into what was on
   screen — but that is a repair, and the file should say what it means. Not
   counted as required: nothing is broken while the repair holds. */
if (envExists) {
  const raw = fs.readFileSync(envPath, 'utf8');
  const bad = raw.split('\n')
    .map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/))
    .filter((m) => m && hasKeystrokes(m[2]))
    .map((m) => ({ key: m[1], meant: cleanTyped(m[2].replace(/^["']|["']$/g, '')) }));
  line(!bad.length, bad.length
    ? `.env has keystrokes saved as text in ${bad.map((b) => b.key).join(', ')}`
    : 'no stray keystrokes in .env');
  for (const b of bad) {
    /* NEVER OFFER A VALUE THAT IS STILL WRONG. This used to print
       `set ALERT_FROM_NAME=<cleaned>` unconditionally — and on a test box the
       cleaned value was still "Test L[2og 2", because the ESC bytes that
       made it a keystroke were already gone and replaying cannot recover
       what is no longer there. So the fix line told somebody to write the
       broken string, which they would have pasted. Advice given
       confidently is worse than none when it is wrong.
       Where the reading still looks like wreckage, this says what it reads
       as and asks for the name that was meant. */
    if (looksUnclean(b.meant)) {
      problems.push(`${b.key} in .env holds keystroke codes from the install prompt, and `
        + `enough of them are mangled that what was meant cannot be worked out. It reads `
        + `as "${b.meant}", which is what the app shows and what your emails say.`);
      fixes.push(`edit .env and set ${b.key}= to the name you meant   (then restart the service)`);
    } else {
      problems.push(`${b.key} in .env holds arrow-key or delete codes from the install prompt. `
        + `It reads as "${b.meant}" — the app shows it that way already, but fix the file.`);
      fixes.push(`edit .env and set ${b.key}=${b.meant}   (then restart the service)`);
    }
  }
}

/* ---- database -------------------------------------------------------- */
// Read inside the block below, because the pool is closed at the end of it
// and the units and anchoring sections run afterwards. Collected rather than
// queried where they are used, so the whole check still works on a machine
// with no database at all — which is the common case on a laptop.
let subscriberCount = 0;
let listRowCount = 0;
let anchorNewest = null;
let reportCount = 0;
let dbUp = false;
if (process.env.DATABASE_URL) {
  try {
    const { pool } = await import('../src/db.js');
    const { rows } = await pool.query('SELECT 1 AS ok');
    dbUp = rows.length === 1;
    line(true, 'database reachable');

    // Migrations: what is on disk against what the tracking table says, so
    // "you forgot to migrate" is a distinct answer from "the database is
    // down".
    //
    // STATED ONCE, in src/schemaState.js, which the admin Updates pane
    // reads too. This used to be a second copy of the comparison living
    // here, and two statements of one rule drift — the admin pane and the
    // doctor disagreeing about whether a box is migrated is worse than
    // either being wrong alone, because it discredits both.
    const { schemaState } = await import('../src/schemaState.js');
    const schema = await schemaState({ client: pool });
    const { pending } = schema;
    line(pending.length === 0, pending.length === 0
      ? `migrations applied (${schema.applied})`
      : `${pending.length} migration(s) not applied: ${pending.join(', ')}`);
    if (pending.length) {
      required += 1;
      problems.push(`${pending.length} migration(s) have not been applied.`);
      fixes.push('npm run migrate');
    }

    // THE OTHER DIRECTION, which nothing used to detect: the database has
    // run migrations this checkout does not carry, so the code is OLDER
    // than the archive it is reading. Migrating is not the fix and would do
    // nothing useful; updating the checkout is.
    if (schema.unknown.length) {
      required += 1;
      line(false, `this code is OLDER than this database — it has run `
        + `${schema.unknown.length} migration(s) this checkout does not carry: `
        + schema.unknown.join(', '));
      problems.push('The database has run migrations this checkout does not carry, '
        + 'so the application is older than the archive it is reading.');
      fixes.push('contrib/deploy.sh   # update the checkout; do NOT migrate');
    }

    // Is it ready to hand to somebody, or still mid-install?
    if (!pending.length) {
      const { rows: s } = await pool.query(
        'SELECT access_enabled, access_password_hash IS NOT NULL AS has_pw, setup_completed_at FROM site_settings WHERE id = true',
      );
      if (s[0]) {
        const gated = s[0].access_enabled;
        const hasPw = s[0].has_pw;
        line(!gated || hasPw, gated
          ? (hasPw ? 'site password set' : 'site is gated with NO password — nobody can get in, including you')
          : 'site is open (no password gate)');
        if (gated && !hasPw) {
          required += 1;
          problems.push('The gate is on and no password is set, so nothing can be reached.');
          fixes.push('npm run set-curtain-password');
        }
        line(true, s[0].setup_completed_at
          ? 'first-run setup completed'
          : 'first-run setup not done yet — the wizard will run when somebody opens the site');
      }

      // What the units and anchoring sections below need, read while the
      // pool is still open. Each is wrapped on its own: a deployment
      // mid-upgrade may have the tables for one and not the other, and a
      // missing table here must not turn into "database unreachable".
      try {
        const { rows: subs } = await pool.query(
          "SELECT count(*)::int AS n FROM users WHERE notify_mode IN ('hourly', 'weekly')",
        );
        subscriberCount = subs[0].n;
      } catch { /* no users table yet */ }
      try {
        // Entries with an expiry and something still in them. A deployment
        // with no lists, or with only durable ones, does not need the timer.
        const { rows: le } = await pool.query(
          `SELECT count(*)::int AS n FROM list_entries
            WHERE erased_at IS NULL AND personal_expires_at IS NOT NULL`,
        );
        listRowCount = le[0].n;
      } catch { /* no list tables yet */ }
      try {
        const { rows: a } = await pool.query('SELECT max(anchor_date) AS newest FROM chain_anchors');
        anchorNewest = a[0].newest;
        const { rows: r } = await pool.query('SELECT count(*)::int AS n FROM reports');
        reportCount = r[0].n;
      } catch { /* no anchor or reports table yet */ }
    }
    await pool.end();
  } catch (e) {
    line(false, `database unreachable: ${e.message.split('\n')[0]}`);
    required += 1;
    problems.push('The database could not be reached.');
    for (const cmd of databaseSetupCommands(process.env.DATABASE_URL)) fixes.push(cmd);
    fixes.push('...then check the host, port and password in DATABASE_URL. If the\n'
      + '  cluster is on this machine, `sudo systemctl status postgresql` first.');
  }
}

/* ---- media tools ----------------------------------------------------- */
{
  const tools = toolsAvailable();
  // Only a problem if attachments are wanted. Text-only is a real way to
  // run this, and reporting missing ffmpeg as a fault on such a deployment
  // would be noise the operator learns to ignore.
  const wantsAttachments = storageConfigured() || process.env.ATTACHMENTS_ENABLED === 'true';
  line(tools.ok, tools.ok
    ? 'media tools present (photos, video, audio, PDF)'
    : `missing media tools: ${tools.missing.join(', ')}`);

  if (!tools.ok) {
    const bins = tools.missing.map((m) => m.split(' ')[0]);
    if (wantsAttachments) {
      required += 1;
      problems.push('Attachments are configured but the tools to process them are missing. '
        + 'Uploads will be accepted and then wait, not fail.');
    } else {
      problems.push('Media tools are missing. Fine for a text-only deployment; '
        + 'attachments of the affected kinds would wait until they are installed.');
    }
    const cmd = installCommand(bins, family);
    if (cmd) fixes.push(cmd);
    else fixes.push(`Install these yourself: ${bins.join(', ')} (system not recognised).`);
    for (const note of installNotes(bins, family)) fixes.push(note);
  }
}

/* ---- virus scanning -------------------------------------------------- */
// Only when it is switched on. The media worker fails CLOSED when the scanner
// is configured and missing — every upload waits, unprocessed — so this is a
// fault, where a missing scanner on a box that never asked for one is not.
// It finds the client and not the daemon: clamdscan present and clamd stopped
// fails the same way, and `systemctl status clamav-daemon` is the check.
if (process.env.CLAMAV_ENABLED === 'true') {
  const have = scannerAvailable();
  line(have, have
    ? 'clamdscan present (CLAMAV_ENABLED=true; check clamav-daemon is running)'
    : 'CLAMAV_ENABLED=true and there is no clamdscan');
  if (!have) {
    required += 1;
    problems.push('Virus scanning is switched on and the scanner is not installed, so every '
      + 'upload waits unprocessed. Install it, or set CLAMAV_ENABLED=false.');
    const cmd = installCommand(['clamdscan'], family);
    if (cmd) fixes.push(cmd);
  }
}

/* ---- mail ------------------------------------------------------------ */
{
  const c = emailConfig();
  const mail = emailReadiness();
  line(mail.ok, mail.ok
    ? `mail configured (${c.transport})`
    : (c.transport === 'log'
      ? 'NO mail transport — no report can be confirmed; sign-in codes go to the service log'
      : `mail incomplete (${c.transport}): missing ${mail.missing.join(', ')}`));
  if (!mail.ok) {
    required += 1;
    problems.push('Without mail no reporter can confirm a report. The sign-in and setup '
      + 'codes are printed to the service log instead (journalctl -u reportlog), which is '
      + 'enough to finish setup from a shell and useless to anybody without one.');
    fixes.push('npm run configure -- --check    (then fill in SMTP_HOST and friends)');
    fixes.push('npm run mail-test -- you@example.org    once it is set');
  }
}

/* ---- object storage -------------------------------------------------- */
{
  const configured = storageConfigured();
  line(true, configured
    ? `object storage configured (${storageConfig().endpoint})`
    : 'object storage not configured — text-only reports, attachment routes 404');
  if (configured) {
    fixes.push('npm run storage-doctor    to check the buckets actually answer');
  }
}

/* ---- the security header nothing else checks ------------------------- */
// THE ONE PIECE OF CONFIGURATION THAT LIVES OUTSIDE THIS REPOSITORY.
// server.js sets a Content-Security-Policy, but in production nginx answers
// for public/ off disk — the page, every module, every stylesheet, the
// service worker — and never consults the app. contrib/nginx/reportlog.conf
// includes contrib/nginx/csp.conf, and a box built before that line existed, or
// rebuilt from an older config, serves no policy at all and nothing says so.
//
// A grep of this repository can never catch that. Asking the deployment is
// the only check that can, so this fetches it and reads the header back.
console.log('\nThe security header on the deployment itself\n');
const origin = (process.env.SITE_ORIGIN || '').replace(/\/+$/, '');
if (!origin) {
  line(false, 'SITE_ORIGIN is not set, so there is nothing to ask');
} else {
  // A path nginx serves off disk, not one the app answers: the app's own
  // header would hide exactly the gap being looked for. /sw.js is served
  // from disk on every deployment and is never behind the gate.
  const url = `${origin}/sw.js`;
  let header = null;
  let reached = false;
  try {
    const res = await fetch(url, { method: 'HEAD', redirect: 'follow',
      signal: AbortSignal.timeout(6000) });
    reached = true;
    header = res.headers.get('content-security-policy');
  } catch { /* unreachable is reported below, not thrown */ }

  if (!reached) {
    line(false, `could not reach ${url} from this machine`);
    console.log('         Not necessarily a fault: a box that cannot resolve its own');
    console.log('         public name will say this while serving the header fine.');
    console.log('         Check it from outside with:');
    console.log(`           curl -sI ${url} | grep -i content-security-policy`);
  } else if (!header) {
    line(false, 'nginx serves public/ with NO Content-Security-Policy');
    problems.push('The Content-Security-Policy is missing from the live nginx config, so '
      + 'every file nginx serves off disk — the page, every module, every stylesheet, '
      + 'the service worker — is sent without it. The app sets it only on the paths it '
      + 'answers itself.');
    fixes.push('In the live server block, and again inside location = /sw.js, add: '
      + 'include /srv/reportlog/contrib/nginx/csp.conf;  then: '
      + 'sudo nginx -t && sudo systemctl reload nginx. Once. After that deploy.sh keeps it current.');
    fixes.push('contrib/README.md explains both placements and the two ways the edit '
      + 'fails quietly');
  } else if (!/script-src[^;]*'self'/.test(header) || /script-src[^;]*unsafe-inline/.test(header)) {
    line(false, 'a policy is served, but script-src is not \'self\' without unsafe-inline');
    console.log(`         got: ${header}`);
    problems.push('The served Content-Security-Policy does not restrict scripts to this '
      + 'origin, which is the directive the rest of it exists to support.');
    fixes.push('Compare the live nginx server block against contrib/nginx/reportlog.conf');
  } else {
    line(true, 'nginx serves a policy, and script-src is restricted to this origin');
  }

  /* ---- and whether a browser is told how long a module stays fresh ----
   *
   * THE WHITE PAGE. Without `cache.conf` nginx sends no caching instruction
   * for .js, .css or .html, so a browser guesses — and on 10 October an
   * owner's browser kept one OLD module beside new ones after an update, a
   * missing export stopped every script, and the page stayed white. The
   * service worker and public/js/boot-guard.js recover from it in the
   * browser now; the include stops it at the source, including for a
   * browser that has no service worker yet.
   *
   * NOTHING CHECKED FOR IT UNTIL NOW, which is the reason it is here. The
   * include arrived after boxes were already running, `deploy.sh`
   * deliberately never edits nginx, and so the one deployment that most
   * needed it — an old one being jumped forward several releases — was the
   * one with no way to find out.
   *
   * Read off the SAME request shape as the policy above: a real module,
   * served off disk by nginx, never behind the gate.
   */
  if (reached) {
    const modUrl = `${origin}/js/boot.js`;
    let cache = null;
    let modReached = false;
    try {
      const res = await fetch(modUrl, { method: 'HEAD', redirect: 'follow',
        signal: AbortSignal.timeout(6000) });
      modReached = res.ok;
      cache = res.headers.get('cache-control');
    } catch { /* reported below */ }

    if (!modReached) {
      line(false, `could not read ${modUrl} to check its caching`);
    } else if (!cache) {
      line(false, 'nginx sends no Cache-Control for modules, so a browser guesses');
      problems.push('Modules and stylesheets are served with no caching instruction, so a '
        + 'browser decides for itself how long one stays fresh. After an update that can '
        + 'leave it holding an OLD module beside new ones — a missing export stops every '
        + 'script and the page goes white.');
      fixes.push('In the live server block, beside the csp.conf include, add: '
        + 'include /srv/reportlog/contrib/nginx/cache.conf;  then: '
        + 'sudo nginx -t && sudo systemctl reload nginx. Once.');
    } else if (!/no-cache|no-store|max-age=0/.test(cache)) {
      line(false, `modules are served Cache-Control: ${cache}`);
      problems.push('Modules are served with a caching instruction that lets a browser use '
        + 'a stored copy without asking, which is what leaves one old module beside new '
        + 'ones after an update.');
      fixes.push('Compare the live server block against contrib/nginx/cache.conf');
    } else {
      line(true, `a browser must revalidate modules (${cache})`);
    }
  }
}

/* ---- who answers each path the app has to answer --------------------- */
// THE SILENT ONE. A path that exists both as a file in public/ and as a route
// in the app does not 404 when the proxy forgets it — nginx serves the file,
// with a 200, and the deployment goes on answering with a stale copy of
// something the app was supposed to build. /manifest.webmanifest is that
// path, and it went three days wrong before anybody noticed.
//
// A grep of this repository cannot see a live nginx config, so this asks the
// deployment and reads who answered. src/doctor.js holds the markers and why
// each one is a deliberate property of the route rather than an accident.
console.log('\nWhich of these the app answers, and which nginx answered instead\n');
if (!origin) {
  line(false, 'SITE_ORIGIN is not set, so there is nothing to ask');
} else {
  let anyReached = false;
  const wrong = [];
  for (const p of PROXIED_PATHS) {
    let res = null;
    try {
      const r = await fetch(`${origin}${p.path}`, {
        redirect: 'follow', signal: AbortSignal.timeout(6000),
      });
      // Only the small text answers are read. A marker is in the first few
      // kilobytes of every one of them, and a doctor that downloaded whatever
      // a path happened to return would be a denial of service against the
      // box it is meant to be helping.
      const body = (await r.text()).slice(0, 65536);
      res = { status: r.status, headers: Object.fromEntries(r.headers), body };
      anyReached = true;
    } catch { /* reported below */ }

    if (!res) { line(false, `${p.path} — could not be reached`); continue; }
    const who = whoAnswered(p.marker, res);
    if (who === 'app') {
      line(true, `${p.path} — the app`);
    } else if (who === 'nginx') {
      line(false, `${p.path} — nginx answered instead (${p.what})`);
      wrong.push(p);
    } else {
      line(false, `${p.path} — cannot tell who answered`);
    }
  }

  if (!anyReached) {
    console.log('         Not necessarily a fault: a box that cannot resolve its own');
    console.log('         public name will say this while serving every path fine.');
    console.log('         Check from outside, or skip this section.');
  } else if (wrong.length) {
    required += 1;
    // NAME THE PATH THAT IS ACTUALLY WRONG. This used to end with a fixed
    // sentence about /manifest.webmanifest whichever path was missing — so a
    // deployment whose manifest was fine and whose /styleguide was not got
    // told to care about the manifest, two lines under an `ok` saying the
    // manifest was answered by the app. An operator who follows that spends
    // their time on the wrong location block, and learns to distrust the rest
    // of this output.
    //
    // The manifest note is still worth making, because it is the one that
    // fails with a 200 and so looks like nothing — but only when it is one of
    // the paths that is actually wrong.
    const names = wrong.map((w) => w.path);
    problems.push(`${wrong.length} path(s) the app must answer are being answered by nginx `
      + `instead: ${names.join(', ')}.`
      + (names.includes('/manifest.webmanifest')
        ? ' /manifest.webmanifest is the one that hides: it fails with a 200, so nothing '
          + "looks broken and every home-screen icon carries the software's name rather "
          + "than this deployment's."
        : ' None of them is /manifest.webmanifest, which is the one that would fail '
          + 'silently with a 200 — so what is listed above is what to fix.'));
    fixes.push('Add the missing location block(s) to the live nginx server block. '
      + 'contrib/nginx/reportlog.conf is the template and names all five; '
      + 'then sudo nginx -t && sudo systemctl reload nginx');
  }
}

/* ---- is anything actually scheduled to run? ------------------------- */
// A deployment that is not anchoring looks completely healthy. So does one
// that is not backing up, and one whose media worker never runs. Each of
// those is a timer somebody had to remember to enable from a list, and the
// anchor was once missing from the list in contrib's own README — so a
// deployment that followed the instructions exactly never anchored.
console.log('\nWhat systemd is set to run\n');
{
  const wantsAttachments = storageConfigured() || process.env.ATTACHMENTS_ENABLED === 'true';
  let unitFiles = null;
  try {
    unitFiles = execFileSync('systemctl',
      ['list-unit-files', 'reportlog*', '--no-pager', '--no-legend'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch { /* no systemd, or it refused — handled below */ }

  if (unitFiles === null) {
    line(true, 'no systemd here, so nothing to check (fine on a laptop)');
  } else {
    const enabled = parseEnabledUnits(unitFiles);
    const installed = String(unitFiles).trim().length > 0;
    if (!installed) {
      // A checkout is not a deployment. Reporting four missing timers on a
      // developer's machine is noise, and noise is what teaches somebody to
      // stop reading this output.
      line(true, 'no units installed — this looks like a checkout rather than a deployment');
      console.log('         To make it one:  sudo ./contrib/install-units.sh');
    } else {
      const ctx = {
        attachments: wantsAttachments,
        subscribers: subscriberCount,
        listRows: listRowCount,
      };
      const { all, required: needed } = missingUnits(enabled, ctx);
      for (const u of EXPECTED_UNITS) {
        if (!u.needed(ctx) && !enabled.has(u.unit)) {
          line(true, `${u.unit} not enabled — optional (${u.what})`);
        } else {
          line(enabled.has(u.unit), `${u.unit}${enabled.has(u.unit) ? '' : ' NOT ENABLED'} — ${u.what}`);
        }
      }
      for (const u of needed) problems.push(u.missing);
      if (needed.length) {
        required += 1;
        fixes.push('sudo ./contrib/install-units.sh      (idempotent; enables every '
          + 'unit, which is the point — the list of five commands is how one gets missed)');
      }
      if (all.length && !needed.length) {
        fixes.push('sudo ./contrib/install-units.sh      to pick up the optional ones too');
      }

      // Root's updater: a file the application must not be able to write.
      // Read from what systemd actually has installed, not from the
      // repository's copy of the unit, because the question is what THIS box
      // runs as root.
      let unitText = null;
      try {
        unitText = fs.readFileSync('/etc/systemd/system/reportlog-update.service', 'utf8');
      } catch { /* the update unit is optional */ }
      if (unitText) {
        const exec = (unitText.match(/^ExecStart=(\S+)/m) || [])[1] || '';
        let installed = { exists: false };
        try {
          const st = fs.statSync(exec);
          installed = {
            exists: true, uid: st.uid, mode: st.mode,
            text: fs.readFileSync(exec, 'utf8'),
          };
        } catch { /* reported as missing */ }
        let checkoutText = null;
        try {
          checkoutText = fs.readFileSync(path.join(root, 'contrib', 'update-apply.sh'), 'utf8');
        } catch { /* a checkout without contrib/ is reported elsewhere */ }
        const found = updaterProblems({ unitText, repoDir: root, installed, checkoutText });
        line(found.length === 0, found.length === 0
          ? `root's updater is outside the checkout and only root can write it (${exec})`
          : found[0].problem);
        if (found.length) {
          if (found[0].required !== false) required += 1;
          problems.push(found[0].problem);
          fixes.push(`${found[0].fix}      (installs root's copy of the updater outside the checkout)`);
        }
      }
    }
  }
}

/* ---- is the archive still being anchored? --------------------------- */
// NOT "is the anchor timer enabled" — that is the units section above, and
// it was the only thing ever checked. A timer that fires and fails every
// night is enabled, and the archive goes stale in public with nothing
// saying so. The newest row in chain_anchors is the signal that cannot be
// faked by a half-working anchor: the row and the published files are
// written in the same run, so a day with a row got all the way through.
if (dbUp) {
  console.log('\nAnchoring\n');
  const maxAgeHours = Number(process.env.ANCHOR_MAX_AGE_HOURS || DEFAULT_MAX_AGE_HOURS);
  const h = anchorHealth(anchorNewest, { maxAgeHours });
  const fault = anchorFault(h, { hasReports: reportCount > 0 });

  if (h.state === 'never') {
    // An empty archive that has never anchored is a deployment somebody set
    // up this morning, not a fault. One with reports is a fault.
    line(!fault, reportCount > 0
      ? `NOTHING HAS EVER BEEN ANCHORED, and there are ${reportCount} report(s)`
      : 'nothing anchored yet, and no reports to anchor');
  } else {
    line(!fault, fault
      ? `newest anchor is ${h.newest}, ${h.ageHours}h old (stale after ${maxAgeHours}h)`
      : `newest anchor ${h.newest}, ${h.ageHours}h old`);
  }

  if (fault) {
    required += 1;
    problems.push(fault);
    fixes.push('journalctl -u reportlog-anchor -n 50');
    fixes.push('npm run anchor                       runs it now, in the foreground');
  }
}

/* ---- is there a backup, and is it recent? --------------------------- */
// This archive cannot delete a row by design. That protects it from being
// edited and not at all from the disk dying, and until the backup script
// existed there was no second copy of a single report anywhere.
//
// The check that matters is not "is a backup configured" but "is the newest
// one recent", because a backup that quietly stopped looks exactly like one
// that is working.
console.log('\nBackups\n');
{
  const { dir, keep, maxAgeHours } = backupSettings(process.env);
  // A CHECKOUT IS NOT A DEPLOYMENT, and the same reasoning as the units
  // above: faulting a developer's laptop for having no backups is noise, and
  // noise is what teaches somebody to stop reading this output. A reachable
  // database is the line — if there is one, something is in it, and the
  // absence of a second copy is a real fault.
  const isDeployment = dbUp;
  let names = null;
  try { names = fs.readdirSync(dir); } catch { /* absent — reported below */ }

  if (names === null && !isDeployment) {
    line(true, `nothing at ${dir} — no database here either, so nothing to back up yet`);
  } else if (names === null) {
    line(false, `nothing at ${dir}`);
    problems.push('There are no backups. This archive cannot delete a row, which protects '
      + 'it from being edited and not from the disk dying — without a dump there is no '
      + 'second copy of a single report.');
    fixes.push('npm run backup                       takes one now, and reads it back');
    fixes.push('sudo ./contrib/install-units.sh      installs the daily timer');
    required += 1;
  } else {
    const h = backupHealth(names, { maxAgeHours });
    if (h.state === 'none') {
      line(false, `${dir} exists but holds no backups`);
      if (isDeployment) {
        // THREE POSSIBILITIES, NOT TWO. The third is the commonest and was
        // missing: the timer was only just installed and has not reached its
        // first 03:30 yet. An operator told the timer "has never succeeded"
        // goes looking through journalctl for a failure that is not there —
        // and on a box where the journal is filtered for their user, finds
        // "No entries" and reads it as confirmation.
        problems.push('The backup directory is there and empty. Either the timer was '
          + 'only just installed and has not reached its first run, or it has run and '
          + 'failed. `npm run backup` settles which: if it works by hand, the timer is '
          + 'simply young.');
        fixes.push('npm run backup                       and read what it says');
        fixes.push('journalctl -u reportlog-backup -n 30');
        required += 1;
      }
    } else if (h.state === 'stale') {
      line(false, `newest backup is ${h.ageHours}h old (stale after ${maxAgeHours}h)`);
      problems.push(`Backups have stopped: the newest is ${h.ageHours} hours old. A backup `
        + 'that stopped looks exactly like one that is working.');
      fixes.push('journalctl -u reportlog-backup -n 30');
      if (isDeployment) required += 1;
    } else {
      const age = h.ageHours < 1 ? 'under an hour' : `${h.ageHours}h`;
      line(true, `${h.count} backup(s) in ${dir}, newest ${age} old, keeping ${keep}`);
      console.log('         Not checked, and not checkable from here: that a restore works.');
      console.log('         INSTALL.md §5.2 has the pg_restore line. Try it somewhere that');
      console.log('         is not production.');
    }
    if (!process.env.S3_BUCKET_EVIDENCE) { /* nothing to say about buckets */ }
  }
}

/* ---- what to do ------------------------------------------------------ */
console.log('');
if (!problems.length) {
  console.log('Nothing to fix. Start it with `npm start`, or the service unit in contrib/.\n');
  process.exit(0);
}

console.log('What is wrong\n');
for (const p of problems) console.log(`  - ${p}`);

if (fixes.length) {
  console.log('\nWhat to run — read these before you run them; nothing here has been\ndone for you\n');
  for (const f of fixes) console.log(`  ${f}`);
}

console.log('');
process.exit(required > 0 ? 1 : 0);
