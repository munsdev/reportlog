/**
 * The site's pure rules. Ports the pure half of legacy's look, identity,
 * copy, legal-text and manifest checks from scripts/selftest.js.
 */
import {
  DEFAULT_LOOK,
  MAX_SITE_NAME,
  PALETTES,
  THEMES,
  accentMarksClose,
  isDarkPalette,
  parseBrand,
  plainName,
} from '@reportlog/contracts';
import { describe, expect, it } from 'vitest';
import { COPY_SLOTS, editorCopy, resolveCopy, validateCopy } from '../../src/site/copy.ts';
import { resolveSiteName, validateSiteName } from '../../src/site/identity.ts';
import {
  MAX_LEGAL_TEXT,
  SKELETONS,
  editorStartingText,
  resolveLegalText,
  validateLegalText,
} from '../../src/site/legal.ts';
import { paintedLook, resolveLook, validateLook } from '../../src/site/look.ts';
import { buildManifest } from '../../src/site/manifest.ts';

describe('the look', () => {
  it('nobody having chosen resolves to the shipped look', () => {
    expect(resolveLook(null)).toEqual(DEFAULT_LOOK);
    expect(resolveLook({ palette: null, theme: '' })).toEqual(DEFAULT_LOOK);
  });

  it('a value that no longer exists resolves to the default, not to nothing', () => {
    expect(resolveLook({ palette: 'retired', theme: 'retired' })).toEqual(DEFAULT_LOOK);
    expect(validateLook({ palette: 'retired' }).ok).toBe(false);
  });

  it('one axis may be set without disturbing the other', () => {
    expect(validateLook({ palette: 'boardroom' })).toEqual({
      ok: true,
      value: { palette: 'boardroom' },
    });
    expect(validateLook({}).ok).toBe(false);
  });

  it('nobody having chosen is Workstation, the default since the owner approved it', () => {
    expect(DEFAULT_LOOK).toEqual({ palette: 'workstation', theme: 'workstation' });
  });

  it('an id stored before the look library paints the one that replaced it', () => {
    expect(resolveLook({ palette: 'harbour', theme: 'plain' })).toEqual({
      palette: 'darkroom',
      theme: 'firm',
    });
    expect(resolveLook({ palette: 'flint', theme: 'signal' })).toEqual({
      palette: 'flint',
      theme: 'signal',
    });
    // An old settings page left open in a tab saves the replacement.
    expect(validateLook({ palette: 'bureau', theme: 'register' })).toEqual({
      ok: true,
      value: { palette: 'boardroom', theme: 'console' },
    });
  });

  it('sends the theme’s layout with the look', () => {
    expect(paintedLook({ palette: 'legal-pad', theme: 'notebook' })).toMatchObject({
      palette: 'legal-pad',
      theme: 'notebook',
      panel_head: THEMES.find((t) => t.id === 'notebook')?.panelHead,
      texture: THEMES.find((t) => t.id === 'notebook')?.texture,
      width: 'regular',
      columns: 'split',
      scale: 'standard',
      surface: 'outlined',
    });
  });

  it('ignores the retired layout axis rather than refusing it', () => {
    const v = validateLook({ theme: 'docket', layout: 'wide' } as { theme: string });
    expect(v).toEqual({ ok: true, value: { theme: 'docket' } });
    expect(Object.keys(resolveLook({ palette: 'bone', theme: 'docket' })).sort()).toEqual([
      'palette',
      'theme',
    ]);
  });

  it('offers fifteen light palettes (the three Civic ones among them) and seven dark ones', () => {
    expect(PALETTES.filter((p) => !p.dark)).toHaveLength(15);
    expect(PALETTES.filter((p) => p.dark)).toHaveLength(7);
    expect(isDarkPalette('midnight')).toBe(true);
    expect(isDarkPalette('flint')).toBe(false);
    expect(isDarkPalette('nonesuch')).toBe(false);
  });

  it('every choice has a label and a description somebody can choose between', () => {
    for (const item of [...PALETTES, ...THEMES]) {
      expect(item.label.length).toBeGreaterThan(1);
      expect(item.description.length).toBeGreaterThan(15);
    }
  });
});

describe('the two-tone name', () => {
  it('marks runs in double quotes with the first accent and single with the second', () => {
    expect(parseBrand('Report"Log"')).toEqual([
      { text: 'Report', mark: '' },
      { text: 'Log', mark: 'a' },
    ]);
    expect(parseBrand(`The"Ruhr"Line'.org'`)).toEqual([
      { text: 'The', mark: '' },
      { text: 'Ruhr', mark: 'a' },
      { text: 'Line', mark: '' },
      { text: '.org', mark: 'b' },
    ]);
    expect(parseBrand('Munich Archive')).toEqual([{ text: 'Munich Archive', mark: '' }]);
  });

  it('reads an unclosed quote as a character, so an apostrophe survives', () => {
    expect(plainName(`Munich's Log`)).toBe(`Munich's Log`);
    expect(parseBrand(`Sam's "Archive"`)).toEqual([
      { text: `Sam's `, mark: '' },
      { text: 'Archive', mark: 'a' },
    ]);
    expect(accentMarksClose(`Sam's Archive`)).toBe(true);
    expect(accentMarksClose('Report"Log')).toBe(false);
  });

  it('draws a name flat when both kinds fail to close, and always returns a run', () => {
    expect(parseBrand(`a"b'c`)).toEqual([{ text: 'abc', mark: '' }]);
    expect(parseBrand('""')).toEqual([{ text: '', mark: '' }]);
  });

  it('never shows the quotes in the plain name', () => {
    expect(plainName('Report"Log"')).toBe('ReportLog');
  });
});

describe('the site name', () => {
  it('is what was set, or the software’s own', () => {
    expect(resolveSiteName(null)).toBe('ReportLog');
    expect(resolveSiteName('  ')).toBe('ReportLog');
    expect(resolveSiteName('Munich Archive')).toBe('Munich Archive');
  });

  it('is measured without its marks', () => {
    const sixty = 'x'.repeat(MAX_SITE_NAME);
    expect(validateSiteName(`"${sixty}"`).ok).toBe(true);
    expect(validateSiteName(`${sixty}y`).ok).toBe(false);
  });

  it('refuses an unclosed double quote and keeps an apostrophe', () => {
    expect(validateSiteName('Report"Log')).toMatchObject({ ok: false });
    expect(validateSiteName(`Sam's Archive`)).toEqual({ ok: true, value: `Sam's Archive` });
  });

  it('treats clearing it as going back to the default', () => {
    expect(validateSiteName('')).toEqual({ ok: true, value: null });
    expect(validateSiteName(null)).toEqual({ ok: true, value: null });
  });
});

describe('the page wording', () => {
  it('resolves every slot, to what was written or to what ships', () => {
    const copy = resolveCopy([{ key: 'home_headline', body: 'Our archive.' }]);
    expect(Object.keys(copy).sort()).toEqual(COPY_SLOTS.map((s) => s.key).sort());
    expect(copy.home_headline).toBe('Our archive.');
    expect(copy.home_lede).toBe(COPY_SLOTS.find((s) => s.key === 'home_lede')?.fallback);
  });

  it('tells the editor which slots are still the shipped wording', () => {
    const slots = editorCopy([{ key: 'standards', body: 'Ours.' }]);
    expect(slots.find((s) => s.key === 'standards')).toMatchObject({
      written: true,
      body: 'Ours.',
    });
    expect(slots.find((s) => s.key === 'home_intro')).toMatchObject({ written: false });
  });

  it('says when an operator last wrote a slot, and nothing for the shipped wording', () => {
    const at = new Date('2026-10-20T09:30:00Z');
    const slots = editorCopy([
      { key: 'standards', body: 'Ours.', updated_at: at },
      // Emptied but not deleted: still the shipped wording, so no date.
      { key: 'home_intro', body: '  ', updated_at: at },
    ]);
    expect(slots.find((s) => s.key === 'standards')?.changed_at).toBe('2026-10-20T09:30:00.000Z');
    expect(slots.find((s) => s.key === 'home_intro')?.changed_at).toBeNull();
    expect(slots.find((s) => s.key === 'home_lede')?.changed_at).toBeNull();
  });

  it('keeps a line to one line, refuses an unknown slot, and treats empty as cleared', () => {
    expect(validateCopy('home_headline', 'One\nTwo').ok).toBe(false);
    expect(validateCopy('home_headline', 'x'.repeat(301)).ok).toBe(false);
    expect(validateCopy('home_lede', 'One\nTwo')).toEqual({
      ok: true,
      value: { key: 'home_lede', body: 'One\nTwo' },
    });
    expect(validateCopy('form_lede', 'Rewrite the promise').ok).toBe(false);
    expect(validateCopy('home_lede', '   ')).toEqual({
      ok: true,
      value: { key: 'home_lede', body: null },
    });
  });

  it('ships the emergency notice, takes a rewording, and can be switched off (decision 78)', () => {
    const shipped =
      'This is a record, not an emergency line. If you or someone else is in danger, call your local emergency number.';
    expect(resolveCopy([]).help_now).toBe(shipped);
    expect(resolveCopy([{ key: 'help_now', body: 'Call 911 first.' }]).help_now).toBe(
      'Call 911 first.',
    );
    // Decision 78: saved empty, the box is OFF (an empty row, not no row).
    expect(validateCopy('help_now', '  ')).toEqual({
      ok: true,
      value: { key: 'help_now', body: '' },
    });
    expect(resolveCopy([{ key: 'help_now', body: '' }]).help_now).toBe('');
    // A door shows it, and figures count what the password protects.
    const figures = validateCopy('help_now', 'We have {{ published }} reports.');
    expect(figures.ok).toBe(false);
    expect(figures.ok ? '' : figures.error).toMatch(/call to action/);
  });

  it('offers no slot for what the software says about itself', () => {
    for (const key of COPY_SLOTS.map((s) => s.key)) {
      expect(key).not.toMatch(/consent|verify|seal|error|label|submit_lede/);
    }
  });
});

describe('the legal text', () => {
  it('reads null, empty and whitespace alike as nothing published', () => {
    expect(resolveLegalText(null)).toBeNull();
    expect(resolveLegalText('')).toBeNull();
    expect(resolveLegalText('   \n  ')).toBeNull();
    expect(resolveLegalText('A notice')).toBe('A notice');
  });

  it('opens the editor on the outline, and says it is the outline', () => {
    expect(editorStartingText(null, 'impressum')).toEqual({
      text: SKELETONS.impressum,
      published: false,
    });
    expect(editorStartingText('Ours', 'privacy')).toEqual({ text: 'Ours', published: true });
  });

  it('the outline is recognisably an outline, and says it is not a notice', () => {
    expect(SKELETONS.impressum).toMatch(/\[.+\]/);
    expect(SKELETONS.privacy).toMatch(/\[.+\]/);
    expect(SKELETONS.impressum).toMatch(/not a legal notice/i);
    expect(SKELETONS.privacy).toMatch(/not a policy/i);
  });

  it('checks the length and nothing else', () => {
    expect(MAX_LEGAL_TEXT).toBeGreaterThanOrEqual(50000);
    expect(validateLegalText('x'.repeat(MAX_LEGAL_TEXT + 1)).ok).toBe(false);
    expect(validateLegalText('we do not have one, ask me')).toEqual({
      ok: true,
      value: 'we do not have one, ask me',
    });
    expect(validateLegalText('  ')).toEqual({ ok: true, value: null });
  });
});

describe('the web manifest', () => {
  it('wears the site’s name and its palette’s colours', () => {
    const m = buildManifest('Munich Archive', { palette: 'midnight', theme: 'signal' });
    expect(m.name).toBe('Munich Archive');
    expect(m.short_name).toBe('Munich Archive');
    const midnight = PALETTES.find((p) => p.id === 'midnight');
    expect(m.background_color).toBe(midnight?.background);
    expect(m.theme_color).toBe(midnight?.deep);
    expect(m.icons.some((i) => i.purpose === 'maskable')).toBe(true);
  });
});
