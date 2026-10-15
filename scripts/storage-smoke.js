// One-off check that the bucket credentials actually work.
//
// selftest.js proves the signing code is internally consistent; it cannot
// prove the signature is one Hetzner will accept. Only a real round-trip
// does that, so run this once after filling in the S3_* variables and
// before switching ATTACHMENTS_ENABLED on:
//
//   npm run storage-smoke
//
// It writes, reads back, and deletes one small object in each bucket, and
// checks that the staging bucket is not readable without a signature —
// which is the misconfiguration that would matter most.

import 'dotenv/config';
import crypto from 'node:crypto';
import { isConfigured, storageConfig, putObject, getObject, deleteObject, presign } from '../src/storage.js';

if (!isConfigured()) {
  console.error('Object storage is not fully configured. Set S3_ENDPOINT, S3_ACCESS_KEY,');
  console.error('S3_SECRET_KEY, S3_BUCKET_STAGING, S3_BUCKET_EVIDENCE and S3_BUCKET_RENDITIONS.');
  process.exit(1);
}

const c = storageConfig();
const key = `smoke/${crypto.randomBytes(8).toString('hex')}`;
const payload = Buffer.from(`edr storage smoke test ${new Date().toISOString()}`);
let failures = 0;

async function roundTrip(bucket, label) {
  process.stdout.write(`  ${label} (${bucket}) ... `);
  try {
    await putObject(bucket, key, payload);
    const back = await getObject(bucket, key);
    if (!back.equals(payload)) throw new Error('content came back different');
    await deleteObject(bucket, key);
    console.log('ok');
  } catch (e) {
    failures += 1;
    console.log(`FAILED\n     ${e.message}`);
  }
}

console.log(`\nEndpoint: ${c.endpoint} (region ${c.region})\n`);

await roundTrip(c.stagingBucket, 'staging   ');
await roundTrip(c.evidenceBucket, 'evidence  ');
await roundTrip(c.renditionBucket, 'renditions');

// None of the three buckets should answer an unsigned request. Every read
// a person makes goes through the app, which is what enforces the
// moderation gate, the site-access gate and the audit log — a bucket that
// serves the public directly bypasses all three, and would keep serving a
// photo after its report was withdrawn. This is the check a bucket-policy
// mistake would otherwise fail silently.
async function assertPrivate(bucket, label) {
  process.stdout.write(`  ${label} refuses unsigned reads ... `);
  try {
    await putObject(bucket, key, payload);
    const unsigned = presign('GET', bucket, key).split('?')[0];
    const res = await fetch(unsigned);
    if (res.ok) {
      failures += 1;
      console.log(`FAILED\n     ${bucket} answers unsigned GETs — it must not be public`);
    } else {
      console.log(`ok (refused with ${res.status})`);
    }
    await deleteObject(bucket, key);
  } catch (e) {
    failures += 1;
    console.log(`FAILED\n     ${e.message}`);
  }
}

await assertPrivate(c.evidenceBucket, 'evidence  ');
await assertPrivate(c.renditionBucket, 'renditions');
await assertPrivate(c.stagingBucket, 'staging   ');

console.log(failures ? `\n${failures} check(s) failed.\n` : '\nAll checks passed — storage is ready.\n');
process.exit(failures ? 1 : 0);
