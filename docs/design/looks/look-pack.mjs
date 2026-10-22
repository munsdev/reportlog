// Reference implementation of the look pack check and the stylesheet writer.
//
// One file, no dependencies, so it can be read in one sitting and ported:
//   - check(pack, installed)  -> list of problems, each a sentence a person can read
//   - toCss(pack, fontUrl)    -> the stylesheet for a pack's palettes, themes and fonts
//
// The built-in pack (reportlog-core.look.json) goes through exactly the same
// two functions at build time as an uploaded pack does at install time, so the
// shipped looks can never pass a check an uploaded look would fail.
//
//   node look-pack.mjs check reportlog-core.look.json
//   node look-pack.mjs css   reportlog-core.look.json > looks.css
//
// WHY THE SERVER WRITES THE CSS: a pack is data, never a stylesheet. Accepting
// CSS from a pack would let it fetch from another host (url(), @import),
// which breaks the no-third-party rule, or hide content. Every value below is
// checked against a type and a range before it is written out.

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
];

// Text a person must read: 4.5:1 (WCAG 1.4.3). Includes every pair in the
// app's existing test (apps/web/test/ui/look.test.ts) and the pairs the
// redesign adds: text-muted on the page, brand on light, text on the open
// menu, and a count on the deep surface.
export const TEXT_PAIRS = [
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
export const EDGE_PAIRS = [
  ['text-alt', 'surface'],
  ['text-alt', 'background'],
];

export const ENUMS = {
  case: ['none', 'upper'],
  panelHead: ['plain', 'title-bar', 'double-rule', 'bar', 'rule', 'prompt'],
  texture: ['none', 'ruled', 'grid', 'dots'],
  // Optional in a theme; absent means what every page did before (themeMeta).
  width: ['narrow', 'regular', 'wide', 'full'],
  columns: ['single', 'split'],
  scale: ['standard', 'large'],
  surface: ['outlined', 'filled', 'ruled'],
};
export const WIDTHS = { narrow: 760, regular: 1000, wide: 1200 };
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
};
export const LIMITS = { fileBytes: 1_000_000, packBytes: 10_000_000, files: 120 };

const ID = /^[a-z][a-z0-9-]{1,39}$/;
const HEX = /^#[0-9a-f]{6}$/;
const FONT_FILE = /^fonts\/[A-Za-z0-9_-][A-Za-z0-9._-]*\.woff2$/;
// Everything below is written into a stylesheet, so each is held to a shape
// that cannot carry a quote, a brace, a comment or a URL.
const FAMILY = /^[A-Za-z0-9 ]{1,60}$/;
const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
const WEIGHT = /^(\d{3})( \d{3})?$/;
const STRETCH = /^(\d{2,3})( \d{2,3})?$/;

// ---- colour arithmetic --------------------------------------------------
const rgb = (h) => [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16));
const hex = (c) => `#${c.map((x) => Math.round(x).toString(16).padStart(2, '0')).join('')}`;
const mix = (a, b, p) => hex(rgb(a).map((x, i) => x * p + rgb(b)[i] * (1 - p)));
function luminance(h) {
  const [r, g, b] = rgb(h).map((x) => {
    const c = x / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
function hue(h) {
  const [r, g, b] = rgb(h).map((x) => x / 255);
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    d = max - min;
  if (!d) return { h: 0, s: 0 };
  const l = (max + min) / 2;
  const s = d / (1 - Math.abs(2 * l - 1));
  let deg = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (deg * 60 + 360) % 360, s };
}

/** The three colours every palette gets without stating them. Same mixes as the CSS. */
export function derived(colors) {
  return {
    ...colors,
    'text-on-deep-muted': mix(colors['text-on-deep'], colors['background-deep'], 0.82),
    'background-deeper': mix(colors['background-deep'], '#000000', 0.7),
    'border-on-deep': mix(colors['text-on-deep'], colors['background-deep'], 0.18),
  };
}

// ---- the check ------------------------------------------------------------
/**
 * @param pack       the parsed look.json
 * @param installed  { palettes:Set, themes:Set, looks:Set, families:Set } from OTHER packs
 * @param files      optional Map of 'fonts/x.woff2' -> Uint8Array, for an upload
 * @returns string[] problems; empty means the pack may be installed
 */
export function check(pack, installed = emptyInstalled(), files = null, { builtIn = false } = {}) {
  const out = [];
  const say = (s) => out.push(s);
  // builtIn is the caller's to say, never the pack's: a pack that claims it
  // could mark its own look as the default.
  if (pack && Object.hasOwn(pack, 'builtIn')) say('A pack may not say whether it is built in.');
  if (pack?.version !== undefined && !VERSION.test(String(pack.version)))
    say('The version must look like 1.2.3.');
  if (pack?.format !== FORMAT)
    say(`This pack is format ${pack?.format}; this site reads format ${FORMAT}.`);
  if (!ID.test(pack?.id ?? ''))
    say('The pack needs an id of lower-case letters, digits and hyphens.');
  if (!pack?.label) say('The pack needs a label.');

  const families = new Set(installed.families);
  for (const f of pack.fonts ?? []) {
    if (typeof f.family !== 'string' || !FAMILY.test(f.family)) {
      say('A font family name may use only letters, digits and spaces, up to 60.');
      continue;
    }
    if (!f.licence) say(`The font "${f.family}" does not say its licence.`);
    families.add(f.family);
    for (const file of f.files ?? []) {
      if (!FONT_FILE.test(file.file ?? ''))
        say(`"${file.file}" is not a .woff2 file inside fonts/.`);
      if (
        !WEIGHT.test(String(file.weight ?? '')) ||
        String(file.weight)
          .split(' ')
          .some((w) => +w < 100 || +w > 900)
      )
        say(`"${file.file}": weight must be one number, or two, from 100 to 900.`);
      if (file.style !== undefined && !['normal', 'italic'].includes(file.style))
        say(`"${file.file}": style must be normal or italic.`);
      if (
        file.stretch !== undefined &&
        (!STRETCH.test(String(file.stretch)) ||
          String(file.stretch)
            .split(' ')
            .some((w) => +w < RANGES.stretch[0] || +w > RANGES.stretch[1]))
      )
        say(`"${file.file}": stretch must be one number, or two, from 62 to 125.`);
      if (files) {
        const bytes = files.get(file.file);
        if (!bytes) say(`"${file.file}" is named but not in the pack.`);
        else {
          if (bytes.length > LIMITS.fileBytes) say(`"${file.file}" is larger than 1 MB.`);
          const magic = String.fromCharCode(...bytes.slice(0, 4));
          if (magic !== 'wOF2') say(`"${file.file}" is not a WOFF2 font.`);
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

  const seen = new Set();
  const unique = (kind, id, pool) => {
    if (!ID.test(id ?? '')) say(`A ${kind} needs an id of lower-case letters, digits and hyphens.`);
    else if (seen.has(`${kind}:${id}`)) say(`Two ${kind}s are called "${id}".`);
    else if (pool.has(id)) say(`A ${kind} called "${id}" is already installed from another pack.`);
    seen.add(`${kind}:${id}`);
  };

  for (const p of pack.palettes ?? []) {
    unique('palette', p.id, installed.palettes);
    const c = p.colors ?? {};
    const missing = ROLES.filter((r) => !HEX.test(c[r] ?? ''));
    if (missing.length) {
      say(`Palette "${p.id}" is missing or misspells: ${missing.join(', ')}.`);
      continue;
    }
    const extra = Object.keys(c).filter((k) => !ROLES.includes(k));
    if (extra.length)
      say(`Palette "${p.id}" sets colours this site does not use: ${extra.join(', ')}.`);
    const d = derived(c);
    const need = p.id.startsWith('contrast') ? 7 : 4.5;
    for (const [fg, bg] of TEXT_PAIRS) {
      const r = contrast(d[fg], d[bg]);
      if (r < need)
        say(`Palette "${p.id}": ${fg} on ${bg} is ${r.toFixed(2)}:1; it needs ${need}:1.`);
    }
    for (const [fg, bg] of EDGE_PAIRS) {
      const r = contrast(d[fg], d[bg]);
      if (r < 3)
        say(
          `Palette "${p.id}": a control edge (${fg} on ${bg}) is ${r.toFixed(2)}:1; it needs 3:1.`,
        );
    }
    const s = hue(c.serious),
      k = hue(c.confirmed);
    if (!(s.h >= 340 || s.h <= 20) || s.s <= 0.3)
      say(`Palette "${p.id}": serious must be a red (its hue is ${s.h.toFixed(0)}).`);
    if (!(k.h >= 140 && k.h <= 200 && k.s > 0.15))
      say(`Palette "${p.id}": confirmed must be a teal (its hue is ${k.h.toFixed(0)}).`);
    const darkPage = contrast(c.background, '#000000') < contrast(c.background, '#ffffff');
    if (darkPage !== Boolean(p.dark))
      say(
        `Palette "${p.id}" says dark is ${Boolean(p.dark)}, but its page is ${darkPage ? 'dark' : 'light'}.`,
      );
  }

  const inRange = (what, v, [lo, hi]) => {
    if (typeof v !== 'number' || v < lo || v > hi)
      say(`${what} must be a number from ${lo} to ${hi}.`);
  };
  for (const t of pack.themes ?? []) {
    unique('theme', t.id, installed.themes);
    const ty = t.type ?? {};
    for (const slot of ['heading', 'body', 'label', 'mono']) {
      const f = ty[slot];
      if (!f?.family) {
        say(`Theme "${t.id}" has no ${slot} font.`);
        continue;
      }
      if (!families.has(f.family))
        say(
          `Theme "${t.id}" names the font "${f.family}", which neither this pack nor an installed one provides.`,
        );
      if (f.stretch !== undefined)
        inRange(`Theme "${t.id}" ${slot} stretch`, f.stretch, RANGES.stretch);
    }
    if (ty.heading) {
      inRange(`Theme "${t.id}" heading weight`, ty.heading.weight, RANGES.weight);
      inRange(`Theme "${t.id}" heading tracking`, ty.heading.tracking ?? 0, RANGES.headingTracking);
      if (!ENUMS.case.includes(ty.heading.case))
        say(`Theme "${t.id}" heading case must be one of ${ENUMS.case.join(', ')}.`);
    }
    if (ty.label) {
      if (!ENUMS.case.includes(ty.label.case))
        say(`Theme "${t.id}" label case must be one of ${ENUMS.case.join(', ')}.`);
      inRange(`Theme "${t.id}" label tracking`, ty.label.tracking, RANGES.tracking);
    }
    if (ty.body) inRange(`Theme "${t.id}" body size`, ty.body.size, RANGES.size);
    inRange(`Theme "${t.id}" smallest h1`, ty.h1?.min, RANGES.h1);
    inRange(`Theme "${t.id}" largest h1`, ty.h1?.max, RANGES.h1);
    if (ty.h1 && ty.h1.min > ty.h1.max)
      say(`Theme "${t.id}": the smallest h1 is larger than the largest.`);
    for (const k of ['radius', 'radiusSmall', 'border', 'shadow', 'press'])
      inRange(`Theme "${t.id}" ${k}`, t.shape?.[k], RANGES[k]);
    if (t.pageMax !== undefined) inRange(`Theme "${t.id}" page width`, t.pageMax, RANGES.pageMax);
    else if (t.width === undefined)
      say(`Theme "${t.id}" needs a width (${ENUMS.width.join(', ')}) or a pageMax in px.`);
    for (const k of ['width', 'columns', 'scale', 'surface'])
      if (t[k] !== undefined && !ENUMS[k].includes(t[k]))
        say(`Theme "${t.id}" ${k} must be one of ${ENUMS[k].join(', ')}.`);
    if (!ENUMS.panelHead.includes(t.panelHead))
      say(`Theme "${t.id}" panel heading must be one of ${ENUMS.panelHead.join(', ')}.`);
    if (!ENUMS.texture.includes(t.texture))
      say(`Theme "${t.id}" texture must be one of ${ENUMS.texture.join(', ')}.`);
    // Only the fields that become CSS are searched; a description may say "#1".
    if (
      t.colors ||
      JSON.stringify([t.type, t.shape, t.panelHead, t.texture]).match(
        /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|url\(/i,
      )
    )
      say(`Theme "${t.id}" sets a colour. A theme never sets colour.`);
  }

  const palettes = new Set([...installed.palettes, ...(pack.palettes ?? []).map((p) => p.id)]);
  const themes = new Set([...installed.themes, ...(pack.themes ?? []).map((t) => t.id)]);
  for (const l of pack.looks ?? []) {
    unique('look', l.id, installed.looks);
    if (!palettes.has(l.palette))
      say(`The look "${l.id}" names a palette nobody provides: "${l.palette}".`);
    if (!themes.has(l.theme))
      say(`The look "${l.id}" names a theme nobody provides: "${l.theme}".`);
    if (l.default && !builtIn) say(`Only the built-in pack may mark the default look ("${l.id}").`);
  }
  if (!(pack.palettes?.length || pack.themes?.length || pack.looks?.length))
    say('The pack adds nothing.');
  return out;
}

export function emptyInstalled() {
  return { palettes: new Set(), themes: new Set(), looks: new Set(), families: new Set() };
}

// ---- the stylesheet ---------------------------------------------------------
const fam = (f, fallback) => `'${f.family}', ${fallback}`;
const FALLBACK = {
  heading: 'ui-sans-serif, system-ui, sans-serif',
  body: 'ui-sans-serif, system-ui, sans-serif',
  label: 'ui-sans-serif, system-ui, sans-serif',
  mono: 'ui-monospace, monospace',
};
const em = (n) => `${n}em`;

/**
 * @param fontUrl (packId, file) -> URL on THIS site. Never another host.
 * @param opts.root  write the default look's blocks as :root as well
 */
/**
 * Call only with a pack check() returned no problems for: every value written
 * below has been held to a shape that cannot leave its declaration.
 *
 * @param fontUrl (packId, file) -> URL on THIS site. Built-in pack: the bundled
 *   file beside styles.css ((id, f) => `./${f}`, which Vite rewrites). Uploaded
 *   pack: `/api/looks/<pack>/<sha256>.woff2`, so a changed file has a new name.
 */
export function toCss(pack, fontUrl = (id, file) => `/api/looks/${id}/${file}`, opts = {}) {
  const lines = [`/* Look pack ${pack.id}. Written from look.json; never edit by hand. */`];
  for (const f of pack.fonts ?? []) {
    for (const file of f.files ?? []) {
      lines.push(
        `@font-face { font-family: '${f.family}'; src: url('${fontUrl(pack.id, file.file)}') format('woff2'); font-weight: ${file.weight}; font-style: ${file.style ?? 'normal'};${
          file.stretch
            ? ` font-stretch: ${file.stretch
                .split(' ')
                .map((x) => `${x}%`)
                .join(' ')};`
            : ''
        } font-display: swap; }`,
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
    const h1 = ty.h1;
    const slope = ((h1.max - h1.min) * 16) / (1280 - 390); // px per px of viewport, phone to desktop
    const base = h1.min - (slope * 390) / 16;
    lines.push(
      `${sel} {`,
      `  --rl-page-max: ${pageMax(t)};`,
      `  --rl-radius: ${t.shape.radius}px;`,
      `  --rl-radius-sm: ${t.shape.radiusSmall}px;`,
      `  --rl-radius-pill: ${pill(t.shape)}px;`,
      `  --rl-border-main: ${t.shape.border}px;`,
      `  --rl-shadow-offset: ${t.shape.shadow}px;`,
      `  --rl-press: ${t.shape.press}px;`,
      `  --rl-font-display: ${fam(ty.heading, FALLBACK.heading)};`,
      `  --rl-display-stretch: ${ty.heading.stretch ?? 100}%;`,
      `  --rl-font-sans: ${fam(ty.body, FALLBACK.body)};`,
      `  --rl-body-size: ${ty.body.size}px;`,
      `  --rl-font-label: ${fam(ty.label, FALLBACK.label)};`,
      `  --rl-label-stretch: ${ty.label.stretch ?? 100}%;`,
      `  --rl-label-transform: ${ty.label.case === 'upper' ? 'uppercase' : 'none'};`,
      `  --rl-label-tracking: ${em(ty.label.tracking)};`,
      `  --rl-font-mono: ${fam(ty.mono, FALLBACK.mono)};`,
      `  --rl-h1-weight: ${ty.heading.weight};`,
      `  --rl-h1-tracking: ${em(ty.heading.tracking ?? 0)};`,
      `  --rl-h1-size: clamp(${h1.min}rem, ${base.toFixed(3)}rem + ${(slope * 100).toFixed(3)}vw, ${h1.max}rem);`,
      `  --rl-display-transform: ${ty.heading.case === 'upper' ? 'uppercase' : 'none'};`,
      '}',
    );
  }
  return lines.join('\n');
}

// `full`: edge to edge, less a margin that grows from nothing on a phone to 4rem.
function pageMax(t) {
  if (t.width === 'full') return 'calc(100% - 2 * clamp(0rem, 4vw - 1rem, 4rem))';
  if (t.width) return `${WIDTHS[t.width]}px`;
  return `${t.pageMax ?? WIDTHS.regular}px`;
}

// Chips and counts: square in a square theme, a full pill in a round one.
function pill(shape) {
  if (shape.radiusSmall === 0) return 0;
  return shape.radius >= 12 ? 999 : shape.radiusSmall;
}

const widthOf = (px) => (px <= 860 ? 'narrow' : px <= 1100 ? 'regular' : 'wide');

/** What the site API sends with the look, so the page can set the layout attributes on <html>. */
export function themeMeta(theme) {
  return {
    panelHead: theme.panelHead,
    texture: theme.texture,
    width: theme.width ?? widthOf(theme.pageMax ?? WIDTHS.regular),
    columns: theme.columns ?? 'split',
    scale: theme.scale ?? 'standard',
    surface: theme.surface ?? 'outlined',
  };
}

// ---- command line -------------------------------------------------------------
if (import.meta.url === `file://${process.argv[1]}`) {
  const { readFileSync } = await import('node:fs');
  const [cmd, file] = process.argv.slice(2);
  const pack = JSON.parse(readFileSync(file, 'utf8'));
  if (cmd === 'check') {
    const problems = check(pack, undefined, null, {
      builtIn: file.endsWith('reportlog-core.look.json'),
    });
    for (const p of problems) console.log(`PROBLEM  ${p}`);
    console.log(
      problems.length
        ? `${problems.length} problem(s). Not installable.`
        : `OK: ${pack.palettes?.length ?? 0} palettes, ${pack.themes?.length ?? 0} themes, ${pack.looks?.length ?? 0} looks.`,
    );
    process.exit(problems.length ? 1 : 0);
  } else if (cmd === 'css') {
    console.log(toCss(pack, undefined, { root: true }));
  } else {
    console.log('usage: node look-pack.mjs check|css <look.json>');
    process.exit(2);
  }
}
