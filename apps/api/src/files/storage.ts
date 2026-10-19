/**
 * Where file bytes live, behind one small interface.
 *
 * THREE BUCKETS, and the boundary between them is the boundary between what
 * may and may not be seen:
 *
 *   staging     bytes on their way in, already encrypted under the file's own
 *               key; cleared once the worker has finished with them
 *   evidence    every original and every derived copy, encrypted. Never
 *               public, never presigned to a browser
 *   renditions  the re-encoded copies a moderator has published, in the
 *               clear. AN OBJECT HERE IS THE PUBLICATION DECISION
 *
 * Two drivers: S3-compatible storage for production (the provider is not
 * chosen; it will be in the EU, and the code speaks the S3 API only), and a
 * directory on disk for development and the tests.
 *
 * NO BROWSER EVER TALKS TO STORAGE. Uploads stream through the site's own
 * origin and published files are served from it. The site makes no request to
 * another host (CLAUDE.md), its content security policy is `default-src
 * 'self'`, and a presigned URL would bypass the site password and every check
 * a route makes. Legacy presigned uploads straight to the bucket; this is the
 * deliberate difference.
 */
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { dirname, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { UNSIGNED, EMPTY_SHA256, signHeaders, uriEncode } from './sigv4.ts';
import type { Credentials } from './sigv4.ts';

export const BUCKETS = ['staging', 'evidence', 'renditions'] as const;
export type Bucket = (typeof BUCKETS)[number];

export interface StoredObject {
  body: Readable;
  /** Bytes in this response. */
  size: number;
  /** Bytes in the whole object. */
  total: number;
  /** Present when a range was asked for and served. */
  range?: { start: number; end: number };
}

export interface Storage {
  readonly kind: 'disk' | 's3';
  /** Write an object of exactly `size` bytes. A body that errors leaves nothing. */
  put(bucket: Bucket, key: string, body: Readable | Buffer, size: number): Promise<void>;
  /** Null when there is no such object. */
  get(
    bucket: Bucket,
    key: string,
    range?: { start: number; end: number },
  ): Promise<StoredObject | null>;
  head(bucket: Bucket, key: string): Promise<{ size: number } | null>;
  /** Idempotent: deleting what is not there is not an error. */
  delete(bucket: Bucket, key: string): Promise<void>;
}

/**
 * Keys are made by this code (random hex under a prefix), never from a name a
 * reporter's device chose. This refuses anything else, so a bug elsewhere
 * cannot become a path outside the store.
 */
const KEY = /^[a-z]+\/[a-f0-9]{16,64}(\.[a-z0-9]+)*$/;
export function assertKey(key: string): void {
  if (!KEY.test(key)) throw new Error(`not a storage key this code makes: ${JSON.stringify(key)}`);
}

/** A fresh random key under a prefix. Never derived from a row id or a file name. */
export function randomKey(prefix: string): string {
  return `${prefix}/${randomBytes(16).toString('hex')}`;
}

export class StorageError extends Error {
  override name = 'StorageError';
}

/** Read an object fully. For small things only (a page image, a test). */
export async function readAll(o: StoredObject): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of o.body) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c as Uint8Array));
  return Buffer.concat(chunks);
}

// ── a directory on disk ─────────────────────────────────────────────────

export function diskStorage(root: string): Storage {
  const base = resolve(root);
  const pathOf = (bucket: Bucket, key: string) => {
    assertKey(key);
    const p = resolve(base, bucket, key);
    if (!p.startsWith(base + sep)) throw new Error('a key outside the store');
    return p;
  };
  return {
    kind: 'disk',
    async put(bucket, key, body, size) {
      const target = pathOf(bucket, key);
      await mkdir(dirname(target), { recursive: true });
      // Written beside and renamed into place, so a body that fails half way
      // leaves no object, as an aborted S3 PUT leaves none.
      const tmp = `${target}.part-${randomBytes(6).toString('hex')}`;
      try {
        await pipeline(
          Buffer.isBuffer(body) ? Readable.from([body]) : body,
          createWriteStream(tmp),
        );
        const written = (await stat(tmp)).size;
        if (written !== size) {
          throw new StorageError(`expected ${String(size)} bytes, got ${String(written)}`);
        }
        await rename(tmp, target);
      } catch (e) {
        await rm(tmp, { force: true });
        throw e;
      }
    },
    async get(bucket, key, range) {
      const p = pathOf(bucket, key);
      let total: number;
      try {
        total = (await stat(p)).size;
      } catch {
        return null;
      }
      if (range) {
        const end = Math.min(range.end, total - 1);
        return {
          body: createReadStream(p, { start: range.start, end }),
          size: Math.max(0, end - range.start + 1),
          total,
          range: { start: range.start, end },
        };
      }
      return { body: createReadStream(p), size: total, total };
    },
    async head(bucket, key) {
      try {
        return { size: (await stat(pathOf(bucket, key))).size };
      } catch {
        return null;
      }
    },
    async delete(bucket, key) {
      await rm(pathOf(bucket, key), { force: true });
    },
  };
}

// ── S3-compatible object storage ────────────────────────────────────────

export interface S3Settings extends Credentials {
  endpoint: string;
  buckets: Record<Bucket, string>;
  /** Path style (`host/bucket/key`) works everywhere; virtual for AWS proper. */
  addressing: 'path' | 'virtual';
  timeoutMs?: number;
}

export function s3Storage(s: S3Settings, fetchImpl: typeof fetch = fetch): Storage {
  const endpoint = new URL(s.endpoint);
  const timeout = s.timeoutMs ?? 10 * 60 * 1000;

  const target = (bucket: Bucket, key: string) => {
    assertKey(key);
    const name = s.buckets[bucket];
    const encoded = uriEncode(key, true);
    return s.addressing === 'virtual'
      ? { host: `${name}.${endpoint.host}`, path: `/${encoded}` }
      : { host: endpoint.host, path: `/${uriEncode(name, false)}/${encoded}` };
  };

  async function send(
    method: string,
    bucket: Bucket,
    key: string,
    opts: { headers?: Record<string, string>; body?: Readable | Buffer; payloadHash?: string } = {},
  ): Promise<Response> {
    const t = target(bucket, key);
    const headers = signHeaders(s, {
      method,
      path: t.path,
      host: t.host,
      headers: opts.headers ?? {},
      payloadHash: opts.payloadHash ?? EMPTY_SHA256,
      now: new Date(),
    });
    const body =
      opts.body === undefined
        ? undefined
        : Buffer.isBuffer(opts.body)
          ? opts.body
          : (Readable.toWeb(opts.body) as ReadableStream);
    return fetchImpl(`${endpoint.protocol}//${t.host}${t.path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body, duplex: 'half' }),
      signal: AbortSignal.timeout(timeout),
    });
  }

  const fail = async (what: string, res: Response) =>
    new StorageError(
      `storage ${what} failed: ${String(res.status)} ${(await res.text().catch(() => '')).slice(0, 200)}`,
    );

  return {
    kind: 's3',
    async put(bucket, key, body, size) {
      // Content-Length rather than chunked: S3-compatible endpoints refuse a
      // chunked PUT of an object, and the size is always known in advance.
      const res = await send('PUT', bucket, key, {
        headers: { 'content-length': String(size) },
        body,
        payloadHash: UNSIGNED,
      });
      if (!res.ok) throw await fail(`PUT ${bucket}`, res);
      await res.body?.cancel();
    },
    async get(bucket, key, range) {
      const res = await send('GET', bucket, key, {
        ...(range
          ? { headers: { range: `bytes=${String(range.start)}-${String(range.end)}` } }
          : {}),
      });
      if (res.status === 404) {
        await res.body?.cancel();
        return null;
      }
      if (!res.ok || !res.body) throw await fail(`GET ${bucket}`, res);
      const size = Number(res.headers.get('content-length') ?? 0);
      const cr = /bytes (\d+)-(\d+)\/(\d+)/.exec(res.headers.get('content-range') ?? '');
      return {
        body: Readable.fromWeb(res.body),
        size,
        total: cr ? Number(cr[3]) : size,
        ...(cr ? { range: { start: Number(cr[1]), end: Number(cr[2]) } } : {}),
      };
    },
    async head(bucket, key) {
      const res = await send('HEAD', bucket, key);
      if (res.status === 404) return null;
      if (!res.ok) throw await fail(`HEAD ${bucket}`, res);
      return { size: Number(res.headers.get('content-length') ?? 0) };
    },
    async delete(bucket, key) {
      const res = await send('DELETE', bucket, key);
      await res.body?.cancel();
      if (!res.ok && res.status !== 404) throw await fail(`DELETE ${bucket}`, res);
    },
  };
}

/** Write a temporary file's worth of bytes to storage. */
export async function putFile(storage: Storage, bucket: Bucket, key: string, path: string) {
  const size = (await stat(path)).size;
  await storage.put(bucket, key, createReadStream(path), size);
}

/** Copy an object to a local file (the worker needs real files for its tools). */
export async function getToFile(storage: Storage, bucket: Bucket, key: string, path: string) {
  const o = await storage.get(bucket, key);
  if (!o) throw new StorageError(`no object ${bucket}/${key}`);
  await pipeline(o.body, createWriteStream(path));
}
