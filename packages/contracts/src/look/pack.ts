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

export const FORMAT = 1;

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
} as const;
export type PanelHead = (typeof ENUMS.panelHead)[number];
export type Texture = (typeof ENUMS.texture)[number];
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
} as const satisfies Record<string, readonly [number, number]>;
export const LIMITS = { fileBytes: 1_000_000, packBytes: 10_000_000, files: 120 };

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
  pageMax: number;
  panelHead: PanelHead;
  texture: Texture;
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
}

/** What other packs already provide; ids are unique across every installed pack. */
export interface Installed {
  palettes: ReadonlySet<string>;
  themes: ReadonlySet<string>;
  looks: ReadonlySet<string>;
  families: ReadonlySet<string>;
}

export function emptyInstalled(): Installed {
  return { palettes: new Set(), themes: new Set(), looks: new Set(), families: new Set() };
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
  if (pack.format !== FORMAT)
    say(`This pack is format ${shown(pack.format)}; this site reads format ${String(FORMAT)}.`);
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

  const inRange = (what: string, v: unknown, [lo, hi]: readonly [number, number]) => {
    if (typeof v !== 'number' || v < lo || v > hi)
      say(`${what} must be a number from ${String(lo)} to ${String(hi)}.`);
  };
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
    inRange(`Theme "${id}" page width`, t.pageMax, RANGES.pageMax);
    if (!oneOf(ENUMS.panelHead, t.panelHead))
      say(`Theme "${id}" panel heading must be one of ${ENUMS.panelHead.join(', ')}.`);
    if (!oneOf(ENUMS.texture, t.texture))
      say(`Theme "${id}" texture must be one of ${ENUMS.texture.join(', ')}.`);
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
  if (!(palettes.length || themes.length || looks.length)) say('The pack adds nothing.');
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
      `  --rl-page-max: ${String(t.pageMax)}px;`,
      `  --rl-radius: ${String(t.shape.radius)}px;`,
      `  --rl-radius-sm: ${String(t.shape.radiusSmall)}px;`,
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
      '}',
    );
  }
  return lines.join('\n');
}

/** What the site sends with the look, so the page can set the two layout attributes. */
export function themeMeta(theme: Theme): { panelHead: PanelHead; texture: Texture } {
  return { panelHead: theme.panelHead, texture: theme.texture };
}
