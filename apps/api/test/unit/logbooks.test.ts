/**
 * The pure half of logbooks, starting points and the front page's buttons.
 * Ported from the logbook, template and home-button groups of
 * legacy/scripts/selftest.js. Nothing here needs a database.
 */
import { isPublishedFreeText } from '@reportlog/fields';
import type { AvailableButton } from '@reportlog/contracts';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { defaultOrder, resolveButtons } from '../../src/logbooks/homeButtons.ts';
import { LOGBOOK_FILE_VERSION, validateLogbookFile } from '../../src/logbooks/logbookFile.ts';
import { keyify, slugify, stateOf } from '../../src/logbooks/logbooks.ts';
import { STARTING_POINTS, startingPoints, templateLogbook } from '../../src/logbooks/templates.ts';

const source = (name: string) =>
  readFileSync(new URL(`../../src/logbooks/${name}`, import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*/g, '');

describe('state is computed from the clock', () => {
  const now = new Date('2026-10-18T12:00:00Z');
  const base = { launched_at: null, opens_at: null, closes_at: null, closed_at: null };
  it('reads each state in order', () => {
    expect(stateOf(base, now)).toBe('draft');
    const launched = { ...base, launched_at: '2026-10-01T00:00:00Z' };
    expect(stateOf(launched, now)).toBe('open');
    expect(stateOf({ ...launched, opens_at: '2026-10-19T00:00:00Z' }, now)).toBe('scheduled');
    expect(stateOf({ ...launched, closes_at: '2026-10-18T11:59:59Z' }, now)).toBe('closed');
    expect(stateOf({ ...launched, closed_at: '2026-10-02T00:00:00Z' }, now)).toBe('closed');
    // A draft with a stray time is still a draft: launching is the first fact.
    expect(stateOf({ ...base, closed_at: '2026-10-02T00:00:00Z' }, now)).toBe('draft');
  });
});

describe('names', () => {
  it('makes addresses and keys that the database will accept', () => {
    expect(slugify('Selftest: Munich 2026!')).toBe('selftest-munich-2026');
    expect(keyify('When did it happen?')).toBe('when_did_it_happen');
    expect(slugify('x'.repeat(62) + ' y')).toMatch(/^[a-z0-9][a-z0-9-]{0,62}$/);
    expect(keyify('a'.repeat(38) + ' b')).toMatch(/^[a-z0-9][a-z0-9_]{0,38}$/);
  });
});

describe('a logbook file', () => {
  const goodFile = () => ({
    reportlog_logbook: LOGBOOK_FILE_VERSION,
    title: 'Night shift',
    questions: [
      {
        key: 'what',
        kind: 'choice_one',
        label: 'What happened?',
        required: true,
        options: ['A', 'B'],
      },
      { kind: 'long_text', label: 'Tell us more' },
    ],
  });

  it('has nothing wrong with it when it is well formed', () => {
    expect(validateLogbookFile(goodFile())).toEqual([]);
  });

  it('says what is wrong in sentences, all at once', () => {
    const errs = validateLogbookFile({
      reportlog_logbook: 99,
      title: '',
      questions: [
        { kind: 'nonsense', label: 'x' },
        { kind: 'choice_one', label: 'Pick', options: [] },
        { key: 'Bad Key', kind: 'date', label: 'When' },
      ],
    });
    expect(errs.length).toBeGreaterThanOrEqual(4);
    for (const e of errs) expect(e).toMatch(/\.$/);
  });

  it('is refused with no questions, because a report is its answers', () => {
    expect(validateLogbookFile({ ...goodFile(), questions: [] }).length).toBeGreaterThan(0);
    expect(validateLogbookFile('a string')).toEqual(['That is not a logbook file.']);
  });

  it('is refused with a repeated key, since the key is what an answer is sealed under', () => {
    const f = goodFile();
    const again = {
      ...f,
      questions: [...f.questions, { key: 'what', kind: 'date', label: 'Again' }],
    };
    expect(validateLogbookFile(again).some((e) => e.includes('repeats the key'))).toBe(true);
  });

  it('always makes a draft: the file module launches nothing', () => {
    const src = source('logbookFile.ts');
    expect(src).not.toMatch(/\blaunch\b/);
    expect(src).not.toMatch(/launched_at/);
  });
});

describe('starting points', () => {
  it('are each a logbook file the importer accepts', () => {
    for (const id of STARTING_POINTS)
      expect(validateLogbookFile(templateLogbook(id)), id).toEqual([]);
  });

  it('carry questions and nothing about the site', () => {
    const points = startingPoints();
    expect(points.length).toBeGreaterThan(0);
    for (const p of points) {
      expect(p.questions, p.id).toBeGreaterThan(0);
      for (const forbidden of [
        'siteName',
        'palette',
        'theme',
        'publicArchive',
        'attachments',
        'intake',
        'copy',
      ]) {
        expect(forbidden in p, `${p.id} carries ${forbidden}`).toBe(false);
      }
    }
  });

  it('are described from the file, so a count cannot go stale', () => {
    for (const p of startingPoints()) {
      const file = templateLogbook(p.id as (typeof STARTING_POINTS)[number]);
      const hasUpload = file.questions.some((q) => q.kind === 'file');
      expect(p.title).toBe(file.title);
      expect(p.questions).toBe(file.questions.length + (file.accepts_files && !hasUpload ? 1 : 0));
      expect(p.takes_files).toBe(Boolean(file.accepts_files) || hasUpload);
    }
  });

  it('include one with no files and nothing to type, and it is exactly that', () => {
    const f = templateLogbook('how-voting-went');
    expect(f.accepts_files).toBe(false);
    for (const q of f.questions) {
      expect(['short_text', 'long_text', 'email', 'url'], q.key).not.toContain(q.kind);
      if (q.kind === 'place') expect(q.allow_other, q.key).toBe(false);
    }
    expect(startingPoints().find((p) => p.id === 'how-voting-went')?.typed).toBe(false);
  });

  it('ask no free text that would be published: only the attached note and link kinds', () => {
    for (const id of STARTING_POINTS) {
      for (const q of templateLogbook(id).questions) {
        const settings =
          q.kind === 'place' ? { options: q.options ?? [], allowOther: q.allow_other ?? true } : {};
        expect(isPublishedFreeText({ kind: q.kind, settings }), `${id}.${q.key}`).toBe(false);
      }
    }
  });

  it('knows which kinds are published as typed', () => {
    for (const kind of ['short_text', 'long_text', 'url', 'email'])
      expect(isPublishedFreeText({ kind, settings: {} }), kind).toBe(true);
    for (const kind of ['private_text', 'private_link', 'choice_one', 'file', 'number'])
      expect(isPublishedFreeText({ kind, settings: {} }), kind).toBe(false);
    expect(
      isPublishedFreeText({ kind: 'place', settings: { options: ['A'], allowOther: false } }),
    ).toBe(false);
    expect(
      isPublishedFreeText({ kind: 'place', settings: { options: ['A'], allowOther: true } }),
    ).toBe(true);
    expect(isPublishedFreeText({ kind: 'place', settings: {} })).toBe(true);
  });

  it('include a general one: no subject, takes up to three files, and the evidence pattern', () => {
    const f = templateLogbook('general');
    expect(f.slug).toBe('reports');
    expect(f.accepts_files).toBe(true);
    expect(f.max_files).toBe(3);
    expect(f.questions.map((q) => [q.key, q.kind, Boolean(q.required)])).toEqual([
      ['account', 'private_text', false],
      ['date', 'date', true],
      ['time', 'time', false],
      ['place', 'private_text', false],
      ['saw', 'choice_one', true],
      ['has_evidence', 'evidence_declaration', false],
      ['evidence_of', 'private_text', false],
    ]);
    expect(f.questions.at(-1)?.shown_when).toEqual({ field: 'has_evidence', in: ['yes'] });
  });

  it('ship the evidence pattern as two cards, the follow-up after what it depends on', () => {
    const qs = templateLogbook('elections').questions;
    const d = qs.find((q) => q.kind === 'evidence_declaration');
    expect(d?.required).toBeFalsy();
    expect(d?.help).toMatch(/Nothing is uploaded/);
    const follow = qs.find((q) => q.shown_when?.field === d?.key);
    expect(follow?.kind).toBe('private_text');
    expect(follow?.shown_when?.in).toEqual(['yes']);
    expect(follow?.required).toBeFalsy();
    expect(follow && d && qs.indexOf(follow) > qs.indexOf(d)).toBe(true);
  });

  it('never make identity a setting: a logbook that wants a name asks it as a question', () => {
    expect(source('templates.ts')).not.toMatch(/anonymous\s*:|requireIdentity|identityRequired/);
  });
});

describe("the front page's buttons", () => {
  const lb = (ref: string): AvailableButton => ({
    kind: 'logbook',
    ref,
    label: `Logbook ${ref}`,
    href: `/file/${ref}`,
    action: null,
    blurb: null,
    help: null,
  });
  const builtin = (ref: string): AvailableButton => ({
    kind: 'builtin',
    ref,
    label: ref,
    href: null,
    action: null,
    blurb: null,
    help: null,
  });
  const available = {
    logbooks: [lb('a'), lb('b')],
    lists: [],
    builtins: ['board', 'alerts', 'submit'].map(builtin),
  };

  it('puts the accent on the first, and only the first', () => {
    const bs = resolveButtons(available, null);
    expect(bs.map((b) => b.accent)).toEqual([true, ...bs.slice(1).map(() => false)]);
    expect(bs.map((b) => b.ref)).toEqual(['a', 'b', 'board', 'alerts']);
  });

  it('brings back the generic Submit button only when there is no logbook to name', () => {
    expect(defaultOrder({ logbooks: [], lists: [] }).map((e) => e.ref)).toEqual([
      'submit',
      'board',
      'alerts',
    ]);
  });

  it('skips what is gone, appends what is new, and never appends a built-in', () => {
    const bs = resolveButtons(available, [
      { kind: 'builtin', ref: 'board' },
      { kind: 'logbook', ref: 'closed-since' },
    ]);
    expect(bs.map((b) => b.ref)).toEqual(['board', 'a', 'b']);
  });

  it('keeps a hidden logbook hidden: mentioned, so never appended, and never drawn', () => {
    const bs = resolveButtons(available, [
      { kind: 'builtin', ref: 'board' },
      { kind: 'logbook', ref: 'a', hidden: true },
    ]);
    // 'a' is hidden; 'b' was never mentioned, so it is new and appended.
    expect(bs.map((b) => b.ref)).toEqual(['board', 'b']);
  });

  it('reads a label and a second line on a built-in like any other (decision 76)', () => {
    const [b] = resolveButtons(available, [
      { kind: 'builtin', ref: 'board', label: 'Renamed', sub: 'The published record' },
    ]);
    expect(b).toMatchObject({ label: 'Renamed', title: 'board', blurb: 'The published record' });
  });

  it('gives the accent to the first real button, never to a row of icons', () => {
    const social = {
      kind: 'social' as const,
      ref: 'links',
      label: 'Follow us',
      href: null,
      action: null,
      blurb: null,
      help: null,
      social: [{ id: 'bluesky' as const, url: 'https://bsky.app/profile/x' }],
    };
    const bs = resolveButtons({ ...available, social: [social] }, [
      { kind: 'social', ref: 'links' },
      { kind: 'builtin', ref: 'board' },
    ]);
    // (the logbooks the fixture has are appended after what was arranged)
    expect(bs.slice(0, 2).map((b) => [b.ref, b.accent])).toEqual([
      ['links', false],
      ['board', true],
    ]);
    expect(bs.filter((b) => b.accent)).toHaveLength(1);
  });

  it('stores an order and nothing else: no colour, no href', () => {
    const src = source('homeButtons.ts');
    expect(src).toMatch(/accent: i === first/);
    expect(src).not.toMatch(/colou?r/i);
    const stored = /clean\.push\([\s\S]*?\);/.exec(src);
    expect(stored).not.toBeNull();
    for (const key of ['colour', 'color', 'accent', 'href', 'action'])
      expect(stored?.[0]).not.toContain(key);
  });
});
