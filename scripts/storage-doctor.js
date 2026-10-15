// Work out why object storage is not working.
//
//   npm run storage-doctor
//
// storage-smoke tells you something failed. This tells you which of the
// handful of things it actually is: credentials the service does not
// recognise, a key belonging to a different project or location than the
// buckets, bucket names that do not match what was created, or a value
// that picked up quotes or whitespace on its way into .env.
//
// It never writes anything.

import 'dotenv/config';
import { storageConfig, listBuckets } from '../src/storage.js';

const c = storageConfig();

// A value that arrived with quotes or trailing whitespace still "looks
// right" in a text editor and fails in a way that is very hard to see.
function inspect(name, raw) {
  const problems = [];
  if (raw === undefined || raw === '') return { name, value: '(not set)', problems: ['missing'] };
  if (/^["'].*["']$/.test(raw)) problems.push('wrapped in quotes — .env needs them bare');
  if (raw !== raw.trim()) problems.push('has leading or trailing whitespace');
  if (/\s/.test(raw.trim())) problems.push('contains a space');
  return { name, value: raw, problems };
}

const mask = (v) => (v && v.length > 8 ? `${v.slice(0, 4)}…${v.slice(-4)} (${v.length} chars)` : v || '(not set)');

console.log('\n─── configuration ───────────────────────────────────────\n');
console.log(`  S3_ENDPOINT   ${c.endpoint || '(not set)'}`);
console.log(`  S3_REGION     ${c.region}`);
console.log(`  S3_ACCESS_KEY ${mask(c.accessKey)}`);
console.log(`  S3_SECRET_KEY ${mask(c.secretKey)}`);
console.log(`  buckets       staging=${c.stagingBucket}  evidence=${c.evidenceBucket}  renditions=${c.renditionBucket}`);

const checks = [
  inspect('S3_ENDPOINT', process.env.S3_ENDPOINT),
  inspect('S3_ACCESS_KEY', process.env.S3_ACCESS_KEY),
  inspect('S3_SECRET_KEY', process.env.S3_SECRET_KEY),
  inspect('S3_BUCKET_STAGING', process.env.S3_BUCKET_STAGING),
  inspect('S3_BUCKET_EVIDENCE', process.env.S3_BUCKET_EVIDENCE),
  inspect('S3_BUCKET_RENDITIONS', process.env.S3_BUCKET_RENDITIONS),
];
const dirty = checks.filter((x) => x.problems.length);
if (dirty.length) {
  console.log('\n  Problems with the values themselves:');
  for (const d of dirty) console.log(`    ${d.name}: ${d.problems.join('; ')}`);
}

if (c.endpoint && !/^https:\/\/(fsn1|nbg1|hel1)\.your-objectstorage\.com\/?$/.test(c.endpoint)) {
  console.log('\n  Note: the endpoint does not look like a Hetzner one. Expected');
  console.log('        https://fsn1.your-objectstorage.com (or nbg1 / hel1).');
}

console.log('\n─── what the key can see ────────────────────────────────\n');

let names = null;
try {
  names = await listBuckets();
  console.log(`  Credentials accepted by ${new URL(c.endpoint).host}.`);
  if (!names.length) {
    console.log('  It can see NO buckets.\n');
    console.log('  The key is valid but belongs to a project with no buckets in this');
    console.log('  location. In Hetzner, keys and buckets both belong to a project,');
    console.log('  and a key is only valid in the location it was created for.');
    console.log('  Check you generated the key in the same project AND location as');
    console.log('  the buckets.');
  } else {
    console.log(`  Buckets it can see (${names.length}):`);
    for (const n of names) console.log(`    ${n}`);
  }
} catch (e) {
  console.log(`  Request rejected: ${e.code}\n`);
  if (e.code === 'InvalidAccessKeyId') {
    console.log('  The service does not recognise this access key at all. That is not a');
    console.log('  signature problem — the key ID itself is unknown here. Usually one of:');
    console.log('    - the key was pasted incompletely, or with a stray character');
    console.log('    - the key belongs to a different Hetzner PROJECT than the buckets');
    console.log('    - the key was created for a different LOCATION than S3_ENDPOINT');
    console.log('      (a fsn1 key is not valid against nbg1 or hel1)');
  } else if (e.code === 'SignatureDoesNotMatch') {
    console.log('  The key ID is known, but the signature did not match — so the');
    console.log('  SECRET is wrong, truncated, or picked up whitespace/quotes.');
  } else if (e.code === 'AccessDenied') {
    console.log('  The key is valid but not permitted to list buckets. That can be');
    console.log('  normal for a restricted key; try storage-smoke and see whether the');
    console.log('  per-bucket operations work.');
  } else {
    console.log(`  Unexpected: ${e.message} (HTTP ${e.status})`);
  }
}

if (names) {
  console.log('\n─── configured names vs reality ─────────────────────────\n');
  let wrong = 0;
  for (const [label, want] of [
    ['staging', c.stagingBucket], ['evidence', c.evidenceBucket], ['renditions', c.renditionBucket],
  ]) {
    const ok = names.includes(want);
    if (!ok) wrong += 1;
    console.log(`  ${ok ? 'ok    ' : 'WRONG '} ${label.padEnd(10)} .env says "${want}"${ok ? '' : ' — not in the list above'}`);
  }
  if (wrong) {
    console.log('\n  Fix the S3_BUCKET_* values in .env to match the names above, or');
    console.log('  create the missing buckets. Note that on a shared S3 service a');
    console.log('  bucket name can already be taken by someone else, which is why a');
    console.log('  name you tried to create may not be yours.');
  } else if (names.length) {
    console.log('\n  All three match. Run: npm run storage-cors && npm run storage-lifecycle -- --apply');
    console.log('  then: npm run storage-smoke');
  }
}

console.log('');
