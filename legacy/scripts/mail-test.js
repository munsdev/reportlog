/**
 * Send one real message, to prove mail works before it has to.
 *
 *   npm run mail-test -- you@example.org
 *
 * WHY THIS EXISTS. Mail is the thing an install most often gets wrong and
 * discovers last. Without it the one-time sign-in code is discarded rather
 * than logged, so the failure does not look like "mail is broken" — it
 * looks like nobody being able to sign in, including the person who just
 * installed the software, including through the setup wizard. That is a bad
 * moment to start debugging SMTP.
 *
 * So: one command, one message, and a plain answer about which transport
 * was used and whether the provider accepted it.
 */
import 'dotenv/config';
import { sendEmail, emailConfig, emailReadiness } from '../src/email.js';

const to = process.argv.slice(2).find((a) => a.includes('@'));
const c = emailConfig();
const r = emailReadiness();

console.log('\nReportLog — mail test\n');
console.log(`  transport   ${c.transport}`);
if (c.transport === 'smtp') {
  console.log(`  host        ${c.smtp.host}:${c.smtp.port}${c.smtp.secure ? ' (implicit TLS)' : ' (STARTTLS)'}`);
  console.log(`  user        ${c.smtp.user || '(none — unauthenticated submission)'}`);
}
if (c.transport === 'scaleway') {
  console.log(`  region      ${c.scaleway.region}`);
}
console.log(`  from        ${c.from.name} <${c.from.email || '(unset)'}>`);
console.log('');

if (c.transport === 'log') {
  console.error('This deployment has no mail transport configured, so nothing can be sent.');
  console.error('No report could be confirmed, and sign-in codes would reach only the service log.\n');
  console.error('Set SMTP_HOST (and usually SMTP_USER, SMTP_PASS, ALERT_FROM_EMAIL),');
  console.error('or the two SCALEWAY_ values. `npm run configure -- --check` lists what');
  console.error('is missing.\n');
  process.exit(2);
}

if (!r.ok) {
  console.error(`Incomplete: missing ${r.missing.join(', ')}.`);
  console.error('A half-configured transport looks set in the file and fails at the');
  console.error('first send, so this refuses rather than trying.\n');
  process.exit(2);
}

if (!to) {
  console.error('Give an address to send to:\n');
  console.error('  npm run mail-test -- you@example.org\n');
  console.error('Nothing was sent. Use an address you can actually read — the point');
  console.error('is to confirm it ARRIVES, not that the provider accepted it.\n');
  process.exit(2);
}

const stamp = new Date().toISOString();
const result = await sendEmail({
  to: [{ email: to }],
  subject: `ReportLog mail test — ${stamp}`,
  html: `<p>This is a test message from a ReportLog deployment.</p>
         <p>It was sent over <b>${c.transport}</b> at ${stamp}.</p>
         <p>If it arrived, sign-in codes and report confirmation links will
            arrive too, which are the two things this deployment cannot work
            without.</p>`,
});

if (result.sent) {
  console.log(`Accepted by the provider, addressed to ${to}.\n`);
  // Accepted is not delivered, and the difference is where the day goes.
  console.log('That means the provider took it, NOT that it arrived. Check the inbox,');
  console.log('and check spam — a new sending domain without SPF, DKIM and DMARC is');
  console.log('usually accepted and then filed as junk.\n');
  process.exit(0);
}

console.error(`Not sent: ${result.reason}\n`);
if (result.reason === 'smtp-failed') {
  console.error('The server refused or could not be reached. Common causes, in the');
  console.error('order they usually turn out to be:\n');
  console.error('  - wrong port: 587 is STARTTLS, 465 is implicit TLS. SMTP_SECURE');
  console.error('    is derived from the port unless you set it.');
  console.error('  - the provider wants an API-specific username, not your login.');
  console.error('  - outbound 25/465/587 blocked by the host. Many providers block');
  console.error('    25 outright and some block all three until you ask.');
  console.error('  - the FROM address is not one this account may send as.\n');
}
process.exit(1);
