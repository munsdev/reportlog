import { describe, expect, it } from 'vitest';
import {
  allOptionCodes,
  buildAnswers,
  cardHeading,
  cardProblem,
  cardsOf,
  describeAnswer,
  helpFor,
  isAsked,
  matchableValues,
  normalizeAnswer,
  normalizeCondition,
  offeredCodes,
  placeCodeOf,
  strictProblems,
  withoutWording,
} from '../src/index.ts';
import type { FieldDefinition } from '../src/index.ts';

const IN_PERSON = { field: 'method', in: ['election_day', 'early'] };

const method: FieldDefinition = {
  key: 'method',
  kind: 'choice_one',
  label: 'How did you vote?',
  required: true,
  settings: {
    options: [
      { code: 'election_day', label: 'In person on election day' },
      { code: 'early', label: 'In person before election day' },
      { code: 'mail', label: 'By mail' },
    ],
  },
};

const problems: FieldDefinition = {
  key: 'problems',
  kind: 'choice_many',
  label: 'What went wrong?',
  required: true,
  settings: {
    option_sets: [
      {
        when: IN_PERSON,
        options: [
          { code: 'turned_away', label: 'Turned away without voting' },
          { code: 'wrong_ballot', label: 'Wrong ballot, or a ballot with errors' },
          { code: 'other', label: 'Something not on this list' },
        ],
      },
      {
        when: { field: 'method', in: ['mail'] },
        options: [
          { code: 'arrived_late', label: 'Ballot arrived late' },
          { code: 'wrong_ballot', label: 'Wrong ballot, or a ballot with errors' },
          { code: 'other', label: 'Something not on this list' },
        ],
      },
    ],
  },
};

describe('plain string options are exactly what they were', () => {
  const old: FieldDefinition = {
    key: 'k',
    kind: 'choice_one',
    label: 'K',
    settings: { options: ['Yes, fine', 'No'] },
  };
  it('seal the string, accept only the string, and match conditions by the string', () => {
    expect(normalizeAnswer('choice_one', 'Yes, fine', old.settings ?? {})).toBe('Yes, fine');
    expect(normalizeAnswer('choice_one', 'yes_fine', old.settings ?? {})).toBeNull();
    expect(matchableValues(old)).toEqual(['Yes, fine', 'No']);
    expect(describeAnswer(old, 'No')).toBe('No');
  });
  it('have nothing to take out as wording: a string is its own code', () => {
    expect(withoutWording(old.settings)).toEqual(old.settings);
  });
});

describe('option codes', () => {
  it('seal the code and show the label', () => {
    expect(normalizeAnswer('choice_one', 'mail', method.settings ?? {})).toBe('mail');
    expect(normalizeAnswer('choice_one', 'By mail', method.settings ?? {})).toBeNull();
    expect(describeAnswer(method, 'mail')).toBe('By mail');
  });
  it('are what a condition names', () => {
    expect(matchableValues(method)).toEqual(['election_day', 'early', 'mail']);
    expect(normalizeCondition({ field: 'method', in: ['mail', 'early'] }, [method])).toEqual({
      ok: true,
      condition: { field: 'method', in: ['early', 'mail'] },
    });
    expect(normalizeCondition({ field: 'method', in: ['By mail'] }, [method]).ok).toBe(false);
  });
  it('lose their labels, and only their labels, in withoutWording', () => {
    expect(withoutWording(method.settings)).toEqual({
      options: ['election_day', 'early', 'mail'],
    });
  });
});

describe('option sets', () => {
  it('offer the list for the earlier answer, under one key', () => {
    expect(offeredCodes(problems.settings, { method: 'early' })).toEqual([
      'turned_away',
      'wrong_ballot',
      'other',
    ]);
    expect(offeredCodes(problems.settings, { method: 'mail' })).toEqual([
      'arrived_late',
      'wrong_ballot',
      'other',
    ]);
  });
  it('share a code between lists as one code', () => {
    expect(allOptionCodes(problems.settings)).toEqual([
      'turned_away',
      'wrong_ballot',
      'other',
      'arrived_late',
    ]);
  });
  it('refuse a code from another list', () => {
    const out = buildAnswers([method, problems], {
      method: 'mail',
      problems: ['turned_away', 'other'],
    });
    expect(out.answers).toEqual({ method: 'mail', problems: ['other'] });
    expect(
      strictProblems([method, problems], { method: 'mail', problems: ['turned_away'] }),
    ).toEqual([{ key: 'problems', reason: 'not-accepted' }]);
  });
  it('seal in the order of the list offered, whatever order was sent', () => {
    const out = buildAnswers([method, problems], {
      method: 'early',
      problems: ['other', 'turned_away'],
    });
    expect(out.answers?.problems).toEqual(['turned_away', 'other']);
  });
  it('mean the question is not asked when no set applies', () => {
    const only = {
      ...method,
      settings: {
        options: [...(method.settings?.options ?? []), { code: 'overseas', label: 'Overseas' }],
      },
    };
    expect(isAsked(problems, { method: 'overseas' })).toBe(false);
    const out = buildAnswers([only, problems], { method: 'overseas' });
    // Required, but not asked, so not needed.
    expect(out.errors).toEqual([]);
    expect(strictProblems([only, problems], { method: 'overseas', problems: ['other'] })).toEqual([
      { key: 'problems', reason: 'not-asked' },
    ]);
  });
  it('label a shared code from the list the reporter was offered', () => {
    const late: FieldDefinition = {
      key: 'p',
      kind: 'choice_one',
      label: 'P',
      settings: {
        option_sets: [
          {
            when: { field: 'method', in: ['mail'] },
            options: [{ code: 'late', label: 'Arrived late' }],
          },
          { when: IN_PERSON, options: [{ code: 'late', label: 'Arrived too late' }] },
        ],
      },
    };
    expect(describeAnswer(late, 'late', { method: 'early' })).toBe('Arrived too late');
    expect(describeAnswer(late, 'late', { method: 'mail' })).toBe('Arrived late');
    expect(describeAnswer(late, 'late')).toBe('Arrived late');
  });
});

describe('help that depends on an answer', () => {
  const where: FieldDefinition = {
    key: 'state',
    kind: 'location',
    label: 'State',
    help: 'Fallback.',
    settings: {
      scope: 'us',
      code: 'postal',
      help_when: [
        { when: IN_PERSON, help: 'The county where the polling place was.' },
        { when: { field: 'method', in: ['mail'] }, help: 'The county where you are registered.' },
      ],
    },
  };
  it('is the first that holds, else the plain help', () => {
    expect(helpFor(where, { method: 'early' })).toBe('The county where the polling place was.');
    expect(helpFor(where, { method: 'mail' })).toBe('The county where you are registered.');
    expect(helpFor(where, {})).toBe('Fallback.');
  });
  it('is wording', () => {
    expect(withoutWording(where.settings)).toEqual({
      scope: 'us',
      code: 'postal',
      help_when: [{ when: IN_PERSON }, { when: { field: 'method', in: ['mail'] } }],
    });
  });
});

describe('a state by postal code, a county by FIPS inside it', () => {
  const state: FieldDefinition = {
    key: 'state',
    kind: 'location',
    label: 'State',
    required: true,
    settings: { scope: 'us', code: 'postal', card_question: 'Which state and county?' },
  };
  const county: FieldDefinition = {
    key: 'county',
    kind: 'location',
    label: 'County',
    required: true,
    settings: { scope: 'us', depth: 'county', code: 'fips', within: 'state', same_card: true },
  };
  it('seals AZ and 04013', () => {
    expect(buildAnswers([state, county], { state: 'az', county: '04013' })).toEqual({
      answers: { state: 'AZ', county: '04013' },
      errors: [],
    });
  });
  it.each(['US', 'DC', 'PR', 'GU', 'VI', 'AS', 'MP'])('takes %s as a state (but not US)', (c) => {
    expect(normalizeAnswer('location', c, state.settings ?? {})).toBe(c === 'US' ? null : c);
  });
  it('refuses UM, a hierarchical code and a country under postal', () => {
    for (const v of ['UM', 'US-AZ', 'FR', 'XX'])
      expect(normalizeAnswer('location', v, state.settings ?? {})).toBeNull();
  });
  it('refuses a county outside the chosen state, and one with no state chosen', () => {
    expect(strictProblems([state, county], { state: 'NM', county: '04013' })).toEqual([
      { key: 'county', reason: 'not-accepted' },
    ]);
    expect(buildAnswers([state, county], { county: '04013' }).answers).toBeUndefined();
    expect(
      normalizeAnswer('location', 'US-AZ-04013', county.settings ?? {}, {
        answers: { state: 'AZ' },
      }),
    ).toBeNull();
  });
  it('takes Louisiana parishes, Alaska areas, Virginia cities and territory equivalents', () => {
    for (const [s, c] of [
      ['LA', '22071'],
      ['AK', '02020'],
      ['VA', '51760'],
      ['PR', '72127'],
      ['GU', '66010'],
    ] as const) {
      expect(buildAnswers([state, county], { state: s, county: c }).answers).toEqual({
        state: s,
        county: c,
      });
    }
  });
  it('reads back as the hierarchical code and as words', () => {
    expect(placeCodeOf('AZ', state.settings)).toBe('US-AZ');
    expect(placeCodeOf('04013', county.settings)).toBe('US-AZ-04013');
    expect(describeAnswer(state, 'AZ')).toBe('Arizona');
    expect(describeAnswer(county, '04013')).toBe('Maricopa County, Arizona');
  });
  it('without a code setting, is exactly what it was', () => {
    expect(normalizeAnswer('location', 'us-az', { scope: 'us' })).toBe('US-AZ');
    expect(normalizeAnswer('location', 'AZ', { scope: 'us' })).toBeNull();
  });
});

describe('an hour and a tick box', () => {
  const hour: FieldDefinition = {
    key: 'hour',
    kind: 'number',
    label: 'Hour',
    settings: { min: 0, max: 23, integer: true, picker: 'hour' },
  };
  const approx: FieldDefinition = {
    key: 'hour_approx',
    kind: 'yes_no',
    label: 'Approximate',
    settings: { checkbox: true },
  };
  it('takes whole hours 0 to 23 only', () => {
    expect(normalizeAnswer('number', '0', hour.settings ?? {})).toBe(0);
    expect(normalizeAnswer('number', 23, hour.settings ?? {})).toBe(23);
    for (const v of ['24', '-1', '9.5'])
      expect(normalizeAnswer('number', v, hour.settings ?? {})).toBeNull();
    expect(normalizeAnswer('number', '9.5', { min: 0, max: 23 })).toBe(9.5);
  });
  it('seals a tick as true and nothing for no tick', () => {
    expect(buildAnswers([approx], { hour_approx: 'yes' }).answers).toEqual({ hour_approx: true });
    expect(buildAnswers([approx], {}).answers).toBeUndefined();
    expect(strictProblems([approx], { hour_approx: false })).toEqual([
      { key: 'hour_approx', reason: 'not-accepted' },
    ]);
    expect(normalizeAnswer('yes_no', 'no', {})).toBe(false);
  });
  it('reads as words', () => {
    expect(describeAnswer(hour, 0)).toBe('12 am (midnight)');
    expect(describeAnswer(hour, 15)).toBe('3 pm');
    expect(describeAnswer(approx, true)).toBe('Yes');
  });
});

describe('strict refusals', () => {
  const hour: FieldDefinition = {
    key: 'hour',
    kind: 'number',
    label: 'Hour',
    shown_when: IN_PERSON,
    settings: { min: 0, max: 23, integer: true },
  };
  it('refuse an unknown key, a hidden answer and a value not on offer', () => {
    expect(strictProblems([method, hour], { method: 'mail', hour: '9', note: 'hello' })).toEqual([
      { key: 'note', reason: 'unknown' },
      { key: 'hour', reason: 'not-asked' },
    ]);
    expect(strictProblems([method], { method: 'by_post' })).toEqual([
      { key: 'method', reason: 'not-accepted' },
    ]);
  });
  it('never refuse a blank', () => {
    expect(strictProblems([method, hour], { method: 'mail', hour: '', note: '' })).toEqual([]);
  });
  it('accept a good submission', () => {
    expect(strictProblems([method, hour], { method: 'early', hour: 9 })).toEqual([]);
  });
});

describe('cards', () => {
  const q = (
    key: string,
    settings: FieldDefinition['settings'] = {},
    extra: Partial<FieldDefinition> = {},
  ): FieldDefinition => ({
    key,
    kind: 'choice_one',
    label: key,
    settings: { options: ['a', 'b'], ...settings },
    ...extra,
  });
  it('gather same_card questions onto the card before them', () => {
    const fields = [
      q('a'),
      q('b', { card_question: 'B and C?' }),
      q('c', { same_card: true }),
      q('d'),
    ];
    expect(cardsOf(fields).map((c) => c.map((f) => f.key))).toEqual([['a'], ['b', 'c'], ['d']]);
    expect(cardHeading([fields[1] as FieldDefinition])).toBe('B and C?');
    expect(cardHeading([fields[0] as FieldDefinition])).toBe('a');
    expect(cardProblem(fields)).toBeNull();
  });
  it('refuse a part that depends on another part of its own card', () => {
    expect(
      cardProblem([q('a'), q('b', { same_card: true }, { shown_when: { field: 'a', in: ['a'] } })]),
    ).toEqual({ reason: 'same-card-depends', key: 'b' });
    expect(cardProblem([q('a', { same_card: true })])).toEqual({
      reason: 'same-card-first',
      key: 'a',
    });
    expect(cardProblem([q('a'), q('b', { same_card: true, card_question: 'x' })])).toEqual({
      reason: 'card-question-follower',
      key: 'b',
    });
  });
  it('take a part that depends on an earlier card', () => {
    expect(
      cardProblem([
        q('a'),
        q('b'),
        q('c', { same_card: true }, { shown_when: { field: 'a', in: ['a'] } }),
      ]),
    ).toBeNull();
  });
});
