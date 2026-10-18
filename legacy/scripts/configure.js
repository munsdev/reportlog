/**
 * Write the `.env` a deployment needs. The developer's half of an install.
 *
 *   npm run configure          # ask, then write
 *   npm run configure -- --check   # report what an existing .env is missing
 *   npm run configure -- --force   # replace an existing .env (backed up first)
 *
 * WHY THIS EXISTS. `.env` was a human copying values out of a table in a
 * runbook into a file by hand. Two of those values are irreplaceable keys
 * that must never be chosen, typed, displayed or reused — so the one step
 * of an install that most needed to be mechanical was the one being done by
 * eye. This generates them, asks only for what a person can actually know,
 * and says plainly what each answer switches on.
 *
 * It does NOT set the curtain password or mint an administrator. Those are
 * `npm run set-curtain-password` and the setup wizard, and the split is
 * deliberate: this file is yours, the wizard is theirs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  generateSecrets, validateSiteOrigin, validateDatabaseUrl, validateEmail,
  renderEnv, readiness, regionFromEndpoint, defaultTransparencyLogDir,
} from '../src/installConfig.js';
import { ask, askHidden, askUntilValid, confirm, interactive, closePrompt } from '../src/prompt.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(root, '.env');
const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const FORCE = args.includes('--force');

/** Read an existing .env into a plain object. Comments and blanks ignored. */
function readEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return null;
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const lineText = raw.trim();
    if (!lineText || lineText.startsWith('#')) continue;
    const eq = lineText.indexOf('=');
    if (eq === -1) continue;
    out[lineText.slice(0, eq).trim()] = lineText.slice(eq + 1).trim();
  }
  return out;
}

function report(env) {
  const r = readiness(env);
  const mark = (ok) => (ok ? 'yes' : 'NO');

  console.log('\nReportLog — configuration\n');
  console.log(`  starts at all        ${mark(r.bootable)}${r.bootable ? '' : `  — missing ${r.bootMissing.join(', ')}`}`);
  console.log(`  encryption keys set  ${mark(r.secrets)}${r.secrets ? '' : `  — missing ${r.secretsMissing.join(', ')}`}`);

  // Partial is its own state and the worst one: it looks configured in the
  // file and behaves exactly as unset.
  const via = r.emailTransport && r.emailTransport !== 'log' ? ` (${r.emailTransport})` : '';
  console.log(`  email${via.padEnd(16)}${r.emailPartial ? 'PARTLY — behaves as OFF' : mark(r.email)}`
    + (r.emailMissing.length ? `  — missing ${r.emailMissing.join(', ')}` : ''));
  console.log(`  object storage       ${r.storagePartial ? 'PARTLY — behaves as OFF' : mark(r.storage)}`
    + (r.storageMissing.length ? `  — missing ${r.storageMissing.join(', ')}` : ''));

  if (!r.email) {
    console.log('\n  Without email no reporter can confirm a report. The sign-in and setup');
    console.log('  codes alone are printed to the service log, so setup can be finished');
    console.log('  from a shell — and nothing more than that.');
  }
  if (env.ADMIN_EMAIL) {
    console.log('\n  ADMIN_EMAIL is where volunteer applications, other list entries and the feedback');
    console.log('  digest are sent. It no longer grants anything: signing in with it');
    console.log('  used to make that address an administrator every time, and that');
    console.log('  was removed on 14 September.');
  }
  console.log('');
  return r;
}

/* ---- --check ---------------------------------------------------------- */
if (CHECK) {
  const env = readEnv(envPath);
  if (!env) {
    console.error('\nNo .env here. Run `npm run configure` to write one.\n');
    process.exit(1);
  }
  const r = report(env);
  process.exit(r.bootable && r.secrets ? 0 : 1);
}

/* ---- refuse to clobber ------------------------------------------------ */
const existing = readEnv(envPath);
if (existing && !FORCE) {
  console.error('\n.env already exists. Nothing was changed.\n');
  console.error('  npm run configure -- --check    to see what it is missing');
  console.error('  npm run configure -- --force    to replace it (the old one is backed up)\n');
  console.error('A replacement generates NEW encryption keys. Against a database that');
  console.error('already holds data that makes every encrypted field unreadable — so if');
  console.error('this deployment has taken a report, copy the two keys across by hand');
  console.error('rather than letting this write new ones.\n');
  process.exit(1);
}

if (!interactive() && !FORCE && existing) process.exit(1);

/* ---- ask -------------------------------------------------------------- */
console.log('\nReportLog — writing .env\n');
console.log('This is the half of an install only you can do. It asks for the things');
console.log('a person can know, and generates the two things a person should never');
console.log('choose. It does not set the site password and does not create an');
console.log('administrator — those come after, and the second one is not yours to do.\n');

const v = {};

console.log('--- the app cannot start without these ---\n');

v.siteOrigin = await askUntilValid(
  'Public address of this site (https://reports.example.org)', validateSiteOrigin,
);
if (!v.siteOrigin) { console.error('\nNo site address. Nothing was written.\n'); process.exit(1); }

const dbDefault = 'postgres://reportlog@127.0.0.1:5432/reportlog';
const dbResult = await askUntilValid(
  `Database connection string`, validateDatabaseUrl, { fallback: dbDefault },
);
if (!dbResult) { console.error('\nNo database. Nothing was written.\n'); process.exit(1); }
v.databaseUrl = dbResult;

v.port = await ask('Port for the app to listen on (127.0.0.1 only)', { fallback: '5000' });

// Asked here so a handed-over deployment is already wearing its own name
// rather than the software's. An administrator can change it later; this is
// only what it starts as.
console.log('\n  The name below appears on every page, in the browser tab and in the');
console.log('  emails this site sends. The software stays called ReportLog and the');
console.log('  footer says so. Leave blank to use ReportLog as the name too.');
v.siteName = await ask('What this deployment calls itself');

console.log('\n--- email ---\n');
console.log('Not optional in practice. Without it no reporter can confirm a report.');
console.log('Skipped, the sign-in and setup codes are printed to the service log, which');
console.log('is enough to finish setup from a shell and nothing more.\n');
console.log('  smtp      any provider, or a relay you already run. The portable one.');
console.log('  scaleway  Scaleway Transactional Email, over their HTTP API.');
console.log('  skip      decide later. The site runs; reporters cannot use it.\n');

v.emailTransport = await ask('Transport (smtp / scaleway / skip)', { fallback: 'smtp' });

if (v.emailTransport === 'smtp') {
  v.smtpHost = await ask('SMTP host');
  v.smtpPort = await ask('SMTP port — 587 for STARTTLS, 465 for implicit TLS', { fallback: '587' });
  console.log('  Leave the next two blank for an unauthenticated local relay.');
  v.smtpUser = await ask('SMTP username');
  if (v.smtpUser) v.smtpPass = await askHidden('SMTP password (not shown as you type)');
  v.alertFromEmail = await askUntilValid('Address mail is sent FROM', validateEmail);
  v.alertFromName = await ask('Name mail is sent from', { fallback: 'ReportLog' });
} else if (v.emailTransport === 'scaleway') {
  v.scalewaySecretKey = await askHidden('Scaleway secret key (not shown as you type)');
  v.scalewayProjectId = await ask('Scaleway project id');
  v.scalewayRegion = await ask('Scaleway region', { fallback: 'fr-par' });
  v.alertFromEmail = await askUntilValid('Address mail is sent FROM', validateEmail);
  v.alertFromName = await ask('Name mail is sent from', { fallback: 'ReportLog' });
} else {
  // Written empty rather than omitted, so the file is still the list of
  // what could be set — and so --check keeps saying it is missing.
  v.emailTransport = '';
  console.log('  Skipped. `npm run configure -- --check` will keep reminding you.');
}

console.log('\n--- object storage, for attachments ---\n');
console.log('Three separate buckets, same account. Skip this and the site works');
console.log('with text-only reports; the attachment routes return 404 rather than');
console.log('offering an upload that has nowhere to go.\n');

v.s3Endpoint = await ask('S3 endpoint URL (blank to skip attachments)');
if (v.s3Endpoint) {
  // Read off the endpoint where it says (Hetzner's fsn1, AWS's, Scaleway's);
  // asked with no default otherwise, because a wrong default is pressed
  // through and then rejected by the provider.
  const guess = regionFromEndpoint(v.s3Endpoint);
  v.s3Region = await askUntilValid('S3 region', (r) => (String(r).trim()
    ? { ok: true, value: String(r).trim() }
    : { ok: false, error: 'The region is required — the location code your provider shows beside the endpoint.' }),
  { fallback: guess });
  v.s3AccessKey = await ask('S3 access key');
  v.s3SecretKey = await askHidden('S3 secret key (not shown as you type)');
  v.s3BucketStaging = await ask('Staging bucket    (plaintext, short-lived, needs an expiry rule)');
  v.s3BucketEvidence = await ask('Evidence bucket   (encrypted originals, never public)');
  v.s3BucketRenditions = await ask('Renditions bucket (published copies only)');
  // NO by default. The buckets are worth proving before reporters can put
  // files in them: `npm run storage-smoke` first, then ATTACHMENTS_ENABLED.
  console.log('  Prove the buckets with `npm run storage-smoke` before switching this on;');
  console.log('  then set ATTACHMENTS_ENABLED=true in .env, or turn it on from the admin page.');
  v.attachmentsEnabled = await confirm('Accept attachments from the start?', { fallback: false });
} else {
  console.log('  Skipped. Text-only reports.');
  v.attachmentsEnabled = false;
}

console.log('\n--- the daily chain anchor ---\n');
v.tsaUrl = await ask('RFC 3161 timestamp authority', { fallback: 'https://zeitstempel.dfn.de' });
v.transparencyLogDir = defaultTransparencyLogDir(root);
console.log(`  The public log's checkout goes in ${v.transparencyLogDir} (INSTALL.md §3.13).`);

console.log('\n--- where staff mail goes ---\n');
console.log('New entries on lists that email the admin, and the weekly feedback digest,');
console.log('go to this address. It grants nothing. Blank to fill in later.');
v.adminEmail = await askUntilValid('Staff mail address', (r) => (String(r).trim()
  ? validateEmail(r) : { ok: true, value: '' }));

closePrompt();

/* ---- generate, never ask --------------------------------------------- */
const secrets = generateSecrets();
v.tierB = secrets.tierB;
v.contactHmac = secrets.contactHmac;

/* ---- write ------------------------------------------------------------ */
if (existing && FORCE) {
  const backup = `${envPath}.backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  fs.copyFileSync(envPath, backup);
  fs.chmodSync(backup, 0o600);
  console.log(`\nOld .env backed up to ${path.basename(backup)}`);
}

fs.writeFileSync(envPath, renderEnv(v), { mode: 0o600 });
fs.chmodSync(envPath, 0o600);

console.log(`\nWritten: ${envPath} (chmod 600)`);
console.log('Two encryption keys were generated. They exist only in that file —');
console.log('back it up somewhere you trust, and never regenerate them against a');
console.log('database that already holds data.');

report(readEnv(envPath));

/* ---- what happens next ------------------------------------------------ */
const r = readiness(readEnv(envPath));
console.log('Next:\n');
console.log('  npm run migrate                 build the schema');
console.log('  npm run set-curtain-password    the password that lifts the gate');
console.log('  npm run mail-test -- you@…      prove mail actually arrives');
console.log('  npm start                       or start the service\n');
if (!r.email) {
  console.log('Then fill the email values in before handing this over — the setup');
  console.log('wizard emails the new owner a code, and without mail that code is only');
  console.log('in the service log, where the person you hand it to cannot see it.\n');
} else {
  console.log('Then hand over the URL and the curtain password. Opening the site with');
  console.log('it starts the setup wizard, which asks them for their own');
  console.log('administrator account.\n');
}
