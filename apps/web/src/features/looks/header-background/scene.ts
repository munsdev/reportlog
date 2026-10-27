/**
 * What the header background draws, as data. Ported from the mock-up's
 * engine (docs/ui-mockup/src/site.js: drawPattern, shapeBox, drawHost,
 * maskFor); the React components only turn this into elements, so the
 * geometry, the layering and the masks can be tested without a browser.
 *
 * The layers behind a headline, back to front: an optional picture behind
 * everything, pattern elements (lines, stars, stripes), large shapes
 * (filled or outline, or holding the picture), and an optional taped print
 * in front. A pack decides which elements exist and supplies the shapes;
 * the engine knows how to draw each kind.
 */
import type { HeaderBackground, KitElement, KitShape, ShapeStyle } from '@reportlog/contracts';
import { headerImagePath } from '@reportlog/contracts';

/** Where a header is drawn: the front page's hero, a section band, or a cover (ruled lines only). */
export type Slot = 'hero' | 'band' | 'cover';

export const VIEW = { w: 1200, h: 900 } as const;

/** The mock-up's default drift for each kind: stars move most, ruled lines least. */
export const DEPTH = {
  stars: 0.3,
  stripes: 0.1,
  ruled: 0.05,
  shape: 0.16,
  image: 0.08,
  taped: 0.12,
} as const;

/** A repeatable pseudo-random sequence, so the same stars are drawn every time. */
export function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

export interface Star {
  points: string;
  opacity: number;
}
export type PatternGeometry =
  | { kind: 'stripes'; ys: number[] }
  | { kind: 'stars'; stars: Star[] }
  | { kind: 'ruled'; ys: number[] };

const fix = (n: number) => n.toFixed(1);

export function patternGeometry(
  kind: 'ruled' | 'stars' | 'stripes',
  seed: number,
): PatternGeometry {
  if (kind === 'stripes') {
    const ys: number[] = [];
    for (let k = -3; k < 12; k++) ys.push(k * 92 + 60);
    return { kind, ys };
  }
  if (kind === 'stars') {
    const R = rng(seed);
    const stars: Star[] = [];
    for (let i = 0; i < 56; i++) {
      const x = 460 + R() * 740;
      const y = R() * 900;
      const r = 5 + R() * 16;
      const opacity = 0.45 + R() * 0.55;
      const pts: string[] = [];
      for (let j = 0; j < 10; j++) {
        const q = j % 2 ? r * 0.42 : r;
        const a = -Math.PI / 2 + (j * Math.PI) / 5;
        pts.push(`${fix(x + Math.cos(a) * q)},${fix(y + Math.sin(a) * q)}`);
      }
      stars.push({ points: pts.join(' '), opacity: Number(opacity.toFixed(2)) });
    }
    return { kind, stars };
  }
  const ys: number[] = [];
  for (let y = 30; y < 900; y += 38) ys.push(y);
  return { kind: 'ruled', ys };
}

export interface ShapeBox {
  x: number;
  y: number;
  w: number;
  h: number;
  /** The shape's own viewBox. */
  vb: [number, number, number, number];
}

/** Where a shape sits in the 1200 by 900 field: right-aligned, centred vertically, no wider than 760. */
export function shapeBox(el: KitElement, shape: KitShape, slot: Slot): ShapeBox {
  const vb = shape.v.split(/\s+/).map(Number) as [number, number, number, number];
  let h = VIEW.h * (el.h ?? 0.7) * (slot === 'band' ? 0.95 : 1);
  let w = (h * vb[2]) / vb[3];
  if (w > 760) {
    w = 760;
    h = (w * vb[3]) / vb[2];
  }
  return { x: VIEW.w - w - 30, y: VIEW.h / 2 - h / 2, w, h, vb };
}

/** The CSS mask that keeps the headline side clear. 'none' draws the layers at full strength. */
export function maskFor(
  fade: HeaderBackground['fade']['kind'],
  strength: number,
  small: boolean,
): string {
  const amt = Math.max(0, Math.min(1, strength));
  if (fade === 'none' || amt === 0) return 'none';
  if (fade === 'bottom' || (small && fade === 'side'))
    return `linear-gradient(180deg,black ${String(Math.round(100 - amt * 75))}%,transparent 100%)`;
  if (fade === 'radial')
    return `radial-gradient(ellipse 70% 90% at 78% 50%,black ${String(Math.round(70 - amt * 50))}%,transparent ${String(Math.round(100 - amt * 15))}%)`;
  const a0 = Math.round(amt * 40);
  return `linear-gradient(90deg,transparent ${String(a0)}%,black ${String(Math.round(a0 + 10 + amt * 30))}%)`;
}

// ── layers ──────────────────────────────────────────────────────────────

export interface Kit {
  elements: readonly KitElement[];
  shapes: Readonly<Record<string, KitShape>>;
}

export type Layer =
  | {
      type: 'image';
      key: string;
      src: string;
      focus: number;
      opacity: number;
      tone: string;
      depth: number;
    }
  | { type: 'pattern'; key: string; geometry: PatternGeometry; depth: number }
  | {
      type: 'shape';
      key: string;
      box: ShapeBox;
      path: string;
      style: ShapeStyle;
      opacity: number;
      /** The picture held inside the shape, if it holds one. */
      src: string | null;
      tone: string;
      depth: number;
    }
  | {
      type: 'taped';
      key: string;
      src: string;
      focus: number;
      opacity: number;
      tone: string;
      depth: number;
    };

export interface SceneOptions {
  header: HeaderBackground;
  kit: Kit;
  slot: Slot;
  /** Which header on the page this is, so two draw different stars. */
  n?: number;
}

/** Everything the header draws, back to front. Empty means a plain header. */
export function buildScene({ header: B, kit, slot, n = 0 }: SceneOptions): Layer[] {
  if (slot === 'cover') {
    return [
      { type: 'pattern', key: 'cover', geometry: patternGeometry('ruled', 3), depth: DEPTH.ruled },
    ];
  }
  const out: Layer[] = [];
  const img = slot === 'hero' ? B.image : null;
  const src = img ? headerImagePath(img.file) : '';
  const hidePattern = img?.mode === 'replace';
  const depthOf = (el: KitElement, kind: keyof typeof DEPTH) =>
    B.depth[el.id] ?? el.depth ?? DEPTH[kind];

  if (img?.place === 'behind') {
    out.push({
      type: 'image',
      key: 'image',
      src,
      focus: img.focus,
      // On a phone the stylesheet holds it to 35% so the headline stays legible.
      opacity: img.strength,
      tone: img.tone,
      depth: DEPTH.image,
    });
  }
  if (!hidePattern) {
    kit.elements.forEach((el, i) => {
      if (!B.on[el.id] || el.kind === 'shape') return;
      out.push({
        type: 'pattern',
        key: el.id,
        geometry: patternGeometry(el.kind, 11 + n * 7 + i * 3),
        depth: depthOf(el, el.kind),
      });
    });
  }
  for (const el of kit.elements) {
    if (el.kind !== 'shape' || el.shape === undefined) continue;
    const shape = kit.shapes[el.shape];
    if (!shape) continue;
    const holds = img?.place === 'shape' && img.shape === el.id;
    const held = holds ? img : null;
    if (!holds && (hidePattern || !B.on[el.id])) continue;
    out.push({
      type: 'shape',
      key: el.id,
      box: shapeBox(el, shape, slot),
      path: shape.d,
      style: B.style[el.id] ?? el.style ?? 'filled',
      opacity: held ? held.strength : B.shapes * (slot === 'band' ? 0.8 : 1),
      src: held ? src : null,
      tone: held ? held.tone : 'color',
      depth: depthOf(el, 'shape'),
    });
  }
  if (img?.place === 'taped') {
    out.push({
      type: 'taped',
      key: 'taped',
      src,
      focus: img.focus,
      opacity: Math.max(0.35, img.strength * 1.6),
      tone: img.tone,
      depth: DEPTH.taped,
    });
  }
  return out;
}

/** The ruled-lines kit every site has before a pack adds anything. */
export const CORE_KIT: Kit = {
  elements: [{ id: 'ruled', label: 'Ruled lines', kind: 'ruled' }],
  shapes: {},
};

/** The kit with a pack's elements and shapes added. A later pack never replaces an earlier id. */
export function mergeKits(
  ...kits: readonly {
    elements: readonly KitElement[];
    shapes: Readonly<Record<string, KitShape>>;
  }[]
): Kit {
  const elements: KitElement[] = [];
  const shapes: Record<string, KitShape> = {};
  for (const k of kits) {
    for (const e of k.elements) if (!elements.some((x) => x.id === e.id)) elements.push(e);
    for (const [id, s] of Object.entries(k.shapes)) shapes[id] ??= s;
  }
  return { elements, shapes };
}
