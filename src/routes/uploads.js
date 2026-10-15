import crypto from 'node:crypto';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { pool } from '../db.js';
import { asyncRoute } from '../asyncRoute.js';
import {
  attachmentsAvailable, attachmentSettings, allowedTypesFor, enabledKinds,
  createUploadSlot, markSlotUploaded, slotStatuses, discardSlot,
  ALLOWED_TYPES, ATTACHMENT_KINDS, limitsFor, maxBytesForKind,
  MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, MAX_VIDEO_SECONDS,
} from '../attachments.js';

const router = express.Router();

// Uploads are authorised by a draft token, not a login — the submit form
// has never required an account, and attaching a photo must not become the
// thing that does. So this is reachable by anyone who can reach the form,
// and the quotas in createUploadSlot are the real control; these limiters
// only blunt the volume.
//
// TWO QUOTAS, AND THE SECOND IS THE ONE THAT BITES. The per-draft caps
// bound one report, and a draft token is free — POST /draft hands one to
// anybody who asks — so they bounded one draft rather than one caller. The
// staging quota keyed on the address the form collected is what closes
// that, and it is only possible because the email card now comes before
// the upload card. See migration 045.
const draftLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });
const slotLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 60 });

// One gate for the whole router. With the feature off, every route here
// 404s exactly as if the file did not exist — there is no half-enabled
// state where a client can find an endpoint that will not work.
router.use(asyncRoute(async (req, res, next) => {
  try {
    if (!(await attachmentsAvailable())) return res.status(404).json({ error: 'Not found' });
  } catch (e) { return next(e); }
  next();
}));

router.get('/config', asyncRoute(async (req, res) => {
  // THE LIMITS THAT ACTUALLY APPLY, resolved through the logbook, the site
  // and the shipped defaults (migration 038, src/attachments.js).
  //
  // The page reads them from here rather than keeping a copy that can drift
  // from the server's — so a logbook capped at one 10 MB photo says exactly
  // that on the card, instead of letting somebody pick four videos and
  // refusing the second.
  //
  // The logbook is named by its slug, resolved server-side, and an unknown
  // one falls back to the site's limits rather than erroring: a form open in
  // a tab across a relaunch should not start failing here.
  const slug = String(req.query?.logbook || '').trim();
  let logbookId = null;
  if (slug) {
    const { rows } = await pool.query('SELECT id FROM logbooks WHERE slug = $1', [slug]);
    logbookId = rows[0] ? rows[0].id : null;
  }
  const limits = await limitsFor(logbookId);

  res.json({
    enabled: true,
    // The kinds being taken here, which is the site's list narrowed by the
    // logbook's — never widened. The file picker then offers exactly what
    // will be accepted.
    kinds: limits.kinds,
    allowedTypes: limits.kinds.flatMap((k) => ATTACHMENT_KINDS[k]),
    // The largest single file of any kind that is still being accepted, so
    // the client has one number to check before it knows the type. Computed
    // from the kinds actually on, rather than from every kind the code can
    // handle: a deployment taking photos only should not advertise a video
    // ceiling.
    maxFileBytes: Math.max(...limits.kinds.map((k) => maxBytesForKind(k, limits)), 0),
    maxImageBytes: limits.maxImageBytes,
    maxVideoBytes: limits.maxVideoBytes,
    maxAudioBytes: limits.maxAudioBytes,
    maxDocumentBytes: limits.maxDocumentBytes,
    maxVideoSeconds: limits.maxVideoSeconds,
    maxDocumentPages: limits.maxDocumentPages,
    maxFiles: limits.maxFiles,
    maxTotalBytes: limits.maxTotalBytes,
  });
}));

const DRAFT_RE = /^[a-f0-9]{48}$/;

/**
 * Issue a draft token. The form asks for one the first time someone
 * attaches a file, carries it in the submit payload, and confirm time uses
 * it to find which uploads belong to the report being created.
 *
 * Server-issued rather than client-chosen so the format stays predictable
 * and quota is keyed to something we minted. It grants nothing on its own:
 * everything it authorises is bounded by the quota, and an unconfirmed
 * draft's objects expire with the staging bucket's lifecycle rule.
 */
router.post('/draft', draftLimiter, (req, res) => {
  res.status(201).json({ draft_token: crypto.randomBytes(24).toString('hex') });
});

function draftFrom(req) {
  const t = req.body?.draft_token || req.query?.draft_token || '';
  return DRAFT_RE.test(t) ? t : null;
}

router.post('/', slotLimiter, asyncRoute(async (req, res) => {
  const draft = draftFrom(req);
  if (!draft) return res.status(400).json({ error: 'Missing or malformed draft token.' });

  // WHICH LOGBOOK, SO THE RIGHT CAP APPLIES. Resolved from the slug here
  // rather than taken as an id, so a client cannot name a row it has no
  // business naming — and resolved against open logbooks only, because an
  // upload to a closed one is an upload to a form that will refuse the
  // report it belongs to.
  //
  // Unknown or absent is NOT an error: the site-wide limits apply, which is
  // what every upload before migration 037 was created under, and a form
  // open in a tab across a relaunch should not start failing here.
  let logbookId = null;
  const slug = String(req.body?.logbook || '').trim();
  if (slug) {
    const { rows } = await pool.query('SELECT id FROM logbooks WHERE slug = $1', [slug]);
    logbookId = rows[0] ? rows[0].id : null;
  }

  try {
    const slot = await createUploadSlot(draft, {
      name: req.body.name, type: req.body.type, size: Number(req.body.size), logbookId,
      // THE ADDRESS THE FORM ALREADY HAS, which is what keys the staging
      // quota across drafts. Unverified, and treated as such — it buys a
      // bucket to count in and nothing else. Required: see createUploadSlot.
      contactEmail: req.body.email,
    });
    res.status(201).json({ slot_token: slot.slotToken, upload_url: slot.uploadUrl });
  } catch (e) {
    if (e.status === 400 || e.status === 409 || e.status === 429) {
      return res.status(e.status).json({ error: e.message });
    }
    console.error('[uploads] slot creation failed', e);
    res.status(500).json({ error: 'Could not start the upload — please try again.' });
  }
}));

// The browser saying its PUT finished. Deliberately only a hint: the worker
// verifies the object is really there and re-derives everything about it
// from the bytes, so a lying client only gets its own upload marked
// unreadable.
router.post('/:slotToken/complete', slotLimiter, asyncRoute(async (req, res) => {
  const draft = draftFrom(req);
  if (!draft) return res.status(400).json({ error: 'Missing or malformed draft token.' });

  const { rows } = await pool.query(
    'SELECT slot_token FROM upload_slots WHERE slot_token = $1 AND draft_token = $2',
    [req.params.slotToken, draft],
  );
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });

  const promoted = await markSlotUploaded(req.params.slotToken);
  // Still ok either way: the call is only a hint, and the media worker
  // re-derives everything from the bytes in the bucket. But the log now says
  // which of the two happened, which is the whole question when a slot is
  // found stuck at pending afterwards.
  res.locals.log = { promoted };
  res.json({ ok: true });
}));

// Polled by the submit form for per-file progress through scanning.
router.get('/status', asyncRoute(async (req, res) => {
  const draft = draftFrom(req);
  if (!draft) return res.status(400).json({ error: 'Missing or malformed draft token.' });
  res.json(await slotStatuses(draft));
}));

router.delete('/:slotToken', slotLimiter, asyncRoute(async (req, res) => {
  const draft = draftFrom(req);
  if (!draft) return res.status(400).json({ error: 'Missing or malformed draft token.' });
  const removed = await discardSlot(req.params.slotToken, draft);
  if (!removed) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
}));

export default router;
