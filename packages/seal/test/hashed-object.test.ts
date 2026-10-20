/**
 * What the fingerprint is made of, one input at a time: each thing a report
 * commits to must move its hash, and each thing it does not must leave the
 * hash alone. The vectors pin whole objects; these name the single change.
 */
import { describe, expect, it } from 'vitest';
import type { FieldDefinition } from '@reportlog/fields';
import {
  buildSealedObject,
  canonicalJson,
  contentHash,
  formText,
  normalizeReportFields,
  ReportFieldsError,
} from '../src/index.ts';
import type { AttachmentEntry } from '../src/index.ts';

const DIGEST = 'a'.repeat(64);
const base = {
  publicRef: 'RL-X-ABCDEF',
  receivedAt: '2026-10-18T12:00:00.000Z',
  threadId: '0b6f3c2e-6a43-4b8e-9a59-0f1f6f4f2b11',
  correctsId: null,
};
const fields = () =>
  normalizeReportFields({ logbook: 'lb', may_publish: true, may_publish_digest: DIGEST });

describe('the attachment manifest', () => {
  const files: AttachmentEntry[] = [
    { ordinal: 1, sha256: 'c'.repeat(64), byte_size: 5, media_type: 'image/jpeg' },
    { ordinal: 2, sha256: 'd'.repeat(64), byte_size: 9, media_type: 'image/png' },
  ];
  const hashWith = (attachments: AttachmentEntry[]) =>
    contentHash(buildSealedObject({ ...base, fields: fields(), attachments }));

  it("changes the hash when one file's byte_size changes", () => {
    const [first, second] = files as [AttachmentEntry, AttachmentEntry];
    expect(hashWith([first, { ...second, byte_size: 10 }])).not.toBe(hashWith(files));
  });

  it('changes the hash when the same files are in another order', () => {
    // RFC 8785 sorts keys and never arrays, so the order is part of the seal.
    expect(hashWith([...files].reverse())).not.toBe(hashWith(files));
    // And renumbered, so the second file is now the first.
    const [first, second] = files as [AttachmentEntry, AttachmentEntry];
    expect(
      hashWith([
        { ...second, ordinal: 1 },
        { ...first, ordinal: 2 },
      ]),
    ).not.toBe(hashWith(files));
  });
});

describe('the publication answer', () => {
  const sealWith = (may_publish: unknown) =>
    buildSealedObject({
      ...base,
      fields: normalizeReportFields({ logbook: 'lb', may_publish, may_publish_digest: DIGEST }),
    });

  it("reads the strings 'true' and 'false' as the booleans, and seals the boolean", () => {
    // A form post carries strings. What is sealed is the boolean, so a
    // report filed by form and one filed by JSON are the same bytes.
    expect(sealWith('true').may_publish).toBe(true);
    expect(sealWith('false').may_publish).toBe(false);
    expect(canonicalJson(sealWith('true'))).toBe(canonicalJson(sealWith(true)));
    expect(canonicalJson(sealWith('false'))).toBe(canonicalJson(sealWith(false)));
    expect(canonicalJson(sealWith('false'))).toContain('"may_publish":false');
  });

  it('refuses anything else instead of guessing', () => {
    for (const v of ['yes', 'no', 'TRUE', 'False', '1', '0', '', 1, 0, null, undefined]) {
      expect(() => sealWith(v), String(v)).toThrow(ReportFieldsError);
    }
  });
});

describe('the form a report was answered against', () => {
  const QS: FieldDefinition[] = [
    { key: 'what', kind: 'long_text', label: 'What happened?', required: true },
    { key: 'when', kind: 'date', label: 'When?' },
  ];
  const hashOf = (qs: readonly FieldDefinition[]) => formText('lb', qs).hash;
  const [what, when] = QS as [FieldDefinition, FieldDefinition];

  it('changes its hash when help text is added or reworded', () => {
    // Help changes what the reporter was told the question means.
    const helped = hashOf([{ ...what, help: 'In your own words.' }, when]);
    expect(helped).not.toBe(hashOf(QS));
    expect(hashOf([{ ...what, help: 'Briefly.' }, when])).not.toBe(helped);
  });

  it('keeps its hash when there is no help, however "none" is spelled', () => {
    // The key is written only when there is help. Writing it as null or ""
    // would rehash every form definition there is.
    expect(hashOf([{ ...what, help: null }, when])).toBe(hashOf(QS));
    expect(hashOf([{ ...what, help: '' }, when])).toBe(hashOf(QS));
  });

  it('keeps its hash whatever the filterable switch, the position numbers or the row ids say', () => {
    // Questions as a database row carries them: these three are delivery
    // and bookkeeping, and change no answer. A wider type than
    // FieldDefinition, so the extras reach formText the way a row would.
    type Row = FieldDefinition & { id: number; position: number; filterable: boolean };
    const rows = (a: Partial<Row>, b: Partial<Row>): Row[] => [
      { ...what, id: 1, position: 0, filterable: false, ...a },
      { ...when, id: 2, position: 1, filterable: false, ...b },
    ];
    const plain = hashOf(QS);
    expect(hashOf(rows({}, {}))).toBe(plain);
    expect(hashOf(rows({ filterable: true }, { filterable: true }))).toBe(plain);
    expect(hashOf(rows({ position: 10 }, { position: 20 }))).toBe(plain);
    expect(hashOf(rows({ id: 901 }, { id: 77 }))).toBe(plain);
  });

  it('still changes its hash when the order of the questions changes', () => {
    // The position NUMBER is not sealed; the order it produces is.
    expect(hashOf([when, what])).not.toBe(hashOf(QS));
  });
});
