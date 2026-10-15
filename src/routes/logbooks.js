/**
 * Logbooks: the operator's builder, and what a reporter needs to see.
 *
 * TWO AUDIENCES, DELIBERATELY SPLIT. Everything that shapes a logbook is
 * admin-only and lives under /api/admin/logbooks. What a reporter needs —
 * which logbooks are open, and what one of them asks — is public, because
 * the reporting form has to render before anybody has signed in.
 *
 * A DRAFT IS NEVER PUBLIC. The public routes serve only logbooks that have
 * launched, so a questionnaire still being written is not discoverable by
 * guessing a slug.
 */
import express from 'express';
import { requireAuth, requireRole } from '../authMiddleware.js';
import { asyncRoute } from '../asyncRoute.js';
import { FIELD_TYPES, canFilter, LOCATION_TYPE } from '../fieldTypes.js';
import { placeOptions } from '../gazetteer.js';
import { LOGBOOK_STARTING_POINTS, logbookStartingPoints, templateLogbook } from '../templates.js';
import {
  listLogbooks, openLogbooks, launchedLogbooks, logbookBySlug, logbookById,
  fieldsFor, filterableFields,
  createLogbook, addField, updateField, removeField, reorderFields, setClosed, setSchedule,
  setOutsideAccess,
  setEditorialNotes, setLogbookLimits,
  launch, setFilesFrozen, takesFiles, deleteDraft,
} from '../logbooks.js';
import { createFromFile, toFile } from '../logbookFile.js';
import { buildChainFile } from '../chainFile.js';
import { publicArchiveAvailable, PUBLICATION_OFF } from '../publication.js';
import {
  LIMIT_RANGES, attachmentsEnabled, limitLayers, validateLimits,
} from '../attachments.js';

/* ---------------- what a reporter sees ---------------- */

export const publicRouter = express.Router();

// The field shape a form needs, and nothing else. `id` and `position` are
// the builder's business; a reporter's form needs the key it answers under,
// the type of control to draw, and the words around it.
const forForm = (f) => ({
  key: f.key, kind: f.kind, label: f.label, help: f.help,
  required: f.required, settings: f.settings,
  /* THE PLACES A LOCATION QUESTION OFFERS, sent with the question rather
     than fetched separately.
     A `location` answer must be an exact code from the gazetteer — the
     server refuses a name, deliberately, because sealing a guess for
     "Arizona" would hide a bug in the archive. So a reporter needs a
     PICKER, and a picker needs the list. Fetching it from a second
     endpoint would mean widening `outsidePass` — the allow-list of what a
     visitor without the site password may call while filing — and this
     list travels with a question they are already being asked.
     Only on a location question, so it costs nothing on a logbook that
     has none. */
  ...(f.kind === LOCATION_TYPE ? { places: placeOptions(f.settings || {}) } : {}),
});

/**
 * TWO AUDIENCES AGAIN, and they need different lists.
 *
 * The reporting form asks for the default: what is taking reports right
 * now. Offering a closed logbook there is offering a form that will refuse
 * the reporter at the end.
 *
 * The board asks with ?include=closed, because closing a logbook is what
 * happens when its work is done and its reports are exactly the ones
 * somebody wants to read afterwards. Without this a finished logbook's
 * reports sat in the archive, reachable by no filter at all.
 */
publicRouter.get('/', asyncRoute(async (req, res) => {
  const list = req.query.include === 'closed'
    ? await launchedLogbooks()
    : await openLogbooks();
  // How many questions each asks, so the form's progress bar can leave room
  // for a logbook's questions before it knows which one will be chosen.
  const counts = new Map();
  for (const l of list) counts.set(l.id, (await fieldsFor(l.id)).length);
  res.json(list.map((l) => ({
    slug: l.slug, title: l.title, blurb: l.blurb, state: l.state, questions: counts.get(l.id),
  })));
}));

/**
 * This logbook's PUBLISHED reports as a chain file anybody can check with
 * scripts/check-chain.js — each report's fingerprint and link, with the
 * anchors that covered it. The complete chain, unpublished reports and all,
 * is the administrators' download.
 */
publicRouter.get('/:slug/chain', asyncRoute(async (req, res) => {
  if (!await publicArchiveAvailable()) return res.status(404).json(PUBLICATION_OFF);
  const lb = await logbookBySlug(req.params.slug);
  if (!lb || lb.state === 'draft') return res.status(404).json({ error: 'No such logbook' });
  const file = await buildChainFile(lb.id, { publishedOnly: true });
  res.setHeader('Content-Disposition', `attachment; filename="chain-${lb.slug}-published.json"`);
  res.json(file);
}));

publicRouter.get('/:slug', asyncRoute(async (req, res) => {
  const lb = await logbookBySlug(req.params.slug);
  // A draft is not merely closed to filing — it does not exist publicly.
  if (!lb || lb.state === 'draft') return res.status(404).json({ error: 'No such logbook' });
  const fields = await fieldsFor(lb.id);
  res.json({
    slug: lb.slug,
    title: lb.title,
    blurb: lb.blurb,
    state: lb.state,
    // So a form can say "this opens on Tuesday" rather than "not found".
    opensAt: lb.opens_at,
    closesAt: lb.closes_at,
    accepting: lb.state === 'open',
    // Whether the form offers a place for files. ALL THREE GATES, resolved
    // here rather than in the browser: does this logbook ask for files (has it
    // an upload question), has somebody frozen it, and has the site anywhere
    // to put a file. The form gets one fact and does not re-derive policy —
    // three booleans on the wire is three chances for a client to and them
    // together wrongly.
    acceptsFiles: takesFiles(lb) && attachmentsEnabled(),
    fields: fields.map(forForm),
    // The board's filters are generated from this. No date or location
    // filter is built in; a logbook has the filters its operator marked.
    filters: fields.filter((f) => f.filterable && canFilter(f.kind)).map(forForm),
  });
}));

/* ---------------- the builder ---------------- */

export const adminRouter = express.Router();
adminRouter.use(requireAuth);
adminRouter.use(requireRole('admin'));

const REFUSALS = {
  title: 'Give it a title, under 120 characters.',
  slug: 'A web address of lowercase letters, numbers and hyphens.',
  'slug-taken': 'Another logbook already uses that address.',
  kind: 'Unknown field type.',
  label: 'Give the question a label, under 160 characters.',
  key: 'A field key of lowercase letters, numbers and underscores.',
  'key-taken': 'Another field in this logbook already uses that key.',
  'no-logbook': 'No such logbook.',
  outside: 'Without the password is one of: behind it, anybody with the link, or on the password page.',
  'no-field': 'No such field.',
  order: 'Send the field ids in the order you want them.',
  launched: 'This logbook has launched, so its questions are fixed. '
    + 'That is what makes a sealed answer worth anything: a question that '
    + 'could be reworded afterwards would leave every answer to it meaning '
    + 'something nobody can check.',
  'already-launched': 'This logbook has already launched.',
  'no-fields': 'Add at least one question before launching. A logbook that '
    + 'asks nothing is not a questionnaire.',
  'launched-required': 'A question added after launch has to be optional. '
    + 'Reports already filed never answered it, and marking it required '
    + 'would have the form claim an answer the archive does not hold.',
  // The two the upload question brings. Both say what to do instead: a
  // refusal an operator cannot act on is a dead end, and these are reached by
  // pressing an ordinary "add the question" button.
  'file-exists': 'This logbook already asks for files, and one place to put '
    + 'them is all it can have. Two upload questions would be two places for '
    + 'the same files, and nothing in what gets sealed says which one a file '
    + 'came from. Move or reword the one it has instead.',
  'file-required': 'An upload question cannot be compulsory. It seals no '
    + 'answer of its own — a report\u2019s files are sealed separately — so '
    + 'nothing here could tell whether it had been satisfied, and the form '
    + 'would refuse every report forever.',
  // The five a condition brings. Each says what to do instead: these are
  // reached by filling in "ask this only when..." in the builder, and an
  // operator who cannot tell which of five things they got wrong will turn
  // the condition off rather than fix it.
  'shown-when-shape': 'A condition needs a question and the answers that '
    + 'should bring this one up.',
  'shown-when-no-field': 'Choose which question decides whether this one is asked.',
  'shown-when-unknown-field': 'That question is not in this logbook, or it comes '
    + 'after this one. A condition can only look back at a question already '
    + 'answered \u2014 which is also what stops two questions waiting on each '
    + 'other forever. Move this question below the one it depends on.',
  'shown-when-kind': 'A condition can only be asked about a yes/no question or '
    + 'a list of choices. Matching on what somebody typed would mean the '
    + 'question appearing and disappearing as they wrote, and it would put '
    + 'keyword-guessing in front of the reporter instead of in front of a '
    + 'moderator.',
  'shown-when-unsupported-kind': 'An upload question cannot be conditional yet. '
    + 'Whether a logbook takes files is whether it asks for them at all, and the '
    + 'two cards that collect them are drawn from that rather than from this '
    + 'question\u2019s place in the form \u2014 so a condition here would be sealed '
    + 'into the record and never actually applied to anybody.',
  'shown-when-no-values': 'Say which answers should bring this question up.',
  // The limits. Each names the range rather than saying "invalid", because
  // an operator who cannot see the bound will try numbers until one sticks.
  'limit-not-a-number': 'A limit has to be a whole number.',
  'limit-out-of-range': 'That limit is outside what this software can enforce.',
  'total-under-one-file': 'The total for a whole report is smaller than the '
    + 'ceiling for one file of that kind, so the form would accept a file and '
    + 'then refuse the report carrying it. Raise the total or lower the '
    + 'per-file limit.',
  launched: 'This logbook has been launched, so it cannot be deleted. It is its own '
    + 'hash chain and it is named on every anchor published since — removing it would '
    + 'break the one check that notices a whole logbook disappearing. Close it instead: '
    + 'a closed logbook takes no more reports and keeps the ones it has.',
  'has-reports': 'This logbook holds reports, so it cannot be deleted. `reports` is '
    + 'append-only by design — a correction is a new row, and nothing is ever removed.',
  'kinds-shape': 'Send the kinds this logbook takes as a list.',
  'kinds-unknown': 'That is not a kind of file this software handles.',
  'shown-when-unknown-value': 'One of those answers is not on the other '
    + 'question\u2019s list, so this question could never be asked. Check the '
    + 'spelling against its choices.',
};
const refuse = (res, reason, code = 400, detail = null) => {
  let error = REFUSALS[reason] || 'Refused';
  // A range refusal that does not name the range is a dead end: the
  // operator can see the number was rejected and not what would be taken.
  if (reason === 'limit-out-of-range' && detail) {
    error += ` It has to be between ${detail.min} and ${detail.max}.`;
  }
  return res.status(reason === 'launched' ? 409 : code).json({ error });
};

/** The catalogue the builder draws its "add a question" menu from. */
adminRouter.get('/field-types', asyncRoute(async (req, res) => {
  res.json(FIELD_TYPES.map((t) => ({ ...t, filterable: canFilter(t.id) })));
}));

adminRouter.get('/', asyncRoute(async (req, res) => {
  res.json(await listLogbooks());
}));

/**
 * The question sets a new logbook can start from.
 *
 * NOT the deployment templates. A template writes site settings wholesale and
 * belongs to the first-run wizard; this reports only what is inside the
 * shipped logbook files. A deployment makes logbooks for years, so offering
 * the settings-writing kind here would mean adding a second logbook could
 * rewrite the settings of a site that had been running for months.
 */
adminRouter.get('/starting-points', asyncRoute(async (req, res) => {
  res.json(logbookStartingPoints());
}));

/**
 * Make a logbook, optionally from a starting point.
 *
 * ONE ROUTE, because it is one act: an operator is making a logbook and has
 * either chosen a question set to begin from or not. Two routes would mean the
 * wizard's last step branched on which one to call, and the refusals — a slug
 * already taken, a title too long — would have to be written twice.
 *
 * A STARTING POINT ONLY EVER SUPPLIES QUESTIONS. The operator's title and
 * address win over the file's, because they typed them second and on purpose.
 * The result is an ordinary draft either way: nothing arrives launched, so a
 * starting point can be as wrong for somebody as it likes without a reporter
 * ever seeing it.
 */
adminRouter.post('/', asyncRoute(async (req, res) => {
  const b = req.body || {};
  const from = b.startingPoint ? String(b.startingPoint) : '';

  if (!from || from === 'none') {
    const out = await createLogbook(b);
    if (!out.ok) return refuse(res, out.reason);
    return res.status(201).json(out.logbook);
  }

  if (!LOGBOOK_STARTING_POINTS.includes(from)) {
    return res.status(400).json({ error: 'That is not a starting point this software ships.' });
  }
  const file = templateLogbook(from);
  if (!file) {
    return res.status(500).json({ error: 'That starting point could not be read.' });
  }
  // The operator's own words replace the file's. `slug` is left to
  // createFromFile when they gave none, which derives it from the title and
  // numbers it if it is taken — a slug is sealed into every report and must
  // never join an existing logbook's chain.
  const title = String(b.title || '').trim();
  const out = await createFromFile({
    ...file,
    ...(title ? { title } : {}),
    ...(b.slug ? { slug: String(b.slug).trim() } : { slug: undefined }),
    ...(b.blurb !== undefined ? { blurb: String(b.blurb || '').trim() || undefined } : {}),
  });
  if (!out.ok) return res.status(400).json({ error: out.errors.join(' '), errors: out.errors });
  res.status(201).json(out.logbook);
}));

adminRouter.get('/:id', asyncRoute(async (req, res) => {
  const lb = await logbookById(req.params.id);
  if (!lb) return refuse(res, 'no-logbook', 404);
  res.json({ ...lb, fields: await fieldsFor(lb.id) });
}));

// Whether this logbook uses editorial notes. Per logbook, off by default,
// and reversible — turning it off stops new notes and hides none already
// written. src/logbooks.js says why it is not per deployment.
adminRouter.post('/:id/editorial-notes', asyncRoute(async (req, res) => {
  const out = await setEditorialNotes(req.params.id, (req.body || {}).enabled === true);
  if (!out.ok) return refuse(res, out.reason);
  res.json(out.logbook);
}));

/**
 * This logbook's upload limits: how big a file of each kind may be, how
 * many, how much in total, and which kinds it takes.
 *
 * REACHABLE AFTER LAUNCH, unlike anything that touches a question. A limit
 * changes no answer anybody gave and nothing hashed reads it — and a cap
 * that could only be set before launch could never be corrected on the
 * night it turned out to be wrong. src/logbooks.js says so at the function.
 *
 * Omit a key to leave that layer alone; send null to clear it back to the
 * site's. Those are different things and the interface has to offer both.
 */
adminRouter.post('/:id/limits', asyncRoute(async (req, res) => {
  const check = validateLimits(req.body || {});
  if (!check.ok) return refuse(res, check.reason, 400, check);
  const out = await setLogbookLimits(req.params.id, check.values);
  if (!out.ok) return refuse(res, out.reason, 404);
  res.json({ ...out.logbook, limits: await limitLayers(req.params.id) });
}));

/** What is in force here, and which of the three layers each number came from. */
adminRouter.get('/:id/limits', asyncRoute(async (req, res) => {
  const lb = await logbookById(req.params.id);
  if (!lb) return refuse(res, 'no-logbook', 404);
  res.json({
    limits: await limitLayers(lb.id),
    ranges: LIMIT_RANGES,
    // Whether this logbook asks for files at all. A limits panel on a
    // logbook with no upload question is nine boxes that govern nothing,
    // and saying so beats letting somebody tune them for an afternoon.
    acceptsFiles: lb.accepts_files,
    filesFrozen: Boolean(lb.files_frozen_at),
  });
}));

adminRouter.post('/:id/fields', asyncRoute(async (req, res) => {
  const out = await addField(req.params.id, req.body || {});
  if (!out.ok) return refuse(res, out.reason);
  res.status(201).json(out.field);
}));

adminRouter.put('/:id/fields/:fieldId', asyncRoute(async (req, res) => {
  const out = await updateField(req.params.id, req.params.fieldId, req.body || {});
  if (!out.ok) return refuse(res, out.reason);
  res.json(out.field);
}));

adminRouter.delete('/:id/fields/:fieldId', asyncRoute(async (req, res) => {
  const out = await removeField(req.params.id, req.params.fieldId);
  if (!out.ok) return refuse(res, out.reason);
  res.json({ ok: true });
}));

adminRouter.post('/:id/fields/order', asyncRoute(async (req, res) => {
  const out = await reorderFields(req.params.id, (req.body || {}).ids);
  if (!out.ok) return refuse(res, out.reason);
  res.json({ ok: true });
}));

// Closing and reopening touch nothing hashed and are always reversible. A
// logbook closed by accident on a busy night must come back in one press.
adminRouter.post('/:id/closed', asyncRoute(async (req, res) => {
  const out = await setClosed(req.params.id, (req.body || {}).closed);
  if (!out.ok) return refuse(res, out.reason, 404);
  res.json(out.logbook);
}));

// Who may file without the site password. Reversible, like closing.
adminRouter.post('/:id/outside', asyncRoute(async (req, res) => {
  const out = await setOutsideAccess(req.params.id, (req.body || {}).outsideAccess);
  if (!out.ok) return refuse(res, out.reason, out.reason === 'no-logbook' ? 404 : 400);
  res.json(out.logbook);
}));

adminRouter.post('/:id/schedule', asyncRoute(async (req, res) => {
  const out = await setSchedule(req.params.id, {
    opensAt: (req.body || {}).opensAt, closesAt: (req.body || {}).closesAt,
  });
  if (!out.ok) return refuse(res, out.reason, 404);
  res.json(out.logbook);
}));

/**
 * LAUNCH. The one-way door: it opens the logbook to reporters and freezes
 * its questions for good. There is no unlaunch, because the only thing
 * unlaunching could mean is "let me edit the questions again", and by then
 * somebody may have answered them.
 *
 * Closing is the reversible thing, and it is a different route. An operator
 * who wants a launched logbook to stop taking reports closes it; the
 * questions stay exactly as the people who answered them saw them.
 *
 * The refusal an operator is most likely to meet is `no-fields`, and it is
 * deliberate rather than a validation afterthought: a report is a
 * logbook's answers, and a logbook that asks nothing files reports that
 * say nothing.
 */
adminRouter.post('/:id/launch', asyncRoute(async (req, res) => {
  const out = await launch(req.params.id);
  if (!out.ok) return refuse(res, out.reason, out.reason === 'no-logbook' ? 404 : 400);
  res.json(out.logbook);
}));

/**
 * DELETE a logbook that was never launched.
 *
 * A LAUNCHED ONE IS NOT DELETABLE AND THAT IS NOT A PERMISSION LEVEL.
 * It is its own hash chain, `reports` is append-only, and the daily
 * anchor's rule is that a logbook once listed stays listed with a count
 * that only grows — the refusal in src/chainHeads.js is the only thing
 * that would notice a whole logbook vanishing. The way to retire one is
 * to close it, which stops new reports and keeps the old ones.
 *
 * A draft is none of that: never launched, never anchored, no reports, no
 * chain. It is a half-built form, and until now there was no way to
 * remove one — so a typo in a slug, which is not editable, left a logbook
 * on the page forever. Lists have had this since they shipped.
 */
adminRouter.delete('/:id', asyncRoute(async (req, res) => {
  const out = await deleteDraft(req.params.id);
  if (!out.ok) return refuse(res, out.reason, out.reason === 'no-logbook' ? 404 : 400);
  res.json({ deleted: out.deleted });
}));

/**
 * DOWNLOAD a logbook as a file: its title and its questions, in the format
 * src/logbookFile.js describes. Its reports are not in it — that is the
 * archive export. The file is what somebody reads, keeps, edits by hand or
 * uploads elsewhere to start a logbook from.
 */
adminRouter.get('/:id/file', asyncRoute(async (req, res) => {
  const file = await toFile(req.params.id);
  if (!file) return refuse(res, 'no-logbook', 404);
  res.setHeader('Content-Disposition', `attachment; filename="logbook-${file.slug}.json"`);
  res.json(file);
}));

/**
 * UPLOAD a logbook file. Always makes a NEW DRAFT — never launches, never
 * touches an existing logbook — so a file can be as wrong as it likes
 * without anything reaching a reporter. What is wrong with it is said in
 * plain sentences.
 */
adminRouter.post('/from-file', asyncRoute(async (req, res) => {
  const out = await createFromFile((req.body || {}).file);
  if (!out.ok) return res.status(400).json({ error: out.errors.join(' ') , errors: out.errors });
  res.status(201).json(out.logbook);
}));

/**
 * Freeze or unfreeze this logbook's uploads. A PROTECTIVE MEASURE.
 *
 * Not "does this logbook take files" — that is whether it has an upload
 * question, and there is no route for it because it is an ordinary question
 * added and removed like any other. This is the handle for a running logbook
 * that must stop taking files now. See setFilesFrozen.
 */
adminRouter.post('/:id/files/freeze', asyncRoute(async (req, res) => {
  const out = await setFilesFrozen(req.params.id, (req.body || {}).frozen === true);
  if (!out.ok) return refuse(res, out.reason, 404);
  res.json(out.logbook);
}));

/**
 * This logbook's COMPLETE chain: every version of every report, published
 * or not, in chain order, so every link from its start to its head can be
 * checked with scripts/check-chain.js. Tier A only — no reporter's identity
 * or contact details, which were never part of a fingerprint.
 */
adminRouter.get('/:id/chain', asyncRoute(async (req, res) => {
  const file = await buildChainFile(req.params.id);
  if (!file) return res.status(404).json({ error: 'No such launched logbook.' });
  res.setHeader('Content-Disposition', `attachment; filename="chain-${file.logbook}.json"`);
  res.json(file);
}));
