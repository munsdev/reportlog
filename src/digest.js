/**
 * The hourly and weekly email digests: new published reports since each
 * subscriber's last send, in one email.
 *
 * PEOPLE FOLLOW LOGBOOKS. A subscriber's `notify_logbooks` is a list of
 * slugs, or NULL for every logbook. There is no built-in "state" to follow
 * any more — a state is a question some logbook asks.
 *
 * ONLY WHAT THE BOARD WOULD SHOW. A subscriber is a member of the public, so
 * a digest carries exactly what the public board carries and nothing more:
 * approved, not withdrawn, the reporter PERMITTED publication, and this site
 * publishes an archive at all. The digest used to check only the first two,
 * and so emailed reports whose reporters had said no.
 */
import { pool } from './db.js';
import { sendEmail } from './email.js';
import { batchReportsHtml } from './notifyTemplates.js';
import { publicArchiveAvailable } from './publication.js';
import { fieldsFor } from './logbooks.js';

export async function runDigest({ mode, windowMs, subject, intro }) {
  if (!await publicArchiveAvailable()) {
    console.log(`${mode}-notify: this site publishes nothing, so there is nothing to send.`);
    return 0;
  }
  const { rows: users } = await pool.query(
    'SELECT email, notify_logbooks, last_notified_at FROM users WHERE notify_mode = $1',
    [mode],
  );
  const questions = new Map();
  for (const user of users) {
    const since = user.last_notified_at || new Date(Date.now() - windowMs).toISOString();
    const { rows: reports } = await pool.query(
      `SELECT r.public_ref, r.answers, r.logbook_id, lb.slug AS logbook_slug, lb.title AS logbook_title
       FROM report_heads h
       JOIN reports r ON r.id = h.current_report_id
       JOIN logbooks lb ON lb.id = r.logbook_id
       WHERE h.withdrawn = false AND h.moderation_status = 'valid' AND r.may_publish = true
         AND h.updated_at > $1
         AND ($2::text[] IS NULL OR lb.slug = ANY($2::text[]))
       ORDER BY r.received_at`,
      [since, user.notify_logbooks],
    );
    for (const r of reports) {
      if (!questions.has(r.logbook_id)) questions.set(r.logbook_id, await fieldsFor(r.logbook_id));
      r.questions = questions.get(r.logbook_id);
    }
    if (reports.length) {
      await sendEmail({
        to: [{ email: user.email }],
        subject: subject(reports.length),
        html: batchReportsHtml(reports, intro(reports.length)),
      });
    }
    await pool.query('UPDATE users SET last_notified_at = now() WHERE email = $1', [user.email]);
  }
  return users.length;
}
