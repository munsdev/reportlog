/**
 * THE CLIENT-FIRST LAYER: a deployment's look is its palette and theme
 * (styles.css), so no component carries a colour or an inline style of its
 * own. An operator who picks "midnight" must find nothing left behind in
 * light.
 *
 * Two kinds of thing are allowed to differ, and are named here so a third
 * has to be argued for:
 *  - a bar's width, which is a number and not a look (the progress bars);
 *  - the maps' data scale (features/maps), whose colours encode a value and
 *    are chosen to be told apart, not to match a theme.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

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

  it('puts no inline style on a component, except a bar’s width and the maps’ data colours', () => {
    const found = files.flatMap((f) =>
      [...f.text.matchAll(/style=\{\{([^}]*)\}/g)]
        .map((m) => m[1] ?? '')
        .filter(
          (body) => !/^\s*width:/.test(body) && !f.name.startsWith(join('features', 'maps') + '/'),
        )
        .map((body) => `${f.name}: style={{${body}}}`),
    );
    expect(found).toEqual([]);
  });

  it('writes no colour outside the stylesheets, except the maps’ scale', () => {
    const colour = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\[#/;
    const found = files
      .filter(
        (f) =>
          !['styles.css', 'looks.gen.css', join('features', 'maps', 'scale.ts')].includes(f.name),
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
