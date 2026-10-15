/**
 * Lists over HTTP: the form a visitor fills in, the builder an
 * administrator edits, the queue a moderator approves in bulk, and the page
 * an erasure link lands on.
 *
 * FOUR ROUTERS FOR FOUR AUDIENCES, and the split is the security model:
 *
 *   publicRouter  /api/lists         IN FRONT of the gate, each list deciding
 *   adminRouter   /api/admin/lists   administrators: make and change lists
 *   reviewRouter  /api/list-review   moderators and administrators
 *   erasePage     /api/forget/:token IN FRONT of the gate — see below
 *
 * NOTHING HERE PUBLISHES WHAT SOMEBODY WROTE. The only public read of
 * entries is a count, only over fields an operator ticked as countable, only
 * on a list whose counts an operator published and made listed. There is no
 * route that returns an entry's text to anybody but a moderator.
 *
 * AN ENTRY IS NOT A REPORT, and nothing in this file imports the report
 * side. The rules live in src/lists/ so every path goes through them; this
 * file turns their refusals into words.
 */
import express from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth, requireRole } from '../authMiddleware.js';
import { asyncRoute } from '../asyncRoute.js';
import { sendEmail } from '../email.js';
import { SITE_ORIGIN } from '../siteOrigin.js';
import { plainSiteName } from '../siteIdentity.js';
import { roleSatisfies } from '../roleRank.js';
import { hasSiteAccess, LOCKED } from '../siteAccess.js';
import {
  fileEntry, listBySlug, isAccepting, redeemErasureToken, collectionRequirements,
  summaryFor, reviewBatch, reviewEntries, setTriageState, personalRetentionDays, NEVER,
  recipientFor, nameRecipient, confirmRecipient, entryMail, CONFIRM_DAYS,
} from '../lists/index.js';
import { pool } from '../db.js';
import {
  allLists, listById, describe, templateChoices, createFromTemplate,
  updateSettings, replaceFields, deleteUnused, reviewQueues, ListRefusal, VISIBILITIES,
} from '../lists/manage.js';
import { FIELD_TYPES } from '../fieldTypes.js';
import { FORBIDDEN_KINDS } from '../lists/fields.js';

/** Days the personal half is kept, or null for never — one spelling for the wire. */
const keptDays = () => {
  const d = personalRetentionDays();
  return d === NEVER ? null : d;
};

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
}[c]));

/* ---------------- who may see a list at all ---------------- */

/**
 * VISIBILITY, ENFORCED. Until this file existed the column was a promise
 * with nothing keeping it.
 *
 *   hidden    nobody outside the admin pane. An administrator can open it
 *             to see what the form will look like.
 *   password  people who are signed in — the team reviewing something being
 *             built. "Password" is the account's, not a second one.
 *   listed    anybody who can reach the site, and it appears on the front
 *             page while it is taking entries.
 *
 * A LIST SOMEBODY MAY NOT SEE ANSWERS 404, NEVER 403. A 403 confirms the
 * thing exists, and a hidden list's address is build state.
 */
export function maySee(list, user) {
  if (!list) return false;
  if (list.visibility === 'listed') return true;
  if (list.visibility === 'password') return Boolean(user);
  return Boolean(user && roleSatisfies(user.role, 'admin'));
}

/**
 * THE SITE PASSWORD, decided per list. These routes are mounted in front of
 * the gate so that a list an administrator opened — `outside_access` link or
 * door, migration 047 — can be used by somebody without the password, which
 * is the situation of everybody a volunteer form is for. EVERY OTHER LIST
 * ANSWERS EXACTLY WHAT THE GATE WOULD: a 401 that says locked, so a closed
 * list's address tells a stranger nothing it would not have told them anyway.
 */
async function pastCurtain(req, res, list) {
  if (await hasSiteAccess(req)) return true;
  if (list && list.outside_access && list.outside_access !== 'closed' && list.visibility === 'listed') return true;
  res.status(401).json(LOCKED);
  return false;
}

/** What a visitor's form needs, and nothing of the operator's. */
function forForm(list, now = new Date()) {
  const req = collectionRequirements(list.fields);
  return {
    slug: list.slug,
    title: list.title,
    blurb: list.blurb,
    accepting: isAccepting(list, now),
    opensAt: list.opens_at,
    closesAt: list.closes_at,
    // THE FORM-LEVEL REQUIREMENT, derived and never stored: whether this
    // form shows an address card at all. Whether a given submission must
    // fill it in is decided by the server from what actually arrived.
    asksEmail: req.requiresEmail || list.email_mode === 'required',
    // WHY, so the form can say the true reason rather than one reason for
    // every form. 'always': this form wants an address from everybody —
    // because the operator said so, or because a question everybody must
    // answer is typed. 'if-written': only from somebody who wrote something.
    emailWhen: list.email_mode === 'required' ? 'always'
      : (list.fields.some((f) => f.required && f.retention !== 'absent' && req.personalKeys.includes(f.key))
        ? 'always' : (req.requiresEmail ? 'if-written' : 'never')),
    emailReason: list.email_mode === 'required' ? 'reply' : 'erase',
    personalKeys: req.personalKeys,
    // How long the personal half is kept, in days, so the form can say so
    // in words rather than in a policy page nobody opens. null is never.
    personalDays: keptDays(),
    fields: list.fields
      .filter((f) => f.retention !== 'absent')
      .map((f) => ({
        key: f.key,
        kind: f.kind,
        label: f.label,
        help: f.help,
        required: f.required,
        maxValues: f.max_values,
        options: Array.isArray(f.options?.options) ? f.options.options : [],
        allowOther: f.options?.allowOther === true,
        // Whether this answer is erased on the timer. The card says so.
        erased: f.retention === 'transient',
      })),
  };
}

/* ---------------- the form ---------------- */

export const publicRouter = express.Router();

// Writing costs an email at most and a row at least. Generous enough for an
// office behind one address; low enough that a script cannot bury the queue
// before a moderator notices — and the clusters in the review pane will show
// it either way.
const fileLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 40, keyGenerator: (req) => req.ip,
  standardHeaders: true, legacyHeaders: false,
});

/** A form completed faster than this was not read. Same filter as volunteering. */
export const MIN_FILL_MS = 2500;

/** The lists the front page offers: listed and taking entries, nothing else. */
publicRouter.get('/', asyncRoute(async (req, res) => {
  if (!await hasSiteAccess(req)) return res.status(401).json(LOCKED);
  const { rows } = await pool.query(
    "SELECT slug FROM lists WHERE visibility = 'listed' ORDER BY created_at, id",
  );
  const out = [];
  for (const r of rows) {
    const list = await listBySlug(r.slug);
    if (!isAccepting(list)) continue;
    out.push({ slug: list.slug, title: list.title, blurb: list.blurb });
  }
  res.json(out);
}));

publicRouter.get('/:slug', asyncRoute(async (req, res) => {
  const list = await listBySlug(req.params.slug);
  if (!await pastCurtain(req, res, list)) return;
  if (!maySee(list, req.user)) return res.status(404).json({ error: 'No such list' });
  res.json(forForm(list));
}));

/**
 * THE PUBLIC COUNTS. Every condition is checked here, at the boundary:
 * listed, counts published by an administrator, and only the fields they
 * ticked. Received and approved, always both — counting only approved
 * understates what came in, and counting everything publishes a figure
 * about content nobody cleared.
 */
publicRouter.get('/:slug/counts', asyncRoute(async (req, res) => {
  const list = await listBySlug(req.params.slug);
  if (!await pastCurtain(req, res, list)) return;
  if (!list || list.visibility !== 'listed' || !list.aggregates_published) {
    return res.status(404).json({ error: 'No published counts for that list' });
  }
  const s = await summaryFor(list);
  res.json({
    slug: s.slug,
    title: s.title,
    totals: { received: s.totals.received, approved: s.totals.approved, lastEntry: s.totals.lastEntry },
    definition: s.definition,
    fields: s.fields,
  });
}));

/** Refusals from fileEntry and the value checks, in words a visitor reads. */
const FILE_REFUSALS = {
  closed: 'This form is not taking anything at the moment.',
  'missing-required': 'Some questions need an answer.',
  'too-many-values': 'That is more answers than this question takes.',
  'too-long': 'That answer is too long.',
  'not-an-option': 'Pick one of the options shown.',
  'not-a-yes-or-no': 'Answer yes or no.',
  'not-a-number': 'That needs to be a number.',
  'not-a-date': 'That needs to be a date.',
  'not-a-time': 'That needs to be a time.',
  'not-a-datetime': 'That needs to be a date and time.',
  'not-an-email': 'That does not look like an email address.',
  empty: 'A link is needed here.',
  unparseable: 'That does not look like a web address. Copy the whole link, starting with https://',
  'not-http': 'Only web links work here — starting with http:// or https://',
  'credentials-in-url': 'That link has a password in it. Send the public link instead.',
  'bare-address-host': 'That link points at a bare server address. Send the link to the post or article itself.',
  shortener: 'That is a shortened link. Open it and send the full address it leads to.',
  'no-host': 'That link has no site in it.',
  'email-required-for-personal-data': 'What you wrote needs an email address with it, so you can ask for it to be deleted. Add one, or remove the writing.',
  'email-required': 'This form needs your email address.',
};

publicRouter.post('/:slug/entries', fileLimiter, asyncRoute(async (req, res) => {
  const b = req.body || {};
  const list = await listBySlug(req.params.slug);
  if (!await pastCurtain(req, res, list)) return;
  if (!maySee(list, req.user)) return res.status(404).json({ error: 'No such list' });

  // The same two cheap filters as the volunteer form. Accepted, so whatever
  // filled the hidden box in gets the same answer as everybody and learns
  // nothing, and then dropped.
  if (String(b.website || '').trim()) return res.status(201).json({ ok: true });
  const elapsed = Number(b.elapsed_ms);
  if (Number.isFinite(elapsed) && elapsed < MIN_FILL_MS) {
    return res.status(201).json({ ok: true });
  }

  const email = b.email ? String(b.email).trim().toLowerCase() : null;
  if (email && !/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ error: FILE_REFUSALS['not-an-email'], reason: 'not-an-email', key: 'email' });
  }
  const got = await fileEntry(list.slug, {
    answers: b.answers && typeof b.answers === 'object' ? b.answers : {},
    email,
    emailConsent: b.email_consent === true,
    address: req.ip,
  });
  if (!got.ok) {
    return res.status(got.reason === 'no-such-list' ? 404 : 400).json({
      error: FILE_REFUSALS[got.reason] || 'That could not be taken.',
      reason: got.reason,
      key: got.key || (got.keys && got.keys[0]) || null,
    });
  }

  // THE ERASURE LINK, mailed now and only now: the token exists in plaintext
  // for the length of this request and nowhere else. A failed send does not
  // undo the entry — it is said, so the person knows to ask by other means.
  let mailed = false;
  if (got.erasureToken && email) {
    const site = await plainSiteName();
    const url = `${SITE_ORIGIN}/api/forget/${got.erasureToken}`;
    const days = keptDays();
    const sent = await sendEmail({
      to: [{ email }],
      subject: `What you sent to ${site}`,
      html: `<p>Thanks — what you sent to <b>${esc(list.title)}</b> arrived.</p>
             <p>If you want what you wrote and your email address deleted, use this link. Any links you sent stay; your words and your address go.</p>
             <p><a href="${esc(url)}">${esc(url)}</a></p>
             <p>${days === null
    ? 'Nothing is deleted on its own, so this link is the way to do it.'
    : `If you do nothing, they are deleted on their own after ${days} days.`}</p>
             <p style="color:#666;font-size:13px">Nothing you send to this form is published. Keep this email if you might want to use the link.</p>`,
    });
    mailed = sent.sent === true;
  }

  // THE NEW-ENTRY EMAIL, where the list asks for one. To the confirmed
  // address or the admin address, never to one still pending. A failed send
  // is logged and does not touch the entry: it is on the Moderators page
  // either way.
  const to = recipientFor(list);
  if (to) {
    const m = entryMail(list, {
      answers: got.answers, erasable: got.erasable, email, emailConsent: b.email_consent === true,
    });
    const sent = await sendEmail({ to: [{ email: to }], subject: m.subject, html: m.html });
    if (!sent.sent) console.error(`[lists] the new-entry email for ${list.slug} was not sent: ${sent.reason || 'unknown'}`);
  }

  res.status(201).json({ ok: true, erasureMailed: mailed, erasable: Boolean(got.erasureToken) });
}));

/* ---------------- the builder ---------------- */

export const adminRouter = express.Router();
adminRouter.use(requireAuth);
adminRouter.use(requireRole('admin'));

const ADMIN_REFUSALS = {
  'no-template': 'No such starting point.',
  slug: 'A web address of lowercase letters, numbers and hyphens.',
  'slug-taken': 'Another list already uses that address.',
  title: 'Give it a title, under 120 characters.',
  blurb: 'The description is over 1000 characters.',
  visibility: `Visibility is one of ${VISIBILITIES.join(', ')}.`,
  outside: 'Without the password is one of: behind it, anybody with the link, or on the password page.',
  'outside-needs-listed': 'Only a listed list can be open without the site password. Set it to Listed first.',
  'email-mode': 'Ask for an email address is either "only when somebody writes something" or "always".',
  'not-an-email': 'That does not look like an email address.',
  when: 'That is not a date and time.',
  'no-list': 'No such list.',
  'no-field': 'One of those questions no longer exists. Reload and try again.',
  'no-fields': 'A list needs at least one question.',
  'key-taken': 'Two questions share a key.',
  'has-entries': 'This list has taken entries, so it cannot be deleted — that would destroy the links it exists to keep, and break every erasure link already emailed. Close it instead.',
};

function refuse(res, e) {
  if (e instanceof ListRefusal) {
    return res.status(e.code === 'no-list' ? 404 : 400).json({
      error: e.message !== e.code ? e.message : (ADMIN_REFUSALS[e.code] || e.code),
      reason: e.code,
    });
  }
  throw e;
}

adminRouter.get('/', asyncRoute(async (req, res) => {
  // The kinds a list may ask, from the one shared vocabulary less the two
  // that belong to a logbook. The builder offers exactly these.
  const kinds = FIELD_TYPES
    .filter((t) => !FORBIDDEN_KINDS.has(t.id))
    .map((t) => ({ id: t.id, label: t.label }));
  res.json({
    lists: await allLists(),
    templates: templateChoices(),
    kinds,
    personalDays: keptDays(),
  });
}));

adminRouter.post('/', asyncRoute(async (req, res) => {
  const b = req.body || {};
  try {
    const list = await createFromTemplate(b.template, { slug: b.slug, title: b.title });
    res.status(201).json(describe(list));
  } catch (e) { refuse(res, e); }
}));

adminRouter.get('/:id', asyncRoute(async (req, res) => {
  const list = await listById(req.params.id);
  if (!list) return res.status(404).json({ error: ADMIN_REFUSALS['no-list'] });
  // Counts beside the form, for the administrator: internal, not publication.
  res.json({ ...describe(list), adminEmail: process.env.ADMIN_EMAIL || null, summary: await summaryFor(list) });
}));

adminRouter.patch('/:id', asyncRoute(async (req, res) => {
  const b = req.body || {};
  try {
    let list = await updateSettings(req.params.id, b);
    let confirmSent = null;
    // NAMING WHO GETS THE EMAILS. The admin address applies at once; any
    // other is sent a link and receives nothing until it is clicked.
    if (b.notifyEmail !== undefined) {
      const named = await nameRecipient(list.id, b.notifyEmail);
      if (named.error) throw new ListRefusal(named.error);
      if (named.token) {
        const url = `${SITE_ORIGIN}/api/list-mail/${named.token}`;
        const site = await plainSiteName();
        const sent = await sendEmail({
          to: [{ email: String(b.notifyEmail).trim().toLowerCase() }],
          subject: `Receive new entries from ${site}?`,
          html: `<p>An administrator of ${esc(site)} asked for each new entry on <b>${esc(list.title)}</b> to be emailed to this address.</p>
                 <p>Nothing is sent to you unless you agree:</p>
                 <p><a href="${esc(url)}">${esc(url)}</a></p>
                 <p>If you were not expecting this, ignore it. The link stops working in ${CONFIRM_DAYS} days.</p>`,
        });
        confirmSent = sent.sent === true;
      }
      list = await listById(list.id);
    }
    res.json({ ...describe(list), adminEmail: process.env.ADMIN_EMAIL || null, confirmSent });
  } catch (e) { refuse(res, e); }
}));

adminRouter.put('/:id/fields', asyncRoute(async (req, res) => {
  try {
    res.json(describe(await replaceFields(req.params.id, (req.body || {}).fields)));
  } catch (e) { refuse(res, e); }
}));

adminRouter.delete('/:id', asyncRoute(async (req, res) => {
  try {
    res.json(await deleteUnused(req.params.id));
  } catch (e) { refuse(res, e); }
}));

/* ---------------- review, in bulk ---------------- */

export const reviewRouter = express.Router();
reviewRouter.use(requireAuth);
reviewRouter.use(requireRole(['moderator', 'admin']));

reviewRouter.get('/', asyncRoute(async (req, res) => {
  res.json(await reviewQueues());
}));

/**
 * A page of one list's entries. Shown to a moderator, who is the one person
 * who has to read the erasable half to do their job; it is still swept on
 * schedule, and nothing here publishes it.
 */
reviewRouter.get('/:id', asyncRoute(async (req, res) => {
  const list = await listById(req.params.id);
  if (!list) return res.status(404).json({ error: 'No such list' });
  const state = ['received', 'approved', 'rejected'].includes(req.query.state)
    ? req.query.state : 'received';
  const known = String(process.env.LIST_KNOWN_HOSTS || '')
    .split(',').map((h) => h.trim()).filter(Boolean);
  const batch = await reviewBatch(list.id, { state, knownHosts: known, limit: req.query.limit });
  res.json({
    list: { id: Number(list.id), slug: list.slug, title: list.title },
    fields: list.fields.map((f) => ({ key: f.key, label: f.label, kind: f.kind, retention: f.retention })),
    state,
    ...batch,
  });
}));

/**
 * Approve or reject THE IDS SENT — the page the moderator looked at, never
 * "everything matching", so a row that arrived between the render and the
 * click is not approved unseen.
 */
reviewRouter.post('/:id/review', asyncRoute(async (req, res) => {
  const list = await listById(req.params.id);
  if (!list) return res.status(404).json({ error: 'No such list' });
  const b = req.body || {};
  if (!['approved', 'rejected'].includes(b.state)) {
    return res.status(400).json({ error: 'Approve or reject.' });
  }
  if (!Array.isArray(b.ids) || !b.ids.length || b.ids.length > 500) {
    return res.status(400).json({ error: 'Send the entries you looked at, up to 500.' });
  }
  res.json(await reviewEntries(list.id, b.ids, { state: b.state, by: req.user.id }));
}));

reviewRouter.post('/:id/triage', asyncRoute(async (req, res) => {
  const list = await listById(req.params.id);
  if (!list) return res.status(404).json({ error: 'No such list' });
  const b = req.body || {};
  try {
    res.json(await setTriageState(list.id, b.ids, { state: b.state }));
  } catch {
    res.status(400).json({ error: 'Unknown triage state.' });
  }
}));

/* ---------------- the erasure link ---------------- */

/**
 * WHERE THE EMAILED LINK LANDS, served by the server rather than the app.
 *
 * IN FRONT OF THE SITE GATE. Somebody asking for their words to be deleted
 * is exercising a right, and a password prompt between them and it is a
 * refusal by another name.
 *
 * A GET NEVER ERASES. Mail scanners and link previewers open every link in
 * an email; if opening the link erased, a security product would delete
 * people's submissions for them. The GET shows a button; the POST erases.
 *
 * Plain HTML with the site's stylesheets and no script, so it works under
 * the content security policy and on any browser that can submit a form.
 */
export const erasePage = express.Router();

const eraseLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 30, keyGenerator: (req) => req.ip,
  standardHeaders: true, legacyHeaders: false,
});

function page(title, body) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title)}</title>
<link rel="stylesheet" href="/tokens.css">
<link rel="stylesheet" href="/client-first.css">
<link rel="stylesheet" href="/css/page.css">
</head><body>
<main class="padding-global padding-section-small"><div class="container-small layout_stack is-gap-small">
<h1 class="heading-style-h2">${esc(title)}</h1>
${body}
</div></main></body></html>`;
}

const TOKEN_RE = /^[A-Za-z0-9_-]{20,100}$/;

erasePage.get('/:token', eraseLimiter, (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.set('Referrer-Policy', 'no-referrer');
  if (!TOKEN_RE.test(req.params.token)) {
    return res.status(404).send(page('This link does not work',
      '<p class="text-size-regular">Check that the whole link was copied from the email.</p>'));
  }
  res.send(page('Delete what you wrote', `
<p class="text-size-regular">This deletes what you wrote and your email address from what you sent. Any links you sent stay, because they point at things that are already public.</p>
<p class="text-size-regular">It cannot be undone.</p>
<form method="post" action="/api/forget/${esc(req.params.token)}">
<button type="submit" class="button">Delete it</button>
</form>`));
});

erasePage.post('/:token', eraseLimiter, asyncRoute(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.set('Referrer-Policy', 'no-referrer');
  const got = TOKEN_RE.test(req.params.token)
    ? await redeemErasureToken(req.params.token)
    : { ok: false };
  if (!got.ok) {
    // Used, expired or unknown all read the same, on purpose: somebody
    // probing tokens learns nothing from which one it was.
    return res.status(404).send(page('This link is finished',
      '<p class="text-size-regular">Either it was used already — in which case what you wrote is gone — or what it would have deleted has been deleted on its own schedule.</p>'));
  }
  res.send(page('Deleted',
    '<p class="text-size-regular">What you wrote and your email address are gone. Nothing else is needed.</p>'));
}));

/* ---------------- agreeing to receive a list's entries ---------------- */

/**
 * The page the confirmation link lands on. Same shape as the erasure page
 * and for the same reasons: in front of the password (the address being
 * named may belong to somebody who has never had it), served as plain HTML,
 * and A GET CHANGES NOTHING — a mail scanner opening the link must not
 * agree on the owner's behalf.
 */
export const mailConfirmPage = express.Router();

mailConfirmPage.get('/:token', eraseLimiter, (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.set('Referrer-Policy', 'no-referrer');
  if (!TOKEN_RE.test(req.params.token)) {
    return res.status(404).send(page('This link does not work',
      '<p class="text-size-regular">Check that the whole link was copied from the email.</p>'));
  }
  res.send(page('Receive new entries by email', `
<p class="text-size-regular">Each new entry on this form will be emailed to you, including what people wrote and their email address if they gave one.</p>
<p class="text-size-regular">You can be taken off at any time by an administrator of the site.</p>
<form method="post" action="/api/list-mail/${esc(req.params.token)}">
<button type="submit" class="button">Yes, send them to me</button>
</form>`));
});

mailConfirmPage.post('/:token', eraseLimiter, asyncRoute(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.set('Referrer-Policy', 'no-referrer');
  const got = TOKEN_RE.test(req.params.token) ? await confirmRecipient(req.params.token) : { ok: false };
  if (!got.ok) {
    return res.status(404).send(page('This link is finished',
      '<p class="text-size-regular">It was used already, it is more than a week old, or somebody has since named a different address.</p>'));
  }
  res.send(page('Done',
    `<p class="text-size-regular">New entries on <b>${esc(got.title)}</b> will be emailed to ${esc(got.email)}.</p>`));
}));
