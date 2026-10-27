/**
 * The header background, and the two other choices that sit beside the
 * palette and theme: how sections alternate down a page ("zones"), and
 * whether decoration moves as the page scrolls ("motion").
 *
 * Ported from the mock-up's `look` object (docs/ui-mockup/src/site.js) with
 * its flat names spelled out. Presentation only, never sealed, and held to
 * a shape here so a bad stored row can never break the front page: anything
 * that does not parse reads as the defaults (`resolveLookOptions`).
 *
 * The elements a header can switch on are the built-in ones (ruled lines)
 * plus whatever installed look packs add (stars, stripes, silhouettes), by
 * id. A switch for an element no pack provides is simply never drawn.
 *
 * Pure: runs on the server and in the browser alike.
 */
import { z } from 'zod';
import { RANGES } from './pack.ts';

const ElementId = z.string().regex(/^[a-z][a-z0-9-]{1,39}$/);

/** The served name of the header image: random, so a replaced image never hides behind a cache. */
export const HEADER_IMAGE_FILE = /^[a-f0-9]{32}\.(jpg|png)$/;
export const headerImagePath = (file: string): string => `/api/site/header-image/${file}`;
/** The largest image the server takes, before it is re-encoded. The page sends 1600 px. */
export const HEADER_IMAGE_MAX_BYTES = 6 * 1024 * 1024;

const fraction = (lo: number, hi: number) => z.number().min(lo).max(hi);
const ElementMap = <T extends z.ZodType>(value: T) =>
  z
    .record(ElementId, value)
    .refine((o) => Object.keys(o).length <= 32, 'Too many header elements.');

export const IMAGE_PLACES = ['behind', 'shape', 'taped'] as const;
export const IMAGE_MODES = ['under', 'replace'] as const;
export const IMAGE_TONES = ['color', 'mono', 'dark'] as const;
export const FADES = ['side', 'bottom', 'radial', 'none'] as const;
export const ZONES = ['alternate', 'single'] as const;
export const MOTIONS = ['on', 'off'] as const;

/**
 * The optional picture. `place`: laid behind everything, cut to a shape, or
 * a taped print on top. `mode`: elements drawn over it, or the picture alone.
 */
export const HeaderImage = z.object({
  file: z.string().regex(HEADER_IMAGE_FILE),
  place: z.enum(IMAGE_PLACES),
  /** For place "shape": which shape element holds it. */
  shape: ElementId.nullable(),
  mode: z.enum(IMAGE_MODES),
  tone: z.enum(IMAGE_TONES),
  strength: fraction(0.1, 1),
  /** Left to right, as a percentage. */
  focus: fraction(0, 100),
});
export type HeaderImage = z.infer<typeof HeaderImage>;

export const HeaderBackground = z.object({
  /** Element id to on or off. Absent means off. */
  on: ElementMap(z.boolean()),
  /** A large shape's style, where the owner changed it from the pack's. */
  style: ElementMap(z.enum(['filled', 'outline'])),
  /** An element's drift as the page scrolls, where the owner changed it. */
  depth: ElementMap(fraction(RANGES.depth[0], RANGES.depth[1])),
  /** Strength of lines, stars and stripes. */
  pattern: fraction(0.04, 0.4),
  /** Strength of the large shapes. */
  shapes: fraction(0.05, 0.6),
  image: HeaderImage.nullable(),
  fade: z.object({ kind: z.enum(FADES), strength: fraction(0, 1) }),
});
export type HeaderBackground = z.infer<typeof HeaderBackground>;

export const LookOptions = z.object({
  zones: z.enum(ZONES),
  motion: z.enum(MOTIONS),
  header: HeaderBackground,
});
export type LookOptions = z.infer<typeof LookOptions>;

/** The mock-up's `freshLook()`: nothing switched on, a side fade at half strength. */
export const DEFAULT_LOOK_OPTIONS: LookOptions = {
  zones: 'alternate',
  motion: 'on',
  header: {
    on: {},
    style: {},
    depth: {},
    pattern: 0.14,
    shapes: 0.2,
    image: null,
    fade: { kind: 'side', strength: 0.5 },
  },
};

/** Whatever was stored, read as options. Never throws; a bad row is the defaults. */
export function resolveLookOptions(raw: unknown): LookOptions {
  const parsed = LookOptions.safeParse(raw);
  return parsed.success ? parsed.data : structuredClone(DEFAULT_LOOK_OPTIONS);
}

// ── what a pack adds to the header, as the page reads it ────────────────

export const KitShape = z.object({ v: z.string().max(80), d: z.string().max(150_000) });
export const KitElement = z.object({
  id: ElementId,
  label: z.string().max(60),
  kind: z.enum(['ruled', 'stars', 'stripes', 'shape']),
  shape: ElementId.optional(),
  h: z.number().optional(),
  style: z.enum(['filled', 'outline']).optional(),
  depth: z.number().optional(),
});
export type KitElement = z.infer<typeof KitElement>;
export type KitShape = z.infer<typeof KitShape>;
/** One pack's header kit: served as `/api/looks/<pack>/<sha256>.json`. */
export const LookKit = z.object({
  pack: z.string(),
  label: z.string(),
  credit: z.string().optional(),
  elements: z.array(KitElement).max(32),
  shapes: z.record(ElementId, KitShape),
});
export type LookKit = z.infer<typeof LookKit>;

export const LOOK_KIT = /^\/api\/looks\/[a-z][a-z0-9-]{1,39}\/[0-9a-f]{64}\.json$/;
export const LookKitPath = z.string().regex(LOOK_KIT);

/** Where the image sits when it is first added: behind, in colour of the owner's choosing. */
export function newHeaderImage(file: string): HeaderImage {
  return {
    file,
    place: 'behind',
    shape: null,
    mode: 'under',
    tone: 'mono',
    strength: 0.4,
    focus: 60,
  };
}
