/**
 * Check the configured storage works, end to end, before trusting it with
 * anybody's evidence. Writes, reads back, reads a range, and deletes one
 * small object in each of the three buckets, and says plainly what failed.
 *
 *   pnpm --filter @reportlog/api files:storage-check
 *
 * Ports legacy storage-smoke and storage-doctor. Bucket CORS is not needed
 * (no browser talks to storage); a lifecycle rule on the staging bucket is
 * optional, since the worker clears abandoned staging itself.
 */
import { randomBytes } from 'node:crypto';
import { loadConfig } from '../config.ts';
import { storageFrom } from './context.ts';
import { BUCKETS, randomKey, readAll } from './storage.ts';

/**
 * fetch says only "fetch failed"; why (refused, no such host, a certificate)
 * is in its cause, and is the part an owner checking a new provider needs.
 */
function why(e: unknown): string {
  const err = e as Error & { cause?: { code?: string; message?: string } };
  const cause = err.cause?.code ?? err.cause?.message;
  return cause ? `${err.message} (${cause})` : err.message;
}

const storage = storageFrom(loadConfig());
if (typeof storage === 'string') {
  console.error(`Storage is not configured: ${storage}.`);
  process.exit(1);
}
let failed = false;
for (const bucket of BUCKETS) {
  const key = randomKey('check');
  const body = randomBytes(1024);
  try {
    await storage.put(bucket, key, body, body.length);
    const back = await storage.get(bucket, key);
    if (!back || !(await readAll(back)).equals(body))
      throw new Error('what came back is not what was written');
    const part = await storage.get(bucket, key, { start: 10, end: 19 });
    if (!part || !(await readAll(part)).equals(body.subarray(10, 20)))
      throw new Error('a range read came back wrong');
    await storage.delete(bucket, key);
    if (await storage.head(bucket, key)) throw new Error('a deleted object is still there');
    console.log(`ok    ${bucket}: write, read, range, delete`);
  } catch (e) {
    failed = true;
    console.log(`FAIL  ${bucket}: ${why(e)}`);
  }
}
process.exit(failed ? 1 : 0);
