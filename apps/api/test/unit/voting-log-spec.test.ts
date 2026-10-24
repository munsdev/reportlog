/**
 * The shipped voting presets against the owner's own document
 * (docs/voting-questionnaires.md, 21 October 2026), read from the file:
 * every card's question, every code and label, in order, every "only if", the
 * tip list's kinds of link, and the fixed words on the cards. A change to
 * either side that the other does not share turns this red.
 */
import { LINK_FIELD_WORDING } from '@reportlog/contracts';
import type { LogbookFile } from '@reportlog/contracts';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { shippedTemplate } from '../../src/lists/templates.ts';
import { templateLogbook } from '../../src/logbooks/templates.ts';
import { templateById } from '../../src/site/templates.ts';

const SPEC = readFileSync(
  fileURLToPath(new URL('../../../../docs/voting-questionnaires.md', import.meta.url)),
  'utf8',
);

/** The text from one heading line to the next card (or the end of its section). */
function section(start: string): string {
  const at = SPEC.indexOf(start);
  if (at < 0) throw new Error(`the spec has no "${start}"`);
  const rest = SPEC.slice(at + start.length);
  const end = rest.search(/\n\*\*(CARD \d|SEND CARD|THANK YOU)|\n---\n/);
  return end < 0 ? rest : rest.slice(0, end);
}

/** Every `| `code` | Label | …` row of every table in a piece of the spec. */
function rows(text: string): string[][] {
  return text
    .split('\n')
    .filter((l) => /^\|\s*`[a-z0-9_]+`\s*\|/.test(l))
    .map((l) =>
      l
        .split('|')
        .slice(1, -1)
        .map((c) => c.trim().replace(/^`|`$/g, '')),
    );
}

/** The first quoted line: what a card asks. */
const question = (text: string) => /\n> (.+)\n/.exec(text)?.[1]?.trim() ?? '';

const file: LogbookFile = templateLogbook('how-voting-went');
const q = (key: string) => {
  const found = file.questions.find((x) => x.key === key);
  if (!found) throw new Error(`the logbook has no ${key}`);
  return found;
};
const pairs = (options: unknown) =>
  (options as { code: string; label: string }[]).map((o) => [o.code, o.label]);

const IN_PERSON = { field: 'method', in: ['election_day', 'early'] };
const PROBLEM = { field: 'outcome', in: ['problem'] };

describe('the logbook, card by card (§03)', () => {
  it('asks its questions in the spec’s order, under the spec’s keys', () => {
    expect(file.questions.map((x) => x.key)).toEqual([
      'outcome',
      'method',
      'state',
      'county',
      'date',
      'hour',
      'hour_approx',
      'role',
      'wait',
      'problems',
      'voted',
    ]);
    expect(file.questions.some((x) => x.kind === 'file')).toBe(false);
    expect(file.accepts_files).toBe(false);
  });

  it.each([
    ['**CARD 1 · HOW IT WENT**', 'outcome'],
    ['**CARD 2 · METHOD**', 'method'],
    ['**CARD 5 · YOU WERE**', 'role'],
    ['**CARD 6 · WAIT**', 'wait'],
  ])('%s: its question, and every code and label in order', (heading, key) => {
    const text = section(heading);
    expect(q(key).label).toBe(question(text));
    expect(pairs(q(key).options)).toEqual(rows(text).map(([code, label]) => [code, label]));
  });

  it('cards 5 and 6 are asked only in person, cards 7 and 8 only when something went wrong', () => {
    expect(q('role').shown_when).toEqual(IN_PERSON);
    expect(q('wait').shown_when).toEqual(IN_PERSON);
    expect(q('problems').shown_when).toEqual(PROBLEM);
    expect(q('voted').shown_when).toEqual(PROBLEM);
    for (const key of ['outcome', 'method', 'state', 'county', 'date'])
      expect(q(key).shown_when).toBeUndefined();
  });

  it('card 3: one card, a state by postal code and a county by FIPS inside it, and its two helps', () => {
    const text = section('**CARD 3 · WHERE**');
    expect(q('state').card_question).toBe(question(text));
    expect(q('state')).toMatchObject({ kind: 'location', scope: 'us', code: 'postal' });
    expect(q('county')).toMatchObject({
      kind: 'location',
      scope: 'us',
      depth: 'county',
      code: 'fips',
      within: 'state',
      same_card: true,
    });
    const inPerson = /_Help, in person:_ (.+)\n/.exec(text)?.[1];
    const mail = /_Help, mail and overseas:_ (.+)\n/.exec(text)?.[1];
    expect(q('state').help_when).toEqual([
      { when: IN_PERSON, help: inPerson },
      { when: { field: 'method', in: ['mail', 'overseas'] }, help: mail },
    ]);
  });

  it('card 4: a date always; an hour 0 to 23 and the approximate box only in person', () => {
    const text = section('**CARD 4 · WHEN**');
    expect(q('date').card_question).toBe(question(text));
    expect(q('date')).toMatchObject({ kind: 'date', required: true });
    expect(q('hour')).toMatchObject({
      kind: 'number',
      min: 0,
      max: 23,
      integer: true,
      picker: 'hour',
      same_card: true,
      shown_when: IN_PERSON,
    });
    expect(q('hour_approx')).toMatchObject({
      kind: 'yes_no',
      checkbox: true,
      same_card: true,
      shown_when: IN_PERSON,
    });
    expect(q('hour_approx').required).toBeFalsy();
  });

  it('card 7: the three lists, by method, under one key', () => {
    const text = section('**CARD 7 · WHAT WENT WRONG**');
    expect(q('problems').label).toBe(question(text));
    expect(q('problems').kind).toBe('choice_many');
    const [inPerson, mail, overseas] = text
      .split(/\n_(?:In person|By mail|From overseas)[^\n]*_\n/)
      .slice(1);
    const sets = q('problems').option_sets ?? [];
    expect(sets.map((s) => s.when)).toEqual([
      IN_PERSON,
      { field: 'method', in: ['mail'] },
      { field: 'method', in: ['overseas'] },
    ]);
    for (const [i, part] of [inPerson, mail, overseas].entries()) {
      expect(pairs(sets[i]?.options)).toEqual(rows(part ?? '').map(([c, l]) => [c, l]));
    }
  });

  it('card 8: provisional offered in person only', () => {
    const text = section('**CARD 8 · DID YOU VOTE**');
    expect(q('voted').label).toBe(question(text));
    const all = rows(text);
    const sets = q('voted').option_sets ?? [];
    expect(sets.map((s) => s.when)).toEqual([
      IN_PERSON,
      { field: 'method', in: ['mail', 'overseas'] },
    ]);
    expect(pairs(sets[0]?.options)).toEqual(all.map(([c, l]) => [c, l]));
    expect(pairs(sets[1]?.options)).toEqual(
      all.filter((r) => r[2] !== 'in person only').map(([c, l]) => [c, l]),
    );
  });
});

describe('the tip list (§04)', () => {
  const tips = shippedTemplate('link-tips');
  const text = SPEC.slice(SPEC.indexOf('**Tip list: fields**'));

  it('asks three rows of a link and its kind, row 1 required, and nothing else', () => {
    expect(tips?.fields).toHaveLength(1);
    expect(tips?.fields[0]).toMatchObject({ kind: 'url', required: true, max_values: 3 });
    expect(tips?.requiresEmail).toBe(false);
  });

  it('offers every kind of link the spec lists, code and label, in order', () => {
    const kinds = rows(text).filter(([code]) => code !== 'url' && code !== 'type');
    expect(pairs(tips?.fields[0]?.settings?.link_types)).toEqual(kinds.map(([c, l]) => [c, l]));
  });

  it('shows the spec’s words above the rows', () => {
    const words = /\*\*TEXT ABOVE THE ROWS\*\*\n\n> (.+)\n/.exec(text)?.[1];
    expect(LINK_FIELD_WORDING).toBe(words);
  });
});

describe('the site starting point (§02, §03)', () => {
  const t = templateById('voting-log');

  it('asks the entry card’s question, its answers named for the logbook and the list', () => {
    const entry = section('**Entry card**');
    const [ask, answers] = [...entry.matchAll(/\n> (.*)/g)].map((m) => m[1]).filter(Boolean);
    expect(t?.settings.copy?.submit_question).toBe(ask);
    expect(answers).toBe(`${file.title} · ${t?.settings.list?.title ?? ''}`);
    expect(t?.settings.list).toEqual({
      template: 'link-tips',
      slug: 'tips',
      title: 'Send a link',
    });
  });

  it('puts the send card’s line beside Send', () => {
    const send = section('**SEND CARD**');
    expect(t?.settings.copy?.send_note).toBe(question(send));
  });

  it('turns uploads off and the public archive on', () => {
    expect(t?.settings).toMatchObject({
      attachments: false,
      publicArchive: true,
      logbook: 'how-voting-went',
    });
  });
});
