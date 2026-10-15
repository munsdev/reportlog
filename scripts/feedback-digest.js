// Run weekly via cron. With no external tracker there is nothing else
// nagging about issues that were filed and then quietly forgotten, so this
// is the backstop: every open issue, oldest-untouched first, with anything
// past STALE_DAYS called out. Sends to ADMIN_EMAIL only.
import 'dotenv/config';
import { pool } from '../src/db.js';
import { sendEmail } from '../src/email.js';
import { normalizeEmail } from '../src/crypto.js';
import { staleDigestHtml } from '../src/feedbackTemplates.js';
import { OPEN_FEEDBACK_STATUSES } from '../src/feedbackTaxonomy.js';

const STALE_DAYS = Number(process.env.FEEDBACK_STALE_DAYS || 7);

const adminEmail = normalizeEmail(process.env.ADMIN_EMAIL);
if (!adminEmail) {
  console.log('feedback-digest: no ADMIN_EMAIL set, nothing to send.');
  await pool.end();
  process.exit(0);
}

// Ordered by status_changed_at, not created_at: an issue filed months ago
// but moved yesterday isn't the one at risk of being forgotten.
const { rows } = await pool.query(
  `SELECT id, submitter_email, type, severity, title, status,
          floor(extract(epoch FROM now() - status_changed_at) / 86400)::int AS days_untouched
   FROM feedback WHERE status = ANY($1)
   ORDER BY status_changed_at ASC`,
  [OPEN_FEEDBACK_STATUSES],
);

if (!rows.length) {
  console.log('feedback-digest: no open issues.');
  await pool.end();
  process.exit(0);
}

const staleCount = rows.filter((r) => r.days_untouched >= STALE_DAYS).length;
await sendEmail({
  to: [{ email: adminEmail }],
  subject: `Feedback: ${rows.length} open${staleCount ? `, ${staleCount} stale` : ''}`,
  html: staleDigestHtml(rows, STALE_DAYS),
});

console.log(`feedback-digest: ${rows.length} open issue(s), ${staleCount} stale.`);
await pool.end();
