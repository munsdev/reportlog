/**
 * An ed25519 deploy key, in the format OpenSSH reads.
 *
 * WHY THIS IS WRITTEN OUT RATHER THAN SHELLED TO `ssh-keygen`.
 *
 * Two reasons, and the second is the one that decided it.
 *
 *   1. `ssh-keygen` is openssh-client, which a server running git over
 *      HTTPS need not have installed. A panel that works on one box and
 *      reports a missing binary on another is a panel an operator stops
 *      trusting.
 *   2. IT COULD NOT BE TESTED WHERE IT IS WRITTEN. The development
 *      container has no ssh-keygen and no way to install one, so a
 *      shell-out version would have shipped with its only real path
 *      unexercised. This version is pure node, so `npm test` walks every
 *      line of it.
 *
 * WHAT IS STILL NOT PROVED HERE, and it is worth saying plainly: nothing
 * in this container can hand the result to a real sshd and watch it
 * authenticate. The format below is implemented from the OpenSSH key
 * specification and round-tripped against its own parser, which catches a
 * malformed blob but cannot catch a misreading of the spec. That is why
 * the panel has a "test the connection" button that does a real
 * `git ls-remote` with the key: a key OpenSSH will not accept fails there,
 * in front of the operator, with the error git gave — rather than silently
 * at 3am when the anchor runs.
 *
 * ED25519 AND NOT RSA. Shorter, no key-size decision to get wrong, and
 * accepted as a deploy key everywhere that matters. The private half is 64
 * bytes — the 32-byte seed followed by the 32-byte public key — which is
 * what the format stores.
 */

import crypto from 'node:crypto';

const KEY_TYPE = 'ssh-ed25519';
const AUTH_MAGIC = Buffer.from('openssh-key-v1\0', 'binary');

/** An SSH wire string: a four-byte big-endian length, then the bytes. */
function sshString(buf) {
  const body = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf), 'utf8');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length, 0);
  return Buffer.concat([len, body]);
}

/** Read one back. Returns [bytes, nextOffset]. */
function readString(buf, at) {
  if (at + 4 > buf.length) throw new Error('truncated ssh string length');
  const n = buf.readUInt32BE(at);
  if (at + 4 + n > buf.length) throw new Error('truncated ssh string body');
  return [buf.subarray(at + 4, at + 4 + n), at + 4 + n];
}

/**
 * THE RAW 32 BYTES OUT OF NODE'S DER, at a fixed offset.
 *
 * Node will not hand over a raw ed25519 key, only DER. For this one
 * algorithm the encoding is a fixed-length prefix followed by the key, so
 * the last 32 bytes are the key — for both halves. Asserted rather than
 * assumed: a DER of an unexpected length means node changed something or
 * this was called with the wrong kind of key, and taking the tail anyway
 * would produce a key-shaped thing that is not a key.
 */
function rawFromDer(der, expectedLength, what) {
  if (der.length !== expectedLength) {
    throw new Error(`unexpected ${what} DER length ${der.length}, expected ${expectedLength}`);
  }
  return der.subarray(der.length - 32);
}

/** The public half, as it goes in a GitHub deploy key box. */
export function publicKeyLine(rawPublic, comment = '') {
  const blob = Buffer.concat([sshString(KEY_TYPE), sshString(rawPublic)]);
  const c = String(comment || '').replace(/\s+/g, ' ').trim();
  return `${KEY_TYPE} ${blob.toString('base64')}${c ? ` ${c}` : ''}`;
}

/** PEM, 70 characters to a line, which is what OpenSSH writes and reads. */
function pem(body, label) {
  const b64 = body.toString('base64').replace(/(.{70})/g, '$1\n');
  return `-----BEGIN ${label}-----\n${b64}${b64.endsWith('\n') ? '' : '\n'}-----END ${label}-----\n`;
}

/**
 * Generate a keypair. Returns { publicKey, privateKey, fingerprint }.
 *
 * The private key is UNENCRYPTED, deliberately: it is read by a timer with
 * nobody at the keyboard, so a passphrase would have to be stored beside
 * it and would protect nothing. What protects it is the file mode and the
 * fact that it never enters the database or the browser.
 */
export function generateDeployKey(comment = 'reportlog-transparency-log') {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const rawPublic = rawFromDer(
    publicKey.export({ type: 'spki', format: 'der' }), 44, 'public',
  );
  const seed = rawFromDer(
    privateKey.export({ type: 'pkcs8', format: 'der' }), 48, 'private',
  );

  const pubBlob = Buffer.concat([sshString(KEY_TYPE), sshString(rawPublic)]);

  /* THE CHECK INTEGERS ARE THE SAME NUMBER TWICE. OpenSSH writes a random
     value into both and compares them after decryption, as a cheap way to
     tell a wrong passphrase from corrupt bytes. This key is unencrypted,
     so they always match — but they must still be there and still be
     equal, or every reader rejects the file. */
  const check = crypto.randomBytes(4);
  let inner = Buffer.concat([
    check, check,
    sshString(KEY_TYPE),
    sshString(rawPublic),
    // The private half is the seed followed by the public key, not the
    // seed alone. A 32-byte value here parses and then fails to sign.
    sshString(Buffer.concat([seed, rawPublic])),
    sshString(comment),
  ]);
  /* PADDED TO THE CIPHER BLOCK SIZE WITH 1, 2, 3 … and not with zeroes.
     With `none` as the cipher the block size is 8. A reader checks the
     padding bytes are that sequence, so zero padding is rejected. */
  const blockSize = 8;
  const padding = [];
  for (let i = 1; (inner.length + padding.length) % blockSize !== 0; i += 1) padding.push(i);
  inner = Buffer.concat([inner, Buffer.from(padding)]);

  const body = Buffer.concat([
    AUTH_MAGIC,
    sshString('none'),      // cipher
    sshString('none'),      // kdf
    sshString(''),          // kdf options
    (() => { const n = Buffer.alloc(4); n.writeUInt32BE(1, 0); return n; })(),
    sshString(pubBlob),
    sshString(inner),
  ]);

  return {
    publicKey: publicKeyLine(rawPublic, comment),
    privateKey: pem(body, 'OPENSSH PRIVATE KEY'),
    fingerprint: fingerprintOf(pubBlob),
  };
}

/**
 * The SHA256 fingerprint, written the way `ssh-keygen -l` and GitHub both
 * show it, so an operator can compare the two by eye. Base64 with the
 * padding stripped — that is the format, not a tidy-up.
 */
export function fingerprintOf(pubBlob) {
  const d = crypto.createHash('sha256').update(pubBlob).digest('base64').replace(/=+$/, '');
  return `SHA256:${d}`;
}

/** The fingerprint of a public key LINE, which is what a caller usually holds. */
export function fingerprintOfLine(line) {
  const parts = String(line || '').trim().split(/\s+/);
  if (parts.length < 2 || parts[0] !== KEY_TYPE) return null;
  try {
    return fingerprintOf(Buffer.from(parts[1], 'base64'));
  } catch { return null; }
}

/**
 * Read one back, far enough to prove the bytes say what they were meant to.
 *
 * NOT A GENERAL PARSER and not trying to be: it exists so the generator
 * has something to be checked against. It catches a wrong length, a wrong
 * block, a mismatched check integer and padding that is not the expected
 * sequence — every way the writer above could be wrong except a
 * misreading of the specification itself, which no parser of mine could
 * catch because it would share the misreading.
 */
export function parseDeployKey(privatePem) {
  const b64 = String(privatePem)
    .replace(/-----(BEGIN|END) OPENSSH PRIVATE KEY-----/g, '').replace(/\s+/g, '');
  const buf = Buffer.from(b64, 'base64');
  if (!buf.subarray(0, AUTH_MAGIC.length).equals(AUTH_MAGIC)) {
    throw new Error('not an openssh-key-v1 file');
  }
  let at = AUTH_MAGIC.length;
  let cipher; let kdf; let kdfOpts; let pubBlob; let inner;
  [cipher, at] = readString(buf, at);
  [kdf, at] = readString(buf, at);
  [kdfOpts, at] = readString(buf, at);
  const count = buf.readUInt32BE(at); at += 4;
  [pubBlob, at] = readString(buf, at);
  [inner] = readString(buf, at);

  if (inner.readUInt32BE(0) !== inner.readUInt32BE(4)) {
    throw new Error('the check integers disagree');
  }
  let p = 8; let type; let pub; let priv; let comment;
  [type, p] = readString(inner, p);
  [pub, p] = readString(inner, p);
  [priv, p] = readString(inner, p);
  [comment, p] = readString(inner, p);
  const pad = inner.subarray(p);
  pad.forEach((b, i) => {
    if (b !== i + 1) throw new Error(`padding byte ${i} is ${b}, expected ${i + 1}`);
  });

  return {
    cipher: cipher.toString(),
    kdf: kdf.toString(),
    kdfOptions: kdfOpts.toString(),
    keyCount: count,
    type: type.toString(),
    publicKey: pub,
    privateKey: priv,
    comment: comment.toString(),
    publicLine: publicKeyLine(pub, comment.toString()),
    fingerprint: fingerprintOf(pubBlob),
  };
}
