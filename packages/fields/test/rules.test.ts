import { describe, expect, it } from 'vitest';
import {
  buildAnswers,
  conditionMet,
  normalizeAnswer,
  normalizeCondition,
  toTimeString,
} from '../src/index.ts';
import type { FieldDefinition } from '../src/index.ts';

describe('the absent-key rule inside the answer map', () => {
  it('leaves no key for an unanswered question, never a null one', () => {
    const fields: FieldDefinition[] = [
      { key: 'a', kind: 'short_text', label: 'A' },
      { key: 'b', kind: 'short_text', label: 'B' },
    ];
    const { answers } = buildAnswers(fields, { a: 'x', b: '   ' });
    expect(answers).toEqual({ a: 'x' });
    expect(Object.hasOwn(answers ?? {}, 'b')).toBe(false);
  });

  it('returns undefined, not {}, when nothing was answered', () => {
    expect(
      buildAnswers([{ key: 'a', kind: 'short_text', label: 'A' }], {}).answers,
    ).toBeUndefined();
  });

  it('never seals an answer for the upload question, even a required one', () => {
    const out = buildAnswers([{ key: 'f', kind: 'file', label: 'Files', required: true }], {
      f: 'x',
    });
    expect(out).toEqual({ answers: undefined, errors: [] });
  });
});

describe('times', () => {
  it.each([
    ['24:00', null],
    ['23:60', null],
    ['9:30pm', null],
    ['23:59:59', '23:59:59'],
    [' 7:05 ', '07:05:00'],
  ])('%s → %s', (input, out) => {
    expect(toTimeString(input)).toBe(out);
  });
});

describe('numbers', () => {
  it('treats whitespace as unanswered and keeps a real zero', () => {
    expect(normalizeAnswer('number', '  ')).toBeNull();
    expect(normalizeAnswer('number', '0')).toBe(0);
  });
});

describe('conditions', () => {
  const earlier: FieldDefinition[] = [
    { key: 'yn', kind: 'yes_no', label: 'Yes or no' },
    { key: 'pick', kind: 'choice_many', label: 'Pick', settings: { options: ['a', 'b', 'c'] } },
    { key: 'prose', kind: 'long_text', label: 'Prose' },
  ];

  it('orders values the way the target does, so equal conditions hash equally', () => {
    expect(normalizeCondition({ field: 'pick', in: ['c', 'a', 'c'] }, earlier)).toEqual({
      ok: true,
      condition: { field: 'pick', in: ['a', 'c'] },
    });
  });

  it('refuses forward references, prose targets and unknown values', () => {
    expect(normalizeCondition({ field: 'later', in: ['yes'] }, earlier)).toMatchObject({
      reason: 'unknown-field',
    });
    expect(normalizeCondition({ field: 'prose', in: ['x'] }, earlier)).toMatchObject({
      reason: 'kind',
    });
    expect(normalizeCondition({ field: 'yn', in: ['maybe'] }, earlier)).toMatchObject({
      reason: 'unknown-value',
      unknown: ['maybe'],
    });
  });

  it('treats an unanswered controlling question as not shown', () => {
    expect(conditionMet({ field: 'yn', in: ['yes'] }, {})).toBe(false);
    expect(conditionMet({ field: 'yn', in: ['no'] }, { yn: false })).toBe(true);
    expect(conditionMet({ field: 'pick', in: ['b'] }, { pick: ['a', 'b'] })).toBe(true);
  });
});
