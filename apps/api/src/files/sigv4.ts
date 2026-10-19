/**
 * AWS Signature Version 4, for S3-compatible object storage.
 *
 * Written out rather than taken from an SDK: it is about a hundred lines, it
 * is the whole of what this archive needs from S3, and every provider in the
 * EU that speaks S3 (Hetzner, Scaleway, OVH, IONOS, Exoscale) accepts it. The
 * provider is not chosen yet, so nothing here names one.
 *
 * The unit tests check it against the worked examples in Amazon's own
 * documentation, byte for byte.
 */
import { createHash, createHmac } from 'node:crypto';

export interface Credentials {
  accessKey: string;
  secretKey: string;
  region: string;
}

const ALGORITHM = 'AWS4-HMAC-SHA256';
export const UNSIGNED = 'UNSIGNED-PAYLOAD';
export const EMPTY_SHA256 = createHash('sha256').update('').digest('hex');

const hmac = (key: Buffer | string, data: string) =>
  createHmac('sha256', key).update(data, 'utf8').digest();
const sha256Hex = (data: string) => createHash('sha256').update(data, 'utf8').digest('hex');

/** RFC 3986 encoding as S3 wants it; `/` kept in a path, encoded elsewhere. */
export function uriEncode(s: string, keepSlash: boolean): string {
  let out = '';
  for (const ch of s) {
    if (/[A-Za-z0-9\-._~]/.test(ch) || (keepSlash && ch === '/')) out += ch;
    else
      out += Array.from(Buffer.from(ch, 'utf8'))
        .map((b) => `%${b.toString(16).toUpperCase().padStart(2, '0')}`)
        .join('');
  }
  return out;
}

/** `20130524T000000Z` and `20130524`. */
export function amzDate(d: Date): { stamp: string; day: string } {
  const stamp = d.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return { stamp, day: stamp.slice(0, 8) };
}

function signingKey(c: Credentials, day: string): Buffer {
  return hmac(hmac(hmac(hmac(`AWS4${c.secretKey}`, day), c.region), 's3'), 'aws4_request');
}

function canonicalQuery(query: Record<string, string>): string {
  return Object.keys(query)
    .sort()
    .map((k) => `${uriEncode(k, false)}=${uriEncode(query[k] ?? '', false)}`)
    .join('&');
}

export interface SignInput {
  method: string;
  /** Already encoded path, e.g. `/bucket/key`. */
  path: string;
  host: string;
  query?: Record<string, string>;
  /** Headers to sign besides host; names in any case. */
  headers?: Record<string, string>;
  payloadHash: string;
  now: Date;
}

/** The headers to send, Authorization included. */
export function signHeaders(c: Credentials, input: SignInput): Record<string, string> {
  const { stamp, day } = amzDate(input.now);
  const all: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(input.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v.trim()]),
    ),
    host: input.host,
    'x-amz-content-sha256': input.payloadHash,
    'x-amz-date': stamp,
  };
  const names = Object.keys(all).sort();
  const canonicalHeaders = names.map((n) => `${n}:${all[n] ?? ''}\n`).join('');
  const signed = names.join(';');
  const request = [
    input.method,
    input.path,
    canonicalQuery(input.query ?? {}),
    canonicalHeaders,
    signed,
    input.payloadHash,
  ].join('\n');
  const scope = `${day}/${c.region}/s3/aws4_request`;
  const toSign = [ALGORITHM, stamp, scope, sha256Hex(request)].join('\n');
  const signature = createHmac('sha256', signingKey(c, day)).update(toSign, 'utf8').digest('hex');
  // Fetch sets Host itself, and refuses one given to it.
  const send = Object.fromEntries(Object.entries(all).filter(([n]) => n !== 'host'));
  return {
    ...send,
    authorization: `${ALGORITHM} Credential=${c.accessKey}/${scope},SignedHeaders=${signed},Signature=${signature}`,
  };
}

/**
 * A presigned URL. Not handed to browsers (every byte goes through the
 * site's own origin, see storage.ts); kept for the operator's storage check
 * and because the documented vectors exercise the same canonical request.
 */
export function presignUrl(
  c: Credentials,
  input: {
    method: string;
    protocol: string;
    host: string;
    path: string;
    expires: number;
    now: Date;
  },
): string {
  const { stamp, day } = amzDate(input.now);
  const scope = `${day}/${c.region}/s3/aws4_request`;
  const query: Record<string, string> = {
    'X-Amz-Algorithm': ALGORITHM,
    'X-Amz-Credential': `${c.accessKey}/${scope}`,
    'X-Amz-Date': stamp,
    'X-Amz-Expires': String(input.expires),
    'X-Amz-SignedHeaders': 'host',
  };
  const request = [
    input.method,
    input.path,
    canonicalQuery(query),
    `host:${input.host}\n`,
    'host',
    UNSIGNED,
  ].join('\n');
  const toSign = [ALGORITHM, stamp, scope, sha256Hex(request)].join('\n');
  const signature = createHmac('sha256', signingKey(c, day)).update(toSign, 'utf8').digest('hex');
  return `${input.protocol}//${input.host}${input.path}?${canonicalQuery(query)}&X-Amz-Signature=${signature}`;
}
