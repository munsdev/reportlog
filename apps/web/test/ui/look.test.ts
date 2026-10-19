/**
 * The palettes and themes, read from styles.css itself. Ports legacy's
 * "The look: three axes that do not overlap" checks and measures every
 * palette's pairs for contrast, which legacy did before shipping and its
 * browser suite did again.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { PALETTES, THEMES } from '@reportlog/contracts';
import { describe, expect, it } from 'vitest';
import { buttonVariants } from '../../src/components/ui/button.tsx';
import { contrast } from '../contrast.ts';

const src = `${import.meta.dirname}/../../src`;
const css = readFileSync(`${src}/styles.css`, 'utf8');
const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');

function blocks(attr: 'palette' | 'theme'): Map<string, string> {
  const out = new Map<string, string>();
  const re = new RegExp(`\\[data-${attr}=["']([a-z0-9_-]+)["']\\]\\s*\\{([^}]*)\\}`, 'g');
  for (const m of rules.matchAll(re)) out.set(m[1] ?? '', m[2] ?? '');
  return out;
}

const palettes = blocks('palette');
const themes = blocks('theme');
const tokens = (body: string) =>
  Object.fromEntries(
    [...body.matchAll(/--rl-([a-z-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]),
  ) as Record<string, string>;

function hue(hex: string): { h: number; sat: number } {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (!d) return { h: 0, sat: 0 };
  let deg: number;
  if (max === r) deg = ((g - b) / d) % 6;
  else if (max === g) deg = (b - r) / d + 2;
  else deg = (r - g) / d + 4;
  return { h: (deg * 60 + 360) % 360, sat: d / (1 - Math.abs(max + min - 1) || 1) };
}

describe('the palettes', () => {
  it('offered and painted agree, in both directions', () => {
    expect([...palettes.keys()].sort()).toEqual(PALETTES.map((p) => p.id).sort());
  });

  it('the shipped palette is also the bare page', () => {
    expect(rules).toMatch(/:root,\s*\[data-palette=["']flint["']\]/);
  });

  const shape = Object.keys(tokens(palettes.get('flint') ?? '')).sort();
  it('the shipped palette was read', () => {
    expect(shape.length).toBeGreaterThanOrEqual(17);
  });

  for (const p of PALETTES) {
    describe(p.label, () => {
      const t = tokens(palettes.get(p.id) ?? '');

      it('sets every colour, so nothing is inherited from another palette', () => {
        expect(Object.keys(t).sort()).toEqual(shape);
      });

      it('has serious as a red and confirmed as a teal', () => {
        const serious = hue(t.serious ?? '#000000');
        const confirmed = hue(t.confirmed ?? '#000000');
        expect(serious.h >= 340 || serious.h <= 20, `serious hue ${String(serious.h)}`).toBe(true);
        expect(confirmed.h, 'confirmed hue').toBeGreaterThanOrEqual(140);
        expect(confirmed.h, 'confirmed hue').toBeLessThanOrEqual(200);
        expect(confirmed.sat).toBeGreaterThan(0.15);
      });

      // Text a person must read: 4.5:1 (WCAG 1.4.3).
      const text: [string, string][] = [
        ['text', 'surface'],
        ['text', 'background'],
        ['text-alt', 'surface'],
        ['text-alt', 'background'],
        ['text-muted', 'surface'],
        ['text-on-deep', 'background-deep'],
        ['brand-on-deep', 'background-deep'],
        ['on-action', 'action'],
        ['on-serious', 'serious'],
        ['on-confirmed', 'confirmed'],
        ['serious', 'surface'],
      ];
      for (const [fg, bg] of text) {
        it(`${fg} on ${bg} is readable`, () => {
          expect(contrast(t[fg] ?? '', t[bg] ?? '')).toBeGreaterThanOrEqual(4.5);
        });
      }

      // A control's edge must be found: 3:1 (WCAG 1.4.11). Fields and
      // checkboxes draw theirs in text-alt.
      it('a control’s edge stands out from the surface and the page', () => {
        expect(contrast(t['text-alt'] ?? '', t.surface ?? '')).toBeGreaterThanOrEqual(3);
        expect(contrast(t['text-alt'] ?? '', t.background ?? '')).toBeGreaterThanOrEqual(3);
      });

      it('the manifest’s literals are this palette’s colours', () => {
        expect(p.background).toBe(t.background);
        expect(p.deep).toBe(t['background-deep']);
      });

      it(
        p.dark ? 'is dark: light text on a dark page' : 'is light: dark text on a light page',
        () => {
          const darkPage =
            contrast(t.background ?? '', '#000000') < contrast(t.background ?? '', '#ffffff');
          expect(darkPage).toBe(p.dark);
        },
      );
    });
  }
});

describe('the themes', () => {
  it('every theme offered has CSS, and every theme block is offered', () => {
    expect([...themes.keys()].sort()).toEqual(THEMES.map((t) => t.id).sort());
    expect(rules).toMatch(/:root,\s*\[data-theme=["']signal["']\]/);
  });

  it('every theme states its own width', () => {
    for (const [id, body] of themes) expect(body, id).toMatch(/--rl-page-max:\s*\d+px/);
  });

  it('A THEME SETS NO COLOUR: the rule the two axes rest on', () => {
    for (const [id, body] of themes) {
      expect(body, id).not.toMatch(/#[0-9a-f]{3,8}\b/i);
      expect(body, id).not.toMatch(/\b(rgba?|hsla?|oklch|color-mix)\(/i);
      expect(body, id).not.toMatch(/:\s*(red|blue|green|black|white|grey|gray)\b/i);
      // Nor a palette token: borrowing one is setting a colour by proxy.
      const colourTokens = Object.keys(tokens(palettes.get('flint') ?? ''));
      for (const token of colourTokens) expect(body, id).not.toContain(`--rl-${token})`);
    }
  });

  it('names only the fonts this site bundles', () => {
    const fonts = readFileSync(`${src}/fonts/fonts.css`, 'utf8');
    for (const body of themes.values()) {
      for (const family of body.matchAll(/'([^']+)'/g)) expect(fonts).toContain(family[1]);
    }
  });
});

describe('colour is exclusive', () => {
  it('no button variant wears a status colour', () => {
    for (const variant of ['primary', 'secondary', 'quiet'] as const) {
      expect(buttonVariants({ variant })).not.toMatch(/serious|confirmed/);
    }
  });

  it('nothing in the site puts a status colour on a button', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = `${dir}/${name}`;
        if (statSync(path).isDirectory()) walk(path);
        else if (path.endsWith('.tsx')) files.push(path);
      }
    };
    walk(src);
    expect(files.length).toBeGreaterThan(5);
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const tag of text.matchAll(/<(Button|button|DialogClose|a)\b[^>]*>/gs)) {
        expect(tag[0], file).not.toMatch(/\b(bg|border|text)-(serious|confirmed)\b/);
      }
    }
  });
});
