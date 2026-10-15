/**
 * Third-party intake: a coordinator entering accounts collected offline.
 *
 * The second way into the chain, and the reason it needs to exist: a
 * report is normally held until the reporter clicks a link in their own
 * email, which is what stops an unverified email claim consuming a chain
 * slot. Somebody who filled in a paper form at a polling place cannot
 * click anything, and never will.
 *
 * So the gate is different, not absent. What replaces the click is a
 * named, signed-in, accountable person attesting that they received this
 * account and transcribed it faithfully — recorded with a timestamp and
 * sealed into the report itself. That is what makes third-party entry
 * defensible rather than a hole in the record: without it, a bulk-entered
 * report is indistinguishable from a fabricated one.
 *
 * Staging exists because bulk entry produces typos. Nothing reaches the
 * chain until the coordinator reviews the batch and says so explicitly.
 */
import express from 'express';
import crypto from 'node:crypto';
import { pool } from '../db.js';
import { requireAuth } from '../authMiddleware.js';
import { insertReportVersion, normalizeReportFields } from '../reportCore.js';
import { flagReport } from '../reviewFlags.js';
import { sealRestricted } from '../contactKeys.js';
import { INTAKE_METHODS } from '../taxonomy.js';
import { logbookBySlug, fieldsFor, isAccepting } from '../logbooks.js';
import { ensureFormVersion } from '../logbookForms.js';
import { buildAnswers } from '../answers.js';
import { isKnownDigest } from '../consentText.js';
import { asyncRoute } from '../asyncRoute.js';
import { intakeIsOpen, INTAKE_CLOSED } from '../intakeGate.js';

const router = express.Router();
router.use(requireAuth);

function coordinatorOrgs(user) {
  return (user.memberships || []).filter((m) => m.role === 'coordinator' || m.role === 'manager');
}

function mayFileFor(user, organizationId) {
  return coordinatorOrgs(user).some((m) => Number(m.organization_id) === Number(organizationId));
}

/** Which organizations this person may file for. Drives the selector. */
router.get('/organizations', asyncRoute(async (req, res) => {
  res.json(coordinatorOrgs(req.user));
}));

/* ---------------- batches ---------------- */

router.post('/batches', asyncRoute(async (req, res) => {
  const organizationId = Number((req.body || {}).organizationId);
  if (!mayFileFor(req.user, organizationId)) {
    return res.status(403).json({ error: 'You are not filing for that organization.' });
  }
  const { rows } = await pool.query(
    `INSERT INTO intake_batches (organization_id, coordinator_id) VALUES ($1, $2)
     RETURNING id, organization_id, status, created_at`,
    [organizationId, req.user.id],
  );
  res.status(201).json(rows[0]);
}));

// A coordinator sees their own batches. Whether coordinators should see
// each other's within an organization was decided the narrow way: their
// own only. A manager sees everything filed under the organization from
// the manager panel, which is the oversight that matters.
router.get('/batches', asyncRoute(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT b.id, b.organization_id, o.name AS organization, b.status, b.created_at, b.submitted_at,
            count(d.id)::int AS entries,
            count(d.report_id)::int AS filed
     FROM intake_batches b
     JOIN organizations o ON o.id = b.organization_id
     LEFT JOIN intake_drafts d ON d.batch_id = b.id
     WHERE b.coordinator_id = $1
     GROUP BY b.id, o.name
     ORDER BY b.created_at DESC`,
    [req.user.id],
  );
  res.json(rows);
}));

async function ownedBatch(batchId, user) {
  const { rows } = await pool.query(
    `SELECT b.*, o.name AS organization FROM intake_batches b
     JOIN organizations o ON o.id = b.organization_id
     WHERE b.id = $1 AND b.coordinator_id = $2`,
    [batchId, user.id],
  );
  return rows[0] || null;
}

router.get('/batches/:id', asyncRoute(async (req, res) => {
  const batch = await ownedBatch(Number(req.params.id), req.user);
  if (!batch) return res.status(404).json({ error: 'No such batch' });
  const { rows } = await pool.query(
    `SELECT id, ordinal, payload, report_id FROM intake_drafts
     WHERE batch_id = $1 ORDER BY ordinal`,
    [batch.id],
  );
  res.json({ batch, drafts: rows });
}));

router.post('/batches/:id/drafts', asyncRoute(async (req, res) => {
  const batch = await ownedBatch(Number(req.params.id), req.user);
  if (!batch) return res.status(404).json({ error: 'No such batch' });
  if (batch.status !== 'draft') return res.status(409).json({ error: 'That batch has already been submitted.' });

  const { rows } = await pool.query(
    `INSERT INTO intake_drafts (batch_id, ordinal, payload)
     VALUES ($1, coalesce((SELECT max(ordinal) + 1 FROM intake_drafts WHERE batch_id = $1), 1), $2)
     RETURNING id, ordinal, payload`,
    [batch.id, req.body || {}],
  );
  res.status(201).json(rows[0]);
}));

router.put('/drafts/:id', asyncRoute(async (req, res) => {
  const { rows } = await pool.query(
    `UPDATE intake_drafts d SET payload = $1, updated_at = now()
     FROM intake_batches b
     WHERE d.id = $2 AND d.batch_id = b.id AND b.coordinator_id = $3 AND d.report_id IS NULL
     RETURNING d.id, d.ordinal, d.payload`,
    [req.body || {}, Number(req.params.id), req.user.id],
  );
  if (!rows.length) return res.status(404).json({ error: 'No such draft, or it is already filed.' });
  res.json(rows[0]);
}));

router.delete('/drafts/:id', asyncRoute(async (req, res) => {
  await pool.query(
    `DELETE FROM intake_drafts d USING intake_batches b
     WHERE d.id = $1 AND d.batch_id = b.id AND b.coordinator_id = $2 AND d.report_id IS NULL`,
    [Number(req.params.id), req.user.id],
  );
  res.json({ ok: true });
}));

/**
 * What every draft in a batch is missing, before anything is committed.
 *
 * A draft is a logbook's answers, like any other report, plus how the
 * account was collected. It is checked the way a reporter's own submission
 * is — against that logbook's questions, as they are now — and the logbook
 * has to be open, because filing through a coordinator is still filing.
 *
 * The publication answer is required here too: the coordinator records
 * what the person they spoke to said, on the wording coordinators are
 * shown. `logbooks` caches one lookup per slug for the whole batch, so a
 * batch is judged against ONE reading of each logbook's questions.
 */
async function draftProblems(payload, logbooks) {
  const problems = [];
  const p = payload || {};
  const slug = String(p.logbook || '');
  if (!slug) {
    problems.push('needs a logbook');
  } else {
    if (!logbooks.has(slug)) {
      const lb = await logbookBySlug(slug);
      logbooks.set(slug, lb ? { lb, fields: await fieldsFor(lb.id) } : null);
    }
    const hit = logbooks.get(slug);
    if (!hit || hit.lb.state === 'draft') problems.push('names a logbook that does not exist');
    else if (!isAccepting(hit.lb)) problems.push('names a logbook that is not taking reports');
    else problems.push(...buildAnswers(hit.fields, p.answers || {}).errors);
  }
  if (!INTAKE_METHODS.includes(p.intake_method)) problems.push('needs an intake method');
  if (p.may_publish !== true && p.may_publish !== false) {
    problems.push('needs the answer to whether it may be published');
  } else if (!(await isKnownDigest(p.may_publish_digest, 'coordinator'))) {
    problems.push('the publication answer does not name wording this site shows coordinators');
  }
  return problems;
}

router.get('/batches/:id/review', asyncRoute(async (req, res) => {
  const batch = await ownedBatch(Number(req.params.id), req.user);
  if (!batch) return res.status(404).json({ error: 'No such batch' });
  const { rows } = await pool.query(
    'SELECT id, ordinal, payload, report_id FROM intake_drafts WHERE batch_id = $1 ORDER BY ordinal',
    [batch.id],
  );
  const logbooks = new Map();
  const entries = [];
  for (const d of rows) {
    entries.push({
      id: d.id, ordinal: d.ordinal, filed: Boolean(d.report_id),
      problems: d.report_id ? [] : await draftProblems(d.payload, logbooks),
    });
  }
  res.json({
    batch,
    entries,
    ready: entries.filter((e) => !e.filed && !e.problems.length).length,
    blocked: entries.filter((e) => !e.filed && e.problems.length).length,
  });
}));

/**
 * Commit the batch. This is the point of no return, and it is written to
 * be one: everything below happens in a single transaction, and every
 * report gets the same attestation timestamp because they were attested by
 * one person in one act.
 */
router.post('/batches/:id/submit', asyncRoute(async (req, res) => {
  // The second door into the chain, and it closes with the first one. A
  // switch that shut the public form while a coordinator could still file
  // a batch of two hundred would not be an intake switch; it would be a
  // change to who is allowed to file.
  //
  // Deliberately here and not on the batch and draft routes above: a
  // coordinator part-way through transcribing a stack of paper forms keeps
  // their work and can still edit it. What they cannot do is file it into
  // the chain until intake reopens.
  if (!await intakeIsOpen()) return res.status(503).json(INTAKE_CLOSED);

  const batch = await ownedBatch(Number(req.params.id), req.user);
  if (!batch) return res.status(404).json({ error: 'No such batch' });
  if (batch.status !== 'draft') return res.status(409).json({ error: 'That batch has already been submitted.' });

  // The attestation is a specific statement, not a checkbox that says
  // "ok". The client shows the words; this refuses without them, so a
  // client that skips the dialog cannot file anything.
  if ((req.body || {}).attested !== true) {
    return res.status(400).json({ error: 'The attestation is required before a batch can be filed.' });
  }

  const client = await pool.connect();
  const attestedAt = new Date().toISOString();
  const filed = [];
  try {
    await client.query('BEGIN');
    const { rows: locked } = await client.query(
      'SELECT status FROM intake_batches WHERE id = $1 FOR UPDATE', [batch.id],
    );
    if (locked[0].status !== 'draft') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'That batch has already been submitted.' });
    }

    const { rows: drafts } = await client.query(
      'SELECT id, ordinal, payload FROM intake_drafts WHERE batch_id = $1 AND report_id IS NULL ORDER BY ordinal',
      [batch.id],
    );

    // One reading for the whole batch: what was judged is what gets hashed.
    const logbooks = new Map();
    const formIds = new Map();

    for (const draft of drafts) {
      const problems = await draftProblems(draft.payload, logbooks);
      // An incomplete entry is left staged rather than filed or discarded.
      // Discarding somebody's transcription because a field was missing
      // would lose the account entirely.
      if (problems.length) continue;

      const { lb, fields: questions } = logbooks.get(String(draft.payload.logbook));
      // The version of the questions this batch was judged against, the same
      // reading that produced the answers below.
      if (!formIds.has(lb.slug)) {
        formIds.set(lb.slug, (await ensureFormVersion(lb, questions, client)).id);
      }
      const threadId = crypto.randomUUID();
      const fields = normalizeReportFields({
        logbook: lb.slug,
        answers: buildAnswers(questions, draft.payload.answers || {}).answers,
        may_publish: draft.payload.may_publish,
        may_publish_digest: draft.payload.may_publish_digest,
        third_party: true,
        filed_via: batch.organization,
        intake_method: draft.payload.intake_method,
        collected_on: draft.payload.collected_on || undefined,
        attested_at: attestedAt,
      });
      const report = await insertReportVersion(client, {
        threadId,
        correctsId: null,
        fields,
        logbookId: lb.id,
        formId: formIds.get(lb.slug),
        organizationId: batch.organization_id,
        sourceRef: draft.payload.source_ref || null,
      });

      await client.query(
        'INSERT INTO report_heads (thread_id, current_report_id) VALUES ($1, $2)',
        [threadId, report.id],
      );

      // HOWEVER IT WAS FILED. A report typed in by a coordinator is read
      // the same way as one a reporter submitted: the words are still
      // somebody's own, and a flag that only fired on the public form
      // would be quietest exactly where a coordinator is working through a
      // stack of accounts at speed.
      await flagReport(client, {
        reportId: report.id,
        threadId,
        logbookId: lb.id,
        answers: report.answers,
      });

      // One accountable, reachable person per record — the coordinator.
      // The source's own contact details are deliberately not collected: a
      // second contact on a record pulls in consent, access and
      // notification questions this system does not need to answer. If a
      // reporter wants to be reachable they give their details to the
      // coordinator, who carries that offline.
      await sealRestricted(client, {
        threadId, org: batch.organization, email: req.user.email,
      });
      await client.query('UPDATE intake_drafts SET report_id = $1 WHERE id = $2', [report.id, draft.id]);
      filed.push({ ordinal: draft.ordinal, publicRef: report.public_ref });
    }

    const { rows: remaining } = await client.query(
      'SELECT count(*)::int AS n FROM intake_drafts WHERE batch_id = $1 AND report_id IS NULL',
      [batch.id],
    );
    // A batch with entries still staged stays open, so the coordinator can
    // fix them and file the rest rather than starting again.
    if (remaining[0].n === 0) {
      await client.query(
        "UPDATE intake_batches SET status = 'submitted', submitted_at = now() WHERE id = $1",
        [batch.id],
      );
    }

    await client.query('COMMIT');
    res.json({ ok: true, filed, stillStaged: remaining[0].n, attestedAt });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}));

export default router;
