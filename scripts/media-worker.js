// Media worker — the only process that ever touches an uploaded file's
// bytes.
//
// Everything hostile happens here and nowhere else: deciding what a file
// really is, scanning it, and either trimming its metadata or decoding and
// re-encoding it. That is deliberate. The parsers involved are being fed
// files chosen by whoever wants this site down on election day, and a
// crash here costs one queue item, while the same crash inside server.js
// takes the whole site (and Mobilizon next door) with it.
//
// Runs from cron the same way every other job in this repo does — one pass
// per invocation, no daemon to supervise:
//   * * * * * cd /srv/reportlog && npm run media-worker
//
// Safe to run concurrently with itself: claiming a slot is a conditional
// UPDATE, so two overlapping passes cannot process the same file twice.
//
// Everything works through temp files rather than buffers. A 150 MB video
// held as plaintext and ciphertext at once is 300 MB resident per file on
// a shared box, and ffmpeg needs a real file on disk anyway.

import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { pool } from '../src/db.js';
import {
  sniffType, stripMetadata, isAllowedType, kindFor, maxBytesFor,
  MAX_DOCUMENT_PAGES,
  TRIMMED_TYPES, MAX_VIDEO_SECONDS, attachmentsEnabled,
} from '../src/attachments.js';
import { getStream, putStream, deleteObject, headObject, storageConfig } from '../src/storage.js';
import { generateDek, createEncryptStream, wrapDek, encryptBuffer } from '../src/crypto.js';
import {
  heicToJpeg, probeVideo, transcodeVideo, posterFrame, toolsAvailable, missingToolsFor,
  transcodeAudio, probePdf, pdfToPages,
} from '../src/media.js';

if (!attachmentsEnabled()) {
  console.log('[media-worker] attachments are disabled — nothing to do.');
  await pool.end();
  process.exit(0);
}

// Videos are processed one at a time by default: each one is a transcode,
// and running several at once on a shared box is how you starve the site
// itself of CPU.
const BATCH = Number(process.env.MEDIA_WORKER_BATCH || 20);
const c = storageConfig();

const tools = toolsAvailable();
if (!tools.ok) {
  // Not fatal, and not a blanket deferral either. JPEG/PNG/WebP need no
  // external tool, and every other type is checked against the tools IT
  // needs — so a missing pdftoppm stops PDFs and nothing else. A missing
  // package on the box must never destroy a reporter's evidence, and it
  // should not stall files it has no bearing on.
  console.warn(`[media-worker] missing tools: ${tools.missing.join(', ')}`);
  console.warn('[media-worker] only the file types needing those are deferred; the rest of the queue runs');
}

function tmpPath(suffix) {
  return path.join(os.tmpdir(), `reportlog-media-${crypto.randomBytes(10).toString('hex')}${suffix}`);
}

// ClamAV via clamdscan if it is installed and running. Deliberately
// optional and deliberately fail-closed: if scanning is configured but
// broken, files stay unprocessed rather than sailing through unscanned.
function scan(filePath) {
  if (process.env.CLAMAV_ENABLED !== 'true') return { ok: true, detail: 'scanning disabled' };
  try {
    execFileSync('clamdscan', ['--no-summary', '--fdpass', filePath], { stdio: 'pipe' });
    return { ok: true, detail: 'clean' };
  } catch (e) {
    // clamdscan exits 1 for a detection and 2 for an error. Only 1 is a
    // verdict; 2 means we do not know, and "we do not know" must never be
    // treated as clean.
    if (e.status === 1) return { ok: false, verdict: 'infected', detail: String(e.stdout || '').trim().slice(0, 300) };
    return { ok: false, verdict: 'retry', detail: `scanner unavailable: ${e.message}`.slice(0, 300) };
  }
}

async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(filePath), hash);
  return hash.digest('hex');
}

/**
 * Encrypt a file to storage without ever holding it in memory.
 *
 * The auth tag is only known once the last byte is encrypted, and the
 * packed format puts it up front — so the ciphertext goes to a temp file
 * first, then the 28-byte header and that file are streamed together as
 * one upload body.
 */
async function encryptToStorage(plainPath, bucket, key, dek) {
  const ctPath = tmpPath('.enc');
  try {
    const { cipher, header } = createEncryptStream(dek);
    await pipeline(fs.createReadStream(plainPath), cipher, fs.createWriteStream(ctPath));

    const head = header();
    const size = head.length + fs.statSync(ctPath).size;
    const body = Readable.toWeb(Readable.from((async function* join() {
      yield head;
      for await (const chunk of fs.createReadStream(ctPath)) yield chunk;
    })()));

    await putStream(bucket, key, body, size);
  } finally {
    fs.rmSync(ctPath, { force: true });
  }
}

async function downloadToFile(bucket, key, dest) {
  const { body } = await getStream(bucket, key);
  await pipeline(Readable.fromWeb(body), fs.createWriteStream(dest));
}

async function fail(slot, status, detail) {
  await pool.query(
    'UPDATE upload_slots SET status = $1, status_detail = $2 WHERE id = $3',
    [status, String(detail).slice(0, 500), slot.id],
  );
  await deleteObject(c.stagingBucket, slot.staging_key).catch(() => {});
  console.log(`[media-worker] slot ${slot.id} -> ${status}: ${detail}`);
}

async function defer(slot, detail) {
  // Back into the queue untouched. Used when the failure is ours (a tool
  // not installed, a scanner down) rather than the file's.
  await pool.query(
    "UPDATE upload_slots SET status = 'uploaded', status_detail = $1, claimed_at = NULL WHERE id = $2",
    [String(detail).slice(0, 500), slot.id],
  );
  console.warn(`[media-worker] slot ${slot.id} deferred: ${detail}`);
}

/**
 * Turn the uploaded original into the copy that may eventually be
 * published. Two strategies, per src/attachments.js:
 *   trim   — lift the metadata out of a segment stream, no decoding
 *   decode — re-encode from pixels, so no metadata can survive at all
 */
async function buildRendition(originalPath, realType, temps) {
  if (TRIMMED_TYPES.includes(realType)) {
    const buf = fs.readFileSync(originalPath);
    const { clean, metadata } = stripMetadata(buf, realType);
    const out = tmpPath('.clean');
    temps.push(out);
    fs.writeFileSync(out, clean);
    return { renditionPath: out, renditionType: realType, metadata, posterPath: null, duration: null };
  }

  if (realType === 'image/heic' || realType === 'image/heif') {
    const jpg = tmpPath('.jpg');
    temps.push(jpg);
    const { mediaType } = await heicToJpeg(originalPath, jpg);

    // Belt and braces: the decoder is not supposed to carry EXIF across,
    // and today it does not — but that is a property of one version of one
    // library, and a future release quietly starting to preserve metadata
    // would leak GPS silently. Running the converted file through the same
    // trimmer used for ordinary JPEGs costs nothing and makes the outcome
    // independent of libheif's behaviour.
    const { clean, metadata } = stripMetadata(fs.readFileSync(jpg), 'image/jpeg');
    const out = tmpPath('.clean.jpg');
    temps.push(out);
    fs.writeFileSync(out, clean);

    return {
      renditionPath: out,
      renditionType: mediaType,
      metadata: {
        format: realType,
        method: 're-encoded to JPEG, then trimmed',
        trimmedAfterConversion: metadata.removed || [],
      },
      posterPath: null,
      duration: null,
    };
  }

  // Audio. No poster and no dimensions, but otherwise the same argument as
  // video: decode and re-encode, so the published copy contains sound and
  // nothing else. Probed first for the same reason — an over-long file
  // should be refused in a second, not after minutes of encoding.
  if (kindFor(realType) === 'audio') {
    const probe = await probeVideo(originalPath);
    if (probe.durationSeconds > MAX_VIDEO_SECONDS) {
      const err = new Error(`audio is ${probe.durationSeconds}s, longer than the ${MAX_VIDEO_SECONDS}s limit`);
      err.reject = true;
      throw err;
    }
    const m4a = tmpPath('.m4a');
    temps.push(m4a);
    const { mediaType } = await transcodeAudio(originalPath, m4a, { maxSeconds: MAX_VIDEO_SECONDS });
    return {
      renditionPath: m4a,
      renditionType: mediaType,
      metadata: {
        format: realType,
        method: 're-encoded; tags and container metadata dropped',
      },
      posterPath: null,
      duration: probe.durationSeconds,
      pagePaths: null,
    };
  }

  // A document. The published copy is not the document — see pdfToPages
  // for why. Page one becomes the rendition so everything downstream that
  // expects a single file still works, and the rest ride along beside it.
  if (kindFor(realType) === 'document') {
    const probe = await probePdf(originalPath);
    // An encrypted PDF cannot be rendered without its password, and asking
    // a reporter for one would mean holding it. Refused rather than half
    // handled.
    if (probe.encrypted) {
      const err = new Error('the PDF is password-protected, so it cannot be converted for publication');
      err.reject = true;
      throw err;
    }
    if (probe.pages > MAX_DOCUMENT_PAGES) {
      const err = new Error(`the PDF has ${probe.pages} pages, more than the ${MAX_DOCUMENT_PAGES}-page limit`);
      err.reject = true;
      throw err;
    }
    const prefix = tmpPath('.pdfpage').replace(/\.pdfpage$/, '-pg');
    const { pages, mediaType } = await pdfToPages(originalPath, prefix, { maxPages: MAX_DOCUMENT_PAGES });
    pages.forEach((f) => temps.push(f));
    return {
      renditionPath: pages[0],
      renditionType: mediaType,
      metadata: {
        format: realType,
        method: `rendered to ${pages.length} page image${pages.length === 1 ? '' : 's'}; the PDF itself is never published`,
        pages: probe.pages,
      },
      posterPath: null,
      duration: null,
      pagePaths: pages,
    };
  }

  // Video. Probe before spending CPU, so an over-long file is refused in a
  // second rather than after minutes of encoding.
  const info = await probeVideo(originalPath);
  if (info.durationSeconds > MAX_VIDEO_SECONDS) {
    const err = new Error(`video is ${info.durationSeconds}s, longer than the ${MAX_VIDEO_SECONDS}s limit`);
    err.reject = true;
    throw err;
  }

  const out = tmpPath('.mp4');
  temps.push(out);
  const { mediaType } = await transcodeVideo(originalPath, out, { maxSeconds: MAX_VIDEO_SECONDS });

  const poster = tmpPath('.poster.jpg');
  temps.push(poster);
  const gotPoster = await posterFrame(originalPath, poster).catch(() => false);

  return {
    renditionPath: out,
    renditionType: mediaType,
    metadata: {
      format: realType,
      method: 're-encoded; container metadata dropped',
      source: { codec: info.codec, width: info.width, height: info.height, hasAudio: info.hasAudio },
    },
    posterPath: gotPoster ? poster : null,
    duration: info.durationSeconds,
  };
}

async function processSlot(slot) {
  // Claim it. The WHERE clause is the lock: a second pass running
  // concurrently finds zero rows and moves on. claimed_at is what lets a
  // later pass tell "being worked on" from "the worker died holding it".
  const { rowCount } = await pool.query(
    "UPDATE upload_slots SET status = 'processing', status_detail = NULL, claimed_at = now() WHERE id = $1 AND status = 'uploaded'",
    [slot.id],
  );
  if (!rowCount) return;

  const temps = [];
  const originalPath = tmpPath('.orig');
  temps.push(originalPath);

  try {
    const head = await headObject(c.stagingBucket, slot.staging_key).catch(() => null);
    if (!head) return fail(slot, 'unreadable', 'no uploaded file found');

    await downloadToFile(c.stagingBucket, slot.staging_key, originalPath);
    const actualSize = fs.statSync(originalPath).size;

    // Sniff before anything else: every later decision, including which
    // size limit applies, depends on what this really is rather than what
    // the browser claimed.
    const realType = sniffType(fs.readFileSync(originalPath, { start: 0, end: 64 }).subarray(0, 64));
    if (!realType || !isAllowedType(realType)) {
      return fail(slot, 'rejected', 'not a supported photo or video file');
    }
    if (actualSize > maxBytesFor(realType)) {
      return fail(slot, 'rejected', `file is larger than the ${Math.floor(maxBytesFor(realType) / 1048576)} MB limit for ${kindFor(realType)}s`);
    }
    // Quota was charged against the size the browser claimed at slot time,
    // because that is all we knew then. This is where the claim gets
    // checked against reality.
    if (actualSize > Number(slot.declared_size) * 1.05 + 1024) {
      return fail(slot, 'rejected', 'file is larger than it was declared to be');
    }
    // Asked of THIS type, not of the box in general. The old check was
    // `!tools.ok && !TRIMMED_TYPES.includes(realType)`, which deferred an
    // MP4 because pdftoppm was absent and then told the operator to
    // install "media tools" without saying which.
    const needed = missingToolsFor(realType);
    if (needed.length) {
      return defer(slot, `waiting for ${needed.join(' and ')} to be installed on the server`);
    }

    const verdict = scan(originalPath);
    if (!verdict.ok) {
      if (verdict.verdict === 'retry') return defer(slot, verdict.detail);
      return fail(slot, 'infected', verdict.detail);
    }

    let built;
    try {
      built = await buildRendition(originalPath, realType, temps);
    } catch (e) {
      // A file we cannot decode is the file's problem; a tool that is
      // missing or broken is ours, and the two must not share an outcome.
      if (e.reject) return fail(slot, 'rejected', e.message);
      return fail(slot, 'unreadable', e.message);
    }

    // Digest of the ORIGINAL bytes. This is what enters the report's
    // content_hash, so it has to describe the file as submitted — not the
    // rendition, and not anything encryption did afterwards.
    const sha256 = await sha256File(originalPath);

    const dek = generateDek();
    const storageKey = `evidence/${slot.slot_token}`;

    // Everything encrypted, everything in the evidence bucket. The
    // rendition only reaches the public bucket if a moderator publishes
    // it — which is what makes an object's presence there the publication
    // decision rather than a flag somebody could get wrong.
    await encryptToStorage(originalPath, c.evidenceBucket, storageKey, dek);
    await encryptToStorage(built.renditionPath, c.evidenceBucket, `${storageKey}.rendition`, dek);
    if (built.posterPath) {
      await encryptToStorage(built.posterPath, c.evidenceBucket, `${storageKey}.poster`, dek);
    }
    // A rendered document's remaining pages. Page 1 is the rendition
    // above, so this starts at 2 — every page under the same per-object
    // key, so destroying that key erases the whole document at once
    // rather than leaving page 7 readable.
    if (built.pagePaths && built.pagePaths.length > 1) {
      for (let i = 1; i < built.pagePaths.length; i++) {
        await encryptToStorage(built.pagePaths[i], c.evidenceBucket, `${storageKey}.page.${i + 1}`, dek);
      }
    }

    // Stripped metadata under the same per-object key, so destroying that
    // key later takes the GPS with the pixels.
    const exifEnc = encryptBuffer(Buffer.from(JSON.stringify(built.metadata), 'utf8'), dek);

    await pool.query(
      `UPDATE upload_slots
       SET status = 'clean', status_detail = NULL, sha256 = $1, byte_size = $2,
           media_type = $3, storage_key = $4, dek_wrapped = $5, exif_enc = $6,
           rendition_media_type = $7, duration_seconds = $8, has_poster = $9,
           page_count = $10
       WHERE id = $11`,
      [sha256, actualSize, realType, storageKey, wrapDek(dek), exifEnc,
        built.renditionType, built.duration, Boolean(built.posterPath),
        built.pagePaths ? built.pagePaths.length : null, slot.id],
    );

    // The plaintext window in the staging bucket closes here. From now on
    // the storage service holds nothing but ciphertext for this file.
    await deleteObject(c.stagingBucket, slot.staging_key).catch(() => {});

    console.log(`[media-worker] slot ${slot.id} clean (${realType} -> ${built.renditionType}, ${actualSize} bytes${built.duration ? `, ${built.duration}s` : ''})`);
  } finally {
    for (const t of temps) fs.rmSync(t, { force: true });
  }
}

// Anything claimed but never finished — the worker was killed, the box
// rebooted mid-deploy, a malformed file took the process down. Without
// this the upload sits in 'processing' until it expires and the reporter
// silently loses evidence they believe they attached.
const STALE_CLAIM_MINUTES = Number(process.env.MEDIA_WORKER_STALE_MINUTES || 15);
const { rowCount: requeued } = await pool.query(
  `UPDATE upload_slots
   SET status = 'uploaded', claimed_at = NULL,
       status_detail = 'requeued after an interrupted attempt'
   WHERE status = 'processing'
     AND claimed_at < now() - ($1 || ' minutes')::interval`,
  [String(STALE_CLAIM_MINUTES)],
);
if (requeued) console.warn(`[media-worker] requeued ${requeued} interrupted upload(s)`);

// RELEASED WORK ONLY. A staged upload becomes work when the reporter
// presses Send, or at creation if it is answering an evidence request —
// see migration 045 and `releaseDraft`. Before that the bytes sit in
// staging and nothing is spent on them, which is the point: most of the
// transcoding this box used to do belonged to drafts nobody ever sent.
//
// FAIL-CLOSED ON PURPOSE. A bug that forgets to release leaves files
// unprocessed, and the reporter is told at confirmation which files did
// not make it. The other way round — processing everything and hoping —
// spends a core on abandoned drafts and is invisible.
const { rows: slots } = await pool.query(
  `SELECT * FROM upload_slots
   WHERE status = 'uploaded' AND released_at IS NOT NULL AND expires_at > now()
   ORDER BY id LIMIT $1`,
  [BATCH],
);

for (const slot of slots) {
  try {
    await processSlot(slot);
  } catch (e) {
    // One bad file must never stop the batch.
    console.error(`[media-worker] slot ${slot.id} threw`, e);
    await fail(slot, 'unreadable', `processing error: ${e.message}`).catch(() => {});
  }
}

// Sweep expired staging objects whose slots were never confirmed.
const { rows: stale } = await pool.query(
  `SELECT id, staging_key, storage_key, page_count FROM upload_slots
   WHERE expires_at < now() AND promoted_at IS NULL
     AND status NOT IN ('rejected', 'withdrawn', 'expired')
   LIMIT 200`,
);
for (const s of stale) {
  await deleteObject(c.stagingBucket, s.staging_key).catch(() => {});
  // A slot that reached 'clean' but was never confirmed has encrypted
  // originals sitting in the evidence bucket that no report will ever
  // point at. They belong to a submission nobody verified, so they are
  // storage we pay for and data we should not be holding.
  if (s.storage_key) {
    // Every derived object, including a document's extra pages. The list
    // is generous on purpose: deleting an object that was never written is
    // a no-op, and missing one would leave a page of somebody's document
    // in storage after the record said it was gone.
    const pageSuffixes = [];
    for (let i = 2; i <= (s.page_count || 1); i++) pageSuffixes.push(`.page.${i}`);
    for (const suffix of ['', '.rendition', '.poster', ...pageSuffixes]) {
      await deleteObject(c.evidenceBucket, `${s.storage_key}${suffix}`).catch(() => {});
    }
  }
  await pool.query(
    "UPDATE upload_slots SET status = 'expired', status_detail = 'expired unconfirmed', dek_wrapped = NULL, exif_enc = NULL WHERE id = $1",
    [s.id],
  );
}

if (slots.length || stale.length) {
  console.log(`[media-worker] processed ${slots.length}, swept ${stale.length}`);
}

await pool.end();
