/**
 * RFC 3161: asking an outside authority to say "this digest existed at this
 * time", and reading its answer.
 *
 * WRITTEN OUT HERE RATHER THAN SHELLED OUT TO `openssl ts`. The request is
 * five fields and the parts of the reply worth checking are a handful more,
 * so a small DER reader is less to trust than a dependency, and it runs in a
 * test without a binary on the path. (The tests still hand every request to
 * real OpenSSL acting as a stand-in authority, so a misreading of the
 * standard here would fail there.)
 *
 * WHAT IS CHECKED, AND WHAT IS NOT. A reply is accepted only when the
 * authority granted it, it carries a token, the token's TSTInfo names SHA-256
 * and exactly our digest, and it echoes our nonce. The authority's signature
 * is NOT checked here: that needs its certificate chain, and anybody holding
 * the published token checks it with `openssl ts -verify` and DFN's chain,
 * which is the check that matters. What this file stops is the plausible
 * failure: a reply that is an error page, a token over somebody else's
 * digest, or a replayed one.
 */
import { randomBytes } from 'node:crypto';

// ── DER, as little of it as this needs ───────────────────────────────────

interface Node {
  tag: number;
  /** Where the contents start and end in the buffer. */
  start: number;
  end: number;
  /** The whole element, header included. */
  from: number;
}

export class TimestampError extends Error {
  override name = 'TimestampError';
}

function read(buf: Uint8Array, at: number, limit = buf.length): Node {
  if (at + 2 > limit) throw new TimestampError('The reply ends in the middle of a value.');
  const tag = buf[at] ?? 0;
  if ((tag & 0x1f) === 0x1f)
    throw new TimestampError('The reply uses a tag this reader does not know.');
  let len = buf[at + 1] ?? 0;
  let p = at + 2;
  if (len === 0x80)
    throw new TimestampError('The reply uses an indefinite length, which DER forbids.');
  if (len > 0x80) {
    const n = len & 0x7f;
    if (n > 4) throw new TimestampError('The reply claims a value too long to be real.');
    len = 0;
    for (let i = 0; i < n; i += 1) len = len * 256 + (buf[p + i] ?? 0);
    p += n;
  }
  if (p + len > limit) throw new TimestampError('The reply ends in the middle of a value.');
  return { tag, start: p, end: p + len, from: at };
}

function children(buf: Uint8Array, n: Node): Node[] {
  const out: Node[] = [];
  for (let p = n.start; p < n.end;) {
    const c = read(buf, p, n.end);
    out.push(c);
    p = c.end;
  }
  return out;
}

function expect(n: Node | undefined, tag: number, what: string): Node {
  if (n?.tag !== tag)
    throw new TimestampError(`The reply does not have ${what} where RFC 3161 puts it.`);
  return n;
}

function encode(tag: number, contents: Uint8Array): Uint8Array {
  const len = contents.length;
  let header: number[];
  if (len < 0x80) header = [tag, len];
  else {
    const bytes: number[] = [];
    for (let v = len; v > 0; v = Math.floor(v / 256)) bytes.unshift(v % 256);
    header = [tag, 0x80 | bytes.length, ...bytes];
  }
  const out = new Uint8Array(header.length + len);
  out.set(header);
  out.set(contents, header.length);
  return out;
}

const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

const hex = (b: Uint8Array): string => Buffer.from(b).toString('hex');

/** An INTEGER's value as hex, without the sign byte DER adds. */
const intHex = (buf: Uint8Array, n: Node): string =>
  hex(buf.subarray(n.start, n.end)).replace(/^(00)+(?=.)/, '');

const SEQ = 0x30;
const INT = 0x02;
const OCTETS = 0x04;
const OID = 0x06;
const BOOL = 0x01;
const GENTIME = 0x18;
const CTX0 = 0xa0;

const OIDS = {
  sha256: '608648016503040201',
  signedData: '2a864886f70d010702',
  tstInfo: '2a864886f70d0109100104',
};

const oidHex = (buf: Uint8Array, n: Node) => hex(buf.subarray(n.start, n.end));

// ── the request ──────────────────────────────────────────────────────────

/**
 * A TimeStampReq over a SHA-256 digest: version 1, the imprint, a nonce, and
 * certReq so the token carries the authority's certificate and can be
 * checked by somebody who has never heard of this archive.
 */
export function timestampRequest(digestHex: string, nonce: Uint8Array): Uint8Array {
  if (!/^[a-f0-9]{64}$/.test(digestHex)) throw new TimestampError('That is not a SHA-256 digest.');
  const alg = encode(
    SEQ,
    concat(encode(OID, Buffer.from(OIDS.sha256, 'hex')), Uint8Array.of(5, 0)),
  );
  const imprint = encode(SEQ, concat(alg, encode(OCTETS, Buffer.from(digestHex, 'hex'))));
  // A positive INTEGER: a leading zero byte when the top bit is set.
  const n = (nonce[0] ?? 0) & 0x80 ? concat(Uint8Array.of(0), nonce) : nonce;
  return encode(
    SEQ,
    concat(
      encode(INT, Uint8Array.of(1)),
      imprint,
      encode(INT, n),
      encode(BOOL, Uint8Array.of(0xff)),
    ),
  );
}

// ── the reply ────────────────────────────────────────────────────────────

export interface TokenInfo {
  /** The digest the authority signed, lowercase hex. */
  imprint: string;
  /** The nonce it echoed, hex, or null. */
  nonce: string | null;
  /** When it says the digest existed, as GeneralizedTime text ("20261019180645Z"). */
  genTime: string;
  serial: string;
}

/** Read the TSTInfo inside a token (a CMS ContentInfo). */
export function readToken(token: Uint8Array): TokenInfo {
  const ci = expect(read(token, 0), SEQ, 'a token');
  if (ci.end !== token.length) throw new TimestampError('The token has bytes after its end.');
  const [type, wrapped] = children(token, ci);
  if (oidHex(token, expect(type, OID, 'a content type')) !== OIDS.signedData) {
    throw new TimestampError('The token is not signed data.');
  }
  const sd = expect(children(token, expect(wrapped, CTX0, 'signed data'))[0], SEQ, 'signed data');
  // version, digestAlgorithms, encapContentInfo, ...
  const encap = expect(children(token, sd)[2], SEQ, 'the signed content');
  const [eType, eWrapped] = children(token, encap);
  if (oidHex(token, expect(eType, OID, 'a content type')) !== OIDS.tstInfo) {
    throw new TimestampError('The token does not carry a timestamp.');
  }
  const octets = expect(
    children(token, expect(eWrapped, CTX0, 'the timestamp'))[0],
    OCTETS,
    'the timestamp',
  );
  const tst = token.subarray(octets.start, octets.end);
  const info = expect(read(tst, 0), SEQ, 'the timestamp');
  // version, policy, messageImprint, serialNumber, genTime, [accuracy], [ordering], [nonce], ...
  const fields = children(tst, info);
  const imprint = children(tst, expect(fields[2], SEQ, 'the imprint'));
  const alg = children(tst, expect(imprint[0], SEQ, 'the hash algorithm'));
  if (oidHex(tst, expect(alg[0], OID, 'the hash algorithm')) !== OIDS.sha256) {
    throw new TimestampError('The authority signed a digest other than SHA-256.');
  }
  const digest = expect(imprint[1], OCTETS, 'the digest');
  const serial = expect(fields[3], INT, 'a serial number');
  const time = expect(fields[4], GENTIME, 'a time');
  const nonce = fields.slice(5).find((f) => f.tag === INT);
  return {
    imprint: hex(tst.subarray(digest.start, digest.end)),
    nonce: nonce ? intHex(tst, nonce) : null,
    genTime: Buffer.from(tst.subarray(time.start, time.end)).toString('latin1'),
    serial: intHex(tst, serial),
  };
}

/** The token out of a TimeStampResp, if the authority granted one. */
export function readResponse(reply: Uint8Array): Uint8Array {
  const resp = expect(read(reply, 0), SEQ, 'a reply');
  const [statusInfo, token] = children(reply, resp);
  const status = expect(children(reply, expect(statusInfo, SEQ, 'a status'))[0], INT, 'a status');
  const code = Number.parseInt(intHex(reply, status), 16);
  // 0 granted, 1 granted with modifications. Anything else is a refusal.
  if (code !== 0 && code !== 1) {
    throw new TimestampError(
      `The timestamp authority refused the request (status ${String(code)}).`,
    );
  }
  if (!token)
    throw new TimestampError('The timestamp authority granted the request and sent no token.');
  return reply.subarray(token.from, token.end);
}

export interface Timestamp {
  token: Buffer;
  info: TokenInfo;
}

/**
 * Ask `url` to timestamp `digestHex`. Throws a TimestampError with a sentence
 * if the reply is anything but a token over exactly this digest and nonce.
 */
export async function requestTimestamp(
  url: string,
  digestHex: string,
  { fetchImpl = fetch, timeoutMs = 30_000 }: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<Timestamp> {
  const nonce = randomBytes(8);
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/timestamp-query' },
      body: timestampRequest(digestHex, nonce),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    // Not the URL in the message: logs never carry one.
    throw new TimestampError(
      `The timestamp authority could not be reached (${e instanceof Error ? e.name : 'error'}).`,
    );
  }
  if (!res.ok) {
    throw new TimestampError(`The timestamp authority answered HTTP ${String(res.status)}.`);
  }
  const reply = new Uint8Array(await res.arrayBuffer());
  const token = readResponse(reply);
  const info = readToken(token);
  if (info.imprint !== digestHex) {
    throw new TimestampError(
      'The timestamp authority signed a different digest from the one sent.',
    );
  }
  const sent = hex(nonce).replace(/^(00)+(?=.)/, '');
  if (info.nonce !== sent) {
    throw new TimestampError(
      'The timestamp authority did not echo the nonce: the reply is not an answer to this request.',
    );
  }
  return { token: Buffer.from(token), info };
}
