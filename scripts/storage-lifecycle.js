// Apply the staging bucket's expiry rule.
//
// Staging is the one bucket that holds plaintext. An upload lands there,
// the media worker processes it, and the encrypted original goes to
// evidence — after which the staging copy is waste that must not
// accumulate. The expiry rule is what guarantees that even when the worker
// dies, a report is abandoned half-uploaded, or a process is killed between
// the two steps.
//
//   npm run storage-lifecycle            # show the rule on the staging bucket
//   npm run storage-lifecycle -- --apply # write it
//
// Hetzner's console had no CORS section, which is why storage-cors.js
// exists; whether it has a lifecycle section was not established, and this
// does not depend on the answer. It uses the same credentials and the same
// signer as the app, so there is nothing extra to install and the rule is
// reproducible on the next instance instead of being a remembered click.
//
// ONLY the staging bucket. Evidence holds the archive's encrypted
// originals and renditions holds published material; an expiry rule on
// either would delete the archive on a timer. The guard below refuses to
// address them even if the .env names them, because the cost of that
// mistake is not recoverable.

import 'dotenv/config';
import { storageConfig, isConfigured, putBucketLifecycle, getBucketLifecycle } from '../src/storage.js';

const apply = process.argv.includes('--apply');

if (!isConfigured()) {
  console.error('Object storage is not configured — fill in the S3_* values in .env first.');
  process.exit(1);
}

const c = storageConfig();
const bucket = c.stagingBucket;

if (!bucket) {
  console.error('S3_BUCKET_STAGING is not set. Nothing to do.');
  process.exit(1);
}
if (bucket === c.evidenceBucket || bucket === c.renditionBucket) {
  console.error(`REFUSING: S3_BUCKET_STAGING is "${bucket}", which is also the evidence or`);
  console.error('renditions bucket. An expiry rule there would delete the archive on a');
  console.error('timer. Fix .env so staging is its own bucket before running this.');
  process.exit(1);
}

// One day is the S3 minimum, and Expiration.Days is counted to the midnight
// UTC following the elapsed day — so an object actually disappears between
// 24 and 48 hours after it is uploaded. That is why the runbook says "1 day"
// in one place and "48h" in another: both describe this rule.
//
// AbortIncompleteMultipartUpload is here because a browser upload that dies
// partway leaves parts that are invisible to a listing and still billed, and
// no expiry rule on objects touches them.
const xml = `<?xml version="1.0" encoding="UTF-8"?>
<LifecycleConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Rule>
    <ID>expire-staging-plaintext</ID>
    <Filter><Prefix></Prefix></Filter>
    <Status>Enabled</Status>
    <Expiration><Days>1</Days></Expiration>
    <AbortIncompleteMultipartUpload><DaysAfterInitiation>1</DaysAfterInitiation></AbortIncompleteMultipartUpload>
  </Rule>
</LifecycleConfiguration>`;

console.log(`\nEndpoint: ${c.endpoint}`);
console.log(`Bucket:   ${bucket}  (staging)\n`);

if (apply) {
  try {
    await putBucketLifecycle(bucket, xml);
    console.log('  rule applied');
  } catch (e) {
    console.error(`  FAILED: ${e.message}\n`);
    console.error('  SignatureDoesNotMatch — check S3_ACCESS_KEY / S3_SECRET_KEY.');
    console.error('  AccessDenied — the key cannot change bucket settings. On Hetzner that');
    console.error('    usually means a key from a different project than the buckets.');
    console.error('  MalformedXML / NotImplemented — the endpoint may not support');
    console.error('    lifecycle rules. Set the expiry in the provider console instead, and');
    console.error('    record in the runbook that it is a click rather than this command.');
    process.exit(1);
  }
}

// Read it back either way. What the bucket reports is the only answer that
// means anything — a 200 on the PUT is not proof the rule is in force.
const live = await getBucketLifecycle(bucket);
if (!live) {
  console.log('\n  NO RULE on this bucket.');
  console.log('  Plaintext uploads accumulate here indefinitely until one is set.');
  if (!apply) console.log('  Re-run with --apply to write it.');
  process.exit(apply ? 1 : 0);
}

const days = live.match(/<Days>(\d+)<\/Days>/);
const enabled = /<Status>Enabled<\/Status>/.test(live);
console.log('\n  live rule:');
console.log(`    expires after: ${days ? `${days[1]} day(s)` : 'NOT SET — read the XML below'}`);
console.log(`    status:        ${enabled ? 'Enabled' : 'NOT ENABLED — the rule exists and does nothing'}`);
console.log(`\n${live.trim()}\n`);

if (!enabled || !days) process.exit(1);
