import express from 'express';
import { pool } from '../db.js';
import { accessesForThreads } from '../accessLog.js';
import { hmacEmail } from '../crypto.js';
import { insertReportVersion, normalizeReportFields } from '../reportCore.js';
import { flagReport } from '../reviewFlags.js';
import { logbookById, fieldsFor } from '../logbooks.js';
import { ensureFormVersion } from '../logbookForms.js';
import { buildAnswers } from '../answers.js';
import { requireAuth } from '../authMiddleware.js';
import { OWNER_HMAC, isErasable, eraseContact } from '../contactKeys.js';
import {
  PERMISSIONS, ATTACHMENT_PUBLICATION, isPermission, setPermission,
  permissionsForMany, fromMap, permissionHistory,
} from '../reportPermissions.js';
import { withdrawPublishedAttachments } from '../renditions.js';
import {
  attachmentColumns, attachmentsOfReport, linkAttachments, manifestFromRows,
} from '../attachments.js';
import { asyncRoute } from '../asyncRoute.js';

const router = express.Router();
router.use(requireAuth);

router.get('/reports', asyncRoute(async (req, res) => {
  const emailHmac = hmacEmail(req.user.email);
  const { rows } = await pool.query(
    `SELECT r.public_ref AS id, r.received_at, r.recipe, r.answers, r.thread_id, r.chain_hash, r.may_publish,
            h.withdrawn, h.moderation_status,
            lb.slug AS logbook_slug, lb.title AS logbook_title,
            coalesce(rr.key_scheme = 'thread', false) AS erasable
            ${attachmentColumns()}
     FROM reports_restricted rr
     JOIN report_heads h ON h.thread_id = rr.thread_id
     JOIN reports r ON r.id = h.current_report_id
     JOIN logbooks lb ON lb.id = r.logbook_id
     LEFT JOIN contact_keys ck ON ck.thread_id = rr.thread_id
     WHERE ${OWNER_HMAC} = $1
     ORDER BY r.received_at DESC`,
    [emailHmac],
  );
  // One query for every card rather than one per card: a reporter with
  // thirty reports is the case a list view gets slow in quietly.
  const perms = await permissionsForMany(rows.map((r) => r.thread_id));
  res.json(rows.map((r) => ({ ...r, permissions: fromMap(perms, r.thread_id) })));
}));

/**
 * The two permissions a reporter can give and take back, and their history.
 *
 * SEPARATE FROM EVERYTHING SEALED. `may_publish` is the answer they gave at
 * filing and is inside the report's fingerprint; it is not touched here and
 * cannot be. These two are ongoing permissions — see
 * `src/reportPermissions.js` and `migrations/030_report_permissions.sql`.
 */
router.get('/reports/:threadId/permissions', asyncRoute(async (req, res) => {
  const head = await loadOwnedThread(req.params.threadId, hmacEmail(req.user.email));
  if (!head) return res.status(404).json({ error: 'Not found' });
  const map = await permissionsForMany([head.thread_id]);
  res.json({
    permissions: fromMap(map, head.thread_id),
    history: await permissionHistory(head.thread_id),
  });
}));

/**
 * Give or take back one permission.
 *
 * REPORTER-INITIATED, ALWAYS. There is no moderator route that writes this
 * log: a moderator granting a permission on somebody's behalf would record
 * the operator's decision under the reporter's name. The table's own CHECK
 * constraint says `actor = 'reporter'` so that the rule does not depend on
 * every future route remembering it.
 *
 * No reason is required. Withdrawing a report demands one because a
 * moderator has to understand a gap in the record; taking back a permission
 * over your own contact details or your own photographs is nobody's business
 * to justify. The field is accepted if offered and logged.
 */
router.post('/reports/:threadId/permissions', asyncRoute(async (req, res) => {
  const body = req.body || {};
  const permission = String(body.permission || '');
  if (!isPermission(permission)) {
    return res.status(400).json({ error: `permission must be one of ${PERMISSIONS.join(', ')}` });
  }
  if (typeof body.granted !== 'boolean') {
    return res.status(400).json({ error: 'granted must be true or false' });
  }
  const reason = String(body.reason || '').trim() || null;

  const head = await loadOwnedThread(req.params.threadId, hmacEmail(req.user.email));
  if (!head) return res.status(404).json({ error: 'Not found' });

  await setPermission({
    threadId: head.thread_id,
    permission,
    granted: body.granted,
    actorEmail: await logActor(head.thread_id, req.user.email),
    reason,
  });

  // Taking back the attachment permission takes the files down with it, or
  // the switch is decoration. Published means the rendition is in a public
  // bucket, so this is storage work and not a flag: see
  // withdrawPublishedAttachments. A moderator can publish again if the
  // reporter grants it again.
  let withdrawn = 0;
  if (permission === ATTACHMENT_PUBLICATION && body.granted === false) {
    withdrawn = await withdrawPublishedAttachments(head.thread_id);
  }

  const map = await permissionsForMany([head.thread_id]);
  res.json({ ok: true, permissions: fromMap(map, head.thread_id), filesWithdrawn: withdrawn });
}));

/**
 * Every time a human opened something protected on one of your reports.
 *
 * Scoped to threads this account actually owns, by the same contact-email
 * HMAC the reports list uses — there is no path here to anyone else's
 * history.
 *
 * It never says who. Naming the moderator would expose a volunteer to a
 * reporter unhappy with a decision, and the accountability this page exists
 * to provide does not require a name: what a reporter needs is that it
 * happened, when, and the reason the person gave. The reason is the part
 * they can actually judge.
 */
router.get('/access-log', asyncRoute(async (req, res) => {
  const emailHmac = hmacEmail(req.user.email);
  const { rows: mine } = await pool.query(
    `SELECT h.thread_id, r.public_ref
     FROM reports_restricted rr
     JOIN report_heads h ON h.thread_id = rr.thread_id
     JOIN reports r ON r.id = h.current_report_id
     LEFT JOIN contact_keys ck ON ck.thread_id = rr.thread_id
     WHERE ${OWNER_HMAC} = $1`,
    [emailHmac],
  );
  if (!mine.length) return res.json([]);

  const refByThread = new Map(mine.map((m) => [m.thread_id, m.public_ref]));
  const entries = await accessesForThreads(mine.map((m) => m.thread_id));

  res.json(entries.map((e) => ({
    report: refByThread.get(e.thread_id) || null,
    kind: e.kind,
    // Null on anything recorded before reasons were required. Sent through
    // as null rather than as a placeholder sentence, so the page can say
    // plainly that the entry predates the requirement instead of implying
    // somebody declined to give one.
    reason: e.reason,
    at: e.accessed_at,
  })));
}));

/**
 * Who a reporter's own action is logged as. On a thread whose contact
 * details can be erased, NOT their address: self_service_log is append-only,
 * so an address written there would outlive the erasure it was meant to
 * honour. The thread already says whose report it is; the log shows "the
 * reporter". Older threads log the address, as they always have.
 */
async function logActor(threadId, email) {
  return (await isErasable(threadId)) ? null : email;
}

async function loadOwnedThread(threadId, emailHmac) {
  const { rows } = await pool.query(
    `SELECT h.thread_id, h.current_report_id
     FROM report_heads h JOIN reports_restricted rr ON rr.thread_id = h.thread_id
     LEFT JOIN contact_keys ck ON ck.thread_id = rr.thread_id
     WHERE h.thread_id = $1 AND ${OWNER_HMAC} = $2`,
    [threadId, emailHmac],
  );
  return rows[0] || null;
}

router.post('/reports/:threadId/correct', asyncRoute(async (req, res) => {
  const head = await loadOwnedThread(req.params.threadId, hmacEmail(req.user.email));
  if (!head) return res.status(404).json({ error: 'Not found' });

  const b = req.body || {};

  // A CORRECTION IS THE SAME LOGBOOK'S QUESTIONS, ANSWERED AGAIN, checked
  // exactly as a new report is — against the questions as they are now,
  // which may include an optional one added since it was filed. It stays in
  // its logbook and its logbook's chain; a report never moves between them.
  const { rows: prior } = await pool.query(
    'SELECT logbook_id, may_publish, may_publish_digest FROM reports WHERE id = $1',
    [head.current_report_id],
  );
  const priorRow = prior[0];
  const lb = await logbookById(priorRow.logbook_id);
  const questions = await fieldsFor(lb.id);
  const { answers, errors } = buildAnswers(questions, b.answers || {});
  const comment = String(b.comment || '').trim();
  if (!comment) errors.push('a reason for this correction is required');
  if (errors.length) return res.status(400).json({ errors });

  // A correction is a new hashed object, so it CAN carry a different
  // publication answer. Whether it may is the rule below.
  //
  // Tightening is allowed: true to false is the reporter changing their own
  // mind, and it is the humane part of an archive that cannot unpublish.
  //
  // Loosening is refused. A route where anyone with access to an account
  // turns "do not publish" into "publish" would manufacture a permission
  // the report's author never gave.
  //
  // A correction that says nothing about publication carries the head's
  // answer forward, with the wording it was given under.
  const asked = b.may_publish === true || b.may_publish === false;
  if (asked && b.may_publish === true && priorRow.may_publish !== true) {
    return res.status(400).json({
      errors: ['a correction cannot grant permission to publish that the report did not already have'],
    });
  }
  const fields = normalizeReportFields({
    logbook: lb.slug,
    answers,
    may_publish: asked ? b.may_publish : priorRow.may_publish,
    may_publish_digest: priorRow.may_publish_digest,
  });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // The version of the questions the corrected answers were checked
    // against — which may be newer than the one the original was filed under.
    const form = await ensureFormVersion(lb, questions, client);

    // THE FILES COME WITH IT. A correction is a new version of the same
    // report, so it commits to the same photographs unless somebody says
    // otherwise — and before migration 033 it committed to none of them:
    // the new version's hashed object carried no `attachments` key, every
    // file read joined against the new version and found nothing, and a
    // reporter fixing a typo in their own account lost their video.
    // Silently, and verifying cleanly, which is why no suite caught it.
    //
    // Read from the archive rather than from the request. What a version
    // inherits is a fact about the version before it, and a client has no
    // business naming it.
    const inherited = await attachmentsOfReport(client, head.current_report_id);

    const report = await insertReportVersion(client, {
      threadId: head.thread_id,
      correctsId: head.current_report_id,
      fields,
      // Exactly the files the version being corrected held, in the same
      // order, so a correction that changes only wording leaves the
      // `attachments` key byte-identical to the one before it.
      attachmentManifest: inherited.length ? manifestFromRows(inherited) : null,
      logbookId: lb.id,
      formId: form.id,
    });

    // A CORRECTION GETS ITS OWN LOOK. Text that was unremarkable in the
    // original and alarming in the correction must not pass because the
    // thread had already been seen — so this runs per version, not per
    // thread, and re-raises the marker the moderator may have cleared.
    await flagReport(client, {
      reportId: report.id,
      threadId: head.thread_id,
      logbookId: lb.id,
      answers: report.answers,
    });

    // After the insert, because the links point at a row id that does not
    // exist until the version is written — and inside the same transaction,
    // so a version and the files it commits to become visible together or
    // not at all.
    if (inherited.length) {
      await linkAttachments(client, {
        reportId: report.id,
        attachmentIds: inherited.map((a) => a.id),
      });
    }
    // Content changed — needs re-review before it counts as approved
    // again, even if it was previously valid and public.
    await client.query(
      "UPDATE report_heads SET current_report_id = $1, moderation_status = 'pending', updated_at = now() WHERE thread_id = $2",
      [report.id, head.thread_id],
    );
    await client.query(
      "INSERT INTO self_service_log (thread_id, action, actor_email, comment) VALUES ($1, 'correct', $2, $3)",
      [head.thread_id, await logActor(head.thread_id, req.user.email), comment],
    );
    await client.query('COMMIT');
    res.json({ id: report.public_ref, chain_hash: report.chain_hash });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[me] correction failed', e);
    res.status(500).json({ error: 'Correction failed' });
  } finally {
    client.release();
  }
}));

/**
 * Erase this report's contact details, and withdraw it.
 *
 * Asked for together, done together, in one transaction. The report itself
 * stays in the archive, sealed and verifiable — it never held the address.
 * What goes: the key the address, organization and observer ID were
 * encrypted under, the address's digest that linked the report to this
 * account, and the confirmation-link rows that held the address in the
 * clear. After this the reporter will not find the report under My Reports,
 * and a moderator opening its restricted details is told they were erased.
 *
 * Reports filed before erasable keys existed are refused with a reason:
 * their details are under the master key in an append-only table.
 */
router.post('/reports/:threadId/erase', asyncRoute(async (req, res) => {
  const head = await loadOwnedThread(req.params.threadId, hmacEmail(req.user.email));
  if (!head) return res.status(404).json({ error: 'Not found' });
  if ((req.body || {}).confirm !== true) {
    return res.status(400).json({ error: 'Confirm that you want your contact details erased.' });
  }
  if (!(await isErasable(head.thread_id))) {
    return res.status(409).json({
      error: 'This report was filed before contact details could be erased, so they cannot be. '
        + 'You can still withdraw it.',
    });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'UPDATE report_heads SET withdrawn = true, updated_at = now() WHERE thread_id = $1',
      [head.thread_id],
    );
    await eraseContact(client, head.thread_id);
    await client.query(
      `INSERT INTO self_service_log (thread_id, action, actor_email, comment)
       VALUES ($1, 'erase', NULL, 'Withdrawn, and contact details erased, at the reporter''s request')`,
      [head.thread_id],
    );
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}));

router.post('/reports/:threadId/withdraw', asyncRoute(async (req, res) => {
  const comment = String((req.body || {}).comment || '').trim();
  if (!comment) return res.status(400).json({ error: 'A reason is required' });

  const head = await loadOwnedThread(req.params.threadId, hmacEmail(req.user.email));
  if (!head) return res.status(404).json({ error: 'Not found' });

  await pool.query(
    'UPDATE report_heads SET withdrawn = true, updated_at = now() WHERE thread_id = $1',
    [head.thread_id],
  );
  await pool.query(
    "INSERT INTO self_service_log (thread_id, action, actor_email, comment) VALUES ($1, 'withdraw', $2, $3)",
    [head.thread_id, await logActor(head.thread_id, req.user.email), comment],
  );
  res.json({ ok: true });
}));

router.get('/notifications', asyncRoute(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT notify_mode, notify_logbooks FROM users WHERE email = $1',
    [req.user.email],
  );
  res.json(rows[0]);
}));

/**
 * How often to hear about new published reports, and from which logbooks.
 * An empty or absent list means every logbook. Only launched logbooks can be
 * followed: a draft has never been public, and naming one here would be a
 * way to learn that it exists.
 */
router.post('/notifications', asyncRoute(async (req, res) => {
  const b = req.body || {};
  const mode = b.notify_mode;
  if (!['none', 'weekly', 'hourly'].includes(mode)) return res.status(400).json({ error: 'invalid notify_mode' });

  let logbooks = null;
  if (Array.isArray(b.notify_logbooks) && b.notify_logbooks.length) {
    const wanted = [...new Set(b.notify_logbooks.map(String))];
    const { rows } = await pool.query(
      'SELECT slug FROM logbooks WHERE launched_at IS NOT NULL AND slug = ANY($1::text[])',
      [wanted],
    );
    if (rows.length !== wanted.length) {
      return res.status(400).json({ error: 'one of those is not a logbook you can follow' });
    }
    logbooks = wanted;
  }

  await pool.query(
    `UPDATE users SET notify_mode = $1, notify_logbooks = $2, updated_at = now()
     WHERE email = $3`,
    [mode, logbooks, req.user.email],
  );
  res.json({ ok: true });
}));

export default router;
