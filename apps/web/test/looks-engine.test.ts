/**
 * The pure halves of the look engine: headline fitting, the header
 * background's scene and masks, the image scale, zones, and the options
 * contract. No browser: the geometry and the decisions are data.
 */
import { DEFAULT_LOOK_OPTIONS, resolveLookOptions } from '@reportlog/contracts';
import type { HeaderBackground } from '@reportlog/contracts';
import { describe, expect, it } from 'vitest';
import { zoneTone } from '../src/components/ui/zone.tsx';
import { decideFit, effectiveRange, searchLargest } from '../src/features/looks/fit.ts';
import { scaledSize } from '../src/features/looks/header-background/image.ts';
import {
  CORE_KIT,
  buildScene,
  maskFor,
  mergeKits,
  patternGeometry,
  shapeBox,
} from '../src/features/looks/header-background/scene.ts';

describe('headline fitting', () => {
  const range = { min: 40, max: 120 };
  // A line is 10px wide per px of font size over 8 characters: 0.6em each.
  const width = (chars: number) => (size: number) => chars * size * 0.6;

  it('uses the largest size when it fits', () => {
    const c = decideFit(range, { oneLine: (s) => width(5)(s) <= 400, wrapped: () => false });
    expect(c).toEqual({ size: 120, wrap: false });
  });

  it('shrinks a long line to the largest that fits, whole px, not wrapped', () => {
    const c = decideFit(range, { oneLine: (s) => width(10)(s) <= 500, wrapped: () => false });
    expect(c.wrap).toBe(false);
    expect(c.size).toBeLessThanOrEqual(83);
    expect(c.size).toBeGreaterThan(75);
    expect(Number.isInteger(c.size)).toBe(true);
  });

  it('wraps when a line would otherwise come out small and wrapping is much larger', () => {
    const c = decideFit(range, {
      oneLine: (s) => width(30)(s) <= 400, // only about 22px: nothing in range fits
      wrapped: (s) => width(15)(s) <= 400, // half a line: about 44px
    });
    expect(c.wrap).toBe(true);
    expect(c.size).toBeGreaterThanOrEqual(40);
  });

  it('wraps at the smallest size when not even that fits on one line', () => {
    expect(decideFit(range, { oneLine: () => false, wrapped: () => false })).toEqual({
      size: 40,
      wrap: true,
    });
  });

  it('keeps one line when wrapping gains less than a fifth', () => {
    const c = decideFit(range, {
      oneLine: (s) => s <= 70,
      wrapped: (s) => s <= 80,
    });
    expect(c.wrap).toBe(false);
  });

  it('searchLargest finds the edge within a px', () => {
    expect(Math.abs(searchLargest(range, (s) => s <= 77) - 77)).toBeLessThan(1);
    expect(searchLargest(range, () => false)).toBe(0);
  });

  it('Easier reading and a caller cap tighten the largest, never below the smallest', () => {
    expect(effectiveRange({ min: 30, max: 150 }, { easy: true })).toEqual({ min: 30, max: 64 });
    expect(effectiveRange({ min: 30, max: 150 }, { maxSize: 72 })).toEqual({ min: 30, max: 72 });
    expect(effectiveRange({ min: 40, max: 150 }, { maxSize: 20 })).toEqual({ min: 20, max: 20 });
  });
});

const header = (patch: Partial<HeaderBackground> = {}): HeaderBackground => ({
  ...DEFAULT_LOOK_OPTIONS.header,
  ...patch,
});
const kit = mergeKits(CORE_KIT, {
  elements: [
    { id: 'stars', label: 'Stars', kind: 'stars' },
    { id: 'stripes', label: 'Stripes', kind: 'stripes' },
    { id: 'tall', label: 'Tall', kind: 'shape', shape: 'tall', h: 0.74, style: 'filled' },
  ],
  shapes: { tall: { v: '0 0 100 200', d: 'M0 0 L100 0 L100 200 Z' } },
});
const image = {
  file: 'a'.repeat(32) + '.jpg',
  place: 'behind' as const,
  shape: null,
  mode: 'under' as const,
  tone: 'mono' as const,
  strength: 0.4,
  focus: 60,
};

describe('the header background scene', () => {
  it('draws nothing when nothing is on', () => {
    expect(buildScene({ header: header(), kit, slot: 'hero' })).toEqual([]);
  });

  it('draws what is on, back to front: picture, patterns, shapes, taped print', () => {
    const h = header({
      on: { ruled: true, stars: true, tall: true },
      image: { ...image, place: 'taped' },
    });
    const kinds = buildScene({ header: h, kit, slot: 'hero' }).map((l) => l.type);
    expect(kinds).toEqual(['pattern', 'pattern', 'shape', 'taped']);
  });

  it('only the hero shows the picture', () => {
    const h = header({ on: { ruled: true }, image });
    expect(buildScene({ header: h, kit, slot: 'hero' }).map((l) => l.type)).toEqual([
      'image',
      'pattern',
    ]);
    expect(buildScene({ header: h, kit, slot: 'band' }).map((l) => l.type)).toEqual(['pattern']);
  });

  it('"image only" hides every element except a shape holding the picture', () => {
    const h = header({
      on: { ruled: true, stars: true, tall: true },
      image: { ...image, mode: 'replace' },
    });
    expect(buildScene({ header: h, kit, slot: 'hero' }).map((l) => l.type)).toEqual(['image']);
    const inside = header({
      on: { stars: true },
      image: { ...image, place: 'shape', shape: 'tall', mode: 'replace' },
    });
    const layers = buildScene({ header: inside, kit, slot: 'hero' });
    expect(layers.map((l) => l.type)).toEqual(['shape']);
    expect(layers[0]).toMatchObject({
      type: 'shape',
      src: expect.stringContaining(image.file) as string,
    });
  });

  it('a cover is ruled lines and nothing else', () => {
    const layers = buildScene({ header: header({ on: { stars: true } }), kit, slot: 'cover' });
    expect(layers.map((l) => l.type)).toEqual(['pattern']);
  });

  it('a shape’s style and drift come from the owner, then the pack, then the engine', () => {
    const h = header({ on: { tall: true }, style: { tall: 'outline' }, depth: { tall: 0.4 } });
    expect(buildScene({ header: h, kit, slot: 'hero' })[0]).toMatchObject({
      style: 'outline',
      depth: 0.4,
    });
    expect(
      buildScene({ header: header({ on: { tall: true } }), kit, slot: 'hero' })[0],
    ).toMatchObject({
      style: 'filled',
      depth: 0.16,
    });
  });

  it('an element switched on but not provided is never drawn', () => {
    expect(buildScene({ header: header({ on: { ghost: true } }), kit, slot: 'hero' })).toEqual([]);
  });

  it('stars are the same every time, so a repaint never reshuffles them', () => {
    expect(patternGeometry('stars', 11)).toEqual(patternGeometry('stars', 11));
    expect(patternGeometry('stars', 11)).not.toEqual(patternGeometry('stars', 14));
    const g = patternGeometry('stars', 1);
    expect(g.kind === 'stars' && g.stars).toHaveLength(56);
  });

  it('keeps a tall shape inside the field and right-aligned', () => {
    const el = kit.elements.find((e) => e.id === 'tall');
    const shape = kit.shapes.tall;
    if (!el || !shape) throw new Error('no kit');
    const b = shapeBox(el, shape, 'hero');
    expect(b.h).toBeCloseTo(900 * 0.74);
    expect(b.x + b.w).toBe(1200 - 30);
    expect(b.y).toBeCloseTo(450 - b.h / 2);
  });
});

describe('the fade mask', () => {
  it('none, and strength zero, draw at full strength', () => {
    expect(maskFor('none', 0.5, false)).toBe('none');
    expect(maskFor('side', 0, false)).toBe('none');
  });
  it('a side fade runs left to right, and on a phone becomes a fade toward the bottom', () => {
    expect(maskFor('side', 0.5, false)).toMatch(/^linear-gradient\(90deg/);
    expect(maskFor('side', 0.5, true)).toBe(maskFor('bottom', 0.5, false));
    expect(maskFor('radial', 1, false)).toMatch(/^radial-gradient/);
  });
  it('strength is clamped', () => {
    expect(maskFor('bottom', 9, false)).toBe(maskFor('bottom', 1, false));
  });
});

describe('the image is scaled before it is sent', () => {
  it('to 1600 on its longest side, keeping the shape, and never enlarged', () => {
    expect(scaledSize(4000, 3000)).toEqual({ width: 1600, height: 1200 });
    expect(scaledSize(3000, 4000)).toEqual({ width: 1200, height: 1600 });
    expect(scaledSize(800, 600)).toEqual({ width: 800, height: 600 });
  });
});

describe('zones', () => {
  it('"One ground" turns a zone into the ground it names, and only if it names one', () => {
    expect(zoneTone('page', 'deep', 'single')).toBe('deep');
    expect(zoneTone('page', 'deep', 'alternate')).toBe('page');
    expect(zoneTone('page', undefined, 'single')).toBe('page');
  });
});

describe('look options', () => {
  it('read anything that does not parse as the defaults, and a good row as itself', () => {
    expect(resolveLookOptions(null)).toEqual(DEFAULT_LOOK_OPTIONS);
    expect(resolveLookOptions({ zones: 'diagonal' })).toEqual(DEFAULT_LOOK_OPTIONS);
    const ok = { ...DEFAULT_LOOK_OPTIONS, motion: 'off' as const };
    expect(resolveLookOptions(ok)).toEqual(ok);
  });
  it('refuse a picture name that could point elsewhere', () => {
    const bad = header({ image: { ...image, file: '../../etc/passwd' } });
    expect(resolveLookOptions({ ...DEFAULT_LOOK_OPTIONS, header: bad })).toEqual(
      DEFAULT_LOOK_OPTIONS,
    );
  });
});
