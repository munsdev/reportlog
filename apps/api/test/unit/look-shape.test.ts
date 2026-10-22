/**
 * The shape of an uploaded look.json beyond what check() measures
 * (src/looks/shape.ts): only the fields the format names, each the type it
 * should be, so nothing stored can break the pages that send it back out.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CORE_PACK } from '@reportlog/contracts';
import { shapeProblems } from '../../src/looks/shape.ts';
import { FIXTURES } from '../zip.ts';

const good = () =>
  JSON.parse(readFileSync(join(FIXTURES, 'good', 'look.json'), 'utf8')) as Record<
    string,
    unknown
  > & {
    palettes: Record<string, unknown>[];
    themes: Record<string, unknown>[];
    looks: Record<string, unknown>[];
    fonts: Record<string, unknown>[];
  };

describe('a look.json of the right shape', () => {
  it('the good fixture and the built-in pack have nothing wrong', () => {
    expect(shapeProblems(good())).toEqual([]);
    expect(shapeProblems(CORE_PACK)).toEqual([]);
  });
});

describe('what is refused', () => {
  it('a field the format does not name, anywhere it could hide one', () => {
    const p = good();
    p.css = '@import url(https://x.example/a.css)';
    p.palettes[0] = { ...p.palettes[0], url: 'https://x.example' };
    p.looks[0] = { ...p.looks[0], script: 'alert(1)' };
    expect(shapeProblems(p)).toEqual([
      'look.json has a field this site does not read: "css".',
      'Palette "tideline" has a field this site does not read: "url".',
      'The look "tideline" has a field this site does not read: "script".',
    ]);
  });

  it('a dark flag that is not true or false', () => {
    const p = good();
    p.palettes[0] = { ...p.palettes[0], dark: 'no' };
    expect(shapeProblems(p)).toEqual(['Palette "tideline" must say dark as true or false.']);
  });

  it('a label or description that is not text, or too long', () => {
    const p = good();
    p.label = 7;
    p.author = { name: 'x' };
    p.themes[0] = { ...p.themes[0], label: '', description: 'x'.repeat(301) };
    p.looks[0] = { ...p.looks[0], label: ['Tideline'] };
    expect(shapeProblems(p)).toEqual([
      'The pack’s label must be text, up to 60 characters.',
      'The author must be text, up to 100 characters.',
      'Theme "tideline" needs a label: text, up to 60 characters.',
      'Theme "tideline" needs a description: text, up to 300 characters.',
      'The look "tideline" needs a label: text, up to 60 characters.',
    ]);
  });

  it('a list that is not a list', () => {
    const p = good();
    p.palettes = { tideline: {} } as unknown as Record<string, unknown>[];
    expect(shapeProblems(p)).toEqual(['In look.json, "palettes" must be a list of { … }.']);
  });

  it('a look.json that is not an object', () => {
    expect(shapeProblems([])).toEqual(['look.json must be one object, { … }.']);
    expect(shapeProblems('look')).toEqual(['look.json must be one object, { … }.']);
  });
});
