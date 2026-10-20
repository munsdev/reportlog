/**
 * The storage check's two halves, kept apart from its command so the tests
 * can run them (storage-check-cli.ts is the command).
 *
 * Ports legacy storage-doctor (a setting that picked up quotes or whitespace
 * on its way into .env) and storage-smoke (every bucket refuses a request
 * with no signature).
 */
import { randomBytes } from 'node:crypto';
import { BUCKETS, randomKey, readAll } from './storage.ts';
import type { Storage } from './storage.ts';

const SETTINGS = [
  'FILES_STORAGE',
  'S3_ENDPOINT',
  'S3_REGION',
  'S3_ACCESS_KEY',
  'S3_SECRET_KEY',
  'S3_BUCKET_STAGING',
  'S3_BUCKET_EVIDENCE',
  'S3_BUCKET_RENDITIONS',
  'S3_ADDRESSING',
] as const;

/**
 * A value with quotes or a stray space still looks right when printed, and
 * fails as "SignatureDoesNotMatch" or "NoSuchBucket", which sends an owner
 * to check the wrong thing. Checked on the raw environment, before the
 * configuration is parsed, because a quoted URL does not parse at all.
 * The value itself is never printed: two of these are secrets.
 */
export function settingProblems(env: NodeJS.ProcessEnv): string[] {
  const out: string[] = [];
  for (const name of SETTINGS) {
    const raw = env[name];
    if (raw === undefined || raw === '') continue;
    const problems: string[] = [];
    if (/^(["']).*\1$/s.test(raw.trim())) problems.push('is wrapped in quotes (.env needs it bare)');
    if (raw !== raw.trim()) problems.push('has a space or line break at its start or end');
    else if (/\s/.test(raw)) problems.push('contains a space');
    if (problems.length) out.push(`${name} ${problems.join(', and ')}`);
  }
  return out;
}

/**
 * fetch says only "fetch failed"; why (refused, no such host, a certificate)
 * is in its cause, and is the part an owner checking a new provider needs.
 */
export function why(e: unknown): string {
  const err = e as Error & { cause?: { code?: string; message?: string } };
  const cause = err.cause?.code ?? err.cause?.message;
  return cause ? `${err.message} (${cause})` : err.message;
}

/**
 * Write, read back, read a range, and delete one small object in each
 * bucket. On S3, also ask for the object with no signature at all: every
 * byte is served through the site, which checks the password and the
 * reporter's permission, so a bucket that answers a stranger bypasses both.
 * One line per bucket; `ok` is false if any failed.
 */
export async function checkStorage(
  storage: Storage,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; lines: string[] }> {
  const lines: string[] = [];
  let ok = true;
  for (const bucket of BUCKETS) {
    const key = randomKey('check');
    const body = randomBytes(1024);
    const did = ['write', 'read', 'range', 'delete'];
    try {
      await storage.put(bucket, key, body, body.length);
      try {
        const back = await storage.get(bucket, key);
        if (!back || !(await readAll(back)).equals(body))
          throw new Error('what came back is not what was written');
        const part = await storage.get(bucket, key, { start: 10, end: 19 });
        if (!part || !(await readAll(part)).equals(body.subarray(10, 20)))
          throw new Error('a range read came back wrong');
        if (storage.unsignedUrl) {
          const res = await fetchImpl(storage.unsignedUrl(bucket, key));
          await res.body?.cancel();
          if (res.ok)
            throw new Error(
              `the bucket answers a read with no signature (${String(res.status)}); it must not be public`,
            );
          did.push('refuses an unsigned read');
        }
      } finally {
        // Even when a read failed: the check leaves nothing behind.
        await storage.delete(bucket, key);
      }
      if (await storage.head(bucket, key)) throw new Error('a deleted object is still there');
      lines.push(`ok    ${bucket}: ${did.join(', ')}`);
    } catch (e) {
      ok = false;
      lines.push(`FAIL  ${bucket}: ${why(e)}`);
    }
  }
  return { ok, lines };
}
