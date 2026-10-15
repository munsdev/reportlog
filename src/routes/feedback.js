import express from 'express';
import rateLimit from 'express-rate-limit';
import { pool } from '../db.js';
import { normalizeEmail } from '../crypto.js';
import { requireAuth, requireRole } from '../authMiddleware.js';
import { sendEmail } from '../email.js';
import { APP_VERSION, RELEASE_VERSION } from '../appVersion.js';
import { newFeedbackHtml, feedbackStatusHtml } from '../feedbackTemplates.js';
import { asyncRoute } from '../asyncRoute.js';
import { hasAdminAuthority } from '../roleRank.js';
import {
  FEEDBACK_TYPES, FEEDBACK_SEVERITIES, FEEDBACK_STATUSES, OPEN_FEEDBACK_STATUSES,
  MAX_TITLE_LEN, MAX_BODY_LEN,
} from '../feedbackTaxonomy.js';

const router = express.Router();
router.use(requireAuth);

/**
 * The bug tracker is pre-release surface, gated on the tester flag rather
 * than on a role — an admin should be able to be a tester, so should a
 * coordinator, so should an ordinary user, and a role would force a choice
 * between someone's actual position and their tester access.
 *
 * It grants nothing but this. A tester sees the issue tracker and never a
 * report. That matters because this is the list most likely to be handled
 * casually — an address added during a demo and forgotten — so it is worth
 * it being structurally unable to expose anything else.
 */
function requireTester(req, res, next) {
  if (req.user.is_tester || hasAdminAuthority(req.user.role) || req.user.role === 'access_manager') return next();
  return res.status(403).json({ error: 'The issue tracker is open to testers.' });
}
router.use(requireTester);

/**
 * A name testers can recognise each other by, without publishing an
 * address list to everyone who gets a tester flag.
 *
 * Be clear about what this is: cosmetic, not anonymity. Any group that
 * already knows each other decodes every handle almost immediately, and
 * that is fine — recognition inside a small known group is the point.
 * It must not be mistaken later for a privacy guarantee, and anyone added
 * to the tester list should be someone the others would be comfortable
 * being identifiable to.
 */
function maskedHandle(email) {
  const [local, domain] = String(email || '').split('@');
  if (!local) return '—';
  const head = local.slice(0, Math.min(3, local.length));
  return `${head}${'*'.repeat(Math.max(2, local.length - head.length))}@${(domain || '').split('.')[0] || ''}`;
}

// Any logged-in user can file, so this is looser than the OTP limiters but
// still bounded — a stuck retry loop in the browser shouldn't be able to
// fill the queue.
const fileLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });

const FEEDBACK_COLUMNS = `id, submitter_email, type, severity, title, body,
  related_public_ref, context, status, created_at, status_changed_at`;

// Only the fields the form actually captures, each length-capped. The
// client is free to send anything; nothing else is stored, and appVersion
// is always the server's own build rather than whatever was posted.
function sanitizeContext(raw) {
  const c = raw && typeof raw === 'object' ? raw : {};
  const take = (v, n) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : undefined);
  const out = {
    tab: take(c.tab, 40),
    path: take(c.path, 200),
    viewport: take(c.viewport, 20),
    userAgent: take(c.userAgent, 400),
    // Both, deliberately: the release is what a tester will quote back at
    // you, the build id is what actually pins down the code.
    release: RELEASE_VERSION,
    appVersion: APP_VERSION,
  };
  Object.keys(out).forEach((k) => out[k] === undefined && delete out[k]);
  return out;
}

// One extra query rather than a join — an issue's timeline is small, and
// this keeps the row shape identical between the reporter's list and the
// admin queue.
async function attachEvents(rows) {
  if (!rows.length) return rows;
  const { rows: events } = await pool.query(
    `SELECT feedback_id, action, new_status, actor_email, note, created_at
     FROM feedback_events WHERE feedback_id = ANY($1::bigint[]) ORDER BY created_at`,
    [rows.map((r) => r.id)],
  );
  const byId = new Map(rows.map((r) => [String(r.id), { ...r, events: [] }]));
  events.forEach((e) => byId.get(String(e.feedback_id))?.events.push(e));
  return rows.map((r) => byId.get(String(r.id)));
}

router.post('/', fileLimiter, asyncRoute(async (req, res) => {
  const b = req.body || {};
  const errors = [];
  if (!FEEDBACK_TYPES.includes(b.type)) errors.push('type is invalid');
  if (!FEEDBACK_SEVERITIES.includes(b.severity)) errors.push('severity is invalid');

  const title = String(b.title || '').trim();
  const body = String(b.body || '').trim();
  if (title.length < 3) errors.push('title is too short');
  if (title.length > MAX_TITLE_LEN) errors.push('title is too long');
  if (body.length < 10) errors.push('please describe what happened in a bit more detail');
  if (body.length > MAX_BODY_LEN) errors.push('description is too long');
  if (errors.length) return res.status(400).json({ errors });

  const relatedRef = String(b.related_public_ref || '').trim().slice(0, 60) || null;

  const { rows } = await pool.query(
    `INSERT INTO feedback (submitter_email, type, severity, title, body, related_public_ref, context)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${FEEDBACK_COLUMNS}`,
    [req.user.email, b.type, b.severity, title, body, relatedRef, sanitizeContext(b.context)],
  );
  const fb = rows[0];

  await pool.query(
    "INSERT INTO feedback_events (feedback_id, action, actor_email) VALUES ($1, 'created', $2)",
    [fb.id, req.user.email],
  );

  // Fire-and-forget: a mail failure must never cost the tester their
  // report, since the row is already saved and the weekly digest will
  // surface it regardless.
  const adminEmail = normalizeEmail(process.env.ADMIN_EMAIL);
  if (adminEmail) {
    sendEmail({
      to: [{ email: adminEmail }],
      subject: `[feedback #${fb.id}] ${fb.severity}/${fb.type}: ${fb.title}`,
      html: newFeedbackHtml(fb),
    }).catch((e) => console.error('[feedback] new-issue notify failed', e));
  }

  res.status(201).json({ id: fb.id });
}));

router.get('/mine', asyncRoute(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT ${FEEDBACK_COLUMNS} FROM feedback WHERE submitter_email = $1 ORDER BY created_at DESC LIMIT 200`,
    [req.user.email],
  );
  res.json(await attachEvents(rows));
}));

// Defaults to everything, newest first — the same order the reporter's own
// list uses, so the two views agree. 'open' is still available as a
// pseudo-status covering everything needing action; the job of surfacing
// what's gone stale now belongs entirely to scripts/feedback-digest.js,
// which still sorts least-recently-touched first.
router.get('/queue', requireRole('admin'), asyncRoute(async (req, res) => {
  const filter = req.query.status || 'all';
  let where = '';
  let params = [];
  if (filter === 'open') {
    where = 'WHERE status = ANY($1)';
    params = [OPEN_FEEDBACK_STATUSES];
  } else if (FEEDBACK_STATUSES.includes(filter)) {
    where = 'WHERE status = $1';
    params = [filter];
  } else if (filter !== 'all') {
    return res.status(400).json({ error: 'unknown status filter' });
  }

  const { rows } = await pool.query(
    `SELECT ${FEEDBACK_COLUMNS} FROM feedback ${where}
     ORDER BY created_at DESC LIMIT 500`,
    params,
  );
  res.json(await attachEvents(rows));
}));

router.get('/counts', requireRole('admin'), asyncRoute(async (req, res) => {
  const { rows } = await pool.query('SELECT status, count(*)::int AS n FROM feedback GROUP BY status');
  const counts = Object.fromEntries(rows.map((r) => [r.status, r.n]));
  res.json({
    counts,
    open: OPEN_FEEDBACK_STATUSES.reduce((sum, s) => sum + (counts[s] || 0), 0),
    new: counts.new || 0,
  });
}));

// Always changeable, same as report moderation — an issue can go back to
// in_progress after being marked fixed. The note is required and is shown
// to the reporter and emailed to them; it is the reply channel, not a
// private audit comment.
router.post('/:id/status', requireRole('admin'), asyncRoute(async (req, res) => {
  const status = (req.body || {}).status;
  const note = String((req.body || {}).note || '').trim();
  if (!FEEDBACK_STATUSES.includes(status)) return res.status(400).json({ error: 'invalid status' });
  if (!note) return res.status(400).json({ error: 'A note is required — the reporter sees it' });

  const { rows } = await pool.query(
    `UPDATE feedback SET status = $1, status_changed_at = now() WHERE id = $2 RETURNING ${FEEDBACK_COLUMNS}`,
    [status, req.params.id],
  );
  const fb = rows[0];
  if (!fb) return res.status(404).json({ error: 'Not found' });

  await pool.query(
    `INSERT INTO feedback_events (feedback_id, action, new_status, actor_email, note)
     VALUES ($1, 'status_change', $2, $3, $4)`,
    [fb.id, status, req.user.email, note],
  );

  if (fb.submitter_email !== req.user.email) {
    sendEmail({
      to: [{ email: fb.submitter_email }],
      subject: `[feedback #${fb.id}] now ${status}: ${fb.title}`,
      html: feedbackStatusHtml(fb, status, note),
    }).catch((e) => console.error('[feedback] status notify failed', e));
  }

  res.json({ ok: true });
}));

/**
 * Every tester's reports, not only your own.
 *
 * Duplicates drop sharply when people can see what has already been filed,
 * and "seeing this too, on Firefox" is often the most useful line in a bug
 * report. Authors are shown as masked handles.
 */
router.get('/all', asyncRoute(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT ${FEEDBACK_COLUMNS}, (SELECT count(*)::int FROM feedback_comments c WHERE c.feedback_id = feedback.id) AS comment_count
     FROM feedback ORDER BY created_at DESC LIMIT 200`,
  );
  res.json(rows.map((r) => ({
    ...r,
    submitter_email: undefined,
    author: maskedHandle(r.submitter_email),
    mine: normalizeEmail(r.submitter_email) === normalizeEmail(req.user.email),
  })));
}));

router.get('/:id/comments', asyncRoute(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT author_email, body, created_at FROM feedback_comments WHERE feedback_id = $1 ORDER BY created_at',
    [Number(req.params.id)],
  );
  res.json(rows.map((c) => ({
    body: c.body,
    created_at: c.created_at,
    author: maskedHandle(c.author_email),
    mine: normalizeEmail(c.author_email) === normalizeEmail(req.user.email),
  })));
}));

// Append-only replies in order. No threading, no editing, no formatting —
// the least-specified part of the design, deliberately built as the
// smallest thing that answers "is anyone else seeing this".
router.post('/:id/comments', fileLimiter, asyncRoute(async (req, res) => {
  const body = String((req.body || {}).body || '').trim();
  if (!body) return res.status(400).json({ error: 'Write something first.' });
  if (body.length > MAX_BODY_LEN) return res.status(400).json({ error: 'Too long.' });
  const { rows } = await pool.query(
    `INSERT INTO feedback_comments (feedback_id, author_email, body) VALUES ($1, $2, $3)
     RETURNING created_at`,
    [Number(req.params.id), normalizeEmail(req.user.email), body],
  );
  res.status(201).json({ ok: true, created_at: rows[0].created_at });
}));

export default router;