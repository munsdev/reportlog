/**
 * How this deployment looks and what it says about itself: the palette and
 * theme, its name, the words on its own pages, and its legal notices.
 *
 * NEVER SEALED. All of this is presentation. A report must not verify
 * differently because somebody renamed the site or corrected their privacy
 * policy, and the boundary check forbids the seal and chain code from
 * reaching the server's site module.
 *
 * The catalogue of palettes and themes and the name parser live here rather
 * than on one side because both sides need them: the server validates a
 * choice and builds the web manifest; the website paints the choice and
 * previews a name while it is typed.
 */
import { z } from 'zod';
import { defineRoute } from './route.ts';

// ── the look ────────────────────────────────────────────────────────────

/**
 * PALETTE owns every colour; THEME owns type, corners, shadow and width,
 * and sets no colour. Any theme works with any palette. Every id here has a
 * block in apps/web/src/styles.css and every block has an id here; the
 * website's suite checks both directions.
 *
 * `background` and `deep` repeat two of each palette's colours as literals,
 * because a web manifest cannot reference a CSS variable: a phone paints
 * its splash screen and status bar from them. The website's suite checks
 * they match the stylesheet, so a palette edit cannot leave the status bar
 * the old colour.
 */
export const PALETTES = [
  {
    id: 'flint',
    label: 'Flint',
    description: 'The shipped look: cool grey paper, gold for the action.',
    dark: false,
    background: '#e7ecef',
    deep: '#121a24',
  },
  {
    id: 'paper',
    label: 'Paper',
    description: 'Warm off-white, the colour of a printed document.',
    dark: false,
    background: '#f6f4ef',
    deep: '#1f1d1a',
  },
  {
    id: 'bureau',
    label: 'Bureau',
    description: 'Cool official grey-blue, the colour of a form.',
    dark: false,
    background: '#f3f5f8',
    deep: '#121a26',
  },
  {
    id: 'sage',
    label: 'Sage',
    description: 'A warm green ground, quiet and low-contrast.',
    dark: false,
    background: '#f2f5f0',
    deep: '#17211a',
  },
  {
    id: 'gallery',
    label: 'Gallery',
    description: 'The warm white of a gallery wall label.',
    dark: false,
    background: '#f7f3eb',
    deep: '#2b2620',
  },
  {
    id: 'parchment',
    label: 'Parchment',
    description: 'Older paper with softer ink, like a filed document.',
    dark: false,
    background: '#ede3cc',
    deep: '#1e3a5f',
  },
  {
    id: 'ledger',
    label: 'Ledger',
    description: 'Accounting blue-green on a white ground.',
    dark: false,
    background: '#f1f2ed',
    deep: '#1c2620',
  },
  {
    id: 'indigo',
    label: 'Indigo',
    description: 'Deep blue on a cool pale ground.',
    dark: false,
    background: '#f2f3f8',
    deep: '#191c33',
  },
  {
    id: 'bone',
    label: 'Bone',
    description: 'Near-white, with very little colour in it at all.',
    dark: false,
    background: '#fafaf8',
    deep: '#111111',
  },
  {
    id: 'midnight',
    label: 'Midnight',
    description: 'Deep navy, gold for the action. The shipped look after dark.',
    dark: true,
    background: '#121a24',
    deep: '#0a1017',
  },
  {
    id: 'ink',
    label: 'Ink',
    description: 'Blue-black, with a pale indigo accent.',
    dark: true,
    background: '#14172a',
    deep: '#0a0c18',
  },
  {
    id: 'graphite',
    label: 'Graphite',
    description: 'Neutral dark grey with no colour cast at all.',
    dark: true,
    background: '#191b1e',
    deep: '#0e1012',
  },
  {
    id: 'harbour',
    label: 'Harbour',
    description: 'Teal-tinted slate, warm amber for the action.',
    dark: true,
    background: '#10212b',
    deep: '#081419',
  },
  {
    id: 'dusk',
    label: 'Dusk',
    description: 'A violet-tinted dark, quieter than the navy.',
    dark: true,
    background: '#1b1524',
    deep: '#110c18',
  },
  {
    id: 'blackedition',
    label: 'Black edition',
    description: 'Near-black, minimal, high contrast.',
    dark: true,
    background: '#101010',
    deep: '#000000',
  },
  {
    id: 'moss',
    label: 'Moss',
    description: 'A dark green ground, low and even.',
    dark: true,
    background: '#131a15',
    deep: '#0a0f0b',
  },
  {
    id: 'umber',
    label: 'Umber',
    description: 'Warm dark brown, the colour of an old desk.',
    dark: true,
    background: '#1c1712',
    deep: '#110d09',
  },
  {
    id: 'slate',
    label: 'Slate',
    description: 'Cool grey-blue, the dark counterpart to Bureau.',
    dark: true,
    background: '#161b22',
    deep: '#0c1016',
  },
] as const;

export const THEMES = [
  {
    id: 'signal',
    label: 'Signal',
    description:
      'The shipped type: Archivo headings, Public Sans text, soft corners and a raised edge.',
  },
  {
    id: 'plain',
    label: 'Plain',
    description: 'The same type with nothing raised off the page. Quieter.',
  },
  {
    id: 'docket',
    label: 'Docket',
    description:
      'A typewritten record. One monospace family throughout, square corners, no shadow.',
  },
  {
    id: 'broadsheet',
    label: 'Broadsheet',
    description: 'Heavier headings, tighter set, hard edges.',
  },
  {
    id: 'bulletin',
    label: 'Bulletin',
    description: 'One family throughout, set tight and dense. A wider column for a busy board.',
  },
  {
    id: 'register',
    label: 'Register',
    description: 'Monospace headings over ordinary text. Square, and the widest of them.',
  },
] as const;

export type PaletteId = (typeof PALETTES)[number]['id'];
export type ThemeId = (typeof THEMES)[number]['id'];
export const PALETTE_IDS = PALETTES.map((p) => p.id) as [PaletteId, ...PaletteId[]];
export const THEME_IDS = THEMES.map((t) => t.id) as [ThemeId, ...ThemeId[]];

export const Look = z.object({
  palette: z.enum(PALETTE_IDS),
  theme: z.enum(THEME_IDS),
});
export type Look = z.infer<typeof Look>;

export const DEFAULT_LOOK: Look = { palette: 'flint', theme: 'signal' };

export function isDarkPalette(id: string): boolean {
  return PALETTES.some((p) => p.id === id && p.dark);
}

// ── the name ────────────────────────────────────────────────────────────

/** The software's own name, which the footer keeps whatever the site is called. */
export const SOFTWARE_NAME = 'ReportLog';

/** A name has to fit in a page header and a mail subject. Counted without the marks. */
export const MAX_SITE_NAME = 60;

/**
 * The two-tone name. Runs wrapped in straight double quotes take the first
 * accent (the palette's brand colour), runs in single quotes the second
 * (its muted text):
 *
 *   Report"Log"          Report, then Log in the first accent
 *   The"Ruhr"Line'.org'  both accents in one name
 *   Munich Archive       one colour
 *
 * Two and no more, because a third would have to borrow a status colour,
 * and a name in teal would be saying a moderator confirmed it.
 *
 * A QUOTE THAT DOES NOT CLOSE IS A CHARACTER, NOT A MARK. `Munich's Log`
 * keeps its apostrophe instead of losing half the name to an accent nobody
 * asked for. Only when both kinds fail to close is the name drawn flat with
 * the quotes stripped. The quotes themselves are never shown: tabs, mail
 * subjects and the manifest use `plainName`.
 */
export interface BrandPart {
  text: string;
  mark: '' | 'a' | 'b';
}

const MARK_OF: Record<string, 'a' | 'b'> = { '"': 'a', "'": 'b' };

/** One pass honouring only the quote kinds in `active`; null if one is left open. */
function scan(name: string, active: string): BrandPart[] | null {
  const parts: BrandPart[] = [];
  let buf = '';
  let open: string | null = null;
  const push = (text: string, mark: BrandPart['mark']) => {
    if (text) parts.push({ text, mark });
  };
  for (const ch of name) {
    if (open === null && active.includes(ch)) {
      push(buf, '');
      buf = '';
      open = ch;
    } else if (open === ch) {
      push(buf, MARK_OF[ch] ?? '');
      buf = '';
      open = null;
    } else {
      buf += ch;
    }
  }
  if (open !== null) return null;
  push(buf, '');
  return parts;
}

/** The name as ordered runs. Always at least one run, so no caller has to check. */
export function parseBrand(raw: string): BrandPart[] {
  const parts = scan(raw, `"'`) ??
    scan(raw, '"') ??
    scan(raw, "'") ?? [{ text: raw.split('"').join('').split("'").join(''), mark: '' }];
  return parts.length ? parts : [{ text: '', mark: '' }];
}

/** The name with no markup in it. */
export function plainName(raw: string): string {
  return parseBrand(raw)
    .map((p) => p.text)
    .join('');
}

/**
 * Whether the name reads exactly as written. False only for an unclosed
 * DOUBLE quote: nobody puts one in the middle of a name, so it is a typo
 * and the field says so. An unclosed single quote is an apostrophe and is
 * left alone, or every possessive would be refused.
 */
export function accentMarksClose(raw: string): boolean {
  return scan(raw, '"') !== null;
}

export const BrandPartSchema = z.object({ text: z.string(), mark: z.enum(['', 'a', 'b']) });

// ── the words on the site's own pages ───────────────────────────────────

/**
 * The slots an operator may write. Each one is read by a page; offering a
 * slot nothing reads would be a text box that does nothing, so a slot is
 * added here by whoever builds the page that shows it. The wording, help
 * and fallbacks are the server's (apps/api/src/site/copy.ts).
 */
export const COPY_KEYS = ['home_headline', 'home_lede', 'home_intro', 'standards'] as const;
export type CopyKey = (typeof COPY_KEYS)[number];
export const CopyKeySchema = z.enum(COPY_KEYS);

// ── what every page reads ───────────────────────────────────────────────

export const Site = z.object({
  software_name: z.string(),
  /** As stored, with its accent marks. */
  name: z.string(),
  name_parts: z.array(BrandPartSchema).min(1),
  plain_name: z.string(),
  look: Look,
  /** Every slot resolved: what the operator wrote, or what ships. Never missing. */
  copy: z.record(CopyKeySchema, z.string()),
});
export type Site = z.infer<typeof Site>;

export const getSite = defineRoute({
  method: 'GET',
  path: '/api/site',
  summary: "This deployment's name, look and page wording.",
  response: Site,
});

/**
 * The operator's imprint and privacy policy. NULL means nobody has
 * published one, and the page says exactly that: a placeholder that reads
 * like a legal notice is worse than none.
 */
export const LEGAL_KINDS = ['impressum', 'privacy'] as const;
export type LegalKind = (typeof LEGAL_KINDS)[number];
export const LegalKindSchema = z.enum(LEGAL_KINDS);
export const MAX_LEGAL_TEXT = 100000;

export const Legal = z.object({ impressum: z.string().nullable(), privacy: z.string().nullable() });
export type Legal = z.infer<typeof Legal>;

export const getLegal = defineRoute({
  method: 'GET',
  path: '/api/legal',
  summary: "The operator's imprint and privacy policy, or null for each not published.",
  response: Legal,
});

/** The installable app's description. Built per deployment so the icon wears the site's name. */
export const WebManifest = z.object({
  id: z.string(),
  name: z.string(),
  short_name: z.string(),
  description: z.string(),
  start_url: z.string(),
  scope: z.string(),
  display: z.string(),
  display_override: z.array(z.string()),
  background_color: z.string(),
  theme_color: z.string(),
  lang: z.string(),
  dir: z.string(),
  icons: z.array(
    z.object({ src: z.string(), sizes: z.string(), type: z.string(), purpose: z.string() }),
  ),
});
export type WebManifest = z.infer<typeof WebManifest>;

export const getWebManifest = defineRoute({
  method: 'GET',
  path: '/api/site/manifest.webmanifest',
  summary: 'The web app manifest, in this deployment’s name and colours.',
  response: WebManifest,
});

// The front page's buttons are workstream B's: see `getHomeButtons` in
// logbooks.ts. This file once had a second copy; the two were merged into
// B's, which also knows when a logbook closes.

// ── the settings screens ────────────────────────────────────────────────

export const CopySlot = z.object({
  key: CopyKeySchema,
  kind: z.enum(['line', 'block']),
  label: z.string(),
  help: z.string(),
  optional: z.boolean(),
  fallback: z.string(),
  /** What the editor opens with: the operator's words, or the fallback. */
  body: z.string(),
  /** False while the slot still carries the shipped wording. */
  written: z.boolean(),
});
export type CopySlot = z.infer<typeof CopySlot>;

export const LegalEditor = z.object({
  kind: LegalKindSchema,
  /** What was published, or the outline when nothing was. */
  text: z.string(),
  /** False while the editor holds the outline: saving it would publish the outline. */
  published: z.boolean(),
});

export const SiteEditor = z.object({
  look: Look,
  /** The stored name, or null when the site uses the default. */
  name: z.string().nullable(),
  effective_name: z.string(),
  copy: z.array(CopySlot),
  legal: z.array(LegalEditor),
});
export type SiteEditor = z.infer<typeof SiteEditor>;

export const getSiteEditor = defineRoute({
  method: 'GET',
  path: '/api/admin/site',
  summary: 'Everything the site settings screens edit.',
  response: SiteEditor,
});

/**
 * One axis at a time is fine: a palette change does not carry a theme with
 * it. Strings rather than enums so a refusal is a sentence, not a schema
 * error.
 */
export const setLook = defineRoute({
  method: 'PUT',
  path: '/api/admin/site/look',
  summary: 'Choose the palette, the theme, or both.',
  body: z.object({ palette: z.string().optional(), theme: z.string().optional() }),
  response: SiteEditor,
});

export const setSiteName = defineRoute({
  method: 'PUT',
  path: '/api/admin/site/name',
  summary: "Rename the site. Null goes back to the software's name.",
  body: z.object({ name: z.string().nullable() }),
  response: SiteEditor,
});

export const setCopy = defineRoute({
  method: 'PUT',
  path: '/api/admin/site/copy/:key',
  summary: 'Write one slot of page wording. Empty goes back to what ships.',
  params: z.object({ key: z.string() }),
  body: z.object({ body: z.string() }),
  response: SiteEditor,
});

export const setLegalText = defineRoute({
  method: 'PUT',
  path: '/api/admin/site/legal/:kind',
  summary: 'Publish the imprint or the privacy policy. Empty takes it down.',
  params: z.object({ kind: LegalKindSchema }),
  body: z.object({ text: z.string() }),
  response: SiteEditor,
});
