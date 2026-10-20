/**
 * Check the configured storage works, end to end, before trusting it with
 * anybody's evidence. Writes, reads back, reads a range, and deletes one
 * small object in each of the three buckets, checks no bucket answers a
 * request with no signature, and says plainly what failed.
 *
 *   pnpm --filter @reportlog/api files:storage-check
 *
 * Ports legacy storage-smoke and storage-doctor (storage-check.ts). Bucket
 * CORS is not needed (no browser talks to storage); a lifecycle rule on the
 * staging bucket is optional, since the worker clears abandoned staging
 * itself.
 */
import { loadConfig } from '../config.ts';
import { storageFrom } from './context.ts';
import { checkStorage, settingProblems } from './storage-check.ts';

const problems = settingProblems(process.env);
if (problems.length) {
  for (const p of problems) console.log(`FAIL  ${p}`);
  process.exit(1);
}
const storage = storageFrom(loadConfig());
if (typeof storage === 'string') {
  console.error(`Storage is not configured: ${storage}.`);
  process.exit(1);
}
const { ok, lines } = await checkStorage(storage);
for (const l of lines) console.log(l);
process.exit(ok ? 0 : 1);
