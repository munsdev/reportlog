// Run a few hours after the anchor, every day. Asks the one question
// scripts/anchor.js cannot ask about itself: did it run?
//
// A job that fails cannot report its own silence. scripts/anchor.js is loud
// when it breaks mid-run — it throws, and cron mails whoever owns the
// crontab — but it says nothing at all when it never starts, when systemd
// never fired the timer, when the unit was removed in a deploy, or when the
// box was down at 03:00. Six days of daily publication were missed in late
// September and nothing raised a fault, because nothing was looking from
// outside the job.
//
// So this looks from outside: the newest row in `chain_anchors`, compared
// against the clock. That is the only signal that cannot be faked by a
// half-working anchor — the row and the published file are written in the
// same run, so a day with a row is a day that got all the way through.
//
// EXITS NON-ZERO ON A FAULT, as well as emailing, so a deployment that has
// mail misconfigured still has something to notice: systemd marks the unit
// failed and `systemctl --failed` shows it. One alarm with two bells.
import 'dotenv/config';
import { pool } from '../src/db.js';
import { anchorHealth, anchorFault, DEFAULT_MAX_AGE_HOURS } from '../src/anchorHealth.js';
import { sendEmail } from '../src/email.js';

const maxAgeHours = Number(process.env.ANCHOR_MAX_AGE_HOURS || DEFAULT_MAX_AGE_HOURS);
const to = String(process.env.ADMIN_EMAIL || '').trim();

const { rows: [{ newest }] } = await pool.query(
  'SELECT max(anchor_date) AS newest FROM chain_anchors',
);
// Whether there is anything to anchor. A deployment set up this morning has
// never anchored and is not broken, and faulting it is how an operator
// learns to ignore this check on the first day they meet it.
const { rows: [{ n: reportCount }] } = await pool.query(
  'SELECT count(*)::int AS n FROM reports',
);

const health = anchorHealth(newest, { maxAgeHours });
const fault = anchorFault(health, { hasReports: reportCount > 0 });

if (!fault) {
  if (health.state === 'never') {
    console.log('anchor-watch: nothing anchored yet, and no reports to anchor. Fine.');
  } else {
    console.log(`anchor-watch: newest anchor ${health.newest}, ${health.ageHours}h old (stale after ${maxAgeHours}h). Fine.`);
  }
  await pool.end();
  process.exit(0);
}

console.error(`\n!! ${fault}\n`);
console.error('What to look at, in order:');
console.error('  systemctl list-timers reportlog-anchor.timer');
console.error('  journalctl -u reportlog-anchor -n 50');
console.error('  npm run anchor                 runs it now, in the foreground');
console.error('');

if (to) {
  // A failure to send must not swallow the exit code below: the point of
  // this script is that something notices, and systemd noticing is the
  // fallback for exactly the case where mail is the thing that is broken.
  await sendEmail({
    to: [{ email: to }],
    subject: health.state === 'never'
      ? 'ReportLog: nothing has ever been anchored'
      : `ReportLog: the archive has not been anchored for ${health.ageHours}h`,
    text: `${fault}\n\nWhat to look at, in order:\n`
      + '  systemctl list-timers reportlog-anchor.timer\n'
      + '  journalctl -u reportlog-anchor -n 50\n'
      + '  npm run anchor\n',
  }).catch((e) => {
    console.error(`!! and the alert email could not be sent either: ${String(e.message || e)}`);
  });
} else {
  console.error('!! ADMIN_EMAIL is not set, so no alert was emailed. Set it.');
}

await pool.end();
process.exit(1);
