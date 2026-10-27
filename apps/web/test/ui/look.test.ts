/**
 * The look as painted: looks.gen.css read back and held against the
 * built-in look pack it was written from. The pack's own check (contrast,
 * status hues, ranges, fonts) runs in packages/contracts; this is the half
 * only the website can see: that what the server offers is what the page
 * paints, that the file is not stale, and that every font it names is here.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import {
  CORE_PACK,
  DEFAULT_LOOK,
  PALETTES,
  THEMES,
  check,
  emptyInstalled,
  toCss,
} from '@reportlog/contracts';
import { describe, expect, it } from 'vitest';
import { buttonVariants } from '../../src/components/ui/button.tsx';

const src = `${import.meta.dirname}/../../src`;
const generated = readFileSync(`${src}/looks.gen.css`, 'utf8');
const styles = readFileSync(`${src}/styles.css`, 'utf8');
const rules = generated.replace(/\/\*[\s\S]*?\*\//g, '');

function blocks(attr: 'palette' | 'theme'): Map<string, string> {
  const out = new Map<string, string>();
  const re = new RegExp(`\\[data-${attr}=["']([a-z0-9_-]+)["']\\]\\s*\\{([^}]*)\\}`, 'g');
  for (const m of rules.matchAll(re)) out.set(m[1] ?? '', m[2] ?? '');
  return out;
}
const palettes = blocks('palette');
const themes = blocks('theme');

describe('the generated stylesheet', () => {
  it('is exactly what toCss() writes from the built-in pack, so nobody edits it by hand', () => {
    const expected = `${toCss(CORE_PACK, (_id, f) => `./${f}`, { root: true })}\n`;
    // Stale? `pnpm --filter @reportlog/web looks:css` rewrites it.
    expect(generated).toBe(expected);
  });

  it('agrees with the reference implementation in docs/design on everything format 1 had', async () => {
    // Plain JavaScript with no types, so it is held to the port's signatures.
    // The reference is the format 1 code. The built-in pack is now format 2,
    // so the comparison is made on its format 1 reading: the same pack with
    // what only format 2 has taken away. That is the backward-compatibility
    // promise in one assertion: a pack written before format 2 is checked
    // and painted exactly as it always was.
    const path = `${import.meta.dirname}/../../../../docs/design/looks/look-pack.mjs`;
    const reference = (await import(path)) as { check: typeof check; toCss: typeof toCss };
    const v1 = structuredClone(CORE_PACK) as unknown as Record<string, unknown> & {
      themes: Record<string, unknown>[];
    };
    v1.format = 1;
    delete v1.elements;
    for (const t of v1.themes) delete t.display;
    expect(reference.check(v1, undefined, null, { builtIn: true })).toEqual(
      check(v1, emptyInstalled(), null, { builtIn: true }),
    );
    const at = (_id: string, f: string) => `./${f}`;
    expect(reference.toCss(v1 as never, at, { root: true })).toBe(
      toCss(v1 as never, at, { root: true }),
    );
  });

  it('holds everything the design specifies, and may add to it', () => {
    // docs/design/looks holds the reference copy of format 1; the app's copy
    // is the one that ships and has since added format 2 (the display block,
    // header elements) and looks of its own. A palette, theme or look the
    // design names must still be there, unchanged apart from what format 2
    // added; the migration table must be identical.
    const dir = `${src}/../../../`;
    const read = (path: string) =>
      JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    type Item = Record<string, unknown>;
    const keyOf = (x: Item): string => String(x.id ?? x.family);
    const shipped = read(`${dir}packages/contracts/src/look/reportlog-core.look.json`);
    const designed = read(`${dir}docs/design/looks/reportlog-core.look.json`);
    for (const kind of ['palettes', 'themes', 'looks', 'fonts'] as const) {
      const have = new Map((shipped[kind] as Item[]).map((x) => [keyOf(x), x]));
      for (const want of designed[kind] as Item[]) {
        const key = keyOf(want);
        const got = { ...have.get(key) } as Record<string, unknown>;
        expect(got, `${kind} ${key}`).not.toEqual({});
        delete got.display;
        // Only the default moved: Workstation is the default look now.
        delete got.default;
        const wanted = { ...want } as Record<string, unknown>;
        delete wanted.default;
        expect(got, `${kind} ${key}`).toEqual(wanted);
      }
    }
    expect(read(`${dir}packages/contracts/src/look/migration.json`)).toEqual(
      read(`${dir}docs/design/looks/migration.json`),
    );
  });

  it('is imported by styles.css', () => {
    expect(styles).toMatch(/@import '\.\/looks\.gen\.css';/);
  });

  it('styles.css states no palette or theme of its own', () => {
    expect(styles).not.toMatch(/\[data-(palette|theme)=/);
  });
});

describe('offered and painted', () => {
  it('every palette offered has a block, and every block is offered', () => {
    expect([...palettes.keys()].sort()).toEqual(PALETTES.map((p) => p.id).sort());
  });

  it('every theme offered has a block, and every block is offered', () => {
    expect([...themes.keys()].sort()).toEqual(THEMES.map((t) => t.id).sort());
  });

  it('the default look is also the bare page', () => {
    expect(rules).toContain(`:root,\n[data-palette='${DEFAULT_LOOK.palette}']`);
    expect(rules).toContain(`:root,\n[data-theme='${DEFAULT_LOOK.theme}']`);
  });

  it('the manifest’s literals are each palette’s colours', () => {
    for (const p of PALETTES) {
      const body = palettes.get(p.id) ?? '';
      expect(body, p.id).toContain(`--rl-background: ${p.background};`);
      expect(body, p.id).toContain(`--rl-background-deep: ${p.deep};`);
    }
  });

  it('the three derived colours are mixed as check() measured them', () => {
    const flat = styles.replace(/\s+/g, ' ');
    expect(flat).toContain(
      'color-mix( in srgb, var(--rl-text-on-deep) 82%, var(--rl-background-deep) )',
    );
    expect(flat).toContain('color-mix(in srgb, var(--rl-background-deep) 70%, #000000)');
    expect(flat).toContain(
      'color-mix(in srgb, var(--rl-text-on-deep) 18%, var(--rl-background-deep))',
    );
  });
});

describe('the themes', () => {
  it('A THEME SETS NO COLOUR: the rule the two axes rest on', () => {
    for (const [id, body] of themes) {
      expect(body, id).not.toMatch(/#[0-9a-f]{3,8}\b/i);
      expect(body, id).not.toMatch(/\b(rgba?|hsla?|oklch|color-mix)\(/i);
      expect(body, id).not.toMatch(/:\s*(red|blue|green|black|white|grey|gray)\b/i);
      expect(body, id).not.toMatch(/var\(--rl-/);
    }
  });

  it('every theme states its own width: px, or edge to edge less a margin', () => {
    for (const [id, body] of themes)
      expect(body, id).toMatch(/--rl-page-max:\s*(\d+px|calc\(100% - [^;]+\));/);
  });
});

describe('the fonts', () => {
  const named = (CORE_PACK.fonts ?? []).flatMap((f) => f.files.map((x) => x.file));
  const bundled = readdirSync(`${src}/fonts`).filter((f) => f.endsWith('.woff2'));

  it('every file the pack names is bundled, and every bundled file is named', () => {
    expect(bundled.map((f) => `fonts/${f}`).sort()).toEqual([...named].sort());
  });

  it('each is a WOFF2 under the pack limit of 1 MB', () => {
    for (const f of bundled) {
      const bytes = readFileSync(`${src}/fonts/${f}`);
      expect(bytes.subarray(0, 4).toString('latin1'), f).toBe('wOF2');
      expect(statSync(`${src}/fonts/${f}`).size, f).toBeLessThanOrEqual(1_000_000);
    }
  });

  it('every family a theme names is one the pack bundles', () => {
    const families = new Set((CORE_PACK.fonts ?? []).map((f) => f.family));
    for (const body of themes.values()) {
      for (const m of body.matchAll(/'([^']+)'/g)) expect(families).toContain(m[1]);
    }
  });

  it('each family carries its licence', () => {
    expect(readdirSync(`${src}/fonts/licences`)).toHaveLength((CORE_PACK.fonts ?? []).length);
  });

  it('Red Hat Mono is retired', () => {
    expect(generated).not.toMatch(/Red Hat/);
    expect(bundled.some((f) => f.startsWith('RedHat'))).toBe(false);
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
