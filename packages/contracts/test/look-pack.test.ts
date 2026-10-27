/**
 * The look pack check, on the built-in pack and on packs built to fail.
 * Each refusal is a sentence a person reads on the upload screen, so the
 * tests match the sentence rather than a code.
 */
import { describe, expect, it } from 'vitest';
import {
  CORE_PACK,
  LOOKS,
  PALETTES,
  RETIRED_IDS,
  THEMES,
  check,
  derived,
  contrast,
  emptyInstalled,
  themeLayout,
  toCss,
} from '../src/index.ts';
import type { LookPack, Palette, Theme } from '../src/index.ts';

/** One item, or the test fails here rather than somewhere stranger. */
function one<T extends { id: string }>(items: T[] | undefined, id: string): T {
  const found = items?.find((x) => x.id === id);
  if (!found) throw new Error(`nothing called ${id}`);
  return found;
}
const palette = (pack: LookPack, id = 'harbour'): Palette => one(pack.palettes, id);
const theme = (pack: LookPack, id = 'harbour'): Theme => one(pack.themes, id);

// Format 1 had no `display` block: a pack written then carries none, and
// must keep passing and painting as it did.
const desk: Theme = structuredClone(theme(CORE_PACK, 'desk'));
delete desk.display;
const platinum = palette(CORE_PACK, 'platinum');

/** A small pack that passes, to break one thing at a time. */
function goodPack(): LookPack {
  return {
    format: 1,
    id: 'harbour-pack',
    label: 'Harbour',
    version: '1.0.0',
    author: 'Somebody',
    fonts: [
      {
        family: 'Harbour Sans',
        licence: 'OFL-1.1',
        files: [{ file: 'fonts/HarbourSans-400.woff2', weight: 400 }],
      },
    ],
    palettes: [structuredClone({ ...platinum, id: 'harbour' })],
    themes: [
      structuredClone({
        ...desk,
        id: 'harbour',
        type: { ...desk.type, body: { family: 'Harbour Sans', size: 16 } },
      }),
    ],
    looks: [{ id: 'harbour', label: 'Harbour', palette: 'harbour', theme: 'harbour' }],
  };
}

const WOFF2 = new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0, 0, 0, 0]);
const goodFiles = () =>
  new Map<string, Uint8Array>([
    ['look.json', new Uint8Array([123, 125])],
    ['fonts/HarbourSans-400.woff2', WOFF2],
  ]);

/** What is already installed: the built-in pack. */
const installed = {
  palettes: new Set(PALETTES.map((p) => p.id)),
  themes: new Set(THEMES.map((t) => t.id)),
  looks: new Set(LOOKS.map((l) => l.id)),
  families: new Set((CORE_PACK.fonts ?? []).map((f) => f.family)),
};

describe('the built-in pack', () => {
  it('passes its own check, as an uploaded pack would have to', () => {
    expect(check(CORE_PACK, emptyInstalled(), null, { builtIn: true })).toEqual([]);
  });

  it('holds the library decision 63 approved, plus Newsdesk, Workstation and Poster tempered: 19 palettes, 13 themes, 18 looks', () => {
    expect(PALETTES).toHaveLength(19);
    expect(THEMES).toHaveLength(13);
    expect(LOOKS).toHaveLength(18);
  });

  it('has exactly one default, Workstation, and Civic is Flint with Signal', () => {
    expect(LOOKS.filter((l) => l.default).map((l) => l.id)).toEqual(['workstation']);
    expect(LOOKS.find((l) => l.id === 'civic')).toMatchObject({
      palette: 'flint',
      theme: 'signal',
    });
  });

  it('holds both contrast palettes to 7:1', () => {
    for (const id of ['contrast', 'contrast-dark']) {
      const p = palette(CORE_PACK, id);
      const d = derived(p.colors);
      expect(contrast(d.text, d.background), id).toBeGreaterThanOrEqual(7);
      expect(contrast(d['text-muted'], d.surface), id).toBeGreaterThanOrEqual(7);
    }
  });

  it('every id an earlier version stored resolves to a built-in one', () => {
    for (const to of Object.values(RETIRED_IDS.palettes))
      expect(PALETTES.map((p) => p.id)).toContain(to);
    for (const to of Object.values(RETIRED_IDS.themes))
      expect(THEMES.map((t) => t.id)).toContain(to);
  });

  it('keeps Flint and Midnight under their names, and Signal', () => {
    expect(RETIRED_IDS.palettes.flint).toBe('flint');
    expect(RETIRED_IDS.palettes.midnight).toBe('midnight');
    expect(RETIRED_IDS.themes.signal).toBe('signal');
  });
});

describe('a pack that passes', () => {
  it('installs beside the built-in one', () => {
    expect(check(goodPack(), installed, goodFiles())).toEqual([]);
  });
});

describe('a pack that is refused, and the sentence it is refused with', () => {
  const refused = (pack: unknown, files = goodFiles()) => check(pack, installed, files);

  it('a stylesheet in the zip', () => {
    const files = goodFiles();
    files.set('look.css', new Uint8Array([1]));
    expect(refused(goodPack(), files)).toContain(
      '"look.css" is not allowed in a pack. Only look.json and fonts/*.woff2.',
    );
  });

  it('a fake WOFF2', () => {
    const files = goodFiles();
    files.set('fonts/HarbourSans-400.woff2', new TextEncoder().encode('<svg onload=x>'));
    expect(refused(goodPack(), files)).toContain(
      '"fonts/HarbourSans-400.woff2" is not a WOFF2 font.',
    );
  });

  it('a duplicate id, within the pack and against an installed one', () => {
    const pack = goodPack();
    pack.palettes?.push(structuredClone(platinum));
    pack.palettes?.push(structuredClone({ ...platinum, id: 'harbour' }));
    const problems = refused(pack);
    expect(problems).toContain(
      'A palette called "platinum" is already installed from another pack.',
    );
    expect(problems).toContain('Two palettes are called "harbour".');
  });

  it('text under 4.5:1', () => {
    const pack = goodPack();
    const p = palette(pack);
    p.colors['text-muted'] = '#a0a0a0';
    expect(refused(pack)).toContainEqual(
      expect.stringMatching(
        /^Palette "harbour": text-muted on surface is \d\.\d\d:1; it needs 4\.5:1\.$/,
      ),
    );
  });

  it('a blue "serious"', () => {
    const pack = goodPack();
    palette(pack).colors.serious = '#1f3fa8';
    expect(refused(pack)).toContain('Palette "harbour": serious must be a red (its hue is 226).');
  });

  it('a grey passing itself off as red', () => {
    const pack = goodPack();
    palette(pack).colors.serious = '#6b5f5f';
    expect(refused(pack)).toContainEqual(
      expect.stringMatching(/^Palette "harbour": serious must be a red/),
    );
  });

  it('an unknown font', () => {
    const pack = goodPack();
    theme(pack).type.heading.family = 'Comic Sans';
    expect(refused(pack)).toContain(
      'Theme "harbour" names the font "Comic Sans", which neither this pack nor an installed one provides.',
    );
  });

  it('a radius out of range', () => {
    const pack = goodPack();
    theme(pack).shape.radius = 40;
    expect(refused(pack)).toContain('Theme "harbour" radius must be a number from 0 to 24.');
  });

  it('a theme with neither a width nor a pageMax', () => {
    const pack = goodPack();
    const t = theme(pack);
    delete t.width;
    delete t.pageMax;
    expect(refused(pack)).toContain(
      'Theme "harbour" needs a width (narrow, regular, wide, full) or a pageMax in px.',
    );
  });

  it('a layout choice the app does not have', () => {
    const pack = goodPack();
    const t = theme(pack) as unknown as Record<string, unknown>;
    t.width = 'huge';
    t.columns = 'three';
    t.scale = 'tiny';
    t.surface = 'glass';
    const problems = refused(pack);
    expect(problems).toContain('Theme "harbour" width must be one of narrow, regular, wide, full.');
    expect(problems).toContain('Theme "harbour" columns must be one of single, split.');
    expect(problems).toContain('Theme "harbour" scale must be one of standard, large.');
    expect(problems).toContain('Theme "harbour" surface must be one of outlined, filled, ruled.');
  });

  it('a pack written before the layout fields still passes, and reads as before', () => {
    const pack = goodPack();
    const t = theme(pack);
    delete t.width;
    delete t.columns;
    delete t.scale;
    delete t.surface;
    t.pageMax = 760;
    expect(check(pack, installed, null)).toEqual([]);
    expect(themeLayout(t)).toEqual({
      panelHead: t.panelHead,
      texture: t.texture,
      width: 'narrow',
      columns: 'split',
      scale: 'standard',
      surface: 'outlined',
      second: 'solid',
      tag: 'plain',
    });
  });

  it('a default look from anything but the built-in pack', () => {
    const pack = goodPack();
    (pack.looks ?? [])[0] = {
      id: 'harbour',
      label: 'H',
      palette: 'harbour',
      theme: 'harbour',
      default: true,
    };
    expect(refused(pack)).toContain(
      'Only the built-in pack may mark the default look ("harbour").',
    );
  });

  it('a pack that says it is built in', () => {
    expect(refused({ ...goodPack(), builtIn: true })).toContain(
      'A pack may not say whether it is built in.',
    );
  });

  it('a theme that sets a colour, even through a url', () => {
    const pack = goodPack();
    const t = theme(pack);
    t.type.mono.family = 'url(https://example.com/x)';
    expect(refused(pack)).toContain('Theme "harbour" sets a colour. A theme never sets colour.');
  });

  it('a font family that could leave its declaration', () => {
    const pack = goodPack();
    (pack.fonts ?? [])[0] = { family: "X'; } body { display:none", licence: 'OFL', files: [] };
    expect(refused(pack)).toContain(
      'A font family name may use only letters, digits and spaces, up to 60.',
    );
  });

  it('nonsense in place of a pack is refused, not thrown', () => {
    expect(() => check('nonsense', installed, null)).not.toThrow();
    expect(check({ format: 1, id: 'x1', label: 'X', palettes: 7 }, installed)).toContain(
      'The pack adds nothing.',
    );
  });
});

describe('the stylesheet', () => {
  it('names fonts only at the address it is given', () => {
    const css = toCss(goodPack(), (id, f) => `/api/looks/${id}/${f}`);
    expect(css).toContain("url('/api/looks/harbour-pack/fonts/HarbourSans-400.woff2')");
    expect(css).not.toMatch(/https?:/);
  });

  it('writes no :root unless asked, and then only the default look', () => {
    expect(toCss(goodPack(), undefined, { root: true })).not.toContain(':root');
    const core = toCss(CORE_PACK, undefined, { root: true });
    expect(core).toContain(":root,\n[data-palette='workstation']");
    expect(core).toContain(":root,\n[data-theme='workstation']");
    expect(core.match(/:root/g)).toHaveLength(2);
  });

  it('a named width becomes its px, full keeps a growing margin, and pageMax still works', () => {
    const pack = goodPack();
    const t = theme(pack);
    t.width = 'narrow';
    expect(toCss(pack)).toContain('--rl-page-max: 760px;');
    t.width = 'full';
    expect(toCss(pack)).toContain('--rl-page-max: calc(100% - 2 * clamp(0rem, 4vw - 1rem, 4rem));');
    delete t.width;
    t.pageMax = 900;
    expect(toCss(pack)).toContain('--rl-page-max: 900px;');
  });

  it('chips and counts are square in a square theme and a pill in a round one', () => {
    const pack = goodPack();
    const t = theme(pack);
    t.shape = { ...t.shape, radius: 0, radiusSmall: 0 };
    expect(toCss(pack)).toContain('--rl-radius-pill: 0px;');
    t.shape = { ...t.shape, radius: 16, radiusSmall: 10 };
    expect(toCss(pack)).toContain('--rl-radius-pill: 999px;');
    t.shape = { ...t.shape, radius: 6, radiusSmall: 4 };
    expect(toCss(pack)).toContain('--rl-radius-pill: 4px;');
  });

  it('page titles are fluid between the theme’s two sizes', () => {
    expect(toCss(CORE_PACK)).toContain('--rl-h1-size: clamp(2rem, 1.562rem + 1.798vw, 3rem);');
  });
});

// ── format 2 ──────────────────────────────────────────────────────────────

/** A format 2 pack: a poster-style theme, a shape and the elements that draw it. */
function posterPack(): LookPack {
  const base = goodPack();
  const t = theme(base);
  return {
    ...base,
    format: 2,
    credit: 'Silhouettes drawn for this pack.',
    shapes: { square: { v: '0 0 100 100', d: 'M10 10 L90 10 L90 90 L10 90 Z' } },
    elements: [
      { id: 'poster-stars', label: 'Stars', kind: 'stars' },
      {
        id: 'poster-square',
        label: 'Square',
        kind: 'shape',
        shape: 'square',
        h: 0.6,
        style: 'outline',
      },
    ],
    themes: [
      {
        ...t,
        display: {
          lineHeight: 0.9,
          headlineStretch: 110,
          headlineWeight: 800,
          fit: { min: 40, max: 140 },
          band: { min: 30, max: 90 },
          second: 'outline',
          tag: 'bar',
          buttonCase: 'upper',
          radiusButton: 12,
        },
      },
    ],
  };
}

describe('format 2: the display block, header shapes and elements', () => {
  const refused = (pack: unknown) => check(pack, installed, goodFiles());

  it('a format 2 pack with all of it passes', () => {
    expect(refused(posterPack())).toEqual([]);
  });

  it('format 1 is still read, and a format 3 is refused in a sentence', () => {
    expect(refused(goodPack())).toEqual([]);
    expect(refused({ ...goodPack(), format: 3 })).toContain(
      'This pack is format 3; this site reads formats 1 and 2.',
    );
  });

  it('a format 1 pack may not use what only format 2 has', () => {
    const pack = { ...posterPack(), format: 1 };
    const said = refused(pack);
    expect(said).toContain('A credit line needs a pack in format 2. Set "format" to 2.');
    expect(said).toContain('Header shapes needs a pack in format 2. Set "format" to 2.');
    expect(said).toContain('Header elements needs a pack in format 2. Set "format" to 2.');
    expect(said).toContain(
      'Theme "harbour" display settings needs a pack in format 2. Set "format" to 2.',
    );
  });

  it('refuses a fit range, a line height and a second line it cannot draw', () => {
    const pack = posterPack();
    const d = theme(pack).display;
    if (!d) throw new Error('no display');
    d.fit = { min: 150, max: 40 };
    d.lineHeight = 3;
    d.second = 'sparkle' as never;
    const said = refused(pack);
    expect(said).toContain('Theme "harbour": the smallest fit size is larger than the largest.');
    expect(said).toContain('Theme "harbour" line height must be a number from 0.8 to 1.4.');
    expect(said).toContain(
      'Theme "harbour" second headline line must be one of outline, muted, solid, action.',
    );
  });

  it('refuses a shape that is not path data, and one that is not there', () => {
    const pack = posterPack();
    pack.shapes = { square: { v: '0 0 100 100', d: 'M0 0 <script>alert(1)</script>' } };
    pack.elements = [{ id: 'poster-ghost', label: 'Ghost', kind: 'shape', shape: 'nothing' }];
    const said = refused(pack);
    expect(said).toContain(
      'The shape "square": "d" must be path data, with only path letters, numbers and separators.',
    );
    expect(said).toContain(
      'The header element "poster-ghost" names a shape nobody provides: "nothing".',
    );
  });

  it('refuses a viewBox that is not four numbers, and a shape larger than the limit', () => {
    const pack = posterPack();
    pack.shapes = {
      square: { v: '0 0 100', d: 'M0 0 L1 1 Z' },
      huge: { v: '0 0 10 10', d: `M0 0 ${'L1 1 '.repeat(40_000)}Z` },
    };
    const said = refused(pack);
    expect(said).toContain(
      'The shape "square": "v" must be four numbers like "0 0 100 100", the last two above zero.',
    );
    expect(said).toContain('The shape "huge" is larger than 150 KB.');
  });

  it('refuses an element id another pack already provides, and a non-shape with a shape', () => {
    const pack = posterPack();
    const said = check(pack, { ...installed, elements: new Set(['poster-stars']) }, goodFiles());
    expect(said).toContain(
      'A header element called "poster-stars" is already installed or listed twice.',
    );
    pack.elements = [{ id: 'poster-lines', label: 'Lines', kind: 'ruled', shape: 'square' }];
    expect(refused(pack)).toContain(
      'The header element "poster-lines" is not a shape, so it cannot have a shape, height or style.',
    );
  });

  it('writes the display variables, and none for a theme without a block', () => {
    const css = toCss(posterPack());
    expect(css).toContain('--rl-display-lh: 0.9;');
    expect(css).toContain('--rl-headline-stretch: 110%;');
    expect(css).toContain('--rl-fit-min: 40;');
    expect(css).toContain('--rl-fit-max: 140;');
    expect(css).toContain('--rl-band-max: 90;');
    expect(css).toContain('--rl-radius-btn: 12px;');
    expect(css).toContain('--rl-btn-transform: uppercase;');
    expect(toCss(goodPack())).not.toContain('--rl-fit-min');
  });

  it('a theme carries its second line and tag into its layout, and defaults when it has none', () => {
    const t = theme(posterPack());
    expect(themeLayout(t)).toMatchObject({ second: 'outline', tag: 'bar' });
    expect(themeLayout({ panelHead: 'plain', texture: 'none' })).toMatchObject({
      second: 'solid',
      tag: 'plain',
    });
  });

  it('every core theme states its display block, inside the ranges', () => {
    for (const t of CORE_PACK.themes ?? []) {
      expect(t.display, t.id).toBeDefined();
    }
    expect(check(CORE_PACK, emptyInstalled(), null, { builtIn: true })).toEqual([]);
  });
});

describe('the default look (Workstation)', () => {
  const colors = derived(palette(CORE_PACK, 'workstation').colors);

  it('is the default, for a new site', async () => {
    const { DEFAULT_LOOK } = await import('../src/index.ts');
    expect(DEFAULT_LOOK).toEqual({ palette: 'workstation', theme: 'workstation' });
  });

  it('reads at 4.5:1 or better in every pair a page uses, measured with contrast()', () => {
    const pairs: [keyof typeof colors, keyof typeof colors][] = [
      ['text', 'background'],
      ['text', 'surface'],
      ['text-alt', 'background'],
      ['text-muted', 'background'],
      ['text-muted', 'surface'],
      ['text-on-deep', 'background-deep'],
      ['text-on-deep-muted', 'background-deep'],
      ['brand-on-deep', 'background-deep'],
      ['brand', 'background'],
      ['on-action', 'action'],
    ];
    for (const [fg, bg] of pairs)
      expect(contrast(colors[fg], colors[bg]), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
  });

  it('the action colour is found on the page by its edge: 3:1', () => {
    expect(contrast(colors.action, colors.background)).toBeGreaterThanOrEqual(3);
  });
});

describe('status colours lifted on a deep zone (styles.css: 45% of the page colour, 55% white)', () => {
  const lift = (hexColor: string) => {
    const c = [1, 3, 5].map((i) => Number.parseInt(hexColor.slice(i, i + 2), 16));
    return `#${c
      .map((x) =>
        Math.round(x * 0.45 + 255 * 0.55)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')}`;
  };
  it('reads at 4.5:1 on the deep surface in every built-in light palette', () => {
    for (const p of CORE_PACK.palettes ?? []) {
      if (p.dark) continue;
      const deep = p.colors['background-deep'];
      for (const role of ['serious', 'confirmed'] as const)
        expect(contrast(lift(p.colors[role]), deep), `${p.id} ${role}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
