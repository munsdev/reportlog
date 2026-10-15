import express from 'express';
import { pool } from '../db.js';
import {
  recordAccess, grantOriginalView, redeemGrant, sweepGrants, validateReason,
  recentAccesses, KINDS,
} from '../accessLog.js';
import { normalizeSearch, searchClause, sortDirection } from '../reportSearch.js';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import {
  decryptField, decryptBuffer, unwrapDek, createDecryptStream, PACKED_HEADER_BYTES,
} from '../crypto.js';
import { getObject, putObject, deleteObject, getStream, storageConfig, randomKey } from '../storage.js';
import {
  permissionsFor, permissionsForMany, fromMap,
  ATTACHMENT_PUBLICATION, CONTACT_PASSING, EVIDENCE_REQUEST,
} from '../reportPermissions.js';
import { declaredEvidence, describedEvidence } from '../evidence.js';
import { fieldsFor } from '../logbooks.js';
import { attachmentsEnabled, attachmentColumns } from '../attachments.js';
import { dropRendition } from '../renditions.js';
import { forget } from '../mediaCache.js';
import { requireRole } from '../authMiddleware.js';
import { openRestricted } from '../contactKeys.js';
import {
  noteFor, versionsFor, writeNote, setState, addLink, removeLink, linksFor, STATES,
} from '../editorialNotes.js';
import { SEVERITIES } from '../taxonomy.js';
import { clearFlag } from '../reviewFlags.js';
import {
  MESSAGE_MAX, MESSAGE_MIN, askableState, cancelRequest, createRequest,
  openRequestFor, requestHistory,
} from '../evidenceRequests.js';
import { sendEmail } from '../email.js';
import { SITE_ORIGIN } from '../siteOrigin.js';
import crypto from 'node:crypto';
import { asyncRoute } from '../asyncRoute.js';

const router = express.Router();
router.use(requireRole(['moderator', 'admin']));

const REPORT_COLUMNS = `
  r.public_ref AS id, r.thread_id, r.received_at, r.recipe,
  r.third_party, r.filed_via, r.intake_method, r.collected_on, r.source_ref,
  r.answers, r.may_publish, r.chain_hash,
  (SELECT lb.slug  FROM logbooks lb WHERE lb.id = r.logbook_id) AS logbook_slug,
  (SELECT lb.title FROM logbooks lb WHERE lb.id = r.logbook_id) AS logbook_title,
  -- Whether this logbook uses editorial notes, so the card knows whether to
  -- offer the control. A button whose route answers 409 is worse than no
  -- button, and the operator turned the feature off for a reason.
  (SELECT lb.editorial_notes_enabled FROM logbooks lb WHERE lb.id = r.logbook_id)
    AS editorial_notes_enabled,
  -- Whether there IS one, so the button reads "Write" or "Revise". Not the
  -- note itself: a list view does not need the body, and the modal fetches
  -- the full thing including its history when it opens.
  EXISTS (SELECT 1 FROM editorial_notes n WHERE n.thread_id = h.thread_id) AS editorial_note,
  h.assessed_severity AS severity,
  h.moderation_status, h.withdrawn, h.incident_id,
  -- WHETHER THIS ONE ASKS FOR A SECOND READ, and which words asked. The
  -- terms rather than a boolean, because a moderator who can see that
  -- something fired but not WHAT fired has to repeat the triage from
  -- scratch — which is most of the work the flag was meant to save.
  --
  -- A QUEUE MARKER AND NOTHING ELSE: not a severity, not a finding, and
  -- nothing about anybody named in the report.
  h.needs_review,
  (SELECT f.terms FROM report_review_flags f
    WHERE f.report_id = h.current_report_id) AS review_terms,
  -- WHETHER A REQUEST IS OPEN, so the card can offer "withdraw" rather than
  -- a second "ask" that the one-live-request index would refuse.
  --
  -- The declaration and the permission are NOT selected here: both need the
  -- logbook's questions to read, and a list query cannot join a form
  -- definition per row. The list route fills them in afterwards.
  (SELECT to_jsonb(e) FROM (
     SELECT e2.asked_by, e2.asked_at, e2.expires_at
       FROM evidence_requests e2
      WHERE e2.thread_id = h.thread_id AND e2.used_at IS NULL
        AND e2.cancelled_at IS NULL AND e2.expires_at > now()
   ) e) AS evidence_open,
  -- How many *published* accounts describe this same incident. Counting
  -- only published ones keeps the number the moderator sees identical to
  -- the number a reader sees, so there is no private inflated figure.
  (SELECT count(*) FROM report_heads h2
    WHERE h2.incident_id = h.incident_id AND h.incident_id IS NOT NULL
      AND h2.withdrawn = false AND h2.moderation_status = 'valid'
      AND EXISTS (SELECT 1 FROM reports r2 WHERE r2.id = h2.current_report_id
                  AND r2.may_publish = true))::int AS corroboration_count`;

// Gated the same way the public board's are, so a queue query is
// byte-identical to today's while the feature is off.
const reportColumns = () => REPORT_COLUMNS + attachmentColumns();

// 'all' means literally everything, withdrawn included — it's the default
// now, because a moderator opening this page wants the whole picture, not
// a pre-narrowed slice. 'withdrawn' stays a pseudo-status (everything
// currently withdrawn regardless of its moderation_status); the other four
// filter on moderation_status among non-withdrawn rows.
const VALID_STATUS_FILTERS = ['all', 'pending', 'valid', 'invalid', 'unknown', 'withdrawn'];

// THE SECOND-READ QUEUE, as its own filter rather than a sixth status. A
// flag is orthogonal to moderation: a report can be flagged and pending,
// flagged and already published, or published and never flagged. Folding it
// into moderation_status would make it look like a verdict, which is the
// one thing it must never look like.
const needsReviewOnly = (v) => v === 'true' || v === '1';

// Default view is 'pending' — the queue moderators actually need to act
// on. 'withdrawn' is a pseudo-status: everything currently withdrawn,
// regardless of what its moderation_status was before withdrawal.
router.get('/reports', asyncRoute(async (req, res) => {
  const status = VALID_STATUS_FILTERS.includes(req.query.status) ? req.query.status : 'all';
  const clauses = [];
  const params = [];
  if (status === 'withdrawn') {
    clauses.push('h.withdrawn = true');
  } else if (status !== 'all') {
    clauses.push('h.withdrawn = false');
    params.push(status);
    clauses.push(`h.moderation_status = $${params.length}`);
  }
  // Unlike the public board, a moderator's search deliberately spans every
  // moderation status — finding the pending and invalid ones is most of
  // the point. Tier B is still not searchable from here; identity stays
  // behind the access_log-audited restricted endpoint.
  const q = normalizeSearch(req.query.q);
  if (q) {
    params.push(q);
    clauses.push(searchClause(params.length));
  }
  if (needsReviewOnly(req.query.flagged)) clauses.push('h.needs_review = true');
  // Which logbook, by slug. There is no built-in date filter: a date is a
  // question a logbook asks.
  if (req.query.logbook) {
    params.push(String(req.query.logbook));
    clauses.push(`r.logbook_id = (SELECT id FROM logbooks WHERE slug = $${params.length})`);
  }

  const { rows } = await pool.query(
    `SELECT ${reportColumns()}
     FROM report_heads h JOIN reports r ON r.id = h.current_report_id
     ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
     ORDER BY r.received_at ${sortDirection(req.query.sort)} LIMIT 500`,
    params,
  );

  /* WHAT EACH REPORT SAID IT HAD, and whether it may be asked for.
     Filled in here rather than in the query because both need the
     LOGBOOK'S QUESTIONS to read: the declaration is found by field kind,
     not by a column, and the description is found by reading which question
     is conditional on it. One fields read per logbook on the page and one
     permissions read for the lot, rather than a join per row. */
  const byLogbook = new Map();
  for (const row of rows) {
    if (!row.logbook_slug) continue;
    if (!byLogbook.has(row.logbook_slug)) {
      const { rows: lb } = await pool.query('SELECT id FROM logbooks WHERE slug = $1',
        [row.logbook_slug]);
      byLogbook.set(row.logbook_slug, lb[0] ? await fieldsFor(lb[0].id) : []);
    }
  }
  const perms = await permissionsForMany(rows.map((r) => r.thread_id));
  for (const row of rows) {
    const fields = byLogbook.get(row.logbook_slug) || [];
    row.evidence_declared = declaredEvidence(row.answers, fields);
    row.evidence_described = row.evidence_declared
      ? describedEvidence(row.answers, fields) : [];
    row.evidence_permitted = fromMap(perms, row.thread_id)[EVIDENCE_REQUEST] === true;
    // Both halves, because asking somebody who never said they had anything
    // is a cold call and asking without permission is not permitted at all.
    row.evidence_askable = row.evidence_declared && row.evidence_permitted;
  }
  res.json(rows);
}));

// A POST, not a GET, because opening this requires a written reason and a
// reason does not belong in a URL — it would end up in the server's access
// log, the browser's history and any referrer header, and it may name a
// person. The method change also means no identity panel can be opened by
// a link, a prefetch or a stray page load.
router.post('/reports/:publicRef/restricted', asyncRoute(async (req, res) => {
  const reasonError = validateReason(req.body?.reason);
  if (reasonError) return res.status(400).json({ error: reasonError });

  const { rows } = await pool.query(
    `SELECT r.id, r.thread_id, rr.thread_id AS rr_thread, rr.key_scheme,
            rr.observer_org_enc, rr.observer_id_enc, rr.observer_contact_enc
     FROM reports r JOIN reports_restricted rr ON rr.thread_id = r.thread_id
     WHERE r.public_ref = $1`,
    [req.params.publicRef],
  );
  const row = rows[0];
  if (!row) return res.status(404).json({ error: 'Not found' });

  // Recorded BEFORE the data is decrypted and sent. If the write fails,
  // the request fails and nothing is disclosed — an unlogged look at
  // someone's contact details is the one outcome this route must not have.
  await recordAccess({
    staffEmail: req.user.email,
    kind: KINDS.IDENTITY,
    reportId: row.id,
    threadId: row.thread_id,
    reason: req.body.reason,
  });

  const { rows: history } = await pool.query(
    `SELECT action, new_status, actor_email, comment, created_at FROM self_service_log
     WHERE thread_id = $1 ORDER BY created_at`,
    [row.thread_id],
  );

  res.json({
    // Either kind of row; `erased` says the reporter had these destroyed.
    ...(await openRestricted({ ...row, thread_id: row.rr_thread })),
    history,
  });
}));

// The moderation gate: valid/invalid/unknown. Always changeable, not a
// one-time decision — a report can move between any of these as new
// information comes in. Only fires the instant-serious alert when the
// *new* status is 'valid', since that's the moment a serious/systemic
// report actually becomes public.
/**
 * A moderator says they have read a flagged report.
 *
 * SEPARATE FROM THE MODERATION DECISION, on purpose. "I have read this"
 * and "this may be published" are different statements, and a flag that
 * cleared itself when somebody pressed Publish would make the queue a
 * record of what was published rather than of what was read.
 *
 * NOT A DELETE. The flag keeps standing as a cleared row, because the
 * question an operator will eventually ask is how many of these were worth
 * raising — and that needs the cleared ones as much as the open ones.
 */
/* ---------------- asking for evidence ----------------

   THREE GATES, and a moderator is told which one is shut rather than
   "no": the report must have DECLARED something, the reporter must have
   GRANTED the permission, and there must not already be a live request.

   THE MODERATOR NEVER SEES THE ADDRESS. The mail is addressed
   server-side from the Tier B row and the address is not in the response.
   This is deliberately NOT the identity route: that one writes an access
   log entry because somebody LOOKED, and nobody looks here. What is on the
   record instead is the request itself, which carries who asked and when —
   the honest entry for an act of writing to somebody rather than reading
   about them. */
router.get('/reports/:threadId/evidence', asyncRoute(async (req, res) => {
  const state = await askableState(req.params.threadId);
  res.json({
    askable: state.ok,
    reason: state.ok ? null : state.reason,
    declared: state.declared === true,
    permitted: state.permitted === true,
    open: await openRequestFor(req.params.threadId),
    history: await requestHistory(req.params.threadId),
    messageMin: MESSAGE_MIN,
    messageMax: MESSAGE_MAX,
  });
}));

const ASK_REFUSALS = {
  'no-report': 'No such report.',
  'not-permitted': 'This reporter has not agreed to be asked for evidence, or has '
    + 'taken that back. Only they can give it, from their own page.',
  'nothing-declared': 'This report did not say it had anything. The permission is '
    + 'consent to be asked for what somebody mentioned, not an open channel.',
  'already-open': 'There is already a live request on this report. Two open links '
    + 'is two ways to spend one ask, and the reporter cannot tell which mail is '
    + 'current. Withdraw the first one if it is wrong.',
  'message-short': 'Say what you are asking for, in at least a few words. A '
    + 'request with no words reads like a phishing mail, which is the one thing '
    + 'this must not look like.',
  'message-long': 'That is too long for a request. Say what you need.',
  'no-contact': 'There is no address on this report any more — the reporter had '
    + 'their contact details erased, so there is nobody to write to.',
  'no-mail': 'This deployment has no mail transport configured, so the request '
    + 'could not be sent. Nothing was recorded.',
};

router.post('/reports/:threadId/evidence', asyncRoute(async (req, res) => {
  const threadId = req.params.threadId;

  // THE ADDRESS FIRST, before a row is written, so a report with nobody to
  // write to does not end up carrying a request that was never sent.
  const { rows } = await pool.query(
    `SELECT r.public_ref, rr.thread_id AS rr_thread, rr.key_scheme,
            rr.observer_org_enc, rr.observer_id_enc, rr.observer_contact_enc
       FROM report_heads h
       JOIN reports r ON r.id = h.current_report_id
       JOIN reports_restricted rr ON rr.thread_id = h.thread_id
      WHERE h.thread_id = $1`,
    [threadId],
  );
  if (!rows[0]) return res.status(404).json({ error: ASK_REFUSALS['no-report'] });
  const opened = await openRestricted({ ...rows[0], thread_id: rows[0].rr_thread });
  // On a coordinator-filed report this is the COORDINATOR's address, which
  // is correct: one accountable, reachable person per record, and the
  // source's own details were deliberately never collected.
  const to = opened.erased ? null : opened.contact;
  if (!to) return res.status(409).json({ error: ASK_REFUSALS['no-contact'] });

  const out = await createRequest(threadId, {
    message: (req.body || {}).message,
    byEmail: req.user.email,
  });
  if (!out.ok) {
    return res.status(out.reason === 'already-open' ? 409 : 400)
      .json({ error: ASK_REFUSALS[out.reason] || 'Refused' });
  }

  const url = `${SITE_ORIGIN}/evidence/${out.token}`;
  const sent = await sendEmail({
    to: [{ email: to }],
    subject: 'A question about your report',
    // NAMES NO MODERATOR AND CARRIES NO REPORT TEXT. The mail goes to an
    // address; what is behind the link is behind the link.
    html: `<p>Somebody reviewing a report you filed has asked whether you can send `
      + `the photos, video, audio or documents you mentioned.</p>`
      + `<p>You agreed to be asked about this when you filed, or afterwards on your `
      + `own page. <b>You do not have to send anything</b>, and you can stop being `
      + `asked at all by switching that permission off.</p>`
      + `<p><a href="${url}">${url}</a></p>`
      + `<p>The link works once, and stops working in two weeks.</p>`,
    text: `Somebody reviewing a report you filed has asked whether you can send the `
      + `evidence you mentioned. You do not have to send anything.\n\n${url}\n\n`
      + `The link works once, and stops working in two weeks.`,
  });

  // A REQUEST NOBODY RECEIVED IS NOT A REQUEST. If the mail did not go,
  // the row is withdrawn rather than left standing — otherwise the open
  // request blocks the next attempt and the moderator is told to withdraw
  // a request the reporter never got.
  if (sent && sent.sent === false) {
    await cancelRequest(threadId, { byEmail: req.user.email });
    return res.status(502).json({ error: ASK_REFUSALS['no-mail'] });
  }

  res.status(201).json({ ok: true, request: out.request });
}));

/* Withdrawing an ask. Not a delete: the link has to stop working, and the
   record of having asked is exactly what should survive that. */
router.post('/reports/:threadId/evidence/cancel', asyncRoute(async (req, res) => {
  const out = await cancelRequest(req.params.threadId, { byEmail: req.user.email });
  res.json({ ok: true, cancelled: out.cancelled });
}));

router.post('/reports/:threadId/reviewed', asyncRoute(async (req, res) => {
  const out = await clearFlag(req.params.threadId, { byEmail: req.user.email });
  if (!out.ok) return res.status(400).json({ error: 'Refused' });
  res.json({ ok: true, cleared: out.cleared });
}));

router.post('/reports/:threadId/status', asyncRoute(async (req, res) => {
  const status = (req.body || {}).status;
  const comment = String((req.body || {}).comment || '').trim();
  if (!['valid', 'invalid', 'unknown'].includes(status)) {
    return res.status(400).json({ error: 'status must be valid, invalid, or unknown' });
  }
  if (!comment) return res.status(400).json({ error: 'A reason is required' });

  const { rows } = await pool.query(
    `SELECT r.public_ref
     FROM report_heads h JOIN reports r ON r.id = h.current_report_id
     WHERE h.thread_id = $1`,
    [req.params.threadId],
  );
  const report = rows[0];
  if (!report) return res.status(404).json({ error: 'Not found' });

  await pool.query(
    'UPDATE report_heads SET moderation_status = $1, updated_at = now() WHERE thread_id = $2',
    [status, req.params.threadId],
  );
  await pool.query(
    "INSERT INTO self_service_log (thread_id, action, new_status, actor_email, comment) VALUES ($1, 'review', $2, $3, $4)",
    [req.params.threadId, status, req.user.email, comment],
  );

  res.json({ ok: true });
}));

// Unlike the self-service withdraw in me.js, this has no ownership check —
// any moderator/admin can withdraw any thread. The original rows are never
// touched (withdrawal is a flag on report_heads, not a deletion) — same
// guarantee as self-service withdrawal, just usable on reports the actor
// didn't submit themselves.
router.post('/reports/:threadId/withdraw', asyncRoute(async (req, res) => {
  const comment = String((req.body || {}).comment || '').trim();
  if (!comment) return res.status(400).json({ error: 'A reason is required' });

  const { rows } = await pool.query(
    'SELECT thread_id FROM report_heads WHERE thread_id = $1',
    [req.params.threadId],
  );
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });

  await pool.query(
    'UPDATE report_heads SET withdrawn = true, updated_at = now() WHERE thread_id = $1',
    [req.params.threadId],
  );
  await pool.query(
    "INSERT INTO self_service_log (thread_id, action, actor_email, comment) VALUES ($1, 'withdraw', $2, $3)",
    [req.params.threadId, req.user.email, comment],
  );
  res.json({ ok: true });
}));

// Restoring also sets the moderation status explicitly (including back to
// 'pending' for a fresh review) rather than just un-hiding whatever status
// the report had before withdrawal — a moderator restoring something may
// well want to re-queue it instead of putting it straight back as valid.
router.post('/reports/:threadId/restore', asyncRoute(async (req, res) => {
  const comment = String((req.body || {}).comment || '').trim();
  if (!comment) return res.status(400).json({ error: 'A reason is required' });
  const status = (req.body || {}).status;
  if (!['pending', 'valid', 'invalid', 'unknown'].includes(status)) {
    return res.status(400).json({ error: 'status must be pending, valid, invalid, or unknown' });
  }

  const { rows } = await pool.query(
    `SELECT r.public_ref
     FROM report_heads h JOIN reports r ON r.id = h.current_report_id
     WHERE h.thread_id = $1`,
    [req.params.threadId],
  );
  const report = rows[0];
  if (!report) return res.status(404).json({ error: 'Not found' });

  await pool.query(
    'UPDATE report_heads SET withdrawn = false, moderation_status = $1, updated_at = now() WHERE thread_id = $2',
    [status, req.params.threadId],
  );
  await pool.query(
    "INSERT INTO self_service_log (thread_id, action, new_status, actor_email, comment) VALUES ($1, 'restore', $2, $3, $4)",
    [req.params.threadId, status, req.user.email, comment],
  );

  res.json({ ok: true });
}));

// THE VERACITY ROUTE IS GONE. A moderator can no longer record a one-word
// verdict about whether a report is true, because the archive publishing
// its own factual assertion about a named third party is the hardest kind
// of claim to defend — and an editorial note, written and signed by the
// person who made the publication decision, replaces it. src/taxonomy.js
// has the reasoning at length.
//
// `report_heads.veracity` still exists, written by nothing, because
// migrations are additive and `/api/v1/stats` has a frozen `by_veracity`
// field to keep until there is a v2.

/* ---- editorial notes ------------------------------------------------
 *
 * What replaced the verdict. A written statement, signed in the record by
 * the moderator who made the publication decision and published under a
 * house byline. src/editorialNotes.js carries the reasoning; these routes
 * are thin on purpose so there is one place the rules live.
 */

/**
 * Whether this logbook uses notes at all, by thread.
 *
 * Checked at the route rather than trusted from the client, and checked for
 * every write: a moderator who can POST a note to a logbook whose operator
 * turned the feature off is a feature that is not really off.
 */
async function notesEnabledFor(threadId) {
  const { rows } = await pool.query(
    `SELECT lb.editorial_notes_enabled AS on
     FROM report_heads h
     JOIN reports r ON r.id = h.current_report_id
     JOIN logbooks lb ON lb.id = r.logbook_id
     WHERE h.thread_id = $1`,
    [threadId],
  );
  if (!rows[0]) return { ok: false, code: 404, error: 'Not found' };
  if (!rows[0].on) {
    return {
      ok: false,
      code: 409,
      error: 'This logbook does not use editorial notes. An administrator turns them '
        + 'on per logbook, because what a note is for varies: an archive that publishes '
        + 'nothing has no use for one.',
    };
  }
  return { ok: true };
}

// The note on one report, in full, with its history and its citations.
router.get('/reports/:threadId/note', asyncRoute(async (req, res) => {
  const note = await noteFor(req.params.threadId);
  if (!note) return res.json({ note: null, versions: [], links: [] });
  res.json({
    note,
    versions: await versionsFor(req.params.threadId),
    links: await linksFor(req.params.threadId),
  });
}));

/**
 * Write a note, or a new version of one. One route for both, because they
 * are the same act: appending what the archive now says.
 *
 * A REVISION NEEDS A REASON AND A FIRST VERSION DOES NOT. The note itself is
 * the reason the first time. The second time, somebody is changing the
 * archive's own published statement, and a change nobody had to explain is
 * one nobody can audit.
 */
router.post('/reports/:threadId/note', asyncRoute(async (req, res) => {
  const gate = await notesEnabledFor(req.params.threadId);
  if (!gate.ok) return res.status(gate.code).json({ error: gate.error });

  const body = (req.body || {}).body;
  const revisionReason = String((req.body || {}).revision_reason || '').trim();
  const existing = await noteFor(req.params.threadId);
  if (existing && !revisionReason) {
    return res.status(400).json({
      error: 'A revision needs a reason. This note is already published, so changing it '
        + 'changes what the archive has said — and every version stays on the record.',
    });
  }

  const out = await writeNote({
    threadId: req.params.threadId,
    body,
    authorEmail: req.user.email,
    revisionReason: revisionReason || null,
  });
  if (!out.ok) return res.status(400).json({ error: out.message || 'Refused' });

  await pool.query(
    `INSERT INTO self_service_log (thread_id, action, new_status, actor_email, comment)
     VALUES ($1, $2, $3, $4, $5)`,
    [req.params.threadId, existing ? 'note_revised' : 'note',
      `v${out.versions}`, req.user.email, revisionReason || 'first version'],
  );
  res.status(existing ? 200 : 201).json({ ok: true, versions: out.versions });
}));

/**
 * Move a note between published, under review and withdrawn.
 *
 * ADMIN ONLY, and that is the chief editor's seat until there is a desk for
 * one. Withdrawing the archive's own published statement, or marking it as
 * under review because its author was removed, is not an ordinary
 * moderator's call — and `docs/specs` records that a note is NOT taken down
 * automatically when its report is withdrawn, because if it were, pressuring
 * a reporter would become a way to erase the editorial record.
 */
router.post('/reports/:threadId/note/state', requireRole('admin'), asyncRoute(async (req, res) => {
  const state = (req.body || {}).state;
  const comment = String((req.body || {}).comment || '').trim();
  if (!STATES.includes(state)) return res.status(400).json({ error: 'invalid state' });
  if (!comment) return res.status(400).json({ error: 'A reason is required' });

  const out = await setState(req.params.threadId, state);
  if (!out.ok) {
    return res.status(out.reason === 'no-note' ? 404 : 400)
      .json({ error: out.reason === 'no-note' ? 'There is no note on that report.' : 'Refused' });
  }
  await pool.query(
    `INSERT INTO self_service_log (thread_id, action, new_status, actor_email, comment)
     VALUES ($1, 'note_state', $2, $3, $4)`,
    [req.params.threadId, state, req.user.email, comment],
  );
  res.json({ ok: true, state: out.note.state });
}));

// Cite outside coverage beside a note. What qualifies is the charter's
// business, not this route's — see src/editorialNotes.js.
router.post('/reports/:threadId/note/links', asyncRoute(async (req, res) => {
  const gate = await notesEnabledFor(req.params.threadId);
  if (!gate.ok) return res.status(gate.code).json({ error: gate.error });
  const b = req.body || {};
  const out = await addLink({
    threadId: req.params.threadId,
    title: b.title,
    publisher: b.publisher,
    publishedOn: b.published_on,
    url: b.url,
    addedBy: req.user.email,
  });
  if (!out.ok) {
    const why = {
      title: 'A citation needs a title, under 300 characters.',
      url: 'A citation needs an http or https address.',
      'no-note': 'Write the note first — a citation sits beside a note, not on its own.',
    }[out.reason] || 'Refused';
    return res.status(out.reason === 'no-note' ? 409 : 400).json({ error: why });
  }
  await pool.query(
    `INSERT INTO self_service_log (thread_id, action, new_status, actor_email, comment)
     VALUES ($1, 'note_link', 'added', $2, $3)`,
    [req.params.threadId, req.user.email, String(b.title || '').trim().slice(0, 200)],
  );
  res.status(201).json({ ok: true, id: out.linkId });
}));

// Withdraw a citation. A timestamp, not a DELETE.
router.delete('/reports/:threadId/note/links/:id', asyncRoute(async (req, res) => {
  const gone = await removeLink(req.params.id);
  if (!gone) return res.status(404).json({ error: 'Not found' });
  await pool.query(
    `INSERT INTO self_service_log (thread_id, action, new_status, actor_email, comment)
     VALUES ($1, 'note_link', 'removed', $2, $3)`,
    [req.params.threadId, req.user.email, `link #${req.params.id}`],
  );
  res.json({ ok: true });
}));

// Severity, as the moderator sees it: a mutable judgement in report_heads,
// the same shape the withdrawn veracity verdict had, and for the same
// reason — it is a judgement by the people handling a report, not something
// the reporter said. It is never inside
// the content hash — a report's seal holds what the reporter said, not what
// a moderator later concluded about it.
router.post('/reports/:threadId/severity', asyncRoute(async (req, res) => {
  const severity = (req.body || {}).severity;
  const comment = String((req.body || {}).comment || '').trim();
  if (!SEVERITIES.includes(severity)) {
    return res.status(400).json({ error: 'invalid severity value' });
  }
  if (!comment) return res.status(400).json({ error: 'A reason is required' });

  const { rows } = await pool.query(
    'UPDATE report_heads SET assessed_severity = $1, updated_at = now() WHERE thread_id = $2 RETURNING thread_id',
    [severity, req.params.threadId],
  );
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });

  await pool.query(
    "INSERT INTO self_service_log (thread_id, action, new_status, actor_email, comment) VALUES ($1, 'severity', $2, $3, $4)",
    [req.params.threadId, severity, req.user.email, comment],
  );
  res.json({ ok: true });
}));

// Corroboration: link this thread to another that describes the same
// real-world incident, or clear the link. Deliberately a moderator action
// rather than inferred — an automatic clustering mistake would silently
// overstate corroboration, which is the number press is most likely to
// quote. Linking to a report that already has an incident joins that
// group; linking two unlinked reports starts a new one.
router.post('/reports/:threadId/incident', asyncRoute(async (req, res) => {
  const body = req.body || {};
  const comment = String(body.comment || '').trim();
  if (!comment) return res.status(400).json({ error: 'A reason is required' });

  const { rows: selfRows } = await pool.query(
    'SELECT thread_id, incident_id FROM report_heads WHERE thread_id = $1',
    [req.params.threadId],
  );
  if (!selfRows[0]) return res.status(404).json({ error: 'Not found' });

  let incidentId = null;
  let note = 'unlinked';

  if (body.linkTo) {
    const { rows: other } = await pool.query(
      `SELECT h.thread_id, h.incident_id FROM report_heads h
       JOIN reports r ON r.id = h.current_report_id
       WHERE r.public_ref = $1`,
      [String(body.linkTo).trim()],
    );
    if (!other[0]) return res.status(404).json({ error: 'No report with that ID' });
    if (other[0].thread_id === req.params.threadId) {
      return res.status(400).json({ error: "A report can't corroborate itself" });
    }
    incidentId = other[0].incident_id || crypto.randomUUID();
    note = `linked to ${String(body.linkTo).trim()}`;
    // If the target had no incident yet, it joins the new group too.
    if (!other[0].incident_id) {
      await pool.query('UPDATE report_heads SET incident_id = $1, updated_at = now() WHERE thread_id = $2',
        [incidentId, other[0].thread_id]);
    }
  }

  await pool.query(
    'UPDATE report_heads SET incident_id = $1, updated_at = now() WHERE thread_id = $2',
    [incidentId, req.params.threadId],
  );
  await pool.query(
    "INSERT INTO self_service_log (thread_id, action, new_status, actor_email, comment) VALUES ($1, 'incident', $2, $3, $4)",
    [req.params.threadId, note, req.user.email, comment],
  );
  res.json({ ok: true, incidentId });
}));

/* ---------- attachments ---------- */

// Everything a moderator needs to decide, except the bytes themselves —
// those cost an audited request each (see /original below), so the list
// view never silently pulls a reporter's original photographs into a
// browser cache just because someone opened the queue.
router.get('/reports/:publicRef/attachments', asyncRoute(async (req, res) => {
  if (!attachmentsEnabled()) return res.json([]);
  const { rows } = await pool.query(
    `SELECT a.id, a.ordinal, a.original_name, a.media_type, a.rendition_media_type,
            a.byte_size, a.sha256, a.captured_at, a.received_at,
            a.duration_seconds, a.has_poster,
            (ah.dek_wrapped IS NOT NULL) AS recoverable,
            ah.scan_status, ah.publication, ah.alt_text, ah.dek_destroyed_at
     FROM reports r
     JOIN report_attachments ra ON ra.report_id = r.id
     JOIN attachments a ON a.id = ra.attachment_id
     JOIN attachment_heads ah ON ah.attachment_id = a.id
     WHERE r.public_ref = $1
     ORDER BY a.ordinal`,
    [req.params.publicRef],
  );
  res.json(rows);
}));

// One of the three encrypted copies of a file, decrypted in flight:
//   original  — exactly what was uploaded, metadata intact
//   rendition — what would be published: re-encoded or trimmed
//   poster    — a still frame from a video
//
// Every view is written to access_log, identical to how Tier B identity
// reads are already treated. An unpublished original is at least as
// sensitive as an observer's org name, and there must be no unlogged path
// to either — which is also why none of these is ever a presigned URL.
//
// Streamed rather than buffered: a 150 MB video read into this process
// would be 150 MB of resident memory per viewing moderator.
const VARIANTS = {
  original: { suffix: '', type: (r) => r.media_type },
  rendition: { suffix: '.rendition', type: (r) => r.rendition_media_type || r.media_type },
  poster: { suffix: '.poster', type: () => 'image/jpeg' },
};

/**
 * The audit log itself: who opened whose protected data, when, and why.
 *
 * Admin only. Moderators are the people this records, and letting them
 * read it turns "your access is logged" into "your access is logged, and
 * you can check whether anyone noticed".
 */
router.get('/access-log', requireRole(['admin']), asyncRoute(async (req, res) => {
  const months = Math.min(Math.max(Number(req.query.months) || 12, 1), 120);
  const rows = await recentAccesses({
    months,
    threadId: /^[0-9a-f-]{36}$/i.test(String(req.query.thread || '')) ? req.query.thread : null,
  });

  // Reading the log is itself an access, and recorded as one — otherwise
  // the most sensitive summary in the system is the one place a person can
  // look without leaving a mark.
  //
  // Exactly one level deep. Logging reads-of-reads-of-reads would fill the
  // table with entries about itself and bury what it is for, so this entry
  // is written and the recursion stops here by construction: nothing reads
  // the log except this route, and this route logs only the caller's read.
  await recordAccess({ staffEmail: req.user.email, kind: KINDS.AUDIT });

  res.json({ months, entries: rows });
}));

const ATTACHMENT_ROW = `SELECT a.id, a.report_id, a.thread_id, a.media_type,
    a.rendition_media_type, a.storage_key, a.has_poster, ah.dek_wrapped
  FROM attachments a JOIN attachment_heads ah ON ah.attachment_id = a.id
  WHERE a.id = $1`;

/**
 * Record why an original is about to be looked at, and get back a token
 * good for exactly one view of it.
 *
 * The original still carries everything stripped out of the published
 * copy — where the photo was taken, on what device — so opening it is a
 * disclosure of the reporter's data in a way that viewing the cleaned copy
 * is not. It is the one attachment view that requires a reason, and the
 * reporter is shown that reason.
 */
router.post('/attachments/:id/view-grant', asyncRoute(async (req, res) => {
  if (!attachmentsEnabled()) return res.status(404).json({ error: 'Not found' });
  const reasonError = validateReason(req.body?.reason);
  if (reasonError) return res.status(400).json({ error: reasonError });

  const { rows } = await pool.query(ATTACHMENT_ROW, [Number(req.params.id) || 0]);
  const row = rows[0];
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (!row.dek_wrapped) return res.status(410).json({ error: 'This file has been erased.' });

  const token = await grantOriginalView({
    staffEmail: req.user.email, attachment: row, reason: req.body.reason,
  });
  sweepGrants().catch(() => {});
  res.json({ token });
}));

router.get('/attachments/:id/:variant(original|rendition|poster)', asyncRoute(async (req, res) => {
  if (!attachmentsEnabled()) return res.status(404).json({ error: 'Not found' });
  const variant = VARIANTS[req.params.variant];

  const { rows } = await pool.query(ATTACHMENT_ROW, [Number(req.params.id) || 0]);
  const row = rows[0];
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (!row.dek_wrapped) return res.status(410).json({ error: 'This file has been erased.' });
  if (req.params.variant === 'poster' && !row.has_poster) {
    return res.status(404).json({ error: 'No poster frame for this file' });
  }

  if (req.params.variant === 'original') {
    // The reason was recorded when the grant was issued, so there is no
    // second log row here — one deliberate look is one entry, however many
    // HTTP requests the browser makes to satisfy it.
    const ok = await redeemGrant(req.query.grant, req.user.email, row.id);
    if (!ok) {
      return res.status(403).json({
        error: 'Viewing the original needs a reason. Ask for one and try again.',
      });
    }
  } else {
    // The cleaned copy and its poster frame: not a disclosure of anything
    // the reporter gave us, but still a look at unpublished material, so it
    // is logged for oversight without demanding a reason — and it is not
    // shown in the reporter's own history, where it would be noise.
    await recordAccess({
      staffEmail: req.user.email,
      kind: KINDS.PREVIEW,
      reportId: row.report_id,
      threadId: row.thread_id,
      attachmentId: row.id,
    });
  }

  try {
    const got = await getStream(storageConfig().evidenceBucket, `${row.storage_key}${variant.suffix}`);
    const stream = Readable.fromWeb(got.body);

    // The packed layout puts the 12-byte IV and 16-byte tag first, so the
    // header has to be collected before the rest can be deciphered.
    const header = await readExactly(stream, PACKED_HEADER_BYTES);
    const decipher = createDecryptStream(header, unwrapDek(row.dek_wrapped));

    res.setHeader('Content-Type', variant.type(row));
    // The type was sniffed from the bytes, so it is trustworthy — but tell
    // the browser not to second-guess it anyway, and not to run anything.
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Content-Disposition', 'inline');
    // Never cached: each view should be a logged view, not a replay from
    // the browser's disk.
    res.setHeader('Cache-Control', 'no-store');

    await pipeline(stream, decipher, res);
  } catch (e) {
    if (res.headersSent || e?.code === 'ERR_STREAM_PREMATURE_CLOSE') return;
    console.error('[moderators] file fetch failed', e);
    res.status(502).json({ error: 'Could not retrieve the file' });
  }
}));

// Pull exactly n bytes off the front of a stream, leaving the remainder
// readable. Node has no built-in for this and the header is fixed-width.
//
// Deliberately not `for await`: breaking out of an async iteration calls
// the iterator's return(), which destroys the stream — so the header would
// be read correctly and the body would then be gone. Event-driven reads
// leave the stream alive for the decipher to consume.
function readExactly(stream, n) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let have = 0;

    const cleanup = () => {
      stream.removeListener('readable', onReadable);
      stream.removeListener('error', onError);
      stream.removeListener('end', onEnd);
    };
    const onReadable = () => {
      let chunk;
      // eslint-disable-next-line no-cond-assign
      while ((chunk = stream.read()) !== null) {
        chunks.push(chunk);
        have += chunk.length;
        if (have >= n) {
          cleanup();
          const all = Buffer.concat(chunks);
          // Anything read past the header belongs to the ciphertext, so
          // push it back for the decipher to consume.
          if (all.length > n) stream.unshift(all.subarray(n));
          return resolve(all.subarray(0, n));
        }
      }
    };
    const onError = (e) => { cleanup(); reject(e); };
    const onEnd = () => { cleanup(); reject(new Error('stored file is truncated')); };

    stream.on('readable', onReadable);
    stream.once('error', onError);
    stream.once('end', onEnd);
  });
}

// Publish or refuse one file. Publishing copies the worker's stripped
// rendition into the public bucket — that copy IS the publication
// decision, which is why the two buckets exist. Refusing leaves the
// digest in the chain untouched: the archive still records that the file
// was submitted, it just never becomes public.
router.post('/attachments/:id/publication', asyncRoute(async (req, res) => {
  if (!attachmentsEnabled()) return res.status(404).json({ error: 'Not found' });
  const body = req.body || {};
  const publication = body.publication;
  const comment = String(body.comment || '').trim();
  const altText = String(body.alt_text || '').trim();

  if (!['published', 'refused', 'withheld'].includes(publication)) {
    return res.status(400).json({ error: 'publication must be published, refused or withheld' });
  }
  if (!comment) return res.status(400).json({ error: 'A reason is required' });
  // Required to publish, for accessibility and because writing one is a
  // cheap guarantee a human actually looked at the image.
  if (publication === 'published' && altText.length < 3) {
    return res.status(400).json({ error: 'Alt text is required to publish a file' });
  }

  const { rows } = await pool.query(
    `SELECT a.id, a.thread_id, a.storage_key, a.media_type, a.has_poster,
            ah.dek_wrapped, ah.scan_status
     FROM attachments a JOIN attachment_heads ah ON ah.attachment_id = a.id
     WHERE a.id = $1`,
    [Number(req.params.id) || 0],
  );
  const row = rows[0];
  if (!row) return res.status(404).json({ error: 'Not found' });

  // CONSENT IS THE CEILING, MODERATION IS THE FLOOR. A moderator may publish
  // the text and not the photograph; never the reverse. `may_publish` covers
  // the report and is sealed into it; the files are a second layer the
  // reporter permits separately and can take back at any time, so it is read
  // here at the moment of publishing rather than trusted from earlier.
  if (publication === 'published') {
    const perms = await permissionsFor(row.thread_id);
    if (!perms[ATTACHMENT_PUBLICATION]) {
      return res.status(409).json({
        error: 'The reporter has not permitted their files to be published. '
          + 'The report itself may still be published.',
      });
    }
  }

  const c = storageConfig();
  // Reuse the existing key on a republish so one file never leaves two
  // objects behind; otherwise mint a fresh random one. Never a row id —
  // sequential keys are enumerable if a bucket policy is ever loosened.
  const { rows: headRows } = await pool.query(
    'SELECT rendition_key FROM attachment_heads WHERE attachment_id = $1', [row.id],
  );
  const renditionKey = headRows[0]?.rendition_key || randomKey('rendition');

  if (publication === 'published') {
    if (row.scan_status !== 'clean') {
      return res.status(400).json({ error: 'Only a file that passed scanning can be published' });
    }
    if (!row.dek_wrapped) return res.status(410).json({ error: 'This file has been erased.' });
    try {
      // The worker already produced and encrypted the stripped version, so
      // no parser runs in this process — this is a decrypt and a copy.
      // Decrypt and copy the worker's stripped/re-encoded version. No
      // parser runs in this process — it is a decrypt and a copy.
      const packed = await getObject(c.evidenceBucket, `${row.storage_key}.rendition`);
      const plain = decryptBuffer(packed, unwrapDek(row.dek_wrapped));
      await putObject(c.renditionBucket, renditionKey, plain);
      // The poster travels with it, so the public board can show a still
      // for a video without streaming the clip to everyone who scrolls by.
      if (row.has_poster) {
        const pPacked = await getObject(c.evidenceBucket, `${row.storage_key}.poster`);
        await putObject(c.renditionBucket, `${renditionKey}.poster`,
          decryptBuffer(pPacked, unwrapDek(row.dek_wrapped)));
      }
    } catch (e) {
      console.error('[moderators] rendition publish failed', e);
      return res.status(502).json({ error: 'Could not publish the file — storage is unavailable' });
    }
  } else if (headRows[0]?.rendition_key) {
    // Leaving the object behind after a refusal would make the refusal
    // cosmetic if the bucket were ever served directly. Shared with the
    // reporter's revocation path so the two cannot drift.
    await dropRendition(headRows[0].rendition_key);
  }

  await pool.query(
    `UPDATE attachment_heads
     SET publication = $1, alt_text = $2,
         rendition_key = CASE WHEN $1 = 'published' THEN $3 ELSE NULL END,
         updated_at = now()
     WHERE attachment_id = $4`,
    [publication, altText || null, renditionKey, row.id],
  );

  await pool.query(
    "INSERT INTO self_service_log (thread_id, action, new_status, actor_email, comment) VALUES ($1, 'media', $2, $3, $4)",
    [row.thread_id, `${publication} #${row.id}`, req.user.email, comment],
  );

  res.json({ ok: true });
}));

// Crypto-shredding. Destroys the key, not the record: the digest and the
// RFC 3161 anchor over it stay verifiable, so an erasure can never be
// mistaken for tampering with the chain. Admin-only and irreversible.
router.post('/attachments/:id/erase', requireRole('admin'), asyncRoute(async (req, res) => {
  if (!attachmentsEnabled()) return res.status(404).json({ error: 'Not found' });
  const comment = String((req.body || {}).comment || '').trim();
  if (!comment) return res.status(400).json({ error: 'A reason is required' });

  const { rows } = await pool.query(
    `SELECT a.id, a.thread_id, a.storage_key, ah.rendition_key
     FROM attachments a JOIN attachment_heads ah ON ah.attachment_id = a.id
     WHERE a.id = $1`,
    [Number(req.params.id) || 0],
  );
  const row = rows[0];
  if (!row) return res.status(404).json({ error: 'Not found' });

  const c = storageConfig();
  if (row.rendition_key) {
    await deleteObject(c.renditionBucket, row.rendition_key).catch(() => {});
    await deleteObject(c.renditionBucket, `${row.rendition_key}.poster`).catch(() => {});
    await forget(row.rendition_key);
    await forget(`${row.rendition_key}.poster`);
  }

  // The actual shred: the only copy of the data key is destroyed. Even a
  // storage backup taken before this moment holds nothing but ciphertext
  // no one can open, and the same key covered exif_enc, so the GPS goes
  // with the pixels. The ciphertext is deleted too, but that is tidiness —
  // the key destruction is what makes this irreversible.
  await pool.query(
    `UPDATE attachment_heads
     SET dek_wrapped = NULL, dek_destroyed_at = now(), publication = 'refused',
         rendition_key = NULL, updated_at = now()
     WHERE attachment_id = $1`,
    [row.id],
  );
  for (const suffix of ['', '.rendition', '.poster']) {
    await deleteObject(c.evidenceBucket, `${row.storage_key}${suffix}`).catch(() => {});
  }

  await pool.query(
    "INSERT INTO self_service_log (thread_id, action, new_status, actor_email, comment) VALUES ($1, 'media', $2, $3, $4)",
    [row.thread_id, `erased #${row.id}`, req.user.email, comment],
  );

  res.json({ ok: true });
}));

export default router;
