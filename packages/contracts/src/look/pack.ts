/**
 * The look pack: its check and the stylesheet written from it. Ported from
 * docs/design/looks/look-pack.mjs, which stays the reference; the website's
 * suite runs both against the built-in pack and they must agree.
 *
 * The built-in pack (reportlog-core.look.json) goes through exactly the same
 * two functions at build time as an uploaded pack does at install time, so
 * the shipped looks can never pass a check an uploaded look would fail.
 *
 * WHY THE SERVER WRITES THE CSS: a pack is data, never a stylesheet.
 * Accepting CSS from a pack would let it fetch from another host (url(),
 * @import), which breaks the no-third-party rule, or hide content. Every
 * value is checked against a type and a range before it is written out.
 *
 * Pure: runs on the server and in the browser alike.
 */

/**
 * The format a pack is written in. Format 2 adds, to format 1, a theme's
 * `display` block (the poster-style headline: fit ranges, line height, the
 * outlined second line, the tag style, the button case), header `shapes` and
 * `elements`, and a `credit` line. Everything format 1 had reads the same;
 * a format 1 pack stays valid and keeps painting exactly as it did, and
 * check() refuses a format 1 pack that uses a format 2 field, so a pack can
 * never half-claim the newer format.
 */
export const FORMAT = 2;
/** Formats this site reads. */
export const READS = [1, 2] as const;

export const ROLES = [
  'background',
  'background-alt',
  'background-deep',
  'surface',
  'border',
  'text',
  'text-alt',
  'text-muted',
  'text-on-deep',
  'action',
  'on-action',
  'brand',
  'brand-on-deep',
  'serious',
  'on-serious',
  'confirmed',
  'on-confirmed',
] as const;
export type Role = (typeof ROLES)[number];

/** The three colours every palette gets without stating them. */
export type DerivedRole = 'text-on-deep-muted' | 'background-deeper' | 'border-on-deep';

// Text a person must read: 4.5:1 (WCAG 1.4.3), 7:1 for a `contrast` palette.
// The app's earlier pairs plus the redesign's: text-muted on the page, brand
// on light, text on the open menu, and a count on the deep surface.
export const TEXT_PAIRS: readonly (readonly [Role | DerivedRole, Role | DerivedRole])[] = [
  ['text', 'surface'],
  ['text', 'background'],
  ['text-alt', 'surface'],
  ['text-alt', 'background'],
  ['text-muted', 'surface'],
  ['text-muted', 'background'],
  ['text-on-deep', 'background-deep'],
  ['brand-on-deep', 'background-deep'],
  ['on-action', 'action'],
  ['on-serious', 'serious'],
  ['on-confirmed', 'confirmed'],
  ['serious', 'surface'],
  ['serious', 'background'],
  ['brand', 'surface'],
  ['brand', 'background'],
  // derived, see derived()
  ['text-on-deep-muted', 'background-deep'],
  ['text-on-deep', 'background-deeper'],
  ['brand-on-deep', 'background-deeper'],
  ['text-on-deep-muted', 'background-deeper'],
  ['text-on-deep', 'border-on-deep'],
];
// A control's edge must be found: 3:1 (WCAG 1.4.11). Fields, checkboxes and
// every button's outline are drawn in text-alt or text.
export const EDGE_PAIRS: readonly (readonly [Role, Role])[] = [
  ['text-alt', 'surface'],
  ['text-alt', 'background'],
];

export const ENUMS = {
  case: ['none', 'upper'],
  panelHead: ['plain', 'title-bar', 'double-rule', 'bar', 'rule', 'prompt'],
  texture: ['none', 'ruled', 'grid', 'dots'],
  // The four layout choices below are optional in a theme, so a pack written
  // before they existed stays valid; an absent one means what every page
  // did before (themeLayout()).
  width: ['narrow', 'regular', 'wide', 'full'],
  columns: ['single', 'split'],
  scale: ['standard', 'large'],
  surface: ['outlined', 'filled', 'ruled'],
  // Format 2: the headline's second line, the tag under it, button text.
  second: ['outline', 'muted', 'solid', 'action'],
  tag: ['bar', 'rule', 'plain'],
  buttonCase: ['none', 'upper'],
  // Header background: what the engine knows how to draw.
  element: ['ruled', 'stars', 'stripes', 'shape'],
  shapeStyle: ['filled', 'outline'],
} as const;
export type PanelHead = (typeof ENUMS.panelHead)[number];
export type Texture = (typeof ENUMS.texture)[number];
export type Width = (typeof ENUMS.width)[number];
export type Columns = (typeof ENUMS.columns)[number];
export type Scale = (typeof ENUMS.scale)[number];
export type Surface = (typeof ENUMS.surface)[number];
export type Second = (typeof ENUMS.second)[number];
export type Tag = (typeof ENUMS.tag)[number];
export type ButtonCase = (typeof ENUMS.buttonCase)[number];
export type ElementKind = (typeof ENUMS.element)[number];
export type ShapeStyle = (typeof ENUMS.shapeStyle)[number];

/**
 * The page widths a theme names. `full` has no number: the page runs edge
 * to edge, less a margin that grows with the screen (toCss()).
 */
export const WIDTHS = { narrow: 760, regular: 1000, wide: 1200 } as const;
export type LetterCase = (typeof ENUMS.case)[number];

export const RANGES = {
  weight: [300, 900],
  size: [15, 20],
  tracking: [0, 0.2],
  headingTracking: [-0.05, 0.05],
  stretch: [62, 125],
  h1: [1.5, 4],
  radius: [0, 24],
  radiusSmall: [0, 16],
  border: [1, 4],
  shadow: [0, 6],
  press: [0, 4],
  pageMax: [640, 1280],
  // Format 2. Fit sizes are px, as the mock-up's: a headline is fitted
  // between its smallest and its largest.
  lineHeight: [0.8, 1.4],
  fit: [20, 200],
  band: [20, 140],
  radiusButton: [0, 999],
  depth: [0, 0.6],
  shapeHeight: [0.2, 1],
} as const satisfies Record<string, readonly [number, number]>;
export const LIMITS = {
  fileBytes: 1_000_000,
  packBytes: 10_000_000,
  files: 120,
  // Header shapes are inline path data. 150 KB covers a detailed
  // silhouette; more is a picture that should have been an image.
  shapeBytes: 150_000,
  shapes: 8,
  elements: 12,
  credit: 400,
};

// ── the shape of a pack that passed ─────────────────────────────────────

export interface FontFile {
  file: string;
  /** One weight, or a range "500 800" for a variable font. */
  weight: number | string;
  style?: 'normal' | 'italic';
  /** A range "62 125" for a font with a width axis. */
  stretch?: string;
}
export interface FontFamily {
  family: string;
  licence: string;
  files: FontFile[];
}
export interface Palette {
  id: string;
  label: string;
  description: string;
  dark: boolean;
  colors: Record<Role, string>;
}
interface Face {
  family: string;
  stretch?: number;
}
export interface Theme {
  id: string;
  label: string;
  description: string;
  type: {
    heading: Face & { weight: number; case: LetterCase; tracking?: number };
    body: Face & { size: number };
    label: Face & { case: LetterCase; tracking: number };
    mono: { family: string };
    h1: { min: number; max: number };
  };
  shape: { radius: number; radiusSmall: number; border: number; shadow: number; press: number };
  /**
   * The page's width in px: the older way to say it, still read when
   * `width` is absent. A theme states one or the other (or both, and then
   * `width` decides).
   */
  pageMax?: number;
  panelHead: PanelHead;
  texture: Texture;
  width?: Width;
  /** Whether a page's two-part regions (`.layout-split`) sit side by side on a desktop. */
  columns?: Columns;
  /** `large`: bigger headings and lede, more room between sections, larger controls. */
  scale?: Scale;
  /** How a panel is drawn: an edge and a hard shadow, a soft tinted fill, or a rule on top. */
  surface?: Surface;
  /** Format 2: the display headline and what goes with it. See ThemeDisplay. */
  display?: ThemeDisplay;
}

/**
 * Format 2. How the big headline behaves. The face, weight, width, case and
 * tracking of the headline are the theme's `type.heading`; these are the
 * rest of what the mock-up's themes state.
 */
export interface ThemeDisplay {
  /** The headline's line height, unitless. */
  lineHeight: number;
  /** Width axis of the section headings (h2, h3) as a percentage; defaults to 100. */
  headlineStretch?: number;
  /** Weight of the section headings; defaults to the heading weight. */
  headlineWeight?: number;
  /** The front-page headline is fitted between these, in px. */
  fit: { min: number; max: number };
  /** The same for a section band's headline. */
  band: { min: number; max: number };
  /** What the second line of a headline looks like. */
  second: Second;
  /** The tagline under a headline. */
  tag: Tag;
  /** Button text. */
  buttonCase: ButtonCase;
  /** Button corner radius in px, apart from the panels'. */
  radiusButton: number;
}

/** A silhouette the header background can draw. `v` is its viewBox, `d` its path. */
export interface HeaderShape {
  v: string;
  d: string;
}
/** Something the header background can switch on. */
export interface HeaderElement {
  id: string;
  label: string;
  kind: ElementKind;
  /** For kind `shape`: which of the pack's (or an installed pack's) shapes. */
  shape?: string;
  /** For a shape: its height as a share of the header, 0.2 to 1. */
  h?: number;
  /** For a shape: filled or outline until the owner chooses. */
  style?: ShapeStyle;
  /** How far it drifts as the page scrolls, 0 to 0.6. */
  depth?: number;
}

/** Everything a theme decides that the page sets on <html> rather than as a CSS value. */
export interface ThemeLayout {
  panelHead: PanelHead;
  texture: Texture;
  width: Width;
  columns: Columns;
  scale: Scale;
  surface: Surface;
  /** Format 2. The headline's second line and the tag under it; what every page did before when absent. */
  second: Second;
  tag: Tag;
}
export interface NamedLook {
  id: string;
  label: string;
  palette: string;
  theme: string;
  default?: boolean;
}
export interface LookPack {
  format: number;
  id: string;
  label: string;
  version?: string;
  author?: string;
  fonts?: FontFamily[];
  palettes?: Palette[];
  themes?: Theme[];
  looks?: NamedLook[];
  /** Format 2. Credit for a shape or a font, shown on the Look screen. */
  credit?: string;
  /** Format 2. Silhouettes the header background can use. */
  shapes?: Record<string, HeaderShape>;
  /** Format 2. What the header background can switch on. */
  elements?: HeaderElement[];
}

/** What other packs already provide; ids are unique across every installed pack. */
export interface Installed {
  palettes: ReadonlySet<string>;
  themes: ReadonlySet<string>;
  looks: ReadonlySet<string>;
  families: ReadonlySet<string>;
  /** Header elements and shapes, by id. Optional so a caller from before format 2 still compiles. */
  elements?: ReadonlySet<string>;
  shapes?: ReadonlySet<string>;
}

export function emptyInstalled(): Installed {
  return {
    palettes: new Set(),
    themes: new Set(),
    looks: new Set(),
    families: new Set(),
    elements: new Set(),
    shapes: new Set(),
  };
}

const ID = /^[a-z][a-z0-9-]{1,39}$/;
const HEX = /^#[0-9a-f]{6}$/;
const FONT_FILE = /^fonts\/[A-Za-z0-9_-][A-Za-z0-9._-]*\.woff2$/;
// Everything below is written into a stylesheet, so each is held to a shape
// that cannot carry a quote, a brace, a comment or a URL.
const FAMILY = /^[A-Za-z0-9 ]{1,60}$/;
const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
const WEIGHT = /^(\d{3})( \d{3})?$/;
const STRETCH = /^(\d{2,3})( \d{2,3})?$/;
// A shape's viewBox: four numbers, the last two above zero. Its path: path
// commands, digits and separators only, so it cannot carry a tag, a URL or
// a script into the page that draws it.
const VIEWBOX = /^-?\d+(\.\d+)?( -?\d+(\.\d+)?){3}$/;
const PATH_DATA = /^[MmLlHhVvCcSsQqTtAaZz0-9eE.,\s+-]+$/;

/** An id a pack may use for a palette, theme or look. */
export function isLookId(value: unknown): value is string {
  return typeof value === 'string' && ID.test(value);
}

// ── colour arithmetic ───────────────────────────────────────────────────

const rgb = (h: string) => [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16));
const hex = (c: number[]) =>
  `#${c.map((x) => Math.round(x).toString(16).padStart(2, '0')).join('')}`;
const mix = (a: string, b: string, p: number) => {
  const other = rgb(b);
  return hex(rgb(a).map((x, i) => x * p + (other[i] ?? 0) * (1 - p)));
};
function luminance(h: string): number {
  const [r = 0, g = 0, b = 0] = rgb(h).map((x) => {
    const c = x / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a: string, b: string): number {
  const [hi = 0, lo = 0] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
function hue(h: string): { h: number; s: number } {
  const [r = 0, g = 0, b = 0] = rgb(h).map((x) => x / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (!d) return { h: 0, s: 0 };
  const l = (max + min) / 2;
  const s = d / (1 - Math.abs(2 * l - 1));
  const deg = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (deg * 60 + 360) % 360, s };
}

/**
 * The three colours every palette gets without stating them. The same mixes
 * as styles.css writes with color-mix(), so what is measured here is what
 * the page paints.
 */
export function derived(colors: Record<Role, string>): Record<Role | DerivedRole, string> {
  return {
    ...colors,
    'text-on-deep-muted': mix(colors['text-on-deep'], colors['background-deep'], 0.82),
    'background-deeper': mix(colors['background-deep'], '#000000', 0.7),
    'border-on-deep': mix(colors['text-on-deep'], colors['background-deep'], 0.18),
  };
}

// ── the check ───────────────────────────────────────────────────────────

// An uploaded look.json is whatever somebody wrote. Every field is read as
// unknown and held to its shape before it is trusted; these two keep that
// from throwing on a pack whose `palettes` is a number.
type Bag = Record<string, unknown>;
const bag = (v: unknown): Bag => (v !== null && typeof v === 'object' ? (v as Bag) : {});
const list = (v: unknown): Bag[] => (Array.isArray(v) ? v.map(bag) : []);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
// JSON.stringify(undefined) is undefined, whatever its type says.
const shown = (v: unknown): string =>
  typeof v === 'string' ? v : v === undefined ? 'nothing' : JSON.stringify(v);
const oneOf = (choices: readonly string[], v: unknown) =>
  typeof v === 'string' && choices.includes(v);

/**
 * Every problem with a pack, each a sentence a person can read. Empty means
 * the pack may be installed; nothing is installed otherwise.
 *
 * @param installed what OTHER packs provide
 * @param files     'fonts/x.woff2' -> bytes, for an upload; null for the built-in pack
 * @param builtIn   the caller's to say, never the pack's: a pack that could
 *                  claim it could mark its own look as the default
 */
export function check(
  input: unknown,
  installed: Installed = emptyInstalled(),
  files: ReadonlyMap<string, Uint8Array> | null = null,
  { builtIn = false }: { builtIn?: boolean } = {},
): string[] {
  const out: string[] = [];
  const say = (s: string) => out.push(s);
  const pack = bag(input);

  if (Object.hasOwn(pack, 'builtIn')) say('A pack may not say whether it is built in.');
  if (pack.version !== undefined && !VERSION.test(shown(pack.version)))
    say('The version must look like 1.2.3.');
  if (!(READS as readonly unknown[]).includes(pack.format))
    say(`This pack is format ${shown(pack.format)}; this site reads formats 1 and 2.`);
  // A format 1 pack that uses what only format 2 has would be read by an
  // older site as a pack it can paint, and it could not.
  const v2 = pack.format === 2;
  const needsV2 = (what: string) => {
    if (!v2) say(`${what} needs a pack in format 2. Set "format" to 2.`);
  };
  if (pack.credit !== undefined) {
    needsV2('A credit line');
    if (typeof pack.credit !== 'string' || pack.credit.length > LIMITS.credit)
      say(`The credit must be text, up to ${String(LIMITS.credit)} characters.`);
  }
  if (!ID.test(str(pack.id)))
    say('The pack needs an id of lower-case letters, digits and hyphens.');
  if (!pack.label) say('The pack needs a label.');

  const families = new Set(installed.families);
  for (const f of list(pack.fonts)) {
    if (typeof f.family !== 'string' || !FAMILY.test(f.family)) {
      say('A font family name may use only letters, digits and spaces, up to 60.');
      continue;
    }
    if (!f.licence) say(`The font "${f.family}" does not say its licence.`);
    families.add(f.family);
    for (const file of list(f.files)) {
      const name = shown(file.file);
      if (!FONT_FILE.test(str(file.file))) say(`"${name}" is not a .woff2 file inside fonts/.`);
      const weight = shown(file.weight ?? '');
      if (!WEIGHT.test(weight) || weight.split(' ').some((w) => Number(w) < 100 || Number(w) > 900))
        say(`"${name}": weight must be one number, or two, from 100 to 900.`);
      if (file.style !== undefined && !oneOf(['normal', 'italic'], file.style))
        say(`"${name}": style must be normal or italic.`);
      if (
        file.stretch !== undefined &&
        (!STRETCH.test(shown(file.stretch)) ||
          shown(file.stretch)
            .split(' ')
            .some((w) => Number(w) < RANGES.stretch[0] || Number(w) > RANGES.stretch[1]))
      )
        say(`"${name}": stretch must be one number, or two, from 62 to 125.`);
      if (files) {
        const bytes = files.get(str(file.file));
        if (!bytes) say(`"${name}" is named but not in the pack.`);
        else {
          if (bytes.length > LIMITS.fileBytes) say(`"${name}" is larger than 1 MB.`);
          const magic = String.fromCharCode(...bytes.slice(0, 4));
          if (magic !== 'wOF2') say(`"${name}" is not a WOFF2 font.`);
        }
      }
    }
  }
  if (files) {
    let total = 0;
    for (const [name, bytes] of files) {
      total += bytes.length;
      if (name !== 'look.json' && !FONT_FILE.test(name))
        say(`"${name}" is not allowed in a pack. Only look.json and fonts/*.woff2.`);
    }
    if (files.size > LIMITS.files) say('The pack has too many files.');
    if (total > LIMITS.packBytes) say('The pack is larger than 10 MB.');
  }

  const inRange = (what: string, v: unknown, [lo, hi]: readonly [number, number]) => {
    if (typeof v !== 'number' || v < lo || v > hi)
      say(`${what} must be a number from ${String(lo)} to ${String(hi)}.`);
  };

  // ── header shapes and elements (format 2) ──
  const shapeIds = new Set(installed.shapes ?? []);
  const packShapes = bag(pack.shapes);
  if (pack.shapes !== undefined) {
    needsV2('Header shapes');
    const entries = Object.entries(packShapes);
    if (Array.isArray(pack.shapes) || typeof pack.shapes !== 'object')
      say('"shapes" must be an object of { "id": { "v": viewBox, "d": path } }.');
    if (entries.length > LIMITS.shapes)
      say(`A pack may add at most ${String(LIMITS.shapes)} shapes.`);
    for (const [id, raw] of entries) {
      const sh = bag(raw);
      if (!ID.test(id)) {
        say(
          `A shape needs an id of lower-case letters, digits and hyphens ("${id.slice(0, 40)}").`,
        );
        continue;
      }
      if (shapeIds.has(id)) say(`A shape called "${id}" is already installed from another pack.`);
      shapeIds.add(id);
      const v = str(sh.v);
      const box = v.split(' ').map(Number);
      if (!VIEWBOX.test(v) || (box[2] ?? 0) <= 0 || (box[3] ?? 0) <= 0)
        say(
          `The shape "${id}": "v" must be four numbers like "0 0 100 100", the last two above zero.`,
        );
      const d = str(sh.d);
      if (!d || !PATH_DATA.test(d))
        say(
          `The shape "${id}": "d" must be path data, with only path letters, numbers and separators.`,
        );
      else if (d.length > LIMITS.shapeBytes)
        say(`The shape "${id}" is larger than ${String(LIMITS.shapeBytes / 1000)} KB.`);
    }
  }
  const elementIds = new Set(installed.elements ?? []);
  if (pack.elements !== undefined) {
    if (!Array.isArray(pack.elements)) say('"elements" must be a list of { … }.');
    else if (pack.elements.length > LIMITS.elements)
      say(`A pack may add at most ${String(LIMITS.elements)} header elements.`);
    const own = list(pack.elements);
    if (own.length) needsV2('Header elements');
    for (const e of own) {
      const id = shown(e.id);
      if (!ID.test(str(e.id)))
        say(`A header element needs an id of lower-case letters, digits and hyphens.`);
      else if (elementIds.has(str(e.id)))
        say(`A header element called "${id}" is already installed or listed twice.`);
      elementIds.add(str(e.id));
      if (!e.label || typeof e.label !== 'string') say(`The header element "${id}" needs a label.`);
      if (!oneOf(ENUMS.element, e.kind))
        say(`The header element "${id}": kind must be one of ${ENUMS.element.join(', ')}.`);
      if (e.kind === 'shape') {
        if (typeof e.shape !== 'string' || !shapeIds.has(e.shape))
          say(`The header element "${id}" names a shape nobody provides: "${shown(e.shape)}".`);
        if (e.h !== undefined)
          inRange(`The header element "${id}" height`, e.h, RANGES.shapeHeight);
        if (e.style !== undefined && !oneOf(ENUMS.shapeStyle, e.style))
          say(`The header element "${id}": style must be one of ${ENUMS.shapeStyle.join(', ')}.`);
      } else if (e.shape !== undefined || e.h !== undefined || e.style !== undefined)
        say(
          `The header element "${id}" is not a shape, so it cannot have a shape, height or style.`,
        );
      if (e.depth !== undefined) inRange(`The header element "${id}" depth`, e.depth, RANGES.depth);
    }
  }

  const seen = new Set<string>();
  const unique = (kind: string, id: unknown, pool: ReadonlySet<string>) => {
    const s = str(id);
    if (!ID.test(s)) say(`A ${kind} needs an id of lower-case letters, digits and hyphens.`);
    else if (seen.has(`${kind}:${s}`)) say(`Two ${kind}s are called "${s}".`);
    else if (pool.has(s)) say(`A ${kind} called "${s}" is already installed from another pack.`);
    seen.add(`${kind}:${s}`);
  };

  const palettes = list(pack.palettes);
  for (const p of palettes) {
    const id = shown(p.id);
    unique('palette', p.id, installed.palettes);
    const c = bag(p.colors);
    const missing = ROLES.filter((r) => !HEX.test(str(c[r])));
    if (missing.length) {
      say(`Palette "${id}" is missing or misspells: ${missing.join(', ')}.`);
      continue;
    }
    const colors = c as Record<Role, string>;
    const extra = Object.keys(c).filter((k) => !(ROLES as readonly string[]).includes(k));
    if (extra.length)
      say(`Palette "${id}" sets colours this site does not use: ${extra.join(', ')}.`);
    const d = derived(colors);
    const need = id.startsWith('contrast') ? 7 : 4.5;
    for (const [fg, bg] of TEXT_PAIRS) {
      const r = contrast(d[fg], d[bg]);
      if (r < need)
        say(`Palette "${id}": ${fg} on ${bg} is ${r.toFixed(2)}:1; it needs ${String(need)}:1.`);
    }
    for (const [fg, bg] of EDGE_PAIRS) {
      const r = contrast(d[fg], d[bg]);
      if (r < 3)
        say(`Palette "${id}": a control edge (${fg} on ${bg}) is ${r.toFixed(2)}:1; it needs 3:1.`);
    }
    const s = hue(colors.serious);
    const k = hue(colors.confirmed);
    if (!(s.h >= 340 || s.h <= 20) || s.s <= 0.3)
      say(`Palette "${id}": serious must be a red (its hue is ${s.h.toFixed(0)}).`);
    if (!(k.h >= 140 && k.h <= 200 && k.s > 0.15))
      say(`Palette "${id}": confirmed must be a teal (its hue is ${k.h.toFixed(0)}).`);
    const darkPage =
      contrast(colors.background, '#000000') < contrast(colors.background, '#ffffff');
    if (darkPage !== Boolean(p.dark))
      say(
        `Palette "${id}" says dark is ${String(Boolean(p.dark))}, but its page is ${darkPage ? 'dark' : 'light'}.`,
      );
  }

  const themes = list(pack.themes);
  for (const t of themes) {
    const id = shown(t.id);
    unique('theme', t.id, installed.themes);
    const ty = bag(t.type);
    for (const slot of ['heading', 'body', 'label', 'mono'] as const) {
      const f = bag(ty[slot]);
      if (!f.family) {
        say(`Theme "${id}" has no ${slot} font.`);
        continue;
      }
      if (!families.has(str(f.family)))
        say(
          `Theme "${id}" names the font "${shown(f.family)}", which neither this pack nor an installed one provides.`,
        );
      if (f.stretch !== undefined)
        inRange(`Theme "${id}" ${slot} stretch`, f.stretch, RANGES.stretch);
    }
    if (ty.heading !== undefined) {
      const h = bag(ty.heading);
      inRange(`Theme "${id}" heading weight`, h.weight, RANGES.weight);
      inRange(`Theme "${id}" heading tracking`, h.tracking ?? 0, RANGES.headingTracking);
      if (!oneOf(ENUMS.case, h.case))
        say(`Theme "${id}" heading case must be one of ${ENUMS.case.join(', ')}.`);
    }
    if (ty.label !== undefined) {
      const l = bag(ty.label);
      if (!oneOf(ENUMS.case, l.case))
        say(`Theme "${id}" label case must be one of ${ENUMS.case.join(', ')}.`);
      inRange(`Theme "${id}" label tracking`, l.tracking, RANGES.tracking);
    }
    if (ty.body !== undefined) inRange(`Theme "${id}" body size`, bag(ty.body).size, RANGES.size);
    const h1 = bag(ty.h1);
    inRange(`Theme "${id}" smallest h1`, h1.min, RANGES.h1);
    inRange(`Theme "${id}" largest h1`, h1.max, RANGES.h1);
    if (typeof h1.min === 'number' && typeof h1.max === 'number' && h1.min > h1.max)
      say(`Theme "${id}": the smallest h1 is larger than the largest.`);
    const shape = bag(t.shape);
    for (const k of ['radius', 'radiusSmall', 'border', 'shadow', 'press'] as const)
      inRange(`Theme "${id}" ${k}`, shape[k], RANGES[k]);
    if (t.pageMax !== undefined) inRange(`Theme "${id}" page width`, t.pageMax, RANGES.pageMax);
    else if (t.width === undefined)
      say(`Theme "${id}" needs a width (${ENUMS.width.join(', ')}) or a pageMax in px.`);
    for (const k of ['width', 'columns', 'scale', 'surface'] as const)
      if (t[k] !== undefined && !oneOf(ENUMS[k], t[k]))
        say(`Theme "${id}" ${k} must be one of ${ENUMS[k].join(', ')}.`);
    if (!oneOf(ENUMS.panelHead, t.panelHead))
      say(`Theme "${id}" panel heading must be one of ${ENUMS.panelHead.join(', ')}.`);
    if (!oneOf(ENUMS.texture, t.texture))
      say(`Theme "${id}" texture must be one of ${ENUMS.texture.join(', ')}.`);
    if (t.display !== undefined) {
      needsV2(`Theme "${id}" display settings`);
      const dp = bag(t.display);
      inRange(`Theme "${id}" line height`, dp.lineHeight, RANGES.lineHeight);
      if (dp.headlineStretch !== undefined)
        inRange(`Theme "${id}" headline stretch`, dp.headlineStretch, RANGES.stretch);
      if (dp.headlineWeight !== undefined)
        inRange(`Theme "${id}" headline weight`, dp.headlineWeight, RANGES.weight);
      for (const k of ['fit', 'band'] as const) {
        const r = bag(dp[k]);
        inRange(`Theme "${id}" ${k} smallest size`, r.min, RANGES[k]);
        inRange(`Theme "${id}" ${k} largest size`, r.max, RANGES[k]);
        if (typeof r.min === 'number' && typeof r.max === 'number' && r.min > r.max)
          say(`Theme "${id}": the smallest ${k} size is larger than the largest.`);
      }
      if (!oneOf(ENUMS.second, dp.second))
        say(`Theme "${id}" second headline line must be one of ${ENUMS.second.join(', ')}.`);
      if (!oneOf(ENUMS.tag, dp.tag))
        say(`Theme "${id}" tag style must be one of ${ENUMS.tag.join(', ')}.`);
      if (!oneOf(ENUMS.buttonCase, dp.buttonCase))
        say(`Theme "${id}" button case must be one of ${ENUMS.buttonCase.join(', ')}.`);
      inRange(`Theme "${id}" button radius`, dp.radiusButton, RANGES.radiusButton);
    }
    // Only the fields that become CSS are searched; a description may say "#1".
    if (
      t.colors !== undefined ||
      /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|url\(/i.test(
        JSON.stringify([t.type, t.shape, t.panelHead, t.texture]),
      )
    )
      say(`Theme "${id}" sets a colour. A theme never sets colour.`);
  }

  const paletteIds = new Set([...installed.palettes, ...palettes.map((p) => str(p.id))]);
  const themeIds = new Set([...installed.themes, ...themes.map((t) => str(t.id))]);
  const looks = list(pack.looks);
  for (const l of looks) {
    const id = shown(l.id);
    unique('look', l.id, installed.looks);
    if (!paletteIds.has(str(l.palette)))
      say(`The look "${id}" names a palette nobody provides: "${shown(l.palette)}".`);
    if (!themeIds.has(str(l.theme)))
      say(`The look "${id}" names a theme nobody provides: "${shown(l.theme)}".`);
    if (l.default && !builtIn) say(`Only the built-in pack may mark the default look ("${id}").`);
  }
  if (!(
    palettes.length ||
    themes.length ||
    looks.length ||
    (pack.elements !== undefined && list(pack.elements).length)
  ))
    say('The pack adds nothing.');
  return out;
}

// ── the stylesheet ──────────────────────────────────────────────────────

const FALLBACK = {
  heading: 'ui-sans-serif, system-ui, sans-serif',
  body: 'ui-sans-serif, system-ui, sans-serif',
  label: 'ui-sans-serif, system-ui, sans-serif',
  mono: 'ui-monospace, monospace',
};
const fam = (f: { family: string }, fallback: string) => `'${f.family}', ${fallback}`;
const em = (n: number) => `${String(n)}em`;

/**
 * The page's width. `full` keeps a margin on each side that grows from
 * nothing on a phone to 4rem on a large screen, so a line never touches
 * the window's edge.
 */
function pageMax(t: Theme): string {
  if (t.width === 'full') return 'calc(100% - 2 * clamp(0rem, 4vw - 1rem, 4rem))';
  if (t.width) return `${String(WIDTHS[t.width])}px`;
  return `${String(t.pageMax ?? WIDTHS.regular)}px`;
}

/**
 * Chips and counts. Square in a square theme; a full pill in a round one
 * (a panel radius of 12 or more), so the small things read as round as the
 * panels around them; otherwise the controls' radius.
 */
function pill(shape: Theme['shape']): number {
  if (shape.radiusSmall === 0) return 0;
  return shape.radius >= 12 ? 999 : shape.radiusSmall;
}

/**
 * A format 2 theme's headline variables. A theme without a `display` block
 * writes none, so a pack written before them is painted byte for byte as it
 * was, and styles.css's `:where(:root)` defaults fill the gap.
 */
function displayLines(t: Theme): string[] {
  const d = t.display;
  if (!d) return [];
  return [
    `  --rl-display-lh: ${String(d.lineHeight)};`,
    `  --rl-headline-stretch: ${String(d.headlineStretch ?? 100)}%;`,
    `  --rl-headline-weight: ${String(d.headlineWeight ?? t.type.heading.weight)};`,
    `  --rl-fit-min: ${String(d.fit.min)};`,
    `  --rl-fit-max: ${String(d.fit.max)};`,
    `  --rl-band-min: ${String(d.band.min)};`,
    `  --rl-band-max: ${String(d.band.max)};`,
    `  --rl-radius-btn: ${String(d.radiusButton)}px;`,
    `  --rl-btn-transform: ${d.buttonCase === 'upper' ? 'uppercase' : 'none'};`,
  ];
}

/**
 * Call only with a pack check() returned no problems for: every value
 * written here has been held to a shape that cannot leave its declaration.
 *
 * @param fontUrl (packId, file) -> an address on THIS site, never another
 *   host. The built-in pack: the bundled file beside styles.css
 *   ((id, f) => `./${f}`, which Vite rewrites). An uploaded pack:
 *   `/api/looks/<pack>/<sha256>.woff2`, so a changed file has a new name.
 * @param opts.root write the default look's blocks as :root as well
 */
export function toCss(
  pack: LookPack,
  fontUrl: (packId: string, file: string) => string = (id, file) => `/api/looks/${id}/${file}`,
  opts: { root?: boolean } = {},
): string {
  const lines = [`/* Look pack ${pack.id}. Written from look.json; never edit by hand. */`];
  for (const f of pack.fonts ?? []) {
    for (const file of f.files) {
      const stretch = file.stretch
        ? ` font-stretch: ${file.stretch
            .split(' ')
            .map((x) => `${x}%`)
            .join(' ')};`
        : '';
      lines.push(
        `@font-face { font-family: '${f.family}'; src: url('${fontUrl(pack.id, file.file)}') format('woff2'); font-weight: ${String(file.weight)}; font-style: ${file.style ?? 'normal'};${stretch} font-display: swap; }`,
      );
    }
  }
  const def = (pack.looks ?? []).find((l) => l.default);
  for (const p of pack.palettes ?? []) {
    const sel =
      opts.root && def?.palette === p.id
        ? `:root,\n[data-palette='${p.id}']`
        : `[data-palette='${p.id}']`;
    lines.push(`${sel} {`);
    for (const r of ROLES) lines.push(`  --rl-${r}: ${p.colors[r]};`);
    lines.push('}');
  }
  for (const t of pack.themes ?? []) {
    const ty = t.type;
    const sel =
      opts.root && def?.theme === t.id
        ? `:root,\n[data-theme='${t.id}']`
        : `[data-theme='${t.id}']`;
    // Fluid between a phone (390px) and a desktop (1280px); outside that
    // range the heading stops at the theme's smallest and largest.
    const slope = ((ty.h1.max - ty.h1.min) * 16) / (1280 - 390);
    const base = ty.h1.min - (slope * 390) / 16;
    lines.push(
      `${sel} {`,
      `  --rl-page-max: ${pageMax(t)};`,
      `  --rl-radius: ${String(t.shape.radius)}px;`,
      `  --rl-radius-sm: ${String(t.shape.radiusSmall)}px;`,
      `  --rl-radius-pill: ${String(pill(t.shape))}px;`,
      `  --rl-border-main: ${String(t.shape.border)}px;`,
      `  --rl-shadow-offset: ${String(t.shape.shadow)}px;`,
      `  --rl-press: ${String(t.shape.press)}px;`,
      `  --rl-font-display: ${fam(ty.heading, FALLBACK.heading)};`,
      `  --rl-display-stretch: ${String(ty.heading.stretch ?? 100)}%;`,
      `  --rl-font-sans: ${fam(ty.body, FALLBACK.body)};`,
      `  --rl-body-size: ${String(ty.body.size)}px;`,
      `  --rl-font-label: ${fam(ty.label, FALLBACK.label)};`,
      `  --rl-label-stretch: ${String(ty.label.stretch ?? 100)}%;`,
      `  --rl-label-transform: ${ty.label.case === 'upper' ? 'uppercase' : 'none'};`,
      `  --rl-label-tracking: ${em(ty.label.tracking)};`,
      `  --rl-font-mono: ${fam(ty.mono, FALLBACK.mono)};`,
      `  --rl-h1-weight: ${String(ty.heading.weight)};`,
      `  --rl-h1-tracking: ${em(ty.heading.tracking ?? 0)};`,
      `  --rl-h1-size: clamp(${String(ty.h1.min)}rem, ${base.toFixed(3)}rem + ${(slope * 100).toFixed(3)}vw, ${String(ty.h1.max)}rem);`,
      `  --rl-display-transform: ${ty.heading.case === 'upper' ? 'uppercase' : 'none'};`,
      ...displayLines(t),
      '}',
    );
  }
  return lines.join('\n');
}

/**
 * A pageMax with no `width`, read as the nearest named width, so the page's
 * `data-width` says something true about a theme written before widths had
 * names.
 */
function widthOf(px: number): Width {
  if (px <= 860) return 'narrow';
  if (px <= 1100) return 'regular';
  return 'wide';
}

/**
 * What the site sends with the look, so the page can set the layout
 * attributes on <html>. An absent choice is what every page did before the
 * theme could make it: split, standard and outlined.
 */
export function themeLayout(theme: {
  panelHead: PanelHead;
  texture: Texture;
  pageMax?: number | undefined;
  width?: Width | undefined;
  columns?: Columns | undefined;
  scale?: Scale | undefined;
  surface?: Surface | undefined;
  display?: { second: Second; tag: Tag } | undefined;
  /** Already flattened, as a catalogue entry carries them. */
  second?: Second | undefined;
  tag?: Tag | undefined;
}): ThemeLayout {
  return {
    panelHead: theme.panelHead,
    texture: theme.texture,
    width: theme.width ?? widthOf(theme.pageMax ?? WIDTHS.regular),
    columns: theme.columns ?? 'split',
    scale: theme.scale ?? 'standard',
    surface: theme.surface ?? 'outlined',
    second: theme.second ?? theme.display?.second ?? 'solid',
    tag: theme.tag ?? theme.display?.tag ?? 'plain',
  };
}
