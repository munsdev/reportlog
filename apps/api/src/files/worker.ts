/**
 * The media worker: the only code that touches a file's bytes as content.
 *
 * Everything hostile happens here: deciding what a file really is, scanning
 * it, decoding and re-encoding it. The decoders themselves run as child
 * processes (media.ts); this process streams, hashes and encrypts.
 *
 * ONE PASS (`workOnce`):
 *   1. requeue any claim older than STALE_MINUTES (the worker died holding it)
 *   2. claim and process released files, a few at a time
 *   3. sweep files whose drafts were abandoned
 *   4. delete objects that decisions elsewhere removed (storage_deletions)
 *
 * Safe to run beside itself: claiming is a conditional UPDATE, so two passes
 * never work on the same file.
 *
 * Run as `pnpm --filter @reportlog/api files:worker` (a long-running loop) or
 * with `--once` from a timer. Workstream H runs it; see docs/status/F-files.md
 * for what it needs installed.
 */
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, open, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { sql } from 'kysely';
import type { Selectable } from 'kysely';
import type { UploadSlots } from '../db/schema.gen.ts';
import type { Files } from './context.ts';
import { OVERHEAD, decryptStream, encryptBuffer, encryptStream } from './envelope.ts';
import { isAllowedType, kindFor, sniffType } from './kinds.ts';
import { limitsFor, maxBytesForKind } from './limits.ts';
import { PACKAGE_FOR, RejectFile, buildRendition, missingToolsFor } from './media.ts';
import { evidenceKeys, queueDeletion } from './slots.ts';
import { randomKey } from './storage.ts';
import type { Bucket } from './storage.ts';

/** A claim older than this is a worker that died holding it. */
export const STALE_MINUTES = 15;
/**
 * How long a confirmation waits for files still being prepared, from when
 * they were released. LONGER than STALE_MINUTES on purpose: an interrupted
 * attempt is requeued at fifteen, and a wait that gave up at fifteen would
 * give up exactly as the retry began.
 */
export const CONFIRM_WAIT_MS = 30 * 60 * 1000;

export interface Log {
  info(msg: string): void;
  warn(msg: string): void;
}
const quiet: Log = { info: () => undefined, warn: () => undefined };

type Slot = Selectable<UploadSlots>;

async function putEncrypted(files: Files, bucket: Bucket, key: string, path: string, dek: Buffer) {
  const size = (await stat(path)).size;
  await files.storage.put(
    bucket,
    key,
    createReadStream(path).pipe(encryptStream(dek)),
    size + OVERHEAD,
  );
}

async function sha256File(path: string): Promise<string> {
  const h = createHash('sha256');
  await pipeline(createReadStream(path), h);
  return h.digest('hex');
}

async function head(path: string, n: number): Promise<Buffer> {
  const fh = await open(path, 'r');
  try {
    const buf = Buffer.alloc(n);
    const { bytesRead } = await fh.read(buf, 0, n, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

const run = promisify(execFile);
/**
 * ClamAV, if switched on. Fail closed: a scanner that is configured and
 * broken defers the file; it never waves it through. clamdscan exits 1 for a
 * detection and 2 for "could not tell", and only 1 is a verdict.
 */
async function scan(
  path: string,
): Promise<{ ok: true } | { ok: false; infected: boolean; detail: string }> {
  try {
    await run('clamdscan', ['--no-summary', '--fdpass', path], { timeout: 120_000 });
    return { ok: true };
  } catch (e) {
    const err = e as { code?: number; stdout?: string; message: string };
    if (err.code === 1)
      return {
        ok: false,
        infected: true,
        detail: (err.stdout ?? '').trim().slice(0, 300),
      };
    return {
      ok: false,
      infected: false,
      detail: `the virus scanner is not answering: ${err.message}`.slice(0, 300),
    };
  }
}

/** Refused: nothing of it is kept, its key included. */
async function fail(
  files: Files,
  slot: Slot,
  status: 'rejected' | 'unreadable' | 'infected',
  detail: string,
  log: Log,
) {
  await files.db.transaction().execute(async (trx) => {
    await trx
      .updateTable('upload_slots')
      .set({
        status,
        status_detail: detail.slice(0, 500),
        dek_wrapped: null,
        meta_enc: null,
        claimed_at: null,
      })
      .where('id', '=', slot.id)
      .execute();
    await queueDeletion(trx, 'staging', slot.staging_key);
  });
  log.info(`file ${String(slot.id)} ${status}: ${detail}`);
}

/** Back in the queue untouched: the problem is ours (a tool, a scanner), not the file's. */
async function defer(files: Files, slot: Slot, detail: string, log: Log) {
  await files.db
    .updateTable('upload_slots')
    .set({ status: 'uploaded', status_detail: detail.slice(0, 500), claimed_at: null })
    .where('id', '=', slot.id)
    .execute();
  log.warn(`file ${String(slot.id)} waiting: ${detail}`);
}

/** Process one released file. Returns what became of it. */
export async function processSlot(files: Files, slotId: number, log: Log = quiet): Promise<string> {
  const { db, storage } = files;
  const slot = await db
    .updateTable('upload_slots')
    .set({ status: 'processing', status_detail: null, claimed_at: new Date() })
    .where('id', '=', slotId)
    .where('status', '=', 'uploaded')
    .where('released_at', 'is not', null)
    .returningAll()
    .executeTakeFirst();
  if (!slot) return 'not-claimed';
  if (!slot.dek_wrapped) {
    await fail(files, slot, 'unreadable', 'the file arrived without its key', log);
    return 'unreadable';
  }
  const dek = files.ring.unwrap(slot.dek_wrapped);
  const dir = await mkdtemp(join(tmpdir(), 'reportlog-media-'));
  const original = join(dir, 'original');
  try {
    const staged = await storage.get('staging', slot.staging_key);
    if (!staged) {
      await fail(files, slot, 'unreadable', 'no uploaded file was found', log);
      return 'unreadable';
    }
    await pipeline(staged.body, decryptStream(dek), createWriteStream(original));
    const size = (await stat(original)).size;

    // What it really is, before anything else, because every later decision
    // (which limit, which decoder) depends on it.
    const type = sniffType(await head(original, 1024));
    if (!type || !isAllowedType(type)) {
      await fail(
        files,
        slot,
        'rejected',
        'this is not a photo, video, sound recording or PDF this site can take',
        log,
      );
      return 'rejected';
    }
    const kind = kindFor(type);
    const limits = await limitsFor(db, slot.logbook_id);
    if (!kind || !limits.kinds.includes(kind)) {
      await fail(
        files,
        slot,
        'rejected',
        `${kind ?? 'this kind of file'} is not being taken here`,
        log,
      );
      return 'rejected';
    }
    if (size > maxBytesForKind(kind, limits)) {
      await fail(files, slot, 'rejected', `the file is larger than the limit for a ${kind}`, log);
      return 'rejected';
    }
    const missing = await missingToolsFor(type);
    if (missing.length) {
      const pkgs = [...new Set(missing.map((m) => PACKAGE_FOR[m] ?? m))];
      await defer(
        files,
        slot,
        `waiting for ${pkgs.join(' and ')} to be installed on the server`,
        log,
      );
      return 'deferred';
    }
    if (files.clamav) {
      const verdict = await scan(original);
      if (!verdict.ok) {
        if (!verdict.infected) {
          await defer(files, slot, verdict.detail, log);
          return 'deferred';
        }
        await fail(files, slot, 'infected', verdict.detail, log);
        return 'infected';
      }
    }

    let built;
    try {
      built = await buildRendition(original, type, dir, limits);
    } catch (e) {
      // The file's problem is a refusal; anything else is ours, and goes
      // back in the queue rather than losing somebody's evidence.
      if (e instanceof RejectFile) {
        await fail(files, slot, e.status, e.message, log);
        return 'refused';
      }
      throw e;
    }

    // The digest of the ORIGINAL bytes, as submitted: this is what the report
    // seals, so it has to describe the file the reporter sent, not our copy
    // and not anything encryption did afterwards.
    const sha256 = await sha256File(original);
    const storageKey = randomKey('evidence');
    // Everything under the file's one key. The re-encoded copy reaches the
    // public bucket only if a moderator publishes it.
    await putEncrypted(files, 'evidence', storageKey, original, dek);
    await putEncrypted(files, 'evidence', `${storageKey}.rendition`, built.renditionPath, dek);
    if (built.posterPath)
      await putEncrypted(files, 'evidence', `${storageKey}.poster`, built.posterPath, dek);
    for (const [i, page] of built.morePages.entries()) {
      await putEncrypted(files, 'evidence', `${storageKey}.page${String(i + 2)}`, page, dek);
    }

    await db
      .updateTable('upload_slots')
      .set({
        status: 'clean',
        status_detail: null,
        media_type: type,
        byte_size: size,
        sha256,
        storage_key: storageKey,
        rendition_media_type: built.renditionType,
        duration_seconds: built.duration,
        has_poster: Boolean(built.posterPath),
        page_count: built.pageCount,
        // What was removed, under the same key, so destroying it takes the
        // location with the pixels.
        meta_enc: encryptBuffer(dek, Buffer.from(JSON.stringify(built.meta), 'utf8')),
      })
      .where('id', '=', slot.id)
      .execute();
    await storage
      .delete('staging', slot.staging_key)
      .catch(() => queueDeletion(db, 'staging', slot.staging_key));
    log.info(
      `file ${String(slot.id)} ready (${type} → ${built.renditionType}, ${String(size)} bytes)`,
    );
    return 'clean';
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export interface PassResult {
  requeued: number;
  processed: Record<string, number>;
  swept: number;
  deleted: number;
}

/** One pass of everything the worker does. */
export async function workOnce(
  files: Files,
  opts: { batch?: number; log?: Log } = {},
): Promise<PassResult> {
  const { db } = files;
  const log = opts.log ?? quiet;

  const requeued = await db
    .updateTable('upload_slots')
    .set({
      status: 'uploaded',
      claimed_at: null,
      status_detail: 'tried again after an interrupted attempt',
    })
    .where('status', '=', 'processing')
    .where('claimed_at', '<', new Date(Date.now() - STALE_MINUTES * 60 * 1000))
    .executeTakeFirst();

  // RELEASED WORK ONLY. Fail-closed on purpose: a bug that forgets to release
  // leaves files unprocessed and the reporter is told at confirmation; the
  // other way round spends the machine on drafts nobody sent.
  const work = await db
    .selectFrom('upload_slots')
    .select('id')
    .where('status', '=', 'uploaded')
    .where('released_at', 'is not', null)
    .where('expires_at', '>', new Date())
    .orderBy('id')
    .limit(opts.batch ?? 10)
    .execute();
  const processed: Record<string, number> = {};
  for (const { id } of work) {
    let outcome: string;
    try {
      outcome = await processSlot(files, id, log);
    } catch (e) {
      // One bad file never stops the batch. Back in the queue; a file that
      // keeps doing this is requeued until it expires, and the reporter is
      // told at confirmation.
      log.warn(`file ${String(id)} failed: ${(e as Error).message}`);
      await db
        .updateTable('upload_slots')
        .set({
          status: 'uploaded',
          claimed_at: null,
          status_detail: 'an attempt failed; it will be tried again',
        })
        .where('id', '=', id)
        .where('status', '=', 'processing')
        .execute();
      outcome = 'error';
    }
    processed[outcome] = (processed[outcome] ?? 0) + 1;
  }

  // Abandoned: never confirmed, past its time. Its objects go and so does its
  // key; a clean file nobody confirmed is data we should not be holding.
  const stale = await db
    .selectFrom('upload_slots')
    .select(['id', 'staging_key', 'storage_key', 'page_count'])
    .where('expires_at', '<', new Date())
    .where('promoted_at', 'is', null)
    .where('status', 'not in', ['rejected', 'unreadable', 'infected', 'withdrawn', 'expired'])
    .limit(200)
    .execute();
  for (const s of stale) {
    await db.transaction().execute(async (trx) => {
      await queueDeletion(trx, 'staging', s.staging_key);
      if (s.storage_key)
        for (const key of evidenceKeys(s.storage_key, s.page_count))
          await queueDeletion(trx, 'evidence', key);
      await trx
        .updateTable('upload_slots')
        .set({
          status: 'expired',
          status_detail: 'never confirmed',
          dek_wrapped: null,
          meta_enc: null,
          contact_hmac: null,
        })
        .where('id', '=', s.id)
        .execute();
    });
  }

  const deleted = await drainDeletions(files);
  const result = {
    requeued: Number(requeued.numUpdatedRows),
    processed,
    swept: stale.length,
    deleted,
  };
  if (work.length || stale.length || result.requeued)
    log.info(`worker pass: ${JSON.stringify(result)}`);
  return result;
}

/**
 * Delete what decisions elsewhere removed. Tried right after a decision
 * commits and again on every pass until it succeeds.
 */
export async function drainDeletions(
  files: Pick<Files, 'db' | 'storage'>,
  limit = 200,
): Promise<number> {
  const rows = await files.db
    .selectFrom('storage_deletions')
    .select(['id', 'bucket', 'key'])
    .orderBy('id')
    .limit(limit)
    .execute();
  let done = 0;
  for (const r of rows) {
    try {
      await files.storage.delete(r.bucket as Bucket, r.key);
      await files.db.deleteFrom('storage_deletions').where('id', '=', r.id).execute();
      done += 1;
    } catch (e) {
      await files.db
        .updateTable('storage_deletions')
        .set({
          attempts: sql`attempts + 1`,
          last_error: (e as Error).message.slice(0, 300),
        })
        .where('id', '=', r.id)
        .execute();
    }
  }
  return done;
}
