/**
 * Plan E's two rules that live in the shared package:
 *
 *   E1  which questions make a form ask for an email address (email.ts)
 *   E4  a date, time or date-and-time outside its limits is not an answer
 *       (normalize.ts), and a question without limits reads as it always did.
 */
import { describe, expect, it } from 'vitest';
import {
  FIELD_TYPE_IDS,
  formAsksEmail,
  limitsOf,
  normalizeAnswer,
  questionNeedsEmail,
  strictProblems,
} from '../src/index.ts';

describe('E1: when a form asks for an email', () => {
  it('a question somebody types into asks, whatever it is called', () => {
    for (const kind of ['short_text', 'long_text', 'email', 'url'])
      expect(questionNeedsEmail({ kind }), kind).toBe(true);
  });

  it('files, and the evidence declaration a moderator follows up by email, ask', () => {
    expect(questionNeedsEmail({ kind: 'file' })).toBe(true);
    expect(questionNeedsEmail({ kind: 'evidence_declaration' })).toBe(true);
  });

  it('a place asks unless it is a closed list', () => {
    expect(questionNeedsEmail({ kind: 'place', settings: { options: [], allowOther: true } })).toBe(
      true,
    );
    expect(questionNeedsEmail({ kind: 'place', settings: { options: ['A'] } })).toBe(true);
    expect(
      questionNeedsEmail({ kind: 'place', settings: { options: [], allowOther: false } }),
    ).toBe(true);
    expect(
      questionNeedsEmail({ kind: 'place', settings: { options: ['A', 'B'], allowOther: false } }),
    ).toBe(false);
  });

  it('a choice, yes/no, a location, a number, a date or a time does not', () => {
    for (const kind of [
      'choice_one',
      'choice_many',
      'yes_no',
      'location',
      'number',
      'date',
      'time',
      'datetime',
    ])
      expect(questionNeedsEmail({ kind }), kind).toBe(false);
  });

  it('every kind the software knows has been decided, and an unknown kind asks', () => {
    // A new kind falls to "asks" until somebody classes it here.
    expect(questionNeedsEmail({ kind: 'signature' })).toBe(true);
    for (const kind of FIELD_TYPE_IDS) expect(typeof questionNeedsEmail({ kind })).toBe('boolean');
  });

  it('a form asks if any question does, or the operator says so', () => {
    const choices = [{ kind: 'choice_one' }, { kind: 'date' }];
    expect(formAsksEmail(choices)).toBe(false);
    expect(formAsksEmail(choices, true)).toBe(true);
    expect(formAsksEmail([...choices, { kind: 'long_text' }])).toBe(true);
    // The operator's switch can only add an address, never remove one.
    expect(formAsksEmail([{ kind: 'long_text' }], false)).toBe(true);
  });
});

describe('E4: earliest and latest answers', () => {
  const day = { earliest: '2026-09-18', latest: '2026-11-10' };

  it('a date outside is not an answer; on the limits and between, it is', () => {
    expect(normalizeAnswer('date', '2026-09-17', day)).toBeNull();
    expect(normalizeAnswer('date', '2026-11-11', day)).toBeNull();
    expect(normalizeAnswer('date', '2026-09-18', day)).toBe('2026-09-18');
    expect(normalizeAnswer('date', '2026-11-10', day)).toBe('2026-11-10');
    expect(normalizeAnswer('date', '2026-10-21', { earliest: '2026-10-01' })).toBe('2026-10-21');
    expect(normalizeAnswer('date', '2026-09-30', { earliest: '2026-10-01' })).toBeNull();
  });

  it('a time compares in its one written form', () => {
    const polls = { earliest: '05:00', latest: '23:00:00' };
    expect(normalizeAnswer('time', '04:59', polls)).toBeNull();
    expect(normalizeAnswer('time', '5:00', polls)).toBe('05:00:00');
    expect(normalizeAnswer('time', '23:00', polls)).toBe('23:00:00');
    expect(normalizeAnswer('time', '23:01', polls)).toBeNull();
  });

  it('a date and time compares as a moment, whatever offset either was written in', () => {
    const window = { earliest: '2026-11-03T06:00:00-05:00', latest: '2026-11-03T20:00:00-05:00' };
    expect(normalizeAnswer('datetime', '2026-11-03T10:59:00Z', window)).toBeNull();
    expect(normalizeAnswer('datetime', '2026-11-03T11:00:00Z', window)).toBe(
      '2026-11-03T11:00:00.000Z',
    );
    expect(normalizeAnswer('datetime', '2026-11-03T20:00:00-05:00', window)).toBe(
      '2026-11-04T01:00:00.000Z',
    );
    expect(normalizeAnswer('datetime', '2026-11-04T01:00:01Z', window)).toBeNull();
  });

  it('without limits every answer reads exactly as before, and limits are ignored on other kinds', () => {
    expect(normalizeAnswer('date', '1900-01-01')).toBe('1900-01-01');
    expect(normalizeAnswer('date', '1900-01-01', {})).toBe('1900-01-01');
    expect(normalizeAnswer('number', 5, { earliest: '9' })).toBe(5);
    expect(limitsOf('number', { earliest: '2026-01-01' })).toEqual({});
    // A limit that is not one of the kind's own is no limit (the builder refuses it).
    expect(limitsOf('date', { earliest: 'soon' })).toEqual({});
    expect(limitsOf('time', { latest: '7pm' })).toEqual({});
  });

  it('the strict reading refuses an answer outside, as it refuses one not offered', () => {
    const qs = [{ key: 'day', kind: 'date', label: 'Day', settings: day }];
    expect(strictProblems(qs, { day: '2026-12-01' })).toEqual([
      { key: 'day', reason: 'not-accepted' },
    ]);
    expect(strictProblems(qs, { day: '2026-11-03' })).toEqual([]);
    // Blank is not an answer and never refused.
    expect(strictProblems(qs, { day: '' })).toEqual([]);
  });
});
