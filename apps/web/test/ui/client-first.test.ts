/**
 * THE CLIENT-FIRST LAYER, in Tailwind's terms (owner, 29 October 2026): a
 * deployment's look is its palette and theme, so a component styles itself
 * with classes (Tailwind utilities, or the mock-up's classes in
 * mockup/site.css) and takes every colour from a token. An operator who picks
 * "midnight" must find nothing left behind in light.
 *
 *  - No inline style, except a value known only at run time. The inline
 *    styles already there are frozen per file (inline-styles.frozen.ts) and
 *    may only go down.
 *  - No colour in a component: no hex, rgb() or hsl(), and no arbitrary
 *    Tailwind colour such as bg-[#123456]. Colours live in the stylesheets.
 *
 * Named exceptions, so a new one has to be argued for:
 *  - a bar's width, which is a number and not a look (the progress bars);
 *  - the maps' data scale (features/maps), whose colours encode a value and
 *    are chosen to be told apart, not to match a theme;
 *  - mockup/siteLook.tsx's fallbacks, used only when a look pack's palette
 *    leaves a colour out.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FROZEN_INLINE_STYLES } from './inline-styles.frozen.ts';

// vitest runs from apps/web.
const SRC = join(process.cwd(), 'src');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(tsx?|css)$/.test(name) && !name.endsWith('.gen.ts') ? [path] : [];
  });
}

const files = sources(SRC).map((path) => ({
  name: relative(SRC, path),
  text: readFileSync(path, 'utf8'),
}));

describe('the Client-First layer', () => {
  it('has files to read', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('adds no inline style, except a bar’s width and the maps’ data colours', () => {
    const counts = new Map<string, number>();
    for (const f of files) {
      if (f.name.startsWith(join('features', 'maps') + '/')) continue;
      // style={{…}}, or a style object passed by name (style={ROW_COLS}).
      const n = [...f.text.matchAll(/style=\{(?:\{([^}]*)\}|[A-Z_]+\})/g)].filter(
        (m) => !/^\s*width:/.test(m[1] ?? ''),
      ).length;
      if (n > 0) counts.set(f.name, n);
    }
    const grew = [...counts]
      .filter(([name, n]) => n > (FROZEN_INLINE_STYLES[name] ?? 0))
      .map(([name, n]) => `${name}: ${String(n)} inline styles; use classes instead`);
    expect(grew).toEqual([]);
    // A count that went down is written down, so it cannot creep back up.
    const fell = Object.entries(FROZEN_INLINE_STYLES)
      .filter(([name, n]) => (counts.get(name) ?? 0) < n)
      .map(([name]) => `${name}: lower it to ${String(counts.get(name) ?? 0)}`);
    expect(fell).toEqual([]);
  });

  it('writes no colour outside the stylesheets, except the maps’ scale', () => {
    const colour = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\[#/;
    const found = files
      .filter(
        (f) =>
          ![
            'styles.css',
            'looks.gen.css',
            join('mockup', 'site.css'),
            join('mockup', 'siteLook.tsx'),
            join('features', 'maps', 'scale.ts'),
          ].includes(f.name),
      )
      .filter((f) => !f.name.startsWith(join('fonts') + '/'))
      .flatMap((f) =>
        f.text
          .split('\n')
          .map((line, i) => ({ line, n: i + 1 }))
          // A comment may say a colour; a component may not use one.
          .filter(({ line }) => colour.test(line) && !/^\s*(\/\/|\*|\/\*)/.test(line))
          .map(({ line, n }) => `${f.name}:${String(n)}: ${line.trim()}`),
      );
    expect(found).toEqual([]);
  });
});
