/**
 * A passkey in software, for the tests: what a phone or a security key does
 * when a browser asks it to register or to sign, built from node:crypto so
 * @simplewebauthn/server checks real signatures over real bytes.
 *
 * An ES256 (P-256) key, "none" attestation, and the minimum of CBOR needed
 * to write the attestation object and the COSE key.
 */
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';

const b64url = (b: Uint8Array) => Buffer.from(b).toString('base64url');
const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest();

// ── just enough CBOR (RFC 8949) ─────────────────────────────────────────
type Cbor = number | string | Uint8Array | Map<Cbor, Cbor> | Record<string, unknown>;

function head(major: number, n: number): Buffer {
  if (n < 24) return Buffer.from([(major << 5) | n]);
  if (n < 256) return Buffer.from([(major << 5) | 24, n]);
  if (n < 65536) return Buffer.from([(major << 5) | 25, n >> 8, n & 255]);
  const b = Buffer.alloc(5);
  b[0] = (major << 5) | 26;
  b.writeUInt32BE(n, 1);
  return b;
}

export function cbor(v: Cbor): Buffer {
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (typeof v === 'string') {
    const s = Buffer.from(v, 'utf8');
    return Buffer.concat([head(3, s.length), s]);
  }
  if (v instanceof Uint8Array) return Buffer.concat([head(2, v.length), Buffer.from(v)]);
  const entries: [Cbor, Cbor][] =
    v instanceof Map ? [...v.entries()] : (Object.entries(v) as [Cbor, Cbor][]);
  return Buffer.concat([
    head(5, entries.length),
    ...entries.flatMap(([k, x]) => [cbor(k), cbor(x)]),
  ]);
}

export interface SoftPasskey {
  id: string;
  /** What the browser would send to finish registering, for these options. */
  register(options: { challenge: string; rp: { id?: string } }, origin: string): object;
  /** What the browser would send to sign in, for these options. */
  sign(options: { challenge: string; rpId?: string }, origin: string): object;
}

export function softPasskey(): SoftPasskey {
  const credentialId = randomBytes(32);
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  let counter = 0;
  const jwk = publicKey.export({ format: 'jwk' });
  const cose = new Map<Cbor, Cbor>([
    [1, 2], // kty: EC2
    [3, -7], // alg: ES256
    [-1, 1], // crv: P-256
    [-2, Buffer.from(jwk.x ?? '', 'base64url')],
    [-3, Buffer.from(jwk.y ?? '', 'base64url')],
  ]);

  const clientData = (type: string, challenge: string, origin: string) =>
    Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }), 'utf8');

  const authData = (rpId: string, flags: number, attested?: Buffer) => {
    const count = Buffer.alloc(4);
    count.writeUInt32BE(counter);
    return Buffer.concat([
      sha256(rpId),
      Buffer.from([flags]),
      count,
      ...(attested ? [attested] : []),
    ]);
  };

  return {
    id: b64url(credentialId),
    register(options, origin) {
      const rpId = options.rp.id ?? new URL(origin).hostname;
      const idLen = Buffer.alloc(2);
      idLen.writeUInt16BE(credentialId.length);
      const attested = Buffer.concat([Buffer.alloc(16), idLen, credentialId, cbor(cose)]);
      // User present (0x01), verified (0x04), attested credential data (0x40).
      const data = authData(rpId, 0x45, attested);
      const attestationObject = cbor(
        new Map<Cbor, Cbor>([
          ['fmt', 'none'],
          ['attStmt', new Map()],
          ['authData', data],
        ]),
      );
      return {
        id: b64url(credentialId),
        rawId: b64url(credentialId),
        type: 'public-key',
        response: {
          clientDataJSON: b64url(clientData('webauthn.create', options.challenge, origin)),
          attestationObject: b64url(attestationObject),
          transports: ['internal'],
        },
        clientExtensionResults: {},
        authenticatorAttachment: 'platform',
      };
    },
    sign(options, origin) {
      counter += 1;
      const rpId = options.rpId ?? new URL(origin).hostname;
      const data = authData(rpId, 0x05);
      const cd = clientData('webauthn.get', options.challenge, origin);
      const signature = sign('sha256', Buffer.concat([data, sha256(cd)]), privateKey);
      return {
        id: b64url(credentialId),
        rawId: b64url(credentialId),
        type: 'public-key',
        response: {
          clientDataJSON: b64url(cd),
          authenticatorData: b64url(data),
          signature: b64url(signature),
        },
        clientExtensionResults: {},
        authenticatorAttachment: 'platform',
      };
    },
  };
}
