import crypto from 'node:crypto';
import { pool } from './db.js';
import { hmacEmail, looksLikeEmail } from './crypto.js';
import { isConfigured, storageConfig, presignUpload, deleteObject } from './storage.js';

// The whole feature is off unless it is switched on AND storage is fully
// configured. Both halves matter: a half-configured deploy that accepted
// uploads it could not store would lose evidence silently, which is worse
// than not offering the feature.
//
// `settings` is the row from site_settings, or null when the caller has
// not got one. Its attachments_enabled is tri-state: true and false are an
// admin's decision, and NULL means they have not made one, so the
// environment answers. Storage being configured is never negotiable —
// nothing an admin can press conjures somewhere to put the files.
export function attachmentsEnabled(settings) {
  if (!isConfigured()) return false;
  const chosen = settings ? settings.attachments_enabled : null;
  if (chosen === true || chosen === false) return chosen;
  return process.env.ATTACHMENTS_ENABLED === 'true';
}

// Two families, handled two different ways.
//
// TRIMMED formats are a stream of labelled segments, so the metadata can
// be lifted out without decoding a single pixel (see stripMetadata below).
// Nothing hostile is ever parsed by us beyond a length field.
//
// DECODED formats — HEIC and video — cannot be made safe that way: the
// location data is woven through a box structure whose offsets would all
// have to be rewritten. So those are decoded and re-encoded by an external
// tool in the worker instead (see src/media.js). That is stronger, because
// the published copy is built by our own encoder from pixels alone and can
// only contain what we put in it.
export const TRIMMED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const DECODED_IMAGE_TYPES = ['image/heic', 'image/heif'];
export const VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'];

// Audio joins the DECODED half rather than the TRIMMED one: an MP3's tags
// or an M4A's metadata boxes could be lifted out by hand, but re-encoding
// through the same tool video already uses is both stronger and less code
// to be wrong. There is nothing to publish in an audio file except the
// sound, so rebuilding it loses nothing.
export const AUDIO_TYPES = ['audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/ogg', 'audio/wav', 'audio/webm'];

// A PDF is the one format where "we removed the metadata" would be a claim
// we cannot back. It can carry embedded files, JavaScript, external
// references and its author's identity in half a dozen places, and there
// is no safe subset to strip down to.
//
// So a PDF is never published as a PDF. Each page is rendered to an image
// and those images are what anyone sees — the same rebuild-not-redact
// discipline as everything else, applied to the one format that most
// needs it. The original stays encrypted as evidence like any other
// original, openable by a moderator with a written reason.
export const DOCUMENT_TYPES = ['application/pdf'];

export const ALLOWED_TYPES = [
  ...TRIMMED_TYPES, ...DECODED_IMAGE_TYPES, ...VIDEO_TYPES, ...AUDIO_TYPES, ...DOCUMENT_TYPES,
];

/**
 * The families an administrator chooses between, and the media types each
 * one covers.
 *
 * Families rather than media types because "photos, video, audio,
 * documents?" is the question somebody actually has, and picking media
 * types by hand invites the mistake of allowing JPEG and forgetting that
 * half of all iPhone photos are HEIC.
 */
export const ATTACHMENT_KINDS = {
  photo: [...TRIMMED_TYPES, ...DECODED_IMAGE_TYPES],
  video: VIDEO_TYPES,
  audio: AUDIO_TYPES,
  document: DOCUMENT_TYPES,
};
export const ALL_KINDS = Object.keys(ATTACHMENT_KINDS);

/**
 * Which families may be uploaded right now.
 *
 * NULL in the database means every family the code supports, so a deploy
 * that never touches the setting keeps working. An empty array is a real
 * answer meaning none, and is not the same thing.
 */
export function enabledKinds(settings) {
  const chosen = settings ? settings.attachment_kinds : null;
  if (!Array.isArray(chosen)) return ALL_KINDS.slice();
  return chosen.filter((k) => ALL_KINDS.includes(k));
}

export function allowedTypesFor(settings) {
  return enabledKinds(settings).flatMap((k) => ATTACHMENT_KINDS[k]);
}

/**
 * The attachment settings, cached briefly.
 *
 * Every upload request and every render of the form asks this, and the row
 * changes about twice a year. Reading it fresh each time is a query per
 * keystroke's worth of traffic for a value that is effectively constant.
 *
 * Five seconds is short enough that an admin pressing the switch sees it
 * take effect while still looking at the page, and long enough that a burst
 * of uploads does not become a burst of queries. Deliberately not
 * invalidated on write: a cache that has to be told about every writer is a
 * cache with a bug waiting in whichever writer gets forgotten.
 */
let settingsCache = { at: 0, row: null };
const SETTINGS_TTL_MS = 5000;

export async function attachmentSettings() {
  if (Date.now() - settingsCache.at < SETTINGS_TTL_MS) return settingsCache.row;
  try {
    const { rows } = await pool.query(
      'SELECT attachments_enabled, attachment_kinds FROM site_settings WHERE id = true',
    );
    settingsCache = { at: Date.now(), row: rows[0] || null };
  } catch {
    // A database that cannot answer must not make the feature look
    // switched ON. Falling through with a null row means the environment
    // decides, which is where this lived before the setting existed.
    settingsCache = { at: Date.now(), row: null };
  }
  return settingsCache.row;
}

/** Drop the cache, so a write is visible on the very next read. */
export function clearAttachmentSettingsCache() {
  settingsCache = { at: 0, row: null };
}

/** The gate, with the stored setting consulted. */
export async function attachmentsAvailable() {
  return attachmentsEnabled(await attachmentSettings());
}

/**
 * Is this media type accepted right now?
 *
 * Two questions, not one: the code has to support the type at all, and an
 * administrator has to have left its family switched on. Narrowing the list
 * only ever affects NEW uploads — nothing here is consulted when reading a
 * file that was already accepted, so turning documents off tomorrow does
 * not hide the PDF somebody filed today.
 */
export async function isCurrentlyAllowedType(t) {
  const type = String(t || '').toLowerCase();
  if (!ALLOWED_TYPES.includes(type)) return false;
  return allowedTypesFor(await attachmentSettings()).includes(type);
}

/**
 * THE SHIPPED DEFAULTS, and they are the bottom layer of three.
 *
 * Since migration 038 every one of these is something an operator sets, per
 * site and per logbook. These are what applies when nobody has: the values
 * this software shipped with, which is what every deployment was running on
 * before the columns existed.
 *
 * THE MAX_* ENVIRONMENT VARIABLES ARE STILL READ, and only here. They are no
 * longer the control — an environment variable needs shell access to a
 * production box, is invisible from the interface meant to describe the
 * deployment, records nobody and nothing, and on this project there is no SSH
 * from a session. But a deployment that set one is entitled to keep the value
 * it chose, so they feed the default rather than being ripped out.
 *
 * Read `limitsFor` instead of these, everywhere. They are exported because
 * the config endpoint and the suite both need to know what the floor is.
 */
export const MAX_IMAGE_BYTES = Number(process.env.MAX_IMAGE_BYTES || 25 * 1024 * 1024);
export const MAX_VIDEO_BYTES = Number(process.env.MAX_VIDEO_BYTES || 150 * 1024 * 1024);
export const MAX_VIDEO_SECONDS = Number(process.env.MAX_VIDEO_SECONDS || 180);

// The largest single file of any kind — what the upload endpoint checks
// before it knows more, and the ceiling the worker enforces again.
export const MAX_FILE_BYTES = Math.max(MAX_IMAGE_BYTES, MAX_VIDEO_BYTES);
export const MAX_FILES_PER_SUBMISSION = 10;
export const MAX_TOTAL_BYTES = Number(process.env.MAX_TOTAL_BYTES || 400 * 1024 * 1024);

// The three ways a staged upload can end without reaching a report, kept
// here rather than as string literals at each call site — they are read by
// the confirm handler, the worker's expiry sweep and the quota query, and
// a typo in any of them fails silently as "this status matched nothing".
//
// WITHDRAWN  the reporter removed it. Not news to them, and not a moderator's
//            business either.
// EXPIRED    the draft was abandoned and the slot aged out.
// REFUSED    we turned it away. This is the one that must be visible to
//            both the reporter and the moderator.
export const WITHDRAWN_STATUSES = ['withdrawn', 'expired'];
export const REFUSED_STATUSES = ['rejected', 'infected', 'unreadable'];

/** Did this slot fail to reach the report because we refused it? */
export function isRefused(status) {
  return REFUSED_STATUSES.includes(status);
}

/** Should this slot be named back to the reporter as "did not attach"? */
export function isExcludedFromReport(status) {
  return status !== 'clean' && !WITHDRAWN_STATUSES.includes(status);
}

export function kindFor(type) {
  if (VIDEO_TYPES.includes(type)) return 'video';
  if (AUDIO_TYPES.includes(type)) return 'audio';
  if (DOCUMENT_TYPES.includes(type)) return 'document';
  if (ALLOWED_TYPES.includes(type)) return 'image';
  return null;
}

/**
 * ONE NAME FOR THE PHOTO KIND, because there have been two and it cost a bug.
 *
 * `kindFor` has always returned 'image'. `ATTACHMENT_KINDS` — the operator's
 * list, which the site switch and now the per-logbook switch both write — has
 * always keyed it 'photo'. Nothing compared the two until migration 038 made
 * the accepted-kinds list something an upload is checked against, and then
 * `limits.kinds.includes(kindFor(type))` was false for every photograph ever
 * uploaded.
 *
 * Renaming either one would be the tidier fix and is not available: 'image'
 * is in `maxBytesFor`'s shape and in the worker, and 'photo' is in
 * `site_settings.attachment_kinds` on every existing deployment and in the
 * database's own CHECK. So the translation is named once, here, and every
 * comparison goes through it.
 */
export function settingKindFor(type) {
  const k = kindFor(type);
  return k === 'image' ? 'photo' : k;
}

export const MAX_AUDIO_BYTES = Number(process.env.MAX_AUDIO_BYTES || 60 * 1024 * 1024);
export const MAX_DOCUMENT_BYTES = Number(process.env.MAX_DOCUMENT_BYTES || 30 * 1024 * 1024);
// A page count as well as a byte count. A small PDF can still be nine
// hundred pages, and every page becomes an image somebody has to store and
// a moderator has to look at.
export const MAX_DOCUMENT_PAGES = Number(process.env.MAX_DOCUMENT_PAGES || 40);

// Each family gets its own allowance, because one number for everything is
// either far too small for a video or absurdly large for a photo.
export function maxBytesFor(type) {
  const kind = kindFor(type);
  if (kind === 'video') return MAX_VIDEO_BYTES;
  if (kind === 'audio') return MAX_AUDIO_BYTES;
  if (kind === 'document') return MAX_DOCUMENT_BYTES;
  return MAX_IMAGE_BYTES;
}

// Matches report_submission_tokens' own TTL, so a staged upload and the
// submission it belongs to expire together. Twenty-four hours since
// 5 October; src/submissionTokens.js carries the reasoning and the cost, and
// the suite asserts the two numbers are still equal — they are a pair, and a
// change to one alone is the bug.
const SLOT_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * HOW MUCH ONE ADDRESS MAY HAVE STAGED AT ONCE, in reports' worth.
 *
 * The per-draft caps below (`maxFiles`, `maxTotalBytes`) bound one report,
 * and until now they were the only caps there were — so somebody who wanted
 * to park bytes simply asked for another draft token, which is free by
 * design. This is the ceiling across every draft one address has open, and
 * it is what the email card moving ahead of the upload card bought.
 *
 * THREE REPORTS' WORTH, which is a judgement and not a measurement. A
 * reporter who files, finds a mistake, and files again has two live drafts
 * in the same hour; three leaves room for that and for a browser that lost
 * its draft token mid-upload. It is an operator setting because the right
 * number depends on a deployment nobody has run yet, and the honest default
 * is a generous one: refusing a second real report is a far worse failure
 * than letting somebody stage 1.2 GB they never confirm.
 *
 * ZERO TURNS IT OFF rather than refusing everything, because a limit of
 * nothing at all is never what somebody means by typing 0, and a form that
 * refuses every file is the kind of outage nobody notices until a report is
 * lost.
 */
export const STAGING_QUOTA_REPORTS = Number(process.env.STAGING_QUOTA_REPORTS || 3);

export function isAllowedType(t) {
  return ALLOWED_TYPES.includes(String(t || '').toLowerCase());
}

// What the bytes actually are, as opposed to what the browser claimed.
// Every downstream decision uses this and never the Content-Type header:
// the declared type is attacker-controlled in exactly the case that
// matters.
export function sniffType(buf) {
  if (buf.length >= 3 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'image/jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))) return 'image/png';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  // Matroska/WebM
  if (buf.length >= 4 && buf.subarray(0, 4).equals(Buffer.from([0x1A, 0x45, 0xDF, 0xA3]))) return 'video/webm';
  // ISO base media: HEIC photos and MP4/MOV video share one container, and
  // the brand in the ftyp box is what separates them. An iPhone photo is
  // 'heic'; an iPhone video is 'qt  '
  if (buf.length >= 12 && buf.subarray(4, 8).toString('latin1') === 'ftyp') {
    const brand = buf.subarray(8, 12).toString('latin1');
    if (['heic', 'heix', 'heim', 'heis', 'hevc', 'mif1', 'msf1'].includes(brand)) return 'image/heic';
    if (brand === 'qt  ') return 'video/quicktime';
    // Audio-only MP4 declares itself. M4A from a phone's voice memo app is
    // the common case and is otherwise indistinguishable from video here.
    if (['M4A ', 'M4B ', 'F4A '].includes(brand)) return 'audio/mp4';
    if (['isom', 'iso2', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'M4V ', 'dash'].includes(brand)) return 'video/mp4';
  }
  // %PDF- , allowing for the leading junk some producers emit. The spec
  // permits the header within the first 1024 bytes, and readers accept it,
  // so refusing to look past byte 0 would reject files every PDF reader
  // opens happily.
  const pdfAt = buf.subarray(0, Math.min(buf.length, 1024)).indexOf('%PDF-');
  if (pdfAt !== -1) return 'application/pdf';
  // ID3-tagged MP3, and a bare MPEG audio frame.
  if (buf.length >= 3 && buf.subarray(0, 3).toString('latin1') === 'ID3') return 'audio/mpeg';
  if (buf.length >= 2 && buf[0] === 0xFF && (buf[1] & 0xE6) === 0xE2) return 'audio/mpeg';
  // RIFF/WAVE, which shares its first four bytes with WebP above.
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF'
      && buf.subarray(8, 12).toString('latin1') === 'WAVE') return 'audio/wav';
  if (buf.length >= 4 && buf.subarray(0, 4).toString('latin1') === 'OggS') return 'audio/ogg';
  return null;
}

/**
 * Split a file into the bytes safe to publish and the metadata that must
 * not be. Container-level parsing only — no pixels are decoded, so a
 * malformed file produces a parse failure rather than a crash in a decoder
 * we would then have to trust.
 *
 * Returns { clean, metadata } where `metadata` is whatever was removed,
 * kept because GPS and capture time are genuinely evidentiary even though
 * they can never be published.
 */
export function stripMetadata(buf, mediaType) {
  if (mediaType === 'image/jpeg') return stripJpeg(buf);
  if (mediaType === 'image/png') return stripPng(buf);
  if (mediaType === 'image/webp') return stripWebp(buf);
  return { clean: buf, metadata: {} };
}

// Walks the JPEG marker segments, copying everything except the metadata
// application segments. APP0 is kept when it is JFIF (it carries pixel
// aspect, not identity); APP1 (EXIF/XMP), APP2 (ICC/FlashPix), the rest of
// the APP range and COM are dropped. Once SOS is reached the remainder is
// entropy-coded image data and is copied verbatim.
function stripJpeg(buf) {
  const out = [buf.subarray(0, 2)];
  const removed = [];
  let i = 2;

  while (i < buf.length - 1) {
    if (buf[i] !== 0xFF) break;
    const marker = buf[i + 1];

    if (marker === 0xD8 || (marker >= 0xD0 && marker <= 0xD9)) {
      out.push(buf.subarray(i, i + 2));
      i += 2;
      continue;
    }
    if (marker === 0xDA) {
      out.push(buf.subarray(i));
      i = buf.length;
      break;
    }

    const len = buf.readUInt16BE(i + 2);
    const segment = buf.subarray(i, i + 2 + len);
    const isJfif = marker === 0xE0 && segment.subarray(4, 8).toString('latin1') === 'JFIF';
    const isMetadata = (marker >= 0xE1 && marker <= 0xEF) || marker === 0xFE || (marker === 0xE0 && !isJfif);

    if (isMetadata) {
      removed.push({ marker: `0xFF${marker.toString(16).toUpperCase()}`, bytes: segment.length });
    } else {
      out.push(segment);
    }
    i += 2 + len;
  }

  return { clean: Buffer.concat(out), metadata: { format: 'jpeg', removed } };
}

// PNG is a clean chunk stream, so this is an allow-list: the critical
// chunks plus the ancillary ones that affect rendering. Everything else —
// tEXt/zTXt/iTXt (comments, software, sometimes GPS), eXIf, tIME — goes.
function stripPng(buf) {
  const KEEP = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'gAMA', 'cHRM',
    'sRGB', 'iCCP', 'sBIT', 'bKGD', 'pHYs', 'acTL', 'fcTL', 'fdAT']);
  const out = [buf.subarray(0, 8)];
  const removed = [];
  let i = 8;

  while (i + 8 <= buf.length) {
    const len = buf.readUInt32BE(i);
    const type = buf.subarray(i + 4, i + 8).toString('latin1');
    const total = 12 + len;
    if (i + total > buf.length) break;
    if (KEEP.has(type)) out.push(buf.subarray(i, i + total));
    else removed.push({ chunk: type, bytes: total });
    i += total;
    if (type === 'IEND') break;
  }

  return { clean: Buffer.concat(out), metadata: { format: 'png', removed } };
}

// RIFF container: drop the EXIF and XMP chunks, rewrite the outer size.
function stripWebp(buf) {
  const out = [];
  const removed = [];
  let i = 12;

  while (i + 8 <= buf.length) {
    const fourcc = buf.subarray(i, i + 4).toString('latin1');
    const size = buf.readUInt32LE(i + 4);
    const total = 8 + size + (size % 2); // chunks are word-aligned
    if (i + total > buf.length) break;
    if (fourcc === 'EXIF' || fourcc === 'XMP ') removed.push({ chunk: fourcc, bytes: total });
    else out.push(buf.subarray(i, i + total));
    i += total;
  }

  const payload = Buffer.concat(out);
  const header = Buffer.from(buf.subarray(0, 12));
  header.writeUInt32LE(payload.length + 4, 4);
  return { clean: Buffer.concat([header, payload]), metadata: { format: 'webp', removed } };
}

/**
 * Reserve an upload slot for one file and hand back a presigned PUT.
 *
 * Quota is enforced here, before any URL is issued, because this endpoint
 * is reachable with nothing but a submission token — the same unverified
 * position the submit form itself is in. An attacker who never confirms an
 * email should not be able to park bytes in the bucket indefinitely.
 */
export async function createUploadSlot(draftToken, {
  name, type, size, logbookId = null,
  // WHICH REQUEST THIS ANSWERS, when a reporter is sending evidence they
  // were asked for rather than filing. Passed by the server from a redeemed
  // request token, never from the client, so a slot cannot be moved onto
  // somebody else's request.
  evidenceRequestId = null,
  // THE ADDRESS THE FORM COLLECTED, unverified, for the staging quota and
  // for nothing else. Required while filing — the email card comes before
  // the upload card on every logbook that takes files, so the form always
  // has one, and accepting a slot without it would make the quota
  // decorative: an attacker would simply stop sending the field.
  //
  // An evidence-request slot passes none. It is authorised by a scoped
  // one-time link instead, which is a stronger thing than an address
  // somebody typed, and that path has no form to collect one on.
  contactEmail = null,
} = {}) {
  const normalizedType = String(type || '').toLowerCase();

  // WHOSE STAGING THIS IS, resolved before anything else is checked so that
  // a request with no address is refused for that reason rather than for
  // whichever limit it happens to trip first.
  //
  // `filing` is "not answering an evidence request", which is the only path
  // that has a form and therefore the only one that can be asked for this.
  const filing = !evidenceRequestId;
  const address = contactEmail === null || contactEmail === undefined
    ? '' : String(contactEmail).trim();
  if (filing && !looksLikeEmail(address)) {
    const err = new Error('Please give the email address for this report before attaching files.');
    err.status = 400;
    throw err;
  }
  // `hmacEmail` trims and lowercases on the way in, so one person's address
  // is one bucket however they typed it, and it is the same digest
  // `sealRestricted` writes — the quota and the report's own contact key
  // cannot disagree about what one address is.
  const contactHmac = filing ? hmacEmail(address) : null;

  // FIRST, WHAT THE CODE CAN HANDLE AT ALL. Not a setting: a type nothing
  // here can decode is not a configuration choice, and an operator cannot
  // switch on support that does not exist.
  if (!isAllowedType(normalizedType)) {
    const err = new Error('That file type can\'t be attached. Photos: JPEG, PNG, HEIC or WebP. Video: MP4, MOV or WebM. Audio, and PDF documents.');
    err.status = 400;
    throw err;
  }

  // THEN WHICH LOGBOOK'S LIMITS APPLY, because since migration 038 every
  // limit below belongs to a logbook or a site rather than to this file.
  //
  // The first slot in a draft fixes the logbook. A later slot naming a
  // different one is refused rather than quietly accepted: the alternative
  // is a client choosing whichever logbook has the loosest limits on each
  // request, which would make a per-logbook limit decorative.
  //
  // A draft with no logbook named gets the site's limits, which is what
  // every upload before 037 was created under.
  const { rows: existing } = await pool.query(
    `SELECT count(*)::int AS n, coalesce(sum(declared_size), 0)::bigint AS total,
            max(logbook_id) AS logbook_id
     FROM upload_slots
     WHERE draft_token = $1 AND status NOT IN ('rejected', 'withdrawn', 'expired')`,
    [draftToken],
  );
  const fixed = existing[0].logbook_id;
  if (fixed && logbookId && String(fixed) !== String(logbookId)) {
    const err = new Error('These files are already being attached to a different logbook\u2019s report.');
    err.status = 409;
    throw err;
  }
  const forLogbook = fixed || logbookId || null;
  const limits = await limitsFor(forLogbook);

  // WHICH KINDS ARE BEING TAKEN. Two refusals, phrased differently on
  // purpose: a type the code cannot handle is "we do not take that" (above);
  // a kind that is switched off is "we are not taking that at the moment" —
  // and telling somebody their file is unsupported when it is merely
  // disabled sends them away converting a file for no reason.
  // Through settingKindFor, not kindFor: the operator's list keys photos as
  // 'photo' and kindFor says 'image'. See settingKindFor.
  const kind = kindFor(normalizedType);
  if (!limits.kinds.includes(settingKindFor(normalizedType))) {
    const err = new Error(limits.kinds.length
      ? `That kind of file is not being accepted at the moment. Currently accepted: ${limits.kinds.join(', ')}.`
      : 'File attachments are not being accepted at the moment.');
    err.status = 400;
    throw err;
  }

  const cap = maxBytesForKind(kind, limits);
  if (!Number.isFinite(size) || size <= 0 || size > cap) {
    const mb = Math.floor(cap / 1024 / 1024);
    const mins = Math.round(limits.maxVideoSeconds / 60);
    // Seconds rather than "0 minutes" where somebody set a short limit: a
    // thirty-second cap is a real choice on an election logbook, and
    // rounding it to zero minutes reads as broken.
    const dur = limits.maxVideoSeconds < 90
      ? `${limits.maxVideoSeconds} seconds` : `${mins} minutes`;
    const err = new Error(
      kind === 'video' ? `Each video must be under ${mb} MB and ${dur}.`
      : kind === 'audio' ? `Each audio file must be under ${mb} MB and ${dur}.`
      : kind === 'document' ? `Each document must be under ${mb} MB and ${limits.maxDocumentPages} pages.`
      : `Each photo must be under ${mb} MB.`);
    err.status = 400;
    throw err;
  }

  if (existing[0].n >= limits.maxFiles) {
    const err = new Error(limits.maxFiles === 1
      // One file is a deliberate setting rather than a tight default, so it
      // says so: somebody who reads "at most 1 files" assumes a bug.
      ? 'This form takes one file. Replace the one you attached if you meant a different one.'
      : `A report can carry at most ${limits.maxFiles} files.`);
    err.status = 400;
    throw err;
  }
  if (Number(existing[0].total) + size > limits.maxTotalBytes) {
    const err = new Error(`Attachments on one report must total under ${Math.floor(limits.maxTotalBytes / 1024 / 1024)} MB.`);
    err.status = 400;
    throw err;
  }

  // AND THEN WHAT THIS ADDRESS HAS STAGED ACROSS EVERY DRAFT, which is the
  // cap a free draft token could walk around. Unexpired and unpromoted rows
  // only: a slot that already became part of a report is storage the archive
  // means to hold, and an expired one is about to be swept.
  //
  // Counted in bytes rather than files. Files are the cheap half — the cost
  // of abandoned staging is the bucket, and one 150 MB video is worth
  // thirty photographs.
  if (contactHmac && STAGING_QUOTA_REPORTS > 0) {
    const ceiling = limits.maxTotalBytes * STAGING_QUOTA_REPORTS;
    const { rows: held } = await pool.query(
      `SELECT coalesce(sum(declared_size), 0)::bigint AS total
       FROM upload_slots
       WHERE contact_hmac = $1
         AND promoted_at IS NULL
         AND expires_at > now()
         AND status NOT IN ('rejected', 'withdrawn', 'expired')`,
      [contactHmac],
    );
    if (Number(held[0].total) + size > ceiling) {
      // Deliberately does NOT say how much is left or how the ceiling is
      // worked out. The reporter this reaches is somebody with an unfinished
      // report somewhere, and the thing that helps them is finishing it; the
      // arithmetic only helps somebody measuring the limit.
      const err = new Error(
        'There are already files waiting against this email address. '
        + 'Finish or send the report they belong to, or wait a day for them to clear.');
      err.status = 429;
      throw err;
    }
  }

  const slotToken = crypto.randomBytes(24).toString('hex');
  // Random key, never the uploader's filename: the original name is
  // untrusted input and must never influence a storage path.
  const stagingKey = `staging/${slotToken}`;

  await pool.query(
    `INSERT INTO upload_slots (slot_token, draft_token, declared_name, declared_type,
                               declared_size, staging_key, expires_at, logbook_id,
                               evidence_request_id, contact_hmac, released_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [slotToken, draftToken, String(name || '').slice(0, 255), normalizedType, size,
      stagingKey, new Date(Date.now() + SLOT_TTL_MS), forLogbook, evidenceRequestId,
      contactHmac,
      // RELEASED AT CREATION ON THE EVIDENCE PATH ONLY, which keeps that
      // flow exactly as it was: the reporter came through a scoped one-time
      // link and its submit step hands the files over in the same request,
      // so there is no later moment at which to release them.
      //
      // A filing slot is released when the reporter presses Send
      // (`releaseDraft`). Until then the worker will not touch it — see
      // migration 045, and the gate that is gone because of it.
      filing ? null : new Date()],
  );

  return { slotToken, uploadUrl: presignUpload(stagingKey), key: stagingKey };
}

/**
 * How many files and how many bytes one report in this logbook may carry.
 *
 * Kept as its own name because two callers want only these two numbers;
 * everything about limits is `limitsFor`.
 */
export async function capsFor(logbookId, client = pool) {
  const { maxFiles, maxTotalBytes } = await limitsFor(logbookId, client);
  return { maxFiles, maxTotalBytes };
}

/** The shipped defaults, in the shape `limitsFor` returns. */
export function shippedLimits() {
  return {
    maxImageBytes: MAX_IMAGE_BYTES,
    maxVideoBytes: MAX_VIDEO_BYTES,
    maxAudioBytes: MAX_AUDIO_BYTES,
    maxDocumentBytes: MAX_DOCUMENT_BYTES,
    maxVideoSeconds: MAX_VIDEO_SECONDS,
    maxDocumentPages: MAX_DOCUMENT_PAGES,
    maxFiles: MAX_FILES_PER_SUBMISSION,
    maxTotalBytes: MAX_TOTAL_BYTES,
    kinds: ALL_KINDS.slice(),
  };
}

const LIMIT_COLUMNS = [
  ['max_image_bytes', 'maxImageBytes'],
  ['max_video_bytes', 'maxVideoBytes'],
  ['max_audio_bytes', 'maxAudioBytes'],
  ['max_document_bytes', 'maxDocumentBytes'],
  ['max_video_seconds', 'maxVideoSeconds'],
  ['max_document_pages', 'maxDocumentPages'],
  ['max_files', 'maxFiles'],
  ['max_total_bytes', 'maxTotalBytes'],
];

/**
 * EVERY UPLOAD LIMIT THAT APPLIES, resolved through three layers.
 *
 *   the logbook   a column, NULL unless somebody set it
 *   the site      site_settings, NULL unless somebody set it
 *   the shipped default
 *
 * Narrowest wins, and a layer that set nothing is invisible — so a logbook
 * nobody configured behaves exactly as its site does, and a site nobody
 * configured behaves exactly as this software did before migration 038.
 *
 * KINDS INTERSECT RATHER THAN OVERRIDE, and the asymmetry is deliberate.
 * Every other limit is a number and the narrower one simply wins. A kind
 * list is a set, and a logbook naming `video` on a deployment with video
 * switched off must not get video — pressing a site switch has to mean
 * something everywhere. So the site list is a CEILING and the result is the
 * intersection.
 *
 * One query, because this is read on every upload request and every render
 * of the form.
 */
export async function limitsFor(logbookId, client = pool) {
  const shipped = shippedLimits();
  let row = null;
  try {
    const { rows } = await client.query(
      `SELECT ${LIMIT_COLUMNS.map(([c]) => `s.${c} AS site_${c}`).join(', ')},
              s.attachment_kinds AS site_kinds
              ${logbookId ? `, ${LIMIT_COLUMNS.map(([c]) => `lb.${c} AS lb_${c}`).join(', ')}, lb.attachment_kinds AS lb_kinds` : ''}
         FROM site_settings s
         ${logbookId ? 'LEFT JOIN logbooks lb ON lb.id = $1' : ''}
        WHERE s.id = true`,
      logbookId ? [logbookId] : [],
    );
    row = rows[0] || null;
  } catch {
    // A database that cannot answer must not remove every limit. Falling
    // back to the shipped values is the safe direction: they are the
    // narrowest thing this software has ever enforced by default.
    return shipped;
  }
  if (!row) return shipped;

  const out = { ...shipped };
  for (const [col, key] of LIMIT_COLUMNS) {
    const chosen = (logbookId ? row[`lb_${col}`] : null) ?? row[`site_${col}`];
    if (chosen !== null && chosen !== undefined) out[key] = Number(chosen);
  }

  const siteKinds = Array.isArray(row.site_kinds)
    ? row.site_kinds.filter((k) => ALL_KINDS.includes(k)) : shipped.kinds;
  const bookKinds = logbookId && Array.isArray(row.lb_kinds)
    ? row.lb_kinds.filter((k) => ALL_KINDS.includes(k)) : null;
  // In ALL_KINDS order, so two deployments that chose the same kinds report
  // them identically.
  out.kinds = ALL_KINDS.filter((k) => siteKinds.includes(k)
    && (bookKinds === null || bookKinds.includes(k)));
  return out;
}

/**
 * EVERY LAYER'S OWN ANSWER, not just the one that won.
 *
 * `limitsFor` resolves three layers into one number, which is what an
 * upload needs and exactly the wrong thing to put in front of an operator:
 * shown only the effective value they cannot tell a limit they set from one
 * they inherited, and the first thing they do is set all nine to the numbers
 * already showing — which silently freezes the logbook against every later
 * change to the site. Same lesson as the keyword list's three states.
 *
 * Per key: what this logbook stores, what the site stores, what ships, the
 * value in force, and WHICH layer it came from.
 */
export async function limitLayers(logbookId, client = pool) {
  const shipped = shippedLimits();
  const effective = await limitsFor(logbookId, client);
  let site = {}; let book = {};
  try {
    const { rows } = await client.query(
      `SELECT ${LIMIT_COLUMNS.map(([c]) => `s.${c} AS site_${c}`).join(', ')},
              s.attachment_kinds AS site_kinds
              ${logbookId ? `, ${LIMIT_COLUMNS.map(([c]) => `lb.${c} AS lb_${c}`).join(', ')}, lb.attachment_kinds AS lb_kinds` : ''}
         FROM site_settings s
         ${logbookId ? 'LEFT JOIN logbooks lb ON lb.id = $1' : ''}
        WHERE s.id = true`,
      logbookId ? [logbookId] : [],
    );
    const row = rows[0] || {};
    for (const [col, key] of LIMIT_COLUMNS) {
      site[key] = row[`site_${col}`] == null ? null : Number(row[`site_${col}`]);
      book[key] = logbookId && row[`lb_${col}`] != null ? Number(row[`lb_${col}`]) : null;
    }
    site.kinds = Array.isArray(row.site_kinds) ? row.site_kinds : null;
    book.kinds = logbookId && Array.isArray(row.lb_kinds) ? row.lb_kinds : null;
  } catch {
    // The same safe direction limitsFor takes: report the shipped floor
    // rather than claim an operator has set nothing when we cannot tell.
    site = {}; book = {};
  }

  const keys = [...LIMIT_COLUMNS.map(([, k]) => k), 'kinds'];
  const out = {};
  for (const key of keys) {
    const mine = book[key] ?? null;
    const theirs = site[key] ?? null;
    out[key] = {
      logbook: mine,
      site: theirs,
      shipped: shipped[key],
      effective: effective[key],
      // Kinds INTERSECT rather than override, so no single layer owns the
      // result when both have named some — saying 'site' there would be a
      // lie, and saying 'logbook' would hide the ceiling.
      source: key === 'kinds'
        ? (mine && theirs ? 'both' : (mine ? 'logbook' : (theirs ? 'site' : 'shipped')))
        : (mine !== null ? 'logbook' : (theirs !== null ? 'site' : 'shipped')),
    };
  }
  return out;
}

/**
 * Store the site's own limits. Only the keys sent are written.
 *
 * `validateLimits` has already been past them — this does not re-check,
 * because two copies of a range is how they drift.
 */
export async function setSiteLimits(values, client = pool) {
  const sets = []; const args = [];
  for (const [key, range] of Object.entries(LIMIT_RANGES)) {
    if (!(key in values)) continue;
    args.push(values[key]);
    sets.push(`${range.column} = $${args.length}`);
  }
  if ('kinds' in values) {
    args.push(values.kinds);
    sets.push(`attachment_kinds = $${args.length}`);
  }
  if (!sets.length) return { ok: true, changed: 0 };
  await client.query(
    `UPDATE site_settings SET ${sets.join(', ')}, updated_at = now() WHERE id = true`, args,
  );
  // The kinds live behind a cache that the attachments panel also writes,
  // so a stale read here would show an operator their own change undone.
  clearAttachmentSettingsCache();
  return { ok: true, changed: sets.length };
}

/**
 * WHAT AN OPERATOR MAY SET EACH LIMIT TO.
 *
 * These bounds are not opinions about good practice. They are the points
 * past which something else breaks — a single file larger than the media
 * worker can hold while re-encoding, an hour of video that is not evidence
 * of an incident, a thousand-page PDF that becomes a thousand page images
 * somebody has to store and a moderator has to look at.
 *
 * THEY MUST AGREE WITH THE CHECK CONSTRAINTS IN migration 038, and the
 * suite proves it behaviourally rather than by reading the constraint back:
 * for every key it asks the database to accept `min` and `max` and to refuse
 * `min - 1` and `max + 1`. A range that drifted from the database would
 * otherwise show an operator a number the form accepted and the UPDATE
 * threw on, which reads as "something went wrong" and tells them nothing.
 *
 * NO LIMIT MAY BE ZERO. A limit of zero is an upload question that can
 * never be answered — a form refusing every report forever. Turning uploads
 * off is `attachments_enabled`, or not asking for files at all.
 */
export const LIMIT_RANGES = {
  maxImageBytes: { column: 'max_image_bytes', min: 65536, max: 2147483648, unit: 'bytes' },
  maxVideoBytes: { column: 'max_video_bytes', min: 65536, max: 2147483648, unit: 'bytes' },
  maxAudioBytes: { column: 'max_audio_bytes', min: 65536, max: 2147483648, unit: 'bytes' },
  maxDocumentBytes: { column: 'max_document_bytes', min: 65536, max: 2147483648, unit: 'bytes' },
  maxVideoSeconds: { column: 'max_video_seconds', min: 5, max: 3600, unit: 'seconds' },
  maxDocumentPages: { column: 'max_document_pages', min: 1, max: 1000, unit: 'pages' },
  maxFiles: { column: 'max_files', min: 1, max: 50, unit: 'files' },
  maxTotalBytes: { column: 'max_total_bytes', min: 1048576, max: 2147483648, unit: 'bytes' },
};

/**
 * Read a set of limits an operator typed.
 *
 * Returns `{ ok: true, values }` where `values` holds only the keys that
 * were SENT — a key nobody sent is not a key set to its default, and
 * writing every column on every save would quietly erase a layer the
 * operator never touched.
 *
 * NULL IS A REAL ANSWER and means "clear this, defer to the layer above".
 * An empty string arrives from an emptied number box and means the same
 * thing, because that is what emptying the box looks like to the person
 * doing it. Those are the only two ways to clear one; a 0 is a refusal, not
 * a clear, or an operator aiming to unset a limit would set the one value
 * that breaks the form.
 */
export function validateLimits(input) {
  const body = input || {};
  const values = {};
  for (const [key, range] of Object.entries(LIMIT_RANGES)) {
    if (!(key in body)) continue;
    const raw = body[key];
    if (raw === null || raw === '') { values[key] = null; continue; }
    const n = Number(raw);
    if (!Number.isFinite(n) || !Number.isInteger(n)) {
      return { ok: false, reason: 'limit-not-a-number', key };
    }
    if (n < range.min || n > range.max) {
      return { ok: false, reason: 'limit-out-of-range', key, min: range.min, max: range.max };
    }
    values[key] = n;
  }

  // A total smaller than one file's own ceiling is not wrong at the
  // database — each CHECK passes on its own — but it is a form that accepts
  // a file and then refuses the report carrying it. Caught here because
  // this is the only place that sees both numbers.
  const bothSent = (a, b) => values[a] != null && values[b] != null;
  for (const per of ['maxImageBytes', 'maxVideoBytes', 'maxAudioBytes', 'maxDocumentBytes']) {
    if (bothSent('maxTotalBytes', per) && values.maxTotalBytes < values[per]) {
      return { ok: false, reason: 'total-under-one-file', key: per };
    }
  }

  if ('kinds' in body) {
    const raw = body.kinds;
    if (raw === null) { values.kinds = null; } else if (!Array.isArray(raw)) {
      return { ok: false, reason: 'kinds-shape' };
    } else {
      const bad = raw.find((k) => !ALL_KINDS.includes(k));
      // A name the code does not know is a typo, not a feature, and it
      // would silently narrow a logbook to nothing.
      if (bad !== undefined) return { ok: false, reason: 'kinds-unknown', key: String(bad) };
      values.kinds = ALL_KINDS.filter((k) => raw.includes(k));
    }
  }
  return { ok: true, values };
}

/**
 * The per-file ceiling for one media kind, under these resolved limits.
 *
 * Takes the kind rather than the media type, because the caller that needs
 * it most — the config endpoint — is reasoning about kinds and has no type
 * in hand.
 */
export function maxBytesForKind(kind, limits) {
  if (kind === 'video') return limits.maxVideoBytes;
  if (kind === 'audio') return limits.maxAudioBytes;
  if (kind === 'document') return limits.maxDocumentBytes;
  // 'image' and 'photo' are the same kind under two names — see
  // settingKindFor. Both are accepted here rather than making every caller
  // remember which one it is holding.
  return limits.maxImageBytes;
}

export async function markSlotUploaded(slotToken) {
  // Returns whether it actually changed anything. It used to return nothing,
  // so /complete answered ok whether it had promoted a slot or matched no
  // rows at all — and on 11 September an upload sat at pending forever with
  // no way to tell which had happened. The caller puts this in the log.
  const { rowCount } = await pool.query(
    `UPDATE upload_slots SET status = 'uploaded'
     WHERE slot_token = $1 AND status = 'pending'`,
    [slotToken],
  );
  return rowCount > 0;
}

/**
 * The reporter has pressed Send: the worker may now do this draft's work.
 *
 * THIS IS WHAT REPLACED THE READY GATE. Processing used to start the moment
 * the browser finished its PUT, which is why the form made somebody sit and
 * wait for a video to re-encode before it would let them send. Now the
 * waiting happens after Send, in the window between the submission email
 * going out and the reporter clicking the link in it.
 *
 * Only `pending` and `uploaded` are stamped. A slot already past that is
 * either being worked on or finished, and re-stamping would be a lie about
 * when it was released; a withdrawn or refused one is not work.
 *
 * Returns how many it released, which the caller logs — a submission that
 * carried files and released none is the shape of the bug this column
 * introduces, so it must be visible rather than inferred.
 */
export async function releaseDraft(draftToken, client = pool) {
  if (!draftToken) return 0;
  const { rowCount } = await client.query(
    `UPDATE upload_slots SET released_at = now()
     WHERE draft_token = $1 AND released_at IS NULL
       AND status IN ('pending', 'uploaded')`,
    [draftToken],
  );
  return rowCount;
}

/**
 * HOW LONG A CONFIRMATION WILL WAIT for files that are still being worked
 * on before it goes ahead without them.
 *
 * It exists because the wait has to be bounded by something other than
 * hope. If the worker is stopped, its timer is not installed, or ffmpeg is
 * missing, a reporter who clicks their link would otherwise be told to come
 * back indefinitely for a report that is otherwise complete and whose
 * answers are already in the token.
 *
 * Thirty minutes, measured from when the slot was released rather than from
 * this click, so a reporter who waits a day and then clicks is not made to
 * wait again. It is longer than MEDIA_WORKER_STALE_MINUTES (15) on purpose:
 * an interrupted attempt is requeued at fifteen, so a wait that gave up at
 * fifteen would give up exactly as the retry began.
 *
 * Going ahead is not silent. The files are named back to the reporter as
 * excluded, with their reason, by the machinery that already does that —
 * which is the same outcome they would have had before any of this, so the
 * floor here is the old behaviour rather than something worse.
 */
export const CONFIRM_WAIT_MS = Number(process.env.CONFIRM_WAIT_MS || 30 * 60 * 1000);

/**
 * Files whose bytes are in the bucket and whose work is not finished.
 *
 * The confirm step asks this before it builds a manifest. `clearedSlotsFor`
 * takes `clean` slots only, so confirming while the worker is mid-video
 * would seal a report that silently does not hold it — which used to be
 * impossible only because the form refused to send until everything was
 * clean. With that gate gone, this is what stands in its place: the
 * confirmation waits instead of the form.
 *
 * `pending` IS NOT IN FLIGHT. It means the browser never finished its PUT,
 * so there are no bytes and nothing is ever going to happen to it —
 * including it here would make a half-uploaded file block a confirmation
 * for as long as the cap allows.
 */
export async function inFlightSlotsFor(draftToken, client = pool) {
  const { rows } = await client.query(
    `SELECT slot_token, declared_name, status, released_at
     FROM upload_slots
     WHERE draft_token = $1 AND promoted_at IS NULL
       AND status IN ('uploaded', 'processing')
     ORDER BY id`,
    [draftToken],
  );
  return rows;
}

export async function slotStatuses(draftToken) {
  const { rows } = await pool.query(
    `SELECT slot_token, declared_name, declared_size, status, status_detail, media_type,
            byte_size, duration_seconds
     FROM upload_slots WHERE draft_token = $1 ORDER BY id`,
    [draftToken],
  );
  return rows;
}

export async function discardSlot(slotToken, draftToken) {
  const { rows } = await pool.query(
    `SELECT staging_key, storage_key FROM upload_slots
     WHERE slot_token = $1 AND draft_token = $2 AND promoted_at IS NULL`,
    [slotToken, draftToken],
  );
  if (!rows[0]) return false;
  await pool.query(
    `UPDATE upload_slots SET status = 'withdrawn', status_detail = 'withdrawn by uploader'
     WHERE slot_token = $1`,
    [slotToken],
  );
  const c = storageConfig();
  await deleteObject(c.stagingBucket, rows[0].staging_key).catch(() => {});
  if (rows[0].storage_key) await deleteObject(c.evidenceBucket, rows[0].storage_key).catch(() => {});
  return true;
}

/**
 * The ordered list of digests that goes into the report's content_hash.
 *
 * Returns null — not an empty array — when there is nothing to commit to.
 * That distinction is the single most important line in this file: see
 * buildImmutableFields in reportCore.js for why.
 *
 * `ordinalFrom` MUST MATCH WHAT promoteSlots WILL ASSIGN, and since
 * migration 033 that is the next free ordinal in the THREAD rather than
 * zero. On a first submission the thread holds no files and the two are the
 * same number, which is why this took a parameter only once a correction
 * could also bring files.
 *
 * Getting it wrong is silent: the hashed manifest would say ordinal 0 while
 * the stored row says 3, and nothing would complain until somebody tried to
 * verify the report months later. So the base is passed in rather than
 * assumed, and `nextOrdinal` is the only thing that computes it.
 */
export function buildManifest(slots, { ordinalFrom = 0 } = {}) {
  if (!slots.length) return null;
  return slots.map((s, idx) => ({
    ordinal: ordinalFrom + idx,
    sha256: s.sha256,
    byte_size: Number(s.byte_size),
    media_type: s.media_type,
  }));
}

// Only files the worker has cleared are eligible. Anything still pending,
// infected or unreadable at confirm time is left behind and reported back
// to the submitter, rather than silently dropped or silently included.
export async function clearedSlotsFor(draftToken, client = pool) {
  const { rows } = await client.query(
    `SELECT * FROM upload_slots
     WHERE draft_token = $1 AND status = 'clean' AND promoted_at IS NULL
     ORDER BY id`,
    [draftToken],
  );
  return rows;
}

/**
 * The next free ordinal in a thread.
 *
 * ORDINALS ARE PER THREAD, NOT PER VERSION. They used to be numbered from
 * zero within one report, which was indistinguishable while a file could
 * only ever arrive at confirmation. Now that a correction can bring files
 * too, a second batch starting at zero again would collide with the first
 * inside the same thread, and two files would claim one position in the
 * manifest — which is a hashed object with a duplicate key's worth of
 * ambiguity in it.
 *
 * Counts from every file the thread has ever held, including one that was
 * later dropped by a correction: positions are never reused, so the manifest
 * of an old version and the manifest of a new one cannot disagree about
 * which file ordinal 2 was.
 */
export async function nextOrdinal(client, threadId) {
  const { rows } = await client.query(
    'SELECT coalesce(max(ordinal) + 1, 0) AS next FROM attachments WHERE thread_id = $1',
    [threadId],
  );
  return Number(rows[0].next);
}

/**
 * Move cleared slots into the chained `attachments` table. Runs inside the
 * same transaction as the report insert, so a report and its manifest
 * become visible together or not at all.
 *
 * Writes the `report_attachments` link as well as the row, because a version
 * that holds a file and does not say so is exactly the state migration 033
 * exists to make impossible.
 */
export async function promoteSlots(client, { slots, threadId, reportId }) {
  const created = [];
  let ordinal = await nextOrdinal(client, threadId);
  for (const slot of slots) {
    const { rows } = await client.query(
      `INSERT INTO attachments (thread_id, report_id, ordinal, original_name, media_type,
                                byte_size, sha256, storage_key, exif_enc, captured_at,
                                rendition_media_type, duration_seconds, has_poster)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
      [threadId, reportId, ordinal, slot.declared_name, slot.media_type, slot.byte_size,
        slot.sha256, slot.storage_key, slot.exif_enc, slot.captured_at,
        slot.rendition_media_type, slot.duration_seconds, slot.has_poster || false],
    );
    ordinal += 1;
    // Default publication is 'withheld': the file exists in the archive
    // from this moment, and is publishable by nobody until a moderator
    // says otherwise. The DEK lands here rather than above so it stays
    // destroyable.
    await client.query(
      "INSERT INTO attachment_heads (attachment_id, dek_wrapped, scan_status) VALUES ($1, $2, 'clean')",
      [rows[0].id, slot.dek_wrapped],
    );
    await client.query(
      'INSERT INTO report_attachments (report_id, attachment_id) VALUES ($1, $2)',
      [reportId, rows[0].id],
    );
    await client.query(
      'UPDATE upload_slots SET promoted_at = now() WHERE slot_token = $1',
      [slot.slot_token],
    );
    created.push(rows[0].id);
  }
  return created;
}

/**
 * Which files the current version of a thread carries, in manifest order.
 *
 * The shape `buildManifest` wants, read back from what is already stored
 * rather than from the slots it was built from — so a correction's manifest
 * is derived from the archive and not from anything a client sent.
 */
export async function attachmentsOfReport(client, reportId) {
  const { rows } = await client.query(
    `SELECT a.id, a.ordinal, a.sha256, a.byte_size, a.media_type
     FROM report_attachments ra JOIN attachments a ON a.id = ra.attachment_id
     WHERE ra.report_id = $1
     ORDER BY a.ordinal`,
    [reportId],
  );
  return rows;
}

/**
 * Say that a version carries these files.
 *
 * THIS IS WHAT STOPS A CORRECTION LOSING SOMEBODY'S PHOTOGRAPHS. Before
 * migration 033 a correction wrote no manifest at all, so the new version's
 * hashed object had no `attachments` key, every file read joined against the
 * new version and found nothing, and the files became unreachable while
 * verifying perfectly. See the migration for the full account.
 *
 * Links rather than copies: one file is one `attachments` row for as long as
 * it exists, so destroying its key destroys it everywhere, which is the only
 * thing erasure can honestly mean.
 *
 * SEPARATE FROM THE READ ABOVE, and it has to be: the manifest goes INTO the
 * hashed object, so the caller reads the old version's files, hands them to
 * `insertReportVersion` to be hashed, and only then has a row id to link
 * them to. One function doing both would need the id before it exists.
 */
export async function linkAttachments(client, { reportId, attachmentIds }) {
  for (const id of attachmentIds) {
    await client.query(
      `INSERT INTO report_attachments (report_id, attachment_id) VALUES ($1, $2)
       ON CONFLICT (report_id, attachment_id) DO NOTHING`,
      [reportId, id],
    );
  }
}

/**
 * The manifest entries for a set of attachment rows, in the one shape the
 * hashed object takes.
 *
 * Written here beside `buildManifest` rather than at each call site, because
 * a manifest assembled slightly differently in two places is a report that
 * verifies in one and not the other.
 */
export function manifestFromRows(rows) {
  return rows
    .slice()
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((a) => ({
      ordinal: a.ordinal,
      sha256: a.sha256,
      byte_size: Number(a.byte_size),
      media_type: a.media_type,
    }));
}

// Counts for a report card: how many files are on the current version, and
// how many of those a moderator has cleared for publication. Both numbers
// are shown, because "3 attachments, 1 published" is more honest than
// either number alone.
//
// Returned by a function rather than exported as a constant so the
// subqueries are absent from every query while the feature is off. That
// makes the order of a deploy safe in both directions: code shipped before
// `npm run migrate` has run never references tables that do not exist yet,
// and the board keeps working either way.
// Through report_attachments, not attachments.report_id: that column names
// the version a file FIRST arrived with, so counting on it showed zero files
// on every corrected report. Migration 033 says why at length.
const ATTACHMENT_COUNT_SQL = `,
  (SELECT count(*) FROM report_attachments ra
    WHERE ra.report_id = h.current_report_id)::int AS attachment_count,
  (SELECT count(*) FROM report_attachments ra
    JOIN attachment_heads ah ON ah.attachment_id = ra.attachment_id
    WHERE ra.report_id = h.current_report_id AND ah.publication = 'published')::int AS attachment_published_count`;

export function attachmentColumns() {
  return attachmentsEnabled() ? ATTACHMENT_COUNT_SQL : '';
}

// What a browser should be told the published copy is. Older rows predate
// re-encoding, where the two were always the same.
export function servedTypeFor(row) {
  return row.rendition_media_type || row.media_type;
}
