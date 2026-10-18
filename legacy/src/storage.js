// S3-compatible object storage (Hetzner Object Storage — Falkenstein,
// Nuremberg or Helsinki, so the bytes never leave the EU).
//
// Deliberately no SDK. @aws-sdk/client-s3 pulls in ~80 transitive packages
// for what this app actually needs: presign a PUT, GET an object, DELETE an
// object. SigV4 is about sixty lines of node:crypto, it has no dependencies
// to audit or update on a box that also runs something else, and it keeps
// `npm install --omit=dev` on the server as small as it is today.
//
// Everything is query-string ("presigned") signing rather than header
// signing, because presigned URLs are the one form we genuinely need — the
// browser uploads straight to Hetzner and never routes payload through the
// app — and reusing the same code path for the app's own reads means there
// is only one signing implementation to get right.
//
// Follows the same degrade-quietly contract as src/email.js: with no
// credentials configured, isConfigured() is false and callers disable the
// feature rather than throwing.

import crypto from 'node:crypto';

const ALGORITHM = 'AWS4-HMAC-SHA256';
const SERVICE = 's3';
// Presigned PUTs are single-use and short-lived; the browser gets one per
// file and starts uploading immediately.
const DEFAULT_EXPIRY_SECONDS = 15 * 60;

export function storageConfig() {
  return {
    endpoint: process.env.S3_ENDPOINT || '',
    region: process.env.S3_REGION || 'eu-central-1',
    accessKey: process.env.S3_ACCESS_KEY || '',
    secretKey: process.env.S3_SECRET_KEY || '',
    evidenceBucket: process.env.S3_BUCKET_EVIDENCE || '',
    renditionBucket: process.env.S3_BUCKET_RENDITIONS || '',
    stagingBucket: process.env.S3_BUCKET_STAGING || '',
    addressing: (process.env.S3_ADDRESSING || 'path').trim().toLowerCase(),
  };
}

// The two ways an S3 request names its bucket. Path-style puts it in the
// path (`host/bucket/key`); virtual-hosted-style puts it in the hostname
// (`bucket.host/key`). Which one an endpoint accepts is the endpoint's
// choice, not ours, and getting it wrong is not a soft failure: the bucket
// is part of what gets signed, so the wrong form is a signature mismatch
// rather than a 404 that names the problem.
export const ADDRESSING_MODES = ['path', 'virtual'];

export function isConfigured() {
  const c = storageConfig();
  return Boolean(c.endpoint && c.accessKey && c.secretKey
    && c.evidenceBucket && c.renditionBucket && c.stagingBucket);
}

function hmac(key, data) {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
}

function sha256Hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

// RFC 3986. encodeURIComponent leaves !'()* alone and S3 does not, which is
// the classic source of signatures that verify locally and fail at the
// endpoint the moment a filename contains a quote.
function uriEncode(str, encodeSlash = true) {
  let out = '';
  for (const ch of String(str)) {
    if (/[A-Za-z0-9\-._~]/.test(ch)) {
      out += ch;
    } else if (ch === '/') {
      out += encodeSlash ? '%2F' : '/';
    } else {
      out += Array.from(Buffer.from(ch, 'utf8'))
        .map((b) => `%${b.toString(16).toUpperCase().padStart(2, '0')}`)
        .join('');
    }
  }
  return out;
}

function amzDates() {
  const now = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  return { amzDate: now, dateStamp: now.slice(0, 8) };
}

function signingKey(secret, dateStamp, region) {
  return hmac(hmac(hmac(hmac(`AWS4${secret}`, dateStamp), region), SERVICE), 'aws4_request');
}

/**
 * Build a presigned URL for one object operation.
 *
 * PATH-STYLE BY DEFAULT (`host/bucket/key`), because it works against every
 * S3-compatible endpoint including Ceph RGW without depending on wildcard
 * DNS for the bucket — Hetzner, Backblaze B2, MinIO, Scaleway and R2 all
 * take it, and it is what this has run on.
 *
 * `S3_ADDRESSING=virtual` switches to virtual-hosted-style
 * (`bucket.host/key`) for the endpoints that require it. AWS S3 proper is
 * the one that matters: path-style is deprecated there, and a bucket in a
 * newer region may refuse it outright.
 *
 * The bucket is part of the canonical request either way, so this is not a
 * cosmetic difference in the URL — the host header is signed, and in
 * virtual-hosted style the host *contains the bucket*. Both forms are
 * therefore signed here rather than rewritten by a caller afterwards, which
 * would invalidate the signature.
 */
export function presign(method, bucket, key, { expiresIn = DEFAULT_EXPIRY_SECONDS, extraQuery = {} } = {}) {
  const c = storageConfig();
  if (!c.endpoint || !c.accessKey || !c.secretKey) {
    throw new Error('object storage is not configured (S3_ENDPOINT / S3_ACCESS_KEY / S3_SECRET_KEY)');
  }

  const url = new URL(c.endpoint);
  if (!ADDRESSING_MODES.includes(c.addressing)) {
    // A typo here would otherwise fall back to path-style and fail as a
    // signature mismatch against a virtual-hosted endpoint, which names
    // nothing useful. Say which setting is wrong instead.
    throw new Error(
      `S3_ADDRESSING must be one of ${ADDRESSING_MODES.join(', ')} (got "${c.addressing}")`);
  }
  const virtual = c.addressing === 'virtual' && Boolean(bucket);

  if (virtual && !/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(bucket)) {
    // A dot in the bucket breaks TLS: `my.bucket.s3.example.com` is not
    // covered by a `*.s3.example.com` certificate, so the upload fails in
    // the browser with a certificate error rather than anything about S3.
    // Uppercase is not a legal DNS label either.
    throw new Error(
      `bucket "${bucket}" cannot be addressed virtual-hosted-style: `
      + 'it must be lowercase, and a dot in the name breaks TLS against a '
      + 'wildcard certificate. Use S3_ADDRESSING=path, or rename the bucket.');
  }

  // Virtual-hosted style moves the bucket into the host, so the host that
  // gets signed is not the configured endpoint's host.
  const host = virtual ? `${bucket}.${url.host}` : url.host;
  // Bucket-level operations (?cors, ?lifecycle) address the bucket itself,
  // so they must not carry a trailing slash — the path is part of what is
  // signed, and `/bucket/` would not match `/bucket`. Virtual-hosted style
  // names the bucket in the host, so the bucket itself is `/`.
  const canonicalUri = virtual
    ? (key ? `/${uriEncode(key, false)}` : '/')
    : (bucket
      ? (key ? `/${uriEncode(bucket, false)}/${uriEncode(key, false)}` : `/${uriEncode(bucket, false)}`)
      : '/');

  const { amzDate, dateStamp } = amzDates();
  const scope = `${dateStamp}/${c.region}/${SERVICE}/aws4_request`;

  const query = {
    'X-Amz-Algorithm': ALGORITHM,
    'X-Amz-Credential': `${c.accessKey}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expiresIn),
    'X-Amz-SignedHeaders': 'host',
    ...extraQuery,
  };

  const canonicalQuery = Object.keys(query)
    .sort()
    .map((k) => `${uriEncode(k)}=${uriEncode(query[k])}`)
    .join('&');

  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery,
    `host:${host}\n`,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const stringToSign = [ALGORITHM, amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const signature = crypto
    .createHmac('sha256', signingKey(c.secretKey, dateStamp, c.region))
    .update(stringToSign, 'utf8')
    .digest('hex');

  // Built from the host that was SIGNED, not from the configured endpoint —
  // in virtual-hosted style those differ, and returning the endpoint's
  // origin would hand out a URL whose host does not match its signature.
  return `${url.protocol}//${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

/**
 * A URL handed to a browser to upload one file directly to the staging
 * bucket. This is the only presigned URL that ever leaves the server, and
 * it is deliberately a PUT into staging — never a read of anything, and
 * never a handle on the evidence bucket.
 */
export function presignUpload(key, expiresIn = DEFAULT_EXPIRY_SECONDS) {
  return presign('PUT', storageConfig().stagingBucket, key, { expiresIn });
}

/**
 * A random object key.
 *
 * Never derive a key from a row id or an uploader's filename. Sequential
 * keys are enumerable, and if a bucket policy is ever loosened by accident
 * the difference between "someone can guess the next key" and "someone
 * cannot" is the whole blast radius.
 */
export function randomKey(prefix) {
  return `${prefix}/${crypto.randomBytes(16).toString('hex')}`;
}

// Every call is bounded. Without this a storage endpoint that accepts the
// connection and then stalls would hang the request that triggered it —
// and in the worker, hang the whole batch behind one bad object.
const REQUEST_TIMEOUT_MS = Number(process.env.S3_TIMEOUT_MS || 30_000);
// Moving a video takes longer than moving a photo, so transfers get their
// own, more generous ceiling than metadata calls.
const UPLOAD_TIMEOUT_MS = Number(process.env.S3_UPLOAD_TIMEOUT_MS || 10 * 60 * 1000);

async function request(method, bucket, key, body) {
  return fetch(presign(method, bucket, key), {
    method,
    body,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

/**
 * Upload from a stream with an explicit length.
 *
 * Content-Length rather than chunked encoding: S3-compatible endpoints
 * reject a chunked PUT of an object, and we always know the size because
 * the ciphertext is already on disk by this point.
 */
export async function putStream(bucket, key, stream, contentLength) {
  const res = await fetch(presign('PUT', bucket, key), {
    method: 'PUT',
    body: stream,
    duplex: 'half',
    headers: { 'content-length': String(contentLength) },
    signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`storage PUT ${bucket}/${key} failed: ${res.status} ${await res.text().catch(() => '')}`);
  }
}

/**
 * Fetch an object as a stream, optionally a byte range.
 *
 * Range is forwarded rather than signed — only `host` is in the signature,
 * so a range request uses the same presigned URL. That is what lets a
 * browser seek within a published video without the app buffering it.
 */
export async function getStream(bucket, key, { range } = {}) {
  const res = await fetch(presign('GET', bucket, key), {
    method: 'GET',
    headers: range ? { range } : {},
    signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
  });
  if (!res.ok && res.status !== 206) {
    throw new Error(`storage GET ${bucket}/${key} failed: ${res.status}`);
  }
  return {
    body: res.body,
    status: res.status,
    contentLength: Number(res.headers.get('content-length') || 0),
    contentRange: res.headers.get('content-range'),
  };
}

export async function putObject(bucket, key, body) {
  const res = await request('PUT', bucket, key, body);
  if (!res.ok) {
    throw new Error(`storage PUT ${bucket}/${key} failed: ${res.status} ${await res.text().catch(() => '')}`);
  }
}

export async function getObject(bucket, key) {
  const res = await request('GET', bucket, key);
  if (!res.ok) {
    throw new Error(`storage GET ${bucket}/${key} failed: ${res.status}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

export async function headObject(bucket, key) {
  const res = await request('HEAD', bucket, key);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`storage HEAD ${bucket}/${key} failed: ${res.status}`);
  return { size: Number(res.headers.get('content-length') || 0) };
}

/**
 * Set the CORS policy on a bucket.
 *
 * Hetzner's console has no CORS UI, so this is the only way to apply it
 * short of installing an S3 CLI. The browser uploads directly to the
 * staging bucket, and without this the preflight fails and no upload ever
 * starts.
 *
 * Content-MD5 is required by S3 for this operation. It is not part of the
 * signature (only `host` is signed) but the service still verifies it.
 */
/**
 * The buckets this key can see.
 *
 * The single most useful diagnostic there is: it answers "are these
 * credentials valid at all" and "what are the buckets really called" in
 * one request, without needing any bucket to exist.
 */
export async function listBuckets() {
  const c = storageConfig();
  const url = new URL(c.endpoint);
  const res = await fetch(presign('GET', '', ''), {
    method: 'GET',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const body = await res.text();
  if (!res.ok) {
    const code = /<Code>([^<]+)<\/Code>/.exec(body)?.[1] || `HTTP ${res.status}`;
    const err = new Error(code);
    err.code = code;
    err.status = res.status;
    err.host = url.host;
    throw err;
  }
  return [...body.matchAll(/<Name>([^<]+)<\/Name>/g)].map((m) => m[1]);
}

export async function putBucketCors(bucket, xml) {
  const md5 = crypto.createHash('md5').update(xml).digest('base64');
  const res = await fetch(presign('PUT', bucket, '', { extraQuery: { cors: '' } }), {
    method: 'PUT',
    body: xml,
    headers: { 'content-type': 'application/xml', 'content-md5': md5 },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`PUT ${bucket}?cors failed: ${res.status} ${await res.text().catch(() => '')}`);
  }
}

export async function getBucketCors(bucket) {
  const res = await fetch(presign('GET', bucket, '', { extraQuery: { cors: '' } }), {
    method: 'GET',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET ${bucket}?cors failed: ${res.status}`);
  return res.text();
}

export async function putBucketLifecycle(bucket, xml) {
  const md5 = crypto.createHash('md5').update(xml).digest('base64');
  const res = await fetch(presign('PUT', bucket, '', { extraQuery: { lifecycle: '' } }), {
    method: 'PUT',
    body: xml,
    headers: { 'content-type': 'application/xml', 'content-md5': md5 },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`PUT ${bucket}?lifecycle failed: ${res.status} ${await res.text().catch(() => '')}`);
  }
}

export async function getBucketLifecycle(bucket) {
  const res = await fetch(presign('GET', bucket, '', { extraQuery: { lifecycle: '' } }), {
    method: 'GET',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  // A bucket with no rule answers 404 NoSuchLifecycleConfiguration. That is
  // the state this script exists to change, not an error.
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET ${bucket}?lifecycle failed: ${res.status}`);
  return res.text();
}

export async function deleteObject(bucket, key) {
  const res = await request('DELETE', bucket, key);
  // 204 on success, 404 if it was already swept by the lifecycle rule —
  // both mean "not there any more", which is all the caller wants.
  if (!res.ok && res.status !== 404) {
    throw new Error(`storage DELETE ${bucket}/${key} failed: ${res.status}`);
  }
}
