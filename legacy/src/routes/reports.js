import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { pool } from '../db.js';
import { SITE_ORIGIN } from '../siteOrigin.js';
import { normalizeSearch, searchClause, sortDirection } from '../reportSearch.js';
import { normalizeEmail, looksLikeEmail } from '../crypto.js';
import { insertReportVersion, normalizeReportFields } from '../reportCore.js';
import { flagReport } from '../reviewFlags.js';
import { cardFor, isKnownDigest } from '../consentText.js';
import {
  attachmentsEnabled, clearedSlotsFor, buildManifest, promoteSlots,
  isRefused, isExcludedFromReport, releaseDraft, inFlightSlotsFor, CONFIRM_WAIT_MS,
  slotStatuses, attachmentColumns, servedTypeFor,
} from '../attachments.js';
import { verifyReport } from '../verify.js';
import { sealRestricted } from '../contactKeys.js';
import { getObject, getStream, storageConfig } from '../storage.js';
import { localCopy } from '../mediaCache.js';
import { createSubmissionToken, getSubmissionToken } from '../submissionTokens.js';
import { sendEmail } from '../email.js';
import { asyncRoute } from '../asyncRoute.js';
import { logbookBySlug, fieldsFor, isAccepting, openLogbooks, takesFiles } from '../logbooks.js';
import { ensureFormVersion } from '../logbookForms.js';
import { buildAnswers } from '../answers.js';
import { intakeIsOpen, INTAKE_CLOSED } from '../intakeGate.js';
import { publicArchiveAvailable, PUBLICATION_OFF } from '../publication.js';

const router = express.Router();

// Anyone can trigger a confirmation email to any address they type — same
// exposure the OTP request-code endpoint already has, same mitigation.
const submitLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });
const confirmLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 60 });
const verifyLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 120 });

/**
 * THE SPINE: what every report is asked, whichever logbook asked the rest.
 * An address to reach the reporter, their consent, and whether it may be
 * published. Nothing else is built in — a written account, a date, a place
 * are all questions a logbook asks or does not. Everything else is checked
 * against that logbook's own questions in src/answers.js.
 */
function validateSpine(b) {
  const errors = [];
  if (!looksLikeEmail(b.email)) errors.push('a valid email is required');
  if (b.consent !== true) errors.push('consent is required');
  if (b.may_publish !== true && b.may_publish !== false) {
    errors.push('may_publish must be answered');
  }
  if (typeof b.may_publish_digest !== 'string' || !/^[a-f0-9]{64}$/.test(b.may_publish_digest)) {
    errors.push('may_publish_digest is required');
  }
  return errors;
}

// The form no longer creates a report directly — it stages the validated
// submission and emails a confirmation link. Nothing enters the
// hash-chained `reports` table until that link is clicked (see
// GET /confirm/:token below), so an unverified email claim never
// permanently consumes a chain slot.
/**
 * The publication card's wording, so the form renders the same string the
 * server will digest. One copy, server-side, for the reason in
 * src/consentText.js: a digest of text the server never saw is a claim it
 * cannot stand behind.
 *
 * `?variant=coordinator` gets the extra sentence about the organization a
 * coordinator filed through, which is in the hashed object and is public.
 */
router.get('/consent-text', asyncRoute(async (req, res) => {
  res.json(cardFor(req.query.variant));
}));

/**
 * Whether the form should offer itself at all.
 *
 * Read by the page before it draws the first card. Somebody who fills in
 * eleven cards and is refused at the end has been wasted, and on this form
 * that person is often typing an account of something that just happened to
 * them. Tell them at the top or do not put the form up.
 *
 * The switch is enforced below regardless of what any client does with
 * this. This is a courtesy; the refusal is the rule.
 */
router.get('/intake', asyncRoute(async (req, res) => {
  // Two things have to be true for the form to be worth putting up: the
  // site is taking reports, and at least one logbook is open to take them.
  // Every report is filed through a logbook, so with none open there is no
  // form, and saying so at the top beats a form with nothing in it.
  const open = await intakeIsOpen();
  const logbooks = open ? (await openLogbooks()).length : 0;
  res.json({ open: open && logbooks > 0, switchOpen: open, logbooks });
}));

router.post('/', submitLimiter, asyncRoute(async (req, res) => {
  // First, before validation: a closed intake is not a badly filled form,
  // and telling somebody an answer is missing when the archive was never
  // going to take it either way is a lie about why they were refused.
  if (!await intakeIsOpen()) return res.status(503).json(INTAKE_CLOSED);

  const b = req.body || {};

  // EVERY REPORT IS FILED THROUGH A LOGBOOK. There is no other form.
  if (!b.logbook) {
    return res.status(400).json({ errors: ['Choose which logbook this report is for.'] });
  }
  const lb = await logbookBySlug(String(b.logbook));
  if (!lb || lb.state === 'draft') {
    return res.status(404).json({ errors: ['No such logbook'] });
  }
  if (!isAccepting(lb)) {
    // Same reasoning as the closed-intake check above: refusing on the
    // real ground beats a lie about the form.
    return res.status(503).json({
      errors: [lb.state === 'scheduled'
        ? 'That logbook has not opened yet.'
        : 'That logbook is closed and is not taking reports.'],
    });
  }
  const fields = await fieldsFor(lb.id);
  // The questions these answers are about to be checked against, as a
  // version. Sealed at confirmation, so what is sealed is the form this
  // person was actually asked, not whatever it has become by the time the
  // link is clicked.
  const form = await ensureFormVersion(lb, fields);
  const spineErrors = validateSpine(b);
  const { answers, errors: answerErrors } = buildAnswers(fields, b.answers || {});
  const errs = [...spineErrors, ...answerErrors];
  if (errs.length) return res.status(400).json({ errors: errs });

  // The digest arrives from the client, so it is not trusted. It has to name
  // wording this deployment actually put on screen, or the sealed record
  // points at a sentence nobody can produce.
  if (!(await isKnownDigest(b.may_publish_digest))) {
    return res.status(400).json({
      errors: ['may_publish_digest does not match any wording this site has shown'],
    });
  }

  // FILES ONLY WHERE THIS LOGBOOK TAKES THEM. A draft token is how files
  // ride along to the confirm, so on a logbook that takes none it is
  // dropped here rather than trusted there.
  //
  // THREE GATES, each answering a different question, and takesFiles() holds
  // the first two: does this logbook ask for files (has it an upload
  // question), and has somebody frozen it. attachmentsEnabled() is the third
  // and is the site's own — whether there is anywhere to put a file at all.
  const filesOk = takesFiles(lb) && attachmentsEnabled();

  // Carried through the confirmation token so the sealed answers are the
  // ones that were checked, not whatever a second request might send.
  const email = normalizeEmail(b.email);
  const token = await createSubmissionToken(email, {
    logbook: lb.slug,
    logbook_id: lb.id,
    form_id: form.id,
    answers,
    may_publish: b.may_publish,
    may_publish_digest: b.may_publish_digest,
    ...(filesOk && b.draft_token ? { draft_token: b.draft_token } : {}),
  });
  // THE REPORTER HAS PRESSED SEND, so their files become work the media
  // worker may do. Nothing was transcoded while they were filling the form
  // in — that is what let the Ready gate go — and nothing is transcoded for
  // a draft that is abandoned here either.
  //
  // AFTER the token exists and before the mail goes out. After, because a
  // release for a submission that failed to record would be work done for a
  // report that does not exist; before the mail, because the mail is what
  // starts the race with the reporter's own click.
  //
  // Logged rather than checked: a submission that carried a draft token and
  // released nothing is the shape this column's bugs take, and the line
  // below is where somebody will look for it. Not fatal — a report whose
  // files are still staging is recoverable, and refusing the submission over
  // it would throw away the answers too.
  if (filesOk && b.draft_token) {
    const released = await releaseDraft(b.draft_token);
    res.locals.log = { ...(res.locals.log || {}), released };
    if (!released) console.warn('[reports] a submission with a draft token released no files');
  }

  const confirmUrl = `${SITE_ORIGIN}/r/confirm/${token}`;
  await sendEmail({
    to: [{ email }],
    subject: 'Confirm your report',
    html: `<p>Click the link below to confirm and submit your report. It'll then be reviewed by a moderator before appearing publicly.</p>
           <p><a href="${confirmUrl}">${confirmUrl}</a></p>
           <p>This link works again later too — revisit it any time to check on your report.</p>
           <p>If you didn't submit this, you can ignore it — nothing is created until the link above is clicked.</p>`,
    text: `Confirm your report: ${confirmUrl}`,
  });
  return res.status(202).json({ ok: true, pending: true });
}));

async function createReportFromToken(row) {
  const b = row.payload;
  const threadId = crypto.randomUUID();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Re-read the token inside the transaction and lock it. Two rapid
    // clicks on the same confirm link (a mail client prefetching the URL,
    // then the reader clicking it) would otherwise both pass the check
    // above and create two reports — and promote the same files twice.
    const { rows: tokenRows } = await client.query(
      'SELECT confirmed_at FROM report_submission_tokens WHERE token = $1 FOR UPDATE',
      [row.token],
    );
    if (tokenRows[0]?.confirmed_at) {
      await client.query('ROLLBACK');
      return { alreadyConfirmed: true };
    }

    // Files the worker has cleared, resolved inside the transaction so the
    // manifest that gets hashed and the rows that get written are the same
    // set. Anything still scanning, infected or unreadable at this instant
    // is left behind — the confirm response names what was excluded rather
    // than dropping it silently. The draft token is shape-checked because
    // it is whatever the client sent.
    const draft = typeof b.draft_token === 'string' && /^[a-f0-9]{48}$/.test(b.draft_token)
      ? b.draft_token : null;
    const slots = (attachmentsEnabled() && draft) ? await clearedSlotsFor(draft, client) : [];

    const report = await insertReportVersion(client, {
      threadId,
      correctsId: null,
      fields: normalizeReportFields(b),
      attachmentManifest: buildManifest(slots),
      logbookId: b.logbook_id,
      // Tokens issued before forms were sealed carry none; those get the
      // current questions, resolved inside insertReportVersion.
      formId: b.form_id,
    });

    if (slots.length) {
      await promoteSlots(client, { slots, threadId, reportId: report.id });
    }

    await client.query(
      'INSERT INTO report_heads (thread_id, current_report_id) VALUES ($1, $2)',
      [threadId, report.id],
    );

    // READ WHAT THEY WROTE, and raise a flag if it asks for a look. Inside
    // this transaction, so a flag and the report it is about cannot
    // disagree and a rollback leaves no orphan on the queue. After the head
    // exists, because the marker the board reads is a column on it.
    await flagReport(client, {
      reportId: report.id,
      threadId,
      logbookId: b.logbook_id,
      answers: report.answers,
    });

    // Under a key of its own, so the reporter can have it erased later
    // without the append-only table being touched. See src/contactKeys.js.
    await sealRestricted(client, { threadId, email: row.email });

    // Stamped inside the same transaction as the insert, so the token and
    // the report it produced can never disagree.
    await client.query(
      'UPDATE report_submission_tokens SET confirmed_at = now(), thread_id = $1 WHERE token = $2',
      [threadId, row.token],
    );

    await client.query('COMMIT');
    return { report, threadId, attachedCount: slots.length };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

router.get('/confirm/:token', confirmLimiter, asyncRoute(async (req, res) => {
  const row = await getSubmissionToken(req.params.token);
  if (!row) return res.status(404).json({ status: 'not_found' });

  if (row.confirmed_at) {
    // Already created — check current status rather than recreating.
    // The reporter never learns *which* non-public state it's in
    // (pending/unknown/invalid/withdrawn all look identical here) —
    // a moderator can always revisit a decision, so nothing is final.
    const { rows } = await pool.query(
      `SELECT r.public_ref, h.withdrawn, h.moderation_status
       FROM report_heads h JOIN reports r ON r.id = h.current_report_id
       WHERE h.thread_id = $1`,
      [row.thread_id],
    );
    const head = rows[0];
    if (head && head.moderation_status === 'valid' && !head.withdrawn) {
      return res.json({ status: 'public', publicRef: head.public_ref });
    }
    return res.json({ status: 'pending' });
  }

  if (new Date(row.expires_at) < new Date()) {
    return res.json({ status: 'expired' });
  }

  // STILL PREPARING THEIR FILES? Then this is not the moment to seal the
  // report, because confirming is the last moment the manifest can change
  // and `clearedSlotsFor` takes finished files only. Sealing now would
  // produce a report that quietly does not hold a photograph the reporter
  // watched upload.
  //
  // THIS IS THE OTHER HALF OF REMOVING THE READY GATE. The form used to
  // refuse to send until every file said Ready; now the form sends
  // immediately and the wait, if there is one left at all, lands here —
  // behind the reporter rather than in front of them, and usually over
  // before they have opened their mail.
  //
  // The token is NOT spent and nothing is written: this is a read, and
  // clicking the link again is how they come back. The page polls.
  const pendingDraft = typeof row.payload?.draft_token === 'string'
    && /^[a-f0-9]{48}$/.test(row.payload.draft_token) ? row.payload.draft_token : null;
  if (attachmentsEnabled() && pendingDraft) {
    const inFlight = await inFlightSlotsFor(pendingDraft);
    // Bounded by when the files were RELEASED, not by this click — see
    // CONFIRM_WAIT_MS. Past that the report goes ahead without them and
    // they are named as excluded, which is what used to happen anyway.
    const waitingSince = inFlight.reduce((oldest, s) => {
      const at = s.released_at ? new Date(s.released_at).getTime() : Date.now();
      return oldest === null ? at : Math.min(oldest, at);
    }, null);
    if (inFlight.length && waitingSince !== null
        && Date.now() - waitingSince < CONFIRM_WAIT_MS) {
      return res.json({
        status: 'preparing',
        files: inFlight.map((s) => s.declared_name).filter(Boolean),
      });
    }
  }

  try {
    const created = await createReportFromToken(row);
    if (created.alreadyConfirmed) return res.json({ status: 'pending' });
    const { report, threadId, attachedCount } = created;

    // Confirming is the last moment the manifest can change, so it is the
    // last honest moment to say which files made it into the record. A file
    // that did not is named with its reason rather than quietly vanishing.
    let attachments;
    const draft = typeof row.payload?.draft_token === 'string'
      && /^[a-f0-9]{48}$/.test(row.payload.draft_token) ? row.payload.draft_token : null;
    if (attachmentsEnabled() && draft) {
      const all = await slotStatuses(draft);
      // A file the reporter removed themselves is not news to them, and a
      // slot that expired belongs to a different draft attempt. Everything
      // else that did not make it — refused, infected, unreadable, still
      // scanning — is named. Refusals used to be filtered out here along
      // with withdrawals, because both were stored as 'rejected'; someone
      // whose file was turned away was simply told nothing.
      const excluded = all.filter((s) => isExcludedFromReport(s.status));
      attachments = {
        attached: attachedCount,
        excluded: excluded.map((s) => ({ name: s.declared_name, reason: s.status_detail || s.status })),
      };

      // And record it against the report, so the moderator reviewing it can
      // see that an upload was attempted at all. Without this a refused
      // file leaves no trace anywhere a human looks: the slot row is
      // ephemeral and nothing links it to the thread.
      //
      // Outside the confirm transaction on purpose — this is an audit note
      // about the submission, and failing to write it must never be the
      // reason a report that is otherwise valid does not get created.
      const refused = excluded.filter((s) => isRefused(s.status));
      for (const s of refused) {
        await pool.query(
          `INSERT INTO self_service_log (thread_id, action, comment)
           VALUES ($1, 'upload_rejected', $2)`,
          [threadId, `${s.declared_name || '(unnamed file)'} — ${s.status_detail || s.status}`],
        ).catch((e) => console.error('[reports] could not log a refused upload', e));
      }
    }

    res.json({ status: 'created', publicRef: report.public_ref, attachments });
  } catch (e) {
    console.error('[reports] confirm failed', e);
    res.status(500).json({ status: 'error' });
  }
}));

const TIER_A_COLUMNS = `
  r.public_ref AS id, r.thread_id, r.received_at, r.recipe,
  -- Public provenance: which organization an account came through, and how
  -- it was collected. Never which person inside that organization typed it
  -- in — that is Tier B, like any reporter's identity.
  r.third_party, r.filed_via, r.intake_method, r.collected_on,
  -- WHICH LOGBOOK ASKED, and what it was answered. The slug is what the
  -- seal carries; the title is what a person reads, and a logbook that was
  -- renamed still verifies under its slug.
  r.answers,
  lb.slug AS logbook_slug, lb.title AS logbook_title,
  r.chain_hash,
  -- What a moderator concluded, once they have.
  h.assessed_severity AS severity,
  -- Published corroborating accounts only, so this is the same number a
  -- reader sees and a moderator sees. Zero when the report isn't linked
  -- to an incident at all.
  (SELECT count(*) FROM report_heads h2
    WHERE h2.incident_id = h.incident_id AND h.incident_id IS NOT NULL
      AND h2.withdrawn = false AND h2.moderation_status = 'valid'
      AND EXISTS (SELECT 1 FROM reports r2 WHERE r2.id = h2.current_report_id
                  AND r2.may_publish = true))::int AS corroboration_count`;

// Attachment counts are appended only while the feature is on, so a board
// query is byte-identical to today's when it is off.
const tierAColumns = () => TIER_A_COLUMNS + attachmentColumns();

// Public visibility requires both gates: reviewed-and-approved, and not
// (subsequently) withdrawn. The full version history stays intact in
// `reports` regardless — neither gate ever touches it, only report_heads.
const CURRENT_JOIN = `
  FROM report_heads h
  JOIN reports r ON r.id = h.current_report_id
  JOIN logbooks lb ON lb.id = r.logbook_id
  WHERE h.withdrawn = false AND h.moderation_status = 'valid' AND r.may_publish = true`;

/**
 * The board's filters.
 *
 * NOTHING IS FILTERABLE UNLESS AN OPERATOR SAID SO. There is no built-in
 * date or place filter — where and when are questions a logbook asks, and
 * a logbook has the filters its maker marked. What is built in is only what
 * every report has: which logbook, a reference, a search over the answers,
 * and what a moderator concluded.
 */
function filterClause(query) {
  const clauses = [];
  const params = [];
  if (query.severity === 'none') {
    // Reports nobody has rated. Worth being able to ask for directly —
    // it is the moderation queue's real backlog.
    clauses.push('h.assessed_severity IS NULL');
  } else if (query.severity) {
    params.push(query.severity);
    clauses.push(`h.assessed_severity = $${params.length}`);
  }
  if (query.ref) {
    params.push(query.ref);
    clauses.push(`r.public_ref = $${params.length}`);
  }
  // Search rides on top of CURRENT_JOIN's visibility gates rather than
  // replacing them, so a public search can never surface a pending,
  // invalid or withdrawn report.
  const q = normalizeSearch(query.q);
  if (q) {
    params.push(q);
    clauses.push(searchClause(params.length));
  }
  // The slug rather than the id, because that is what the seal carries and
  // what a shared link should say.
  if (query.logbook) {
    params.push(query.logbook);
    clauses.push(`lb.slug = $${params.length}`);
  }
  /* One answer filter per `a.<key>` in the query. The key is checked against
     the same shape the schema enforces, so nothing that could not be a real
     field key reaches the query at all — and the value is a parameter, never
     interpolated.

     THREE TESTS, OR'd, because one answer shape does not cover them all:

       {"station": "Station 12"}  a plain answer, matched by containment
       {"tags": ["Police"]}       one value inside a multiple choice
       {"hurt": true, "n": 3}     not strings at all

     The middle one is the trap. jsonb's rule that an array contains a
     scalar applies only at the TOP level of the containment operand, so
     `{"tags":["Police"]} @> {"tags":"Police"}` is FALSE and the value has
     to be wrapped in an array to match. The ->> comparison catches the
     third case, which containment against a string would miss. */
  for (const [raw, value] of Object.entries(query)) {
    if (!raw.startsWith('a.')) continue;
    const key = raw.slice(2);
    if (!/^[a-z0-9][a-z0-9_]{0,38}$/.test(key)) continue;
    if (typeof value !== 'string' || !value) continue;
    params.push(key);
    const k = params.length;
    params.push(value);
    const v = params.length;
    clauses.push(`(r.answers @> jsonb_build_object($${k}::text, $${v}::text)`
      + ` OR r.answers @> jsonb_build_object($${k}::text, jsonb_build_array($${v}::text))`
      + ` OR (r.answers ->> $${k}::text) = $${v})`);
  }
  return { extra: clauses.length ? `AND ${clauses.join(' AND ')}` : '', params };
}

router.get('/export.csv', asyncRoute(async (req, res) => {
  if (!await publicArchiveAvailable()) return res.status(404).json(PUBLICATION_OFF);
  const { extra, params } = filterClause(req.query);
  const { rows } = await pool.query(
    `SELECT ${tierAColumns()} ${CURRENT_JOIN} ${extra} ORDER BY r.received_at ${sortDirection(req.query.sort)}`,
    params,
  );
  // Veracity and corroboration ride in the export itself, not just the
  // page: a CSV is the form in which this data most often gets
  // re-published, and a stripped-of-context row is the failure mode.
  // `recipe` stays so a reader can tell which shape a row is in.
  const cols = ['id', 'received_at', 'recipe', 'logbook',
    'third_party', 'filed_via', 'intake_method', 'collected_on',
    'severity', 'corroboration_count', 'chain_hash'];

  /* THE ANSWERS, AS COLUMNS WHEN THEY CAN BE.
   *
   * The board can filter by what a logbook asked, and a CSV is the form in
   * which this data most often gets re-published — so an export that
   * dropped the answers would hand somebody a file missing the very thing
   * they filtered by. That was true of this route until now, because the
   * column list above is hand-kept and nothing made it follow the row.
   *
   * ONE COLUMN PER QUESTION only when the export is narrowed to a single
   * logbook, because only then is there one field set to name. Across
   * several, the questions are different questions that happen to share a
   * key, and a column that means one thing in some rows and another in the
   * rest is worse than a column of JSON that means exactly what it says.
   *
   * The header is the field KEY, not its label: the key is what the seal
   * carries, so a reader can line the CSV up against a verified report.
   */
  let answerKeys = null;
  if (req.query.logbook) {
    const lb = await logbookBySlug(String(req.query.logbook));
    if (lb) answerKeys = (await fieldsFor(lb.id)).map((f) => f.key);
  }
  if (answerKeys && answerKeys.length) {
    for (const k of answerKeys) cols.push(`answer.${k}`);
  } else if (rows.some((r) => r.answers)) {
    cols.push('answers');
  }
  const esc = (v) => {
    if (Array.isArray(v)) v = v.join('; ');
    const s = v instanceof Date ? v.toISOString() : String(v ?? '');
    return `"${s.replace(/"/g, '""')}"`;
  };
  const cell = (r, c) => {
    if (c === 'logbook') return r.logbook_slug;
    if (c === 'answers') return r.answers ? JSON.stringify(r.answers) : '';
    if (c.startsWith('answer.')) {
      const v = r.answers ? r.answers[c.slice(7)] : undefined;
      // Absent stays empty rather than becoming "undefined" or "null". A
      // question this report was not asked, and one it left blank, both read
      // as an empty cell — which is all a spreadsheet can say either way.
      if (v === undefined || v === null) return '';
      return Array.isArray(v) ? v.join('; ') : v;
    }
    return r[c];
  };
  const lines = [cols.join(',')].concat(rows.map((r) => cols.map((c) => esc(cell(r, c))).join(',')));
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="reportlog-reports.csv"');
  res.send(lines.join('\n'));
}));

router.get('/:publicRef', asyncRoute(async (req, res) => {
  if (!await publicArchiveAvailable()) return res.status(404).json(PUBLICATION_OFF);
  const { rows } = await pool.query(
    `SELECT ${tierAColumns()} ${CURRENT_JOIN} AND r.public_ref = $1`,
    [req.params.publicRef],
  );
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });

  // THE ARCHIVE'S OWN STATEMENT, where it made one. Through
  // `publicNoteFor`, which does not select the author's address — the
  // byline is a house one, and that policy is expressed in the query rather
  // than in a template somebody can forget. src/editorialNotes.js says why.
  //
  // A note under review or withdrawn still comes back, with its notice and
  // without its text: that the archive said something and then marked it is
  // itself part of the record, and silently serving nothing would be the
  // quiet removal this whole design exists to prevent.
  const note = await publicNoteFor(rows[0].thread_id);
  res.json({
    ...rows[0],
    ...(note ? { editorial_note: note, editorial_links: await linksFor(rows[0].thread_id, { forPublic: true }) } : {}),
  });
}));

/**
 * Re-derive a report's fingerprint and say whether it still matches.
 *
 * Deliberately reachable for any report in the archive, not only a
 * published one. Verification answers "has this record been altered since
 * it was written", which is a different question from "may this be
 * published" — and a withdrawn or declined report is exactly the case
 * where someone is most likely to want an independent answer. Nothing here
 * exposes anything the fingerprint does not already cover, which has never
 * included observer identity or contact details.
 *
 * Rate-limited because it hashes and does three queries per call, which is
 * more work than a board page and would otherwise be the cheapest way to
 * make this server do something expensive.
 */
router.get('/:publicRef/verify', verifyLimiter, asyncRoute(async (req, res) => {
  try {
    const result = await verifyReport(req.params.publicRef);
    if (!result) return res.status(404).json({ error: 'Not found' });
    res.json(result);
  } catch (e) {
    console.error('[reports] verify failed', e);
    res.status(500).json({ error: 'Could not verify this report right now.' });
  }
}));

// Published attachments on a public report. Mirrors the board's own two
// visibility gates and adds the per-file one, so a file can only surface
// here if the report is public AND a moderator published that file.
router.get('/:publicRef/attachments', asyncRoute(async (req, res) => {
  // An attachment is part of the published report. If the report is not
  // being published, neither is the file hanging off it.
  if (!await publicArchiveAvailable()) return res.status(404).json(PUBLICATION_OFF);
  if (!attachmentsEnabled()) return res.json([]);
  const { rows } = await pool.query(
    `SELECT a.id, a.ordinal, a.media_type, a.rendition_media_type, a.sha256,
            a.duration_seconds, a.has_poster, ah.alt_text
     FROM report_heads h
     JOIN reports r ON r.id = h.current_report_id
     JOIN report_attachments ra ON ra.report_id = r.id
     JOIN attachments a ON a.id = ra.attachment_id
     JOIN attachment_heads ah ON ah.attachment_id = a.id
     WHERE h.withdrawn = false AND h.moderation_status = 'valid' AND r.may_publish = true
       AND ah.publication = 'published' AND ah.rendition_key IS NOT NULL
       AND r.public_ref = $1
     ORDER BY a.ordinal`,
    [req.params.publicRef],
  );
  res.json(rows.map((r) => ({
    ...r,
    // What the browser will actually receive, which for a re-encoded file
    // is not what was uploaded.
    served_type: servedTypeFor(r),
    kind: String(servedTypeFor(r)).startsWith('video/') ? 'video' : 'image',
  })));
}));

// Streamed through the app rather than handed out as a presigned URL.
// A presigned URL would bypass every piece of middleware in front of this
// router — including the site-access gate — and would keep working after a
// report is withdrawn, which is exactly the moment its media must stop
// being reachable.
router.get('/:publicRef/attachments/:id/file', asyncRoute(async (req, res) => {
  // An attachment is part of the published report. If the report is not
  // being published, neither is the file hanging off it.
  if (!await publicArchiveAvailable()) return res.status(404).json(PUBLICATION_OFF);
  if (!attachmentsEnabled()) return res.status(404).json({ error: 'Not found' });
  const { rows } = await pool.query(
    `SELECT a.media_type, a.rendition_media_type, a.sha256, a.has_poster, ah.rendition_key
     FROM report_heads h
     JOIN reports r ON r.id = h.current_report_id
     JOIN report_attachments ra ON ra.report_id = r.id
     JOIN attachments a ON a.id = ra.attachment_id
     JOIN attachment_heads ah ON ah.attachment_id = a.id
     WHERE h.withdrawn = false AND h.moderation_status = 'valid' AND r.may_publish = true
       AND ah.publication = 'published' AND ah.rendition_key IS NOT NULL
       AND r.public_ref = $1 AND a.id = $2`,
    [req.params.publicRef, Number(req.params.id) || 0],
  );
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });

  // Digest as the validator, and a short TTL: a withdrawal has to take
  // media down promptly, so nothing here is cached for long. The
  // conditional check happens BEFORE fetching from storage, so a repeat
  // view costs a database row and nothing else.
  const etag = `"${rows[0].sha256}"`;
  res.setHeader('ETag', etag);
  res.setHeader('Cache-Control', 'public, max-age=300, must-revalidate');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  if (req.headers['if-none-match'] === etag) return res.status(304).end();

  const servedType = servedTypeFor(rows[0]);
  const headers = {
    'Content-Type': servedType,
    'Content-Disposition': 'inline',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
  };

  try {
    // Served from the box when we already have it. The gate above still ran
    // on this request — only the bytes are local — so a withdrawal takes
    // effect immediately rather than when a cache entry expires.
    //
    // sendFile also handles range requests against the local file, which is
    // what makes scrubbing a video cheap: seeking used to mean one storage
    // request per seek, and now means one disk read.
    const local = await localCopy(storageConfig().renditionBucket, rows[0].rendition_key);
    if (local) {
      return res.sendFile(local, { headers, acceptRanges: true, cacheControl: false }, (err) => {
        if (err && !res.headersSent) {
          console.error('[reports] cached rendition send failed', err);
          res.status(502).end();
        }
      });
    }

    // Not cached and could not be cached — go straight to storage. Published
    // renditions are the one thing stored as plaintext (they are, by
    // definition, content a moderator cleared for the public), so a range
    // request can be passed through rather than buffered here.
    const range = req.headers.range;
    const got = await getStream(storageConfig().renditionBucket, rows[0].rendition_key, { range });

    for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
    res.setHeader('Accept-Ranges', 'bytes');
    if (got.contentLength) res.setHeader('Content-Length', String(got.contentLength));
    if (got.status === 206 && got.contentRange) {
      res.status(206).setHeader('Content-Range', got.contentRange);
    }
    await pipeline(Readable.fromWeb(got.body), res);
  } catch (e) {
    // A client that navigates away mid-video aborts the pipe; that is not
    // an error worth logging or answering, and the response is long gone.
    if (res.headersSent || e?.code === 'ERR_STREAM_PREMATURE_CLOSE') return;
    console.error('[reports] rendition fetch failed', e);
    res.status(502).json({ error: 'Attachment temporarily unavailable' });
  }
}));

// The still frame for a published video. Same two gates as the clip
// itself, so a poster can never outlive the report it belongs to.
router.get('/:publicRef/attachments/:id/poster', asyncRoute(async (req, res) => {
  // An attachment is part of the published report. If the report is not
  // being published, neither is the file hanging off it.
  if (!await publicArchiveAvailable()) return res.status(404).json(PUBLICATION_OFF);
  if (!attachmentsEnabled()) return res.status(404).json({ error: 'Not found' });
  const { rows } = await pool.query(
    `SELECT a.sha256, ah.rendition_key
     FROM report_heads h
     JOIN reports r ON r.id = h.current_report_id
     JOIN report_attachments ra ON ra.report_id = r.id
     JOIN attachments a ON a.id = ra.attachment_id
     JOIN attachment_heads ah ON ah.attachment_id = a.id
     WHERE h.withdrawn = false AND h.moderation_status = 'valid' AND r.may_publish = true
       AND ah.publication = 'published' AND ah.rendition_key IS NOT NULL
       AND a.has_poster = true
       AND r.public_ref = $1 AND a.id = $2`,
    [req.params.publicRef, Number(req.params.id) || 0],
  );
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });

  const etag = `"${rows[0].sha256}-poster"`;
  res.setHeader('ETag', etag);
  res.setHeader('Cache-Control', 'public, max-age=300, must-revalidate');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  if (req.headers['if-none-match'] === etag) return res.status(304).end();

  const posterKey = `${rows[0].rendition_key}.poster`;
  try {
    const local = await localCopy(storageConfig().renditionBucket, posterKey);
    if (local) {
      return res.sendFile(local, {
        headers: { 'Content-Type': 'image/jpeg', 'Content-Disposition': 'inline' },
        cacheControl: false,
      }, (err) => {
        if (err && !res.headersSent) res.status(502).end();
      });
    }
    const body = await getObject(storageConfig().renditionBucket, posterKey);
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Content-Disposition', 'inline');
    res.send(body);
  } catch (e) {
    console.error('[reports] poster fetch failed', e);
    res.status(502).json({ error: 'Attachment temporarily unavailable' });
  }
}));

router.get('/', asyncRoute(async (req, res) => {
  // Empty array, not an error: the board asked for the published record and
  // this deployment publishes none. There is nothing wrong with the request.
  if (!await publicArchiveAvailable()) return res.json([]);
  const { extra, params } = filterClause(req.query);
  const { rows } = await pool.query(
    `SELECT ${tierAColumns()} ${CURRENT_JOIN} ${extra} ORDER BY r.received_at ${sortDirection(req.query.sort)} LIMIT 500`,
    params,
  );
  res.json(rows);
}));

export default router;
