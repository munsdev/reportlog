/**
 * The new normalizers against the old ones' recorded outputs.
 *
 * Every case must match, except the ones listed in FIXED: legacy bugs this
 * rewrite corrects on purpose. Each is named with what the old code did, so
 * nobody "fixes" the test back to the bug.
 */
import { describe, expect, it } from 'vitest';
import vectors from './fixtures/legacy-vectors.json' with { type: 'json' };
import { buildAnswers, normalizeAnswer, toTimeString } from '../src/index.ts';
import type { FieldDefinition, FieldSettings } from '../src/index.ts';

/** `${kind} ${JSON.stringify(value)}` → what the new code seals instead. */
const FIXED: Record<string, unknown> = {
  // A blank number box sealed `0` (Number('') is 0). Not answered is not zero.
  'number ""': null,
  // An unparseable time was sealed as typed. A time field seals a time or nothing.
  'time "noon"': null,
};

const TIMES_FIXED: Record<string, unknown> = {
  x: null,
};

describe('normalizeAnswer matches the legacy implementation', () => {
  for (const c of vectors.normalize) {
    const id = `${c.kind} ${JSON.stringify(c.value)}`;
    const expected = id in FIXED ? FIXED[id] : c.out;
    it(`${id} ${JSON.stringify(c.settings)}`, () => {
      expect(normalizeAnswer(c.kind, c.value, c.settings as FieldSettings)).toEqual(expected);
    });
  }
});

describe('toTimeString matches the legacy implementation', () => {
  for (const c of vectors.times) {
    const key = String(c.in);
    const expected = key in TIMES_FIXED ? TIMES_FIXED[key] : c.out;
    it(JSON.stringify(c.in), () => {
      expect(toTimeString(c.in)).toEqual(expected);
    });
  }
});

describe('buildAnswers matches the legacy implementation', () => {
  // The question set the vectors were generated against (vecgen form "incidents").
  const fields: FieldDefinition[] = [
    {
      key: 'what',
      kind: 'long_text',
      label: 'What happened?',
      help: 'In your own words.',
      required: true,
      settings: { maxLength: 5000 },
    },
    { key: 'has', kind: 'evidence_declaration', label: 'Do you have photos?', required: false },
    {
      key: 'of',
      kind: 'short_text',
      label: 'What of?',
      required: false,
      shown_when: { field: 'has', in: ['yes'] },
      settings: { maxLength: 200 },
    },
    {
      key: 'kind',
      kind: 'choice_many',
      label: 'Which?',
      help: '',
      required: 0,
      settings: { options: ['x', 'y', 'z'] },
    },
  ];
  for (const c of vectors.buildAnswers) {
    it(c.name, () => {
      const got = buildAnswers(fields, c.body);
      expect(got.answers ?? null).toEqual(c.answers);
      expect(got.errors).toEqual(c.errors);
    });
  }
});
