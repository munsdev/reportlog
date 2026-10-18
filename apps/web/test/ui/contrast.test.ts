/**
 * The default palette's pairs reach WCAG AA: 4.5:1 for text, 3:1 for the
 * edge of a control. Read from styles.css itself, so changing a token there
 * cannot slip past.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contrast } from '../contrast.ts';

const css = readFileSync(`${import.meta.dirname}/../../src/styles.css`, 'utf8');

const root = /:root\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
const tokens = Object.fromEntries(
  [...root.matchAll(/--rl-([a-z-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]),
) as Record<string, string>;

const pair = (fg: string, bg: string) => contrast(tokens[fg] ?? '', tokens[bg] ?? '');

describe('the default palette', () => {
  it('was read', () => {
    expect(Object.keys(tokens).length).toBeGreaterThan(10);
  });

  const text: [string, string][] = [
    ['text', 'background'],
    ['text', 'surface'],
    ['text-alt', 'surface'],
    ['text-alt', 'background'],
    ['text-muted', 'surface'],
    ['text-on-deep', 'background-deep'],
    ['on-action', 'action'],
    ['on-serious', 'serious'],
    ['on-confirmed', 'confirmed'],
    ['serious', 'surface'],
  ];
  for (const [fg, bg] of text) {
    it(`${fg} on ${bg} is readable text`, () => {
      expect(pair(fg, bg)).toBeGreaterThanOrEqual(4.5);
    });
  }

  it('a control’s edge can be found against the surface and the page', () => {
    expect(pair('text-alt', 'surface')).toBeGreaterThanOrEqual(3);
    expect(pair('text-alt', 'background')).toBeGreaterThanOrEqual(3);
  });
});
