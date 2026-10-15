/**
 * The door a reporter answers an evidence request through.
 *
 * UNAUTHENTICATED ON PURPOSE, AND NARROW BECAUSE OF IT. Somebody asked for
 * photographs months after filing may no longer have the sign-in link, and
 * a request they cannot answer is a request not worth making. So the token
 * stands on its own — which is exactly why what it may do is so small:
 *
 *   it says what was asked, and which report it is about
 *   it stages files against that ONE thread
 *   it commits them as a new version of that report
 *
 * It cannot change an answer, withdraw a report, read anybody's contact
 * details, see a moderator's name, or be pointed at another thread. There
 * is no route here that reads a report's text back, because a guessed token
 * must not become a way to read somebody's account.
 *
 * EVERY GATE IS CHECKED ON EVERY REQUEST, including the reporter's own
 * permission, which is read now rather than trusted from when the link was
 * minted. src/evidenceRequests.js says why at length.
 *
 * WHAT THE REPORTER SENDS IS HASHED. It arrives as a new version through
 * the same append-only path a correction takes, carrying the files the
 * previous version had plus the new ones, so the archive's record of what
 * this report commits to is complete at every version.
 */
import express from 'express';
import crypto from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { pool } from '../db.js';
import { asyncRoute } from '../asyncRoute.js';
import { attachEvidence, markLanded, markUsed, redeem } from '../evidenceRequests.js';
import {
  attachmentsEnabled, capsFor, clearedSlotsFor, createUploadSlot,
} from '../attachments.js';
import { flagReport } from '../reviewFlags.js';

const router = express.Router();

// Tighter than the filing limiter. This is a door anybody holding a string
// can knock on, and the only legitimate traffic is one person answering one
// mail.
const openLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30 });
const sendLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 });

/**
 * The staging key for a request's uploads.
 *
 * DERIVED, NOT THE REQUEST TOKEN ITSELF. Reusing the token as the draft
 * token would write a working link into `upload_slots.draft_token` in the
 * clear, which is the whole thing `evidence_requests.token_hash` exists to
 * avoid. This is a one-way function of it: stable across page reloads, so
 * no extra state is needed, and useless to anybody who reads the slots
 * table — staging a file is not submitting one, and submitting needs the
 * token.
 */
function draftTokenFor(token) {
  return crypto.createHash('sha256').update(`${token}:evidence-upload`, 'utf8')
    .digest('hex').slice(0, 48);
}

/**
 * WHAT A STRANGER IS TOLD. Several different refusals collapse into one
 * sentence on purpose: "expired", "already used" and "withdrawn" are all
 * just "this is no longer open" to somebody holding a stale mail, and
 * telling them apart would let anybody with a guessed token learn that a
 * report exists and something about its state.
 *
 * The two that are said plainly are the two the reporter can act on.
 */
const CLOSED = 'This link is no longer open. If you still have something to send, '
  + 'the people reviewing your report can send you a new one.';

const REASONS = {
  'bad-token': CLOSED,
  'not-found': CLOSED,
  used: CLOSED,
  cancelled: CLOSED,
  expired: CLOSED,
  'report-withdrawn': CLOSED,
  // Said plainly, because it is the reporter's own switch and they can turn
  // it back on. Telling them "no longer open" here would be misleading
  // about something they control.
  'permission-withdrawn': 'You have switched off being asked for evidence, so this '
    + 'link no longer works. You can switch it back on from your own page, and then '
    + 'ask for a new link.',
};

const refuse = (res, reason) => res.status(410).json({ error: REASONS[reason] || CLOSED });

/**
 * What am I being asked for?
 *
 * Carries the moderator's own words and the report's public reference —
 * which the reporter already has, from their own confirmation mail — and
 * nothing else about the report.
 */
router.get('/:token', openLimiter, asyncRoute(async (req, res) => {
  const out = await redeem(req.params.token);
  if (!out.ok) return refuse(res, out.reason);
  const r = out.request;

  const caps = await capsFor(r.logbookId);
  res.json({
    ok: true,
    message: r.message,
    askedAt: r.askedAt,
    expiresAt: r.expiresAt,
    publicRef: r.publicRef,
    logbookTitle: r.logbookTitle,
    // Whether this deployment can take a file at all. A page offering an
    // upload box where storage is not configured is a box that fails.
    uploads: attachmentsEnabled(),
    maxFiles: caps.maxFiles,
    maxTotalBytes: caps.maxTotalBytes,
    // The draft the client stages into. Derived from the token it already
    // holds, so this tells it nothing it did not have.
    draftToken: draftTokenFor(req.params.token),
  });
}));

/**
 * Stage one file.
 *
 * The same slot machinery filing uses, with the logbook decided HERE from
 * the thread rather than named by the client — so the per-logbook cap that
 * applies is the one belonging to the report actually being added to.
 */
router.post('/:token/slots', sendLimiter, asyncRoute(async (req, res) => {
  const out = await redeem(req.params.token);
  if (!out.ok) return refuse(res, out.reason);
  if (!attachmentsEnabled()) {
    return res.status(409).json({ error: 'This deployment is not accepting files at the moment.' });
  }
  const b = req.body || {};
  const slot = await createUploadSlot(draftTokenFor(req.params.token), {
    name: b.name,
    type: b.type,
    size: b.size,
    logbookId: out.request.logbookId,
    evidenceRequestId: out.request.id,
  });
  res.status(201).json(slot);
}));

/**
 * Send them.
 *
 * A NEW VERSION OF THE REPORT, not an edit of the old one: `reports` is
 * append-only, and the files a version commits to are in its hashed
 * manifest. So this is the correction path with the answers carried
 * forward byte-for-byte — the reporter was asked for files, not invited to
 * revise their account, and this route cannot change a word of it.
 */
router.post('/:token/submit', sendLimiter, asyncRoute(async (req, res) => {
  const out = await redeem(req.params.token);
  if (!out.ok) return refuse(res, out.reason);
  const r = out.request;

  const draft = draftTokenFor(req.params.token);
  const slots = attachmentsEnabled() ? await clearedSlotsFor(draft) : [];
  if (!slots.length) {
    return res.status(400).json({
      error: 'Nothing has finished uploading yet, so there is nothing to send.',
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // SPEND THE LINK FIRST, conditionally. Two clicks arriving together
    // both pass `redeem`; only one can win this UPDATE, and the loser
    // rolls back having created nothing. Doing it last would let both
    // create a version.
    if (!await markUsed(client, { requestId: r.id, reportId: r.currentReportId })) {
      await client.query('ROLLBACK');
      return refuse(res, 'used');
    }

    const done = await attachEvidence(client, { threadId: r.threadId, slots });
    if (!done.ok) {
      await client.query('ROLLBACK');
      return refuse(res, done.reason === 'no-report' ? 'not-found' : done.reason);
    }
    // Now that the version exists, point the spent request at it rather
    // than at the one that was current when the link was spent.
    await markLanded(client, { requestId: r.id, reportId: done.report.id });

    // The new version's text is the old version's, so nothing new can trip
    // a keyword — but the flag is per version, and a version with no flag
    // row would read as one nobody has looked at. Run for consistency
    // rather than for discovery.
    await flagReport(client, {
      reportId: done.report.id,
      threadId: r.threadId,
      logbookId: done.report.logbook_id,
      answers: done.report.answers,
    });

    await client.query('COMMIT');
    res.status(201).json({ ok: true, attached: slots.length, publicRef: done.report.public_ref });
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}));

export default router;
