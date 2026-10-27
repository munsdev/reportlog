import { describe, expect, it } from 'vitest';
import {
  buildSealedObject,
  canonicalJson,
  contentHash,
  heldFingerprint,
  normalizeReportFields,
  ReportFieldsError,
  sha256Hex,
} from '../src/index.ts';

const DIGEST = 'a'.repeat(64);
const NONCE = '0123456789abcdef'.repeat(4);
const base = {
  publicRef: 'RL-X-ABCDEF',
  receivedAt: '2026-10-18T12:00:00.000Z',
  threadId: '0b6f3c2e-6a43-4b8e-9a59-0f1f6f4f2b11',
  correctsId: null,
};

describe('a held value is sealed as a fingerprint', () => {
  it('is SHA-256 of the canonical JSON of the nonce and the value, as documented', () => {
    const fp = heldFingerprint(NONCE, 'The scanners stopped.');
    expect(fp).toBe(sha256Hex(`{"nonce":"${NONCE}","value":"The scanners stopped."}`));
    // A different nonce, a different fingerprint: a guessed value cannot be
    // matched against a published one.
    expect(heldFingerprint('f'.repeat(64), 'The scanners stopped.')).not.toBe(fp);
  });

  it('refuses a nonce that is not 64 lowercase hex', () => {
    expect(() => heldFingerprint('ABC', 'x')).toThrow(/nonce/);
    expect(() => heldFingerprint('A'.repeat(64), 'x')).toThrow(/nonce/);
  });

  it('never puts the value in the sealed object', () => {
    const value = 'https://example.org/a-post';
    const fields = normalizeReportFields({
      logbook: 'x',
      may_publish: false,
      may_publish_digest: DIGEST,
      link_fingerprints: { links: [heldFingerprint(NONCE, value)] },
    });
    const sealed = buildSealedObject({ ...base, fields });
    expect(canonicalJson(sealed)).not.toContain('example.org');
    expect(sealed.recipe).toBe(2);
  });
});

describe('the fingerprint keys follow the absent-key rule', () => {
  it('writes neither key, and recipe 1, when nothing was held: the bytes are as before', () => {
    const plain = normalizeReportFields({
      logbook: 'x',
      may_publish: true,
      may_publish_digest: DIGEST,
    });
    const empty = normalizeReportFields({
      logbook: 'x',
      may_publish: true,
      may_publish_digest: DIGEST,
      text_fingerprints: {},
      link_fingerprints: {},
    });
    expect(empty).toEqual(plain);
    const a = buildSealedObject({ ...base, fields: plain });
    const b = buildSealedObject({ ...base, fields: empty });
    expect(Object.keys(b)).not.toContain('recipe');
    expect(contentHash(b)).toBe(contentHash(a));
  });

  it('refuses a malformed fingerprint rather than sealing it', () => {
    const f = (extra: object) =>
      normalizeReportFields({
        logbook: 'x',
        may_publish: true,
        may_publish_digest: DIGEST,
        ...extra,
      });
    expect(() => f({ text_fingerprints: { what: 'nope' } })).toThrow(ReportFieldsError);
    expect(() => f({ text_fingerprints: ['a'.repeat(64)] })).toThrow(ReportFieldsError);
    expect(() => f({ link_fingerprints: { l: [] } })).toThrow(ReportFieldsError);
    expect(() => f({ link_fingerprints: { l: 'a'.repeat(64) } })).toThrow(ReportFieldsError);
    expect(() => f({ link_fingerprints: { l: ['a'.repeat(64), 'a'.repeat(64)] } })).toThrow(
      ReportFieldsError,
    );
    expect(() => f({ text_fingerprints: { 'bad key': 'a'.repeat(64) } })).toThrow(
      ReportFieldsError,
    );
  });

  it('keeps the links in the order they were sent', () => {
    const order = ['b'.repeat(64), 'a'.repeat(64)];
    const fields = normalizeReportFields({
      logbook: 'x',
      may_publish: true,
      may_publish_digest: DIGEST,
      link_fingerprints: { l: order },
    });
    expect(fields.link_fingerprints).toEqual({ l: order });
  });
});
