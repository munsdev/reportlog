/**
 * The pure parts of two-factor login (plan E, E3): RFC 4226 and RFC 6238
 * against their published vectors, the one-step window, the secret's
 * encryption, recovery codes as a person types them, and the relying party
 * a passkey is made for.
 */
import { describe, expect, it } from 'vitest';
import { relyingParty } from '../../src/identity/passkeys.ts';
import { normalizeRecoveryCode, stepUpFresh, STEP_UP_MS } from '../../src/identity/secondFactor.ts';
import {
  base32Decode,
  base32Encode,
  hotp,
  matchTotp,
  otpauthUri,
  stepAt,
  totpAt,
} from '../../src/identity/totp.ts';
import {
  openTotpSecret,
  sealTotpSecret,
  twoFactorKeyFrom,
} from '../../src/identity/twoFactorKey.ts';

// The secret both RFCs use for SHA-1: the ASCII digits "1234567890" twice.
const RFC_SECRET = Buffer.from('12345678901234567890', 'ascii');

describe('HOTP (RFC 4226, appendix D)', () => {
  const vectors = [
    '755224',
    '287082',
    '359152',
    '969429',
    '338314',
    '254676',
    '287922',
    '162583',
    '399871',
    '520489',
  ];
  vectors.forEach((want, counter) => {
    it(`counter ${String(counter)} is ${want}`, () => {
      expect(hotp(RFC_SECRET, counter)).toBe(want);
    });
  });
});

describe('TOTP (RFC 6238, appendix B, SHA-1, the last six of its eight digits)', () => {
  const vectors: [number, string][] = [
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ];
  for (const [seconds, eight] of vectors) {
    it(`at ${String(seconds)} s`, () => {
      expect(totpAt(RFC_SECRET, seconds * 1000)).toBe(eight.slice(2));
      expect(hotp(RFC_SECRET, stepAt(seconds * 1000), 8)).toBe(eight);
    });
  }
});

describe('the window', () => {
  const now = 1_700_000_000_000;
  const at = (steps: number) => totpAt(RFC_SECRET, now + steps * 30_000);

  it('accepts now and one step either side, saying which step matched', () => {
    expect(matchTotp(RFC_SECRET, at(0), now)).toBe(stepAt(now));
    expect(matchTotp(RFC_SECRET, at(-1), now)).toBe(stepAt(now) - 1);
    expect(matchTotp(RFC_SECRET, at(1), now)).toBe(stepAt(now) + 1);
  });

  it('refuses two steps either side, and anything not six digits', () => {
    expect(matchTotp(RFC_SECRET, at(-2), now)).toBeNull();
    expect(matchTotp(RFC_SECRET, at(2), now)).toBeNull();
    expect(matchTotp(RFC_SECRET, '', now)).toBeNull();
    expect(matchTotp(RFC_SECRET, `${at(0)} `, now)).toBeNull();
    expect(matchTotp(RFC_SECRET, at(0).slice(1), now)).toBeNull();
    expect(matchTotp(RFC_SECRET, 'abcdef', now)).toBeNull();
  });
});

describe('base32 and the QR code’s address', () => {
  it('round-trips, forgiving spaces, hyphens, padding and case', () => {
    const bytes = Buffer.from('any twenty bytes!!!!', 'ascii');
    const text = base32Encode(bytes);
    expect(text).toMatch(/^[A-Z2-7]+$/);
    expect(base32Decode(text)).toEqual(bytes);
    expect(base32Decode(`${text.toLowerCase().replace(/(.{4})/g, '$1 ')}==`)).toEqual(bytes);
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI'); // RFC 4648 §10
    expect(() => base32Decode('not base32!')).toThrow();
  });

  it('says what every authenticator app expects, naming the site', () => {
    const uri = otpauthUri(RFC_SECRET, 'mod@example.org', 'reports.example.org');
    expect(uri).toBe(
      'otpauth://totp/reports.example.org:mod%40example.org?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=reports.example.org&algorithm=SHA1&digits=6&period=30',
    );
  });
});

describe('the secret at rest', () => {
  const key = twoFactorKeyFrom(Buffer.alloc(32, 1).toString('base64'));
  const other = twoFactorKeyFrom(Buffer.alloc(32, 2).toString('base64'));

  it('opens under its key, for its person, and not otherwise', () => {
    if (!key || !other) throw new Error('no key');
    const sealed = sealTotpSecret(key, 7, RFC_SECRET);
    expect(sealed.includes(RFC_SECRET)).toBe(false);
    expect(openTotpSecret(key, 7, sealed)).toEqual(RFC_SECRET);
    expect(openTotpSecret(key, 8, sealed)).toBeNull();
    expect(openTotpSecret(other, 7, sealed)).toBeNull();
    const damaged = Buffer.from(sealed);
    damaged[damaged.length - 1] = (damaged[damaged.length - 1] ?? 0) ^ 1;
    expect(openTotpSecret(key, 7, damaged)).toBeNull();
    expect(openTotpSecret(key, 7, Buffer.alloc(10))).toBeNull();
  });

  it('is a fresh ciphertext each time', () => {
    if (!key) throw new Error('no key');
    expect(sealTotpSecret(key, 7, RFC_SECRET)).not.toEqual(sealTotpSecret(key, 7, RFC_SECRET));
  });

  it('needs 32 bytes, and no key at all is "cannot set one up", not an error', () => {
    expect(twoFactorKeyFrom(undefined)).toBeNull();
    expect(twoFactorKeyFrom('')).toBeNull();
    expect(() => twoFactorKeyFrom(Buffer.alloc(16).toString('base64'))).toThrow(/32 bytes/);
  });
});

describe('recovery codes as a person types them', () => {
  it('forgives case, spaces, hyphens, and the letters that look like digits', () => {
    expect(normalizeRecoveryCode('abcd-efgh-jkmn-pqrs')).toBe('ABCDEFGHJKMNPQRS');
    expect(normalizeRecoveryCode(' ABCD EFGH JKMN PQRS ')).toBe('ABCDEFGHJKMNPQRS');
    expect(normalizeRecoveryCode('O0IL-0000-0000-0000')).toBe('0011000000000000');
  });

  it('refuses anything else', () => {
    expect(normalizeRecoveryCode('')).toBeNull();
    expect(normalizeRecoveryCode('123456')).toBeNull();
    expect(normalizeRecoveryCode('UUUU-0000-0000-0000')).toBeNull();
    expect(normalizeRecoveryCode('0000-0000-0000-00000')).toBeNull();
  });
});

describe('a step-up', () => {
  it('counts for five minutes, and not from the future', () => {
    const now = Date.now();
    expect(stepUpFresh(null, now)).toBe(false);
    expect(stepUpFresh(new Date(now - 1000), now)).toBe(true);
    expect(stepUpFresh(new Date(now - STEP_UP_MS + 1000), now)).toBe(true);
    expect(stepUpFresh(new Date(now - STEP_UP_MS), now)).toBe(false);
    expect(stepUpFresh(new Date(now + 60_000), now)).toBe(false);
  });
});

describe('the relying party', () => {
  it('is SITE_ORIGIN: its host the RP ID, the origin the only one accepted', () => {
    expect(relyingParty('https://reports.example.org')).toEqual({
      id: 'reports.example.org',
      origin: 'https://reports.example.org',
      name: 'reports.example.org',
    });
    expect(relyingParty('https://reports.example.org:8443').origin).toBe(
      'https://reports.example.org:8443',
    );
  });

  it('answers a development address on 127.0.0.1 as localhost, which a browser accepts', () => {
    expect(relyingParty('http://127.0.0.1:4173')).toEqual({
      id: 'localhost',
      origin: 'http://localhost:4173',
      name: 'localhost',
    });
  });
});
