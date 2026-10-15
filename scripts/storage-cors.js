// Apply the CORS policy the browser upload depends on.
//
// Hetzner's console has no CORS section — it is only settable through the
// S3 API. Rather than require an S3 CLI on the box, this uses the same
// credentials and the same signer the app already uses:
//
//   npm run storage-cors                       # uses SITE_ORIGIN or the default
//   npm run storage-cors -- https://staging.example.org
//
// Only the staging bucket needs a policy. The browser PUTs there directly,
// and that cross-origin request fails at the preflight without one. Nothing
// else is read from a bucket by a browser — every other byte is served by
// the app — so evidence and renditions are deliberately left with no CORS
// policy at all.

import 'dotenv/config';
import { storageConfig, isConfigured, putBucketCors, getBucketCors } from '../src/storage.js';

const origin = process.argv[2] || process.env.SITE_ORIGIN;

if (!isConfigured()) {
  console.error('Object storage is not configured — fill in the S3_* values in .env first.');
  process.exit(1);
}
if (!/^https?:\/\/[^/]+$/.test(origin)) {
  console.error(`"${origin}" does not look like an origin. Expected something like https://reports.example.org`);
  console.error('(scheme and host only — no trailing slash, no path)');
  process.exit(1);
}

const c = storageConfig();

// PUT only: the browser uploads and does nothing else cross-origin.
// ETag is exposed because a multipart upload would need to read it back,
// which is the one thing likely to be added here later.
const xml = `<?xml version="1.0" encoding="UTF-8"?>
<CORSConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <CORSRule>
    <AllowedOrigin>${origin}</AllowedOrigin>
    <AllowedMethod>PUT</AllowedMethod>
    <AllowedHeader>*</AllowedHeader>
    <ExposeHeader>ETag</ExposeHeader>
    <MaxAgeSeconds>3000</MaxAgeSeconds>
  </CORSRule>
</CORSConfiguration>`;

console.log(`\nEndpoint: ${c.endpoint}`);
console.log(`Bucket:   ${c.stagingBucket}`);
console.log(`Origin:   ${origin}\n`);

try {
  await putBucketCors(c.stagingBucket, xml);
  console.log('  policy applied');
} catch (e) {
  console.error(`  FAILED: ${e.message}\n`);
  console.error('  If this says SignatureDoesNotMatch, check S3_ACCESS_KEY / S3_SECRET_KEY.');
  console.error('  If it says AccessDenied, the key may lack permission to change bucket settings.');
  process.exit(1);
}

// Read it back rather than trusting the write. A policy that was accepted
// but stored differently is exactly the failure that would show up later as
// an unexplained upload failure in someone's browser.
try {
  const back = await getBucketCors(c.stagingBucket);
  if (!back) {
    console.error('  but reading it back returned nothing — the policy did not stick.');
    process.exit(1);
  }
  const ok = back.includes(origin) && /PUT/.test(back);
  console.log(ok ? '  verified by reading it back\n' : '  read back, but it does not contain the expected origin/method\n');
  if (!ok) {
    console.error(back);
    process.exit(1);
  }
} catch (e) {
  console.error(`  applied, but could not read it back: ${e.message}`);
  process.exit(1);
}

console.log('Staging uploads from the browser will now work.');
console.log('The evidence and rendition buckets need no CORS policy — the app serves those.\n');
