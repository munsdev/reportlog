import { describe, expect, it } from 'vitest';
import {
  buildSealedObject,
  canonicalJson,
  contradictions,
  genPublicRef,
  normalizeReportFields,
  rebuildSealedObject,
  ReportFieldsError,
} from '../src/index.ts';
import type { StoredReportRecord } from '../src/index.ts';

const DIGEST = 'a'.repeat(64);
const base = {
  publicRef: 'RL-X-ABCDEF',
  receivedAt: '2026-10-18T12:00:00.000Z',
  threadId: '0b6f3c2e-6a43-4b8e-9a59-0f1f6f4f2b11',
  correctsId: null,
};

describe('the absent-key rule at the top level', () => {
  it('writes no answers, provenance, form, attachments or recipe key when none applies', () => {
    const sealed = buildSealedObject({
      ...base,
      fields: normalizeReportFields({
        logbook: 'x',
        may_publish: false,
        may_publish_digest: DIGEST,
        answers: {},
      }),
      attachments: [],
    });
    expect(Object.keys(sealed).sort()).toEqual([
      'corrects_id',
      'logbook',
      'may_publish',
      'may_publish_digest',
      'public_ref',
      'received_at',
      'thread_id',
    ]);
    // An absent key and a null one are different bytes. This is the whole rule.
    expect(canonicalJson({ a: 1 })).not.toBe(canonicalJson({ a: 1, b: null }));
  });

  it('refuses a report without its publication answer and digest', () => {
    expect(() => normalizeReportFields({ logbook: 'x', may_publish_digest: DIGEST })).toThrow(
      ReportFieldsError,
    );
    expect(() =>
      normalizeReportFields({ logbook: 'x', may_publish: true, may_publish_digest: 'short' }),
    ).toThrow(ReportFieldsError);
  });

  it('seals a correction id as a number even when the database hands back a string', () => {
    const sealed = buildSealedObject({
      ...base,
      correctsId: '17',
      fields: normalizeReportFields({
        logbook: 'x',
        may_publish: true,
        may_publish_digest: DIGEST,
      }),
    });
    expect(sealed.corrects_id).toBe(17);
  });
});

describe('third-party provenance', () => {
  const tp = {
    logbook: 'x',
    may_publish: true,
    may_publish_digest: DIGEST,
    third_party: true,
    filed_via: 'Org',
    intake_method: 'phone',
  };

  it('seals the attestation time in the one form the verifier rebuilds', () => {
    const f = normalizeReportFields({ ...tp, attested_at: '2026-10-17T11:00:00+02:00' });
    expect(f.attested_at).toBe('2026-10-17T09:00:00.000Z');
  });

  it('refuses a partial block instead of sealing it as first-hand', () => {
    expect(() => normalizeReportFields({ ...tp, attested_at: 'yesterday' })).toThrow(/attestation/);
    expect(() =>
      normalizeReportFields({ ...tp, filed_via: ' ', attested_at: '2026-10-17T09:00:00Z' }),
    ).toThrow(/organization/);
    expect(() =>
      normalizeReportFields({
        ...tp,
        attested_at: '2026-10-17T09:00:00Z',
        collected_on: '2026-02-30',
      }),
    ).toThrow(/calendar day/);
  });
});

describe('write side and read side agree', () => {
  it('rebuilds exactly the object that was sealed, for every optional combination', () => {
    const attachments = [
      { ordinal: 1, sha256: 'c'.repeat(64), byte_size: 5, media_type: 'image/jpeg' },
    ];
    for (const answers of [undefined, { q: 'yes' }]) {
      for (const third of [false, true]) {
        for (const form of [null, 'b'.repeat(64)]) {
          for (const files of [null, attachments]) {
            const fields = normalizeReportFields({
              logbook: 'lb',
              may_publish: true,
              may_publish_digest: DIGEST,
              answers,
              ...(third
                ? {
                    third_party: true,
                    filed_via: 'Org',
                    intake_method: 'paper',
                    attested_at: '2026-10-17T09:00:00.000Z',
                    collected_on: '2026-10-01',
                  }
                : {}),
            });
            if (form) fields.logbook_form = form;
            const sealed = buildSealedObject({
              ...base,
              correctsId: 3,
              fields,
              attachments: files,
            });
            const stored: StoredReportRecord = {
              public_ref: base.publicRef,
              received_at: base.receivedAt,
              thread_id: base.threadId,
              corrects_id: '3',
              recipe: 1,
              logbook_slug: 'lb',
              form_id: form ? '9' : null,
              logbook_form: form,
              answers: answers ?? null,
              third_party: third ? true : null,
              filed_via: third ? 'Org' : null,
              intake_method: third ? 'paper' : null,
              attested_at: third ? '2026-10-17T09:00:00.000Z' : null,
              collected_on: third ? '2026-10-01' : null,
              may_publish: true,
              may_publish_digest: DIGEST,
            };
            expect(canonicalJson(rebuildSealedObject(stored, files))).toBe(canonicalJson(sealed));
          }
        }
      }
    }
  });

  it('refuses to rebuild a record read without its form hash', () => {
    const stored = { form_id: 4, logbook_form: null } as unknown as StoredReportRecord;
    expect(() => rebuildSealedObject(stored, null)).toThrow(/form_id/);
  });
});

describe('public references', () => {
  it('uses the prefix, the time and six symbols from the alphabet', () => {
    expect(genPublicRef('RL-', 0)).toMatch(/^RL-0-[0-9A-HJKMNP-TV-Z]{6}$/);
    expect(() => genPublicRef('rl')).toThrow();
  });
});

describe('once listed, always listed', () => {
  it('notices a logbook that vanished and a chain that shrank', () => {
    const c = contradictions(
      [
        { logbook: 'a', reports: 2 },
        { logbook: 'b', reports: 5 },
      ],
      [{ logbook: 'b', head: 'x', reports: 4 }],
    );
    expect(c).toEqual({ dropped: ['a'], shrunk: [{ logbook: 'b', was: 5, now: 4 }] });
  });
});
