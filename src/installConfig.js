/**
 * The pure half of `npm run configure`.
 *
 * Validating an answer, generating a key and rendering `.env` are all
 * decisions, and decisions belong somewhere a test can reach without a
 * terminal attached. The script is the part that talks to a human; this is
 * the part that is right or wrong.
 *
 * WHY A CONFIGURE STEP AT ALL. The `.env` file is the developer's half of
 * an install and the setup wizard is the operator's half — that split is
 * deliberate and it is in the right place. What was wrong is that the
 * developer's half was a human copying values out of a documentation table
 * into a file by hand, which is how two irreplaceable keys get generated
 * twice, pasted into a chat, or quietly left the same on two deployments.
 */
import crypto from 'node:crypto';
import { readinessFor } from './email.js';

/**
 * The two keys the software must never let a human choose, see or type.
 *
 * Lose either and the data behind it is unreadable forever, ciphertext
 * intact in every backup. That makes them exactly the wrong thing to ask
 * somebody for: a prompt invites a memorable answer, a paste into a
 * password manager, or a value reused from the last install.
 *
 * They are generated here, written once, and never echoed. If you need to
 * see one, read the file on the box — which is the only place it exists.
 */
export function generateSecrets() {
  const tierB = crypto.randomBytes(32).toString('base64');
  const contactHmac = crypto.randomBytes(32).toString('base64');
  // Not paranoia about the RNG — a guard against a future refactor that
  // computes one from the other, which would silently couple them.
  if (tierB === contactHmac) throw new Error('the two keys must differ');
  return { tierB, contactHmac };
}

/**
 * `src/siteOrigin.js` throws at boot without this, and every confirmation
 * link, invitation link and notification is built from it. A trailing slash
 * or a missing scheme produces URLs that are subtly wrong rather than
 * obviously broken, so both are corrected here rather than accepted.
 */
export function validateSiteOrigin(raw) {
  const value = String(raw ?? '').trim().replace(/\/+$/, '');
  if (!value) return { ok: false, error: 'Required. Every link in every email is built from it.' };
  let url;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, error: 'Not a URL. It should look like https://reports.example.org' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, error: 'Must be http:// or https://' };
  }
  if (url.pathname !== '/' && url.pathname !== '') {
    return { ok: false, error: 'Just the origin — no path. https://reports.example.org' };
  }
  if (url.protocol === 'http:' && !/^(localhost|127\.0\.0\.1)(:|$)/.test(url.host)) {
    return {
      ok: false,
      error: 'Use https for anything but localhost. The curtain password and every '
        + 'sign-in code would otherwise cross the network in the clear.',
    };
  }
  return { ok: true, value: url.origin };
}

/**
 * Not a full connection-string grammar — that is a losing game, and the
 * real check is whether Postgres answers, which the script does afterwards.
 * This catches the shapes that are wrong before anybody waits for a
 * timeout: the wrong scheme, and a URL with no database name, which
 * connects to a default database and then migrates the wrong thing.
 */
export function validateDatabaseUrl(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return { ok: false, error: 'Required. The app cannot start without it.' };
  if (!/^postgres(ql)?:\/\//.test(value)) {
    return { ok: false, error: 'Must start with postgres:// or postgresql://' };
  }
  // Deliberately string surgery and not `new URL`: the socket form
  // postgres://user@/db?host=/var/run/postgresql is a valid connection
  // string and an invalid URL, and it is the form a local install uses.
  const beforeQuery = value.split('?')[0];
  const dbName = beforeQuery.slice(beforeQuery.lastIndexOf('/') + 1);
  if (!dbName) {
    return {
      ok: false,
      error: 'No database name at the end. Without one this connects to the '
        + 'default database and migrates that instead.',
    };
  }
  return { ok: true, value, database: dbName };
}

/**
 * The region an S3 endpoint implies, or '' when it implies none.
 *
 * WHY. The prompt used to default to eu-central-1, which is AWS's name for
 * Frankfurt and not a region Hetzner has — their regions are fsn1, nbg1 and
 * hel1, and they are the first label of the endpoint. Pressing Enter wrote a
 * region the provider rejects. Read it off the endpoint where the endpoint
 * says it, and otherwise offer nothing rather than a wrong guess.
 */
export function regionFromEndpoint(raw) {
  let host = '';
  try { host = new URL(String(raw || '').trim()).hostname.toLowerCase(); } catch { return ''; }
  let m = host.match(/^([a-z0-9-]+)\.your-objectstorage\.com$/); // Hetzner
  if (m) return m[1];
  m = host.match(/^s3[.-]([a-z0-9-]+)\.amazonaws\.com$/); // AWS
  if (m && m[1] !== 'external-1') return m[1];
  m = host.match(/^s3\.([a-z0-9-]+)\.scw\.cloud$/); // Scaleway
  if (m) return m[1];
  return '';
}

/** Where the transparency log's checkout goes: beside the application's. */
export function defaultTransparencyLogDir(checkoutDir) {
  return `${String(checkoutDir).replace(/\/+$/, '')}-transparency-log`;
}

export function validateEmail(raw) {
  const value = String(raw ?? '').trim();
  // A shape check, the same standard the forms use: enough to catch a typo, not an
  // attempt at the full grammar.
  if (!/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(value)) {
    return { ok: false, error: 'That does not look like an email address.' };
  }
  return { ok: true, value };
}

/**
 * Which optional subsystems this configuration actually switches on.
 *
 * Used by the script's summary and by `--check`. It answers the question an
 * installer actually has — "is this box finished?" — which no single
 * variable does.
 */
export function readiness(env) {
  const has = (k) => Boolean(String(env[k] ?? '').trim());

  const storageKeys = ['S3_ENDPOINT', 'S3_ACCESS_KEY', 'S3_SECRET_KEY',
    'S3_BUCKET_STAGING', 'S3_BUCKET_EVIDENCE', 'S3_BUCKET_RENDITIONS'];
  const storageMissing = storageKeys.filter((k) => !has(k));

  // Delegated, not reimplemented. Which transport a configuration selects
  // and what it still needs is decided in one place, or the installer and
  // the app disagree about whether a deployment can send mail.
  const mail = readinessFor(env);
  const emailMissing = mail.missing;

  return {
    bootable: ['DATABASE_URL', 'SITE_ORIGIN'].every(has),
    bootMissing: ['DATABASE_URL', 'SITE_ORIGIN'].filter((k) => !has(k)),
    secrets: ['TIER_B_ENCRYPTION_KEY', 'CONTACT_HMAC_KEY'].every(has),
    secretsMissing: ['TIER_B_ENCRYPTION_KEY', 'CONTACT_HMAC_KEY'].filter((k) => !has(k)),
    // Partial is worse than absent and has to be reported as its own state:
    // half-filled email looks configured in a file and behaves as unset.
    email: mail.ok,
    emailTransport: mail.transport,
    // A transport was chosen and is incomplete. `log` is not partial — it
    // is nothing configured at all, which is a different sentence.
    emailPartial: !mail.ok && mail.transport !== 'log',
    emailMissing,
    storage: storageMissing.length === 0,
    storagePartial: storageMissing.length > 0 && storageMissing.length < storageKeys.length,
    storageMissing,
  };
}

/**
 * Render `.env`.
 *
 * Commented, in the order somebody reads it, and every value quoted-free
 * because dotenv does not need quotes and a stray one becomes part of a
 * key. Absent optional values are written as empty assignments rather than
 * omitted, so the file is also the list of what could be set.
 */
export function renderEnv(v) {
  const line = (k, val) => `${k}=${val ?? ''}`;
  return `# ReportLog configuration — written by \`npm run configure\`.
#
# This file is the DEVELOPER's half of an install. The operator's half is
# the setup wizard, which they reach with the curtain password
# (\`npm run set-curtain-password\`) and which mints their own administrator
# account. Nothing in here needs to be handed to them.
#
# chmod 600. The two generated keys below exist nowhere else.

# --- the app cannot start without these -------------------------------
${line('DATABASE_URL', v.databaseUrl)}
${line('SITE_ORIGIN', v.siteOrigin)}
${line('PORT', v.port || '5000')}

# What this deployment calls itself, shown on every page and in the mail it
# sends. This is the SEED: an administrator can change it from the admin
# page afterwards and that choice wins. Empty means the software's own name.
# The footer credits ReportLog either way.
${line('SITE_NAME', v.siteName)}

# --- generated, irreplaceable, never to be typed by a person ----------
# Lose either and the data behind it is unreadable forever, with the
# ciphertext intact in every backup. They were generated on this machine
# and exist only in this file. Back it up somewhere you trust; do not
# regenerate them against a database that already holds data.
${line('TIER_B_ENCRYPTION_KEY', v.tierB)}
${line('CONTACT_HMAC_KEY', v.contactHmac)}

# --- email ------------------------------------------------------------
# NOT OPTIONAL IN PRACTICE. With no transport, sendEmail() logs the subject
# and recipient and DISCARDS the body. The sign-in and setup codes are the
# one exception, printed to the service log on purpose so a box can be set up
# before mail works — but no reporter can confirm a report, and nobody but
# whoever reads the log can sign in. A transport that is set and failing is
# worse: the code goes nowhere at all.
#
# Leave EMAIL_TRANSPORT empty to let it be inferred: SMTP if SMTP_HOST is
# set, else Scaleway if both its values are, else nothing. Set it to the
# word log deliberately on a staging box that must never send real mail.
${line('EMAIL_TRANSPORT', v.emailTransport)}
${line('ALERT_FROM_EMAIL', v.alertFromEmail)}
${line('ALERT_FROM_NAME', v.alertFromName || 'ReportLog')}

# SMTP — works with any provider, and with a relay you already run.
# Port 587 is STARTTLS and 465 is implicit TLS; SMTP_SECURE is derived from
# the port unless you set it, because that is the misconfiguration people
# hit most. Leave SMTP_USER and SMTP_PASS empty for an unauthenticated
# local relay.
${line('SMTP_HOST', v.smtpHost)}
${line('SMTP_PORT', v.smtpPort || '587')}
${line('SMTP_USER', v.smtpUser)}
${line('SMTP_PASS', v.smtpPass)}
${line('SMTP_SECURE', v.smtpSecure)}

# Scaleway Transactional Email, as an alternative to SMTP.
${line('SCALEWAY_SECRET_KEY', v.scalewaySecretKey)}
${line('SCALEWAY_PROJECT_ID', v.scalewayProjectId)}
${line('SCALEWAY_REGION', v.scalewayRegion || 'fr-par')}

# --- object storage, for attachments ----------------------------------
# ATTACHMENTS_ENABLED is honoured only if every S3_ value is filled in;
# an administrator can also switch attachments off from the admin page,
# and a stored "off" beats this being "true".
${line('ATTACHMENTS_ENABLED', v.attachmentsEnabled ? 'true' : 'false')}
${line('S3_ENDPOINT', v.s3Endpoint)}
${line('S3_REGION', v.s3Region)}
${line('S3_ACCESS_KEY', v.s3AccessKey)}
${line('S3_SECRET_KEY', v.s3SecretKey)}
${line('S3_BUCKET_STAGING', v.s3BucketStaging)}
${line('S3_BUCKET_EVIDENCE', v.s3BucketEvidence)}
${line('S3_BUCKET_RENDITIONS', v.s3BucketRenditions)}

# --- the daily chain anchor -------------------------------------------
${line('TSA_URL', v.tsaUrl || 'https://zeitstempel.dfn.de')}
# The local checkout of the public transparency log. Written out rather than
# left to the code's default, which is a folder in the service user's home —
# and that home is the checkout itself. This path is the one
# contrib/install-units.sh creates and the anchor unit is allowed to write.
${line('TRANSPARENCY_LOG_DIR', v.transparencyLogDir)}

# --- where staff mail goes --------------------------------------------
# New entries on lists that email the admin (the volunteer form is one) and
# the weekly feedback digest are sent here.
#
# It GRANTS NOTHING. Signing in with this address used to make it an
# administrator every time, silently and with no audit row; that was
# removed on 14 September, because appointing an administrator is the
# owner's alone and a second quieter way in would have hollowed that out.
# Safe to set to a real address.
${line('ADMIN_EMAIL', v.adminEmail)}
`;
}
