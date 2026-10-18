// A local disk cache for published renditions.
//
// Every public view of a photo or video currently pulls the bytes out of
// object storage, which means bucket traffic tracks media viewership —
// and a video being scrubbed generates a fresh ranged request per seek.
// This keeps a copy on the box so a file is fetched from storage once.
//
// The important part is WHAT is cached. The obvious approach — an nginx
// proxy cache in front of the endpoint — would serve cached responses
// without running the app at all, and the app is what enforces the
// publication gate. A withdrawn report's video would keep being served
// until the cache entry expired.
//
// So the split is: the app still answers every request and re-runs every
// gate (a cheap indexed query), and only the bytes are served locally.
// Withdrawal, refusal and erasure take effect on the very next request,
// exactly as they do today.
//
// Only published renditions are eligible. Moderator views of originals are
// deliberately never cached: those are audited, unpublished, and often the
// most sensitive thing in the system — writing them to disk in the clear
// to save bandwidth would be a bad trade.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { getStream } from './storage.js';

// CACHE_DIRECTORY is set by systemd when a unit declares CacheDirectory=.
// It is consulted before the temp-dir fallback because the fallback is a
// trap under systemd: units run with PrivateTmp=true get a PRIVATE /tmp that
// is destroyed when the invocation ends, so a oneshot worker caches into a
// directory that is thrown away a second later and that the application —
// which has its own private /tmp — could never have read anyway. The cache
// then silently does nothing and every view re-fetches from the bucket.
const DIR = process.env.MEDIA_CACHE_DIR
  || process.env.CACHE_DIRECTORY
  || path.join(os.tmpdir(), 'reportlog-media-cache');
const MAX_BYTES = Number(process.env.MEDIA_CACHE_MAX_BYTES || 2 * 1024 * 1024 * 1024);
const ENABLED = process.env.MEDIA_CACHE_ENABLED !== 'false';

// Two concurrent viewers of the same new video should not both download it.
const inFlight = new Map();

function ensureDir() {
  if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
}

// The storage key is server-generated and random, but it is still a value
// from the database being turned into a path — hashing it means a cache
// filename can never be anything but 64 hex characters.
function cachePath(key) {
  return path.join(DIR, crypto.createHash('sha256').update(key).digest('hex'));
}

/**
 * Drop the least recently used entries until the directory is comfortably
 * under the ceiling. Called after a write, so the cache self-limits without
 * needing a cron job of its own.
 *
 * Best-effort throughout: a cache that cannot prune should degrade to
 * serving from storage, never to failing a request.
 */
async function prune() {
  try {
    const names = await fsp.readdir(DIR);
    const stats = [];
    let total = 0;
    for (const name of names) {
      try {
        const st = await fsp.stat(path.join(DIR, name));
        if (!st.isFile()) continue;
        stats.push({ name, size: st.size, atime: st.atimeMs });
        total += st.size;
      } catch { /* vanished under us; nothing to account for */ }
    }
    if (total <= MAX_BYTES) return;

    // Down to 90%, so a busy cache is not pruning on every single write.
    const target = MAX_BYTES * 0.9;
    stats.sort((a, b) => a.atime - b.atime);
    for (const s of stats) {
      if (total <= target) break;
      await fsp.rm(path.join(DIR, s.name), { force: true });
      total -= s.size;
    }
  } catch (e) {
    console.warn('[media-cache] prune failed', e.message);
  }
}

async function download(bucket, key, dest) {
  ensureDir();
  // Write to a temp name and rename into place, so a reader can never open
  // a half-written file: rename within a directory is atomic.
  const tmp = `${dest}.${crypto.randomBytes(6).toString('hex')}.part`;
  try {
    const { body } = await getStream(bucket, key);
    await pipeline(Readable.fromWeb(body), fs.createWriteStream(tmp));
    await fsp.rename(tmp, dest);
    prune().catch(() => {});
    return dest;
  } catch (e) {
    await fsp.rm(tmp, { force: true }).catch(() => {});
    throw e;
  }
}

/**
 * The local path for an object, fetching it once if it is not here yet.
 * Returns null if caching is off or the copy could not be made — callers
 * fall back to streaming straight from storage.
 */
export async function localCopy(bucket, key) {
  if (!ENABLED) return null;
  const dest = cachePath(key);

  try {
    const st = await fsp.stat(dest);
    if (st.isFile() && st.size > 0) {
      // Touch it so least-recently-used pruning reflects reads, not just
      // writes. Failure here is harmless.
      fsp.utimes(dest, new Date(), st.mtime).catch(() => {});
      return dest;
    }
  } catch { /* not cached yet */ }

  if (inFlight.has(dest)) return inFlight.get(dest);

  const p = download(bucket, key, dest)
    .catch((e) => {
      console.warn(`[media-cache] could not cache ${key}: ${e.message}`);
      return null;
    })
    .finally(() => inFlight.delete(dest));

  inFlight.set(dest, p);
  return p;
}

/**
 * Forget an object. Called when a file is refused or erased — the gate
 * would already stop it being served, but leaving plaintext of something
 * we just deleted sitting on disk is not a defensible thing to do.
 */
export async function forget(key) {
  if (!key) return;
  await fsp.rm(cachePath(key), { force: true }).catch(() => {});
}

export function cacheStatus() {
  if (!ENABLED) return { enabled: false };
  try {
    const names = fs.existsSync(DIR) ? fs.readdirSync(DIR) : [];
    let bytes = 0;
    for (const n of names) {
      try { bytes += fs.statSync(path.join(DIR, n)).size; } catch { /* ignore */ }
    }
    return { enabled: true, dir: DIR, entries: names.length, bytes, maxBytes: MAX_BYTES };
  } catch {
    return { enabled: true, dir: DIR, error: 'unreadable' };
  }
}
