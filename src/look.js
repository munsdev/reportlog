/**
 * How this deployment looks: three orthogonal axes.
 *
 * Ported from the design preview, and the central rule comes with it:
 *
 *   PALETTE owns every colour.
 *   THEME owns type, borders, shadows, radii and spacing, and sets NO colour.
 *   LAYOUT owns how wide the page is.
 *
 * Orthogonal on purpose. Any theme works with any palette, so an operator
 * who wants the typewritten look in their own colours gets it without
 * anybody having authored that pair. Eighteen palettes times four themes
 * times three widths is two hundred and sixteen combinations, none of which
 * had to be drawn.
 *
 * STATUS COLOUR IS MEANING, NOT BRAND. Crimson is serious or an error; teal
 * is a moderator confirmed this. Every palette restates the same three
 * values rather than inventing its own, because a confirmation that changed
 * colour with the decor would stop being a signal. The suite asserts it by
 * reading the CSS.
 *
 * NO COLOUR MATHS, HERE OR IN THE BROWSER. The palettes are hand-authored
 * and were checked for contrast where they were written. Nothing computes a
 * shade at runtime, so nothing can compute an unreadable one.
 *
 * REPLACES THE SINGLE `theme` NAME from migration 016, which was a stub and
 * said so. Its two non-default values set colour and nothing else, so
 * migration 020 carries them across to the nearest palette.
 *
 * PER-CAMPAIGN LOOK, for when campaigns exist: this is deliberately three
 * plain strings and no behaviour. A campaign row carrying its own three
 * would override a deployment's without any of this changing — the resolver
 * below takes a settings object, not a global. Nothing here needs to know
 * campaigns exist.
 *
 * NEVER HASHED, and nothing here goes near a report.
 */
import { pool } from './db.js';

/**
 * THE PALETTES, ported from the preview and changed in exactly one way.
 *
 * `--color--status-confirmed` was near-black on every light palette and
 * near-white on every dark one — that preview rendered a confirmation as
 * ordinary text, so it had no need of a hue. ReportLog does: the rule at
 * the top of public/index.html is that colour is exclusive and teal means A
 * MODERATOR CONFIRMED THIS. Ported as they came, a confirmed badge would
 * have been indistinguishable from the paragraph beside it in seventeen of
 * eighteen palettes.
 *
 * So every palette carries teal for confirmed — the shipped #296B60 on a
 * light ground, a lighter #6FC7B6 on a dark one so it still reads. Serious
 * is left exactly as ported: it was already red in all eighteen and only
 * varies in how light, which is the ground-tuning it should do.
 *
 * The suite checks both by HUE rather than by exact value, because tuning a
 * red for a dark ground is correct and changing it to a blue is not.
 */
export const PALETTES = [
  // Named for the stone, and for what striking it does: cool grey, with the
  // spark as the action colour. It was `electionlog` — the shipped look in
  // this software was internally named after a different, shelved project —
  // and its label was 'Signal', which is also the name of a THEME, so the
  // palette picker and the theme picker both offered "Signal" meaning two
  // unrelated things. Renamed 15 September, while renaming is still free.
  { id: 'flint', label: 'Flint', description: 'The shipped look: cool grey paper, gold for the action.', dark: false },
  { id: 'paper', label: 'Paper', description: 'Warm off-white, the colour of a printed document.', dark: false },
  { id: 'bureau', label: 'Bureau', description: 'Cool official grey-blue, the colour of a form.', dark: false },
  { id: 'sage', label: 'Sage', description: 'A warm green ground, quiet and low-contrast.', dark: false },
  { id: 'gallery', label: 'Gallery', description: 'The warm white of a gallery wall label.', dark: false },
  { id: 'parchment', label: 'Parchment', description: 'Older paper with softer ink, like a filed document.', dark: false },
  { id: 'ledger', label: 'Ledger', description: 'Accounting blue-green on a white ground.', dark: false },
  { id: 'indigo', label: 'Indigo', description: 'Deep blue on a cool pale ground.', dark: false },
  { id: 'bone', label: 'Bone', description: 'Near-white, with very little colour in it at all.', dark: false },
  // The nine dark ones. Held back one release while the stylesheet still
  // conflated "a solid block" with "a dark surface" — see the note beside
  // the dark palette CSS in public/index.html for what that cost and what
  // fixed it. Every value was measured before it shipped.
  { id: 'midnight', label: 'Midnight', description: 'Deep navy, gold for the action. The shipped look after dark.', dark: true },
  { id: 'ink', label: 'Ink', description: 'Blue-black, with a pale indigo accent.', dark: true },
  { id: 'graphite', label: 'Graphite', description: 'Neutral dark grey with no colour cast at all.', dark: true },
  { id: 'harbour', label: 'Harbour', description: 'Teal-tinted slate, warm amber for the action.', dark: true },
  { id: 'dusk', label: 'Dusk', description: 'A violet-tinted dark, quieter than the navy.', dark: true },
  { id: 'blackedition', label: 'Black edition', description: 'Near-black, minimal, high contrast.', dark: true },
  { id: 'moss', label: 'Moss', description: 'A dark green ground, low and even.', dark: true },
  { id: 'umber', label: 'Umber', description: 'Warm dark brown, the colour of an old desk.', dark: true },
  { id: 'slate', label: 'Slate', description: 'Cool grey-blue, the dark counterpart to Bureau.', dark: true },
];

export const THEMES = [
  { id: 'signal', label: 'Signal', description: 'The shipped type: Archivo headings, Public Sans text, soft corners and a raised edge.' },
  { id: 'plain', label: 'Plain', description: 'The same type with nothing raised off the page. Quieter.' },
  { id: 'docket', label: 'Docket', description: 'A typewritten record. One monospace family throughout, square corners, no shadow.' },
  { id: 'broadsheet', label: 'Broadsheet', description: 'Heavier headings, tighter set, hard edges.' },
  { id: 'bulletin', label: 'Bulletin', description: 'One family throughout, set tight and dense. A wider column for a busy board.' },
  { id: 'register', label: 'Register', description: 'Monospace headings over ordinary text. Square, and the widest of them.' },
];

/**
 * RETIRED — the third axis. Width belongs to the theme now.
 *
 * Three axes made 216 combinations, twelve of them theme-and-width pairs
 * nobody had authored, and one of those — a typewritten record at 1140px —
 * a bad idea an operator could simply pick. A theme is a finished opinion
 * and its measure is part of the opinion, so each states its own
 * `--page-max` in the stylesheet.
 *
 * Kept as an empty list rather than deleted: `site_settings.layout` still
 * exists, because migrations are additive, and a caller that still asks for
 * the layout choices should get "there are none" rather than a crash. The
 * resolver and the validator no longer know the axis at all.
 */
export const LAYOUTS = [];

export const PALETTE_IDS = PALETTES.map((p) => p.id);
export const THEME_IDS = THEMES.map((t) => t.id);
export const LAYOUT_IDS = LAYOUTS.map((l) => l.id);

export const DEFAULT_LOOK = { palette: 'flint', theme: 'signal' };

const TTL_MS = Number(process.env.LOOK_TTL_MS ?? 30 * 1000);
let cache = { at: 0, row: null };

export async function lookSettings() {
  if (Date.now() - cache.at < TTL_MS) return cache.row;
  try {
    const { rows } = await pool.query(
      'SELECT theme, palette FROM site_settings WHERE id = true',
    );
    cache = { at: Date.now(), row: rows[0] || null };
  } catch {
    // A database that cannot answer must not leave the page unstyled.
    cache = { at: Date.now(), row: null };
  }
  return cache.row;
}

export function clearLookCache() {
  cache = { at: 0, row: null };
}

/**
 * Pure, and it refuses to return a name the page has no CSS for.
 *
 * A value dropped in a later version would otherwise leave the attribute
 * naming nothing — a page with no colours at all rather than the shipped
 * ones. Takes a settings object rather than reading a global, which is what
 * lets a campaign's own look override a deployment's later without this
 * file changing.
 */
export function resolveLook(settings) {
  const pick = (value, ids, fallback) => {
    const v = typeof value === 'string' ? value.trim() : '';
    return ids.includes(v) ? v : fallback;
  };
  return {
    palette: pick(settings?.palette, PALETTE_IDS, DEFAULT_LOOK.palette),
    theme: pick(settings?.theme, THEME_IDS, DEFAULT_LOOK.theme),
  };
}

export async function currentLook() {
  return resolveLook(await lookSettings());
}

export function isDarkPalette(id) {
  return !!PALETTES.find((p) => p.id === id)?.dark;
}

export function validateLook(body) {
  const out = {};
  // Two axes. A body still carrying `layout` is IGNORED rather than
  // refused: an older admin page left open in a tab should not start
  // erroring, and the column it would have written is dead anyway.
  const axes = [['palette', PALETTE_IDS], ['theme', THEME_IDS]];
  for (const [key, ids] of axes) {
    if (body?.[key] === undefined) continue;
    const v = String(body[key] ?? '').trim();
    if (!ids.includes(v)) return { ok: false, error: `That is not one of the ${key} choices.` };
    out[key] = v;
  }
  if (!Object.keys(out).length) return { ok: false, error: 'Nothing to update' };
  return { ok: true, value: out };
}

/**
 * The two-tone name — now up to three tones.
 *
 * A deployment's name may mark runs of characters as accents by wrapping
 * them in straight quotes. Double quotes mark the FIRST accent, single
 * quotes the SECOND:
 *
 *     Report"Log"          ->  Report, then Log in the first accent
 *     "Munich"Archive      ->  Munich in the first accent, then Archive
 *     The"Ruhr"Line'.org'  ->  both accents in one name
 *     Munich Archive       ->  one colour, which is what every name does today
 *
 * Quotes are a good choice for one reason
 * beyond taste: they are already impossible to confuse with the rest of a
 * name, and a name with no quotes in it behaves exactly as it always has.
 * Nothing existing has to change and nobody has to learn anything to keep
 * what they have.
 *
 * WHY TWO AND NOT MORE. Two is what the palettes can carry. The first
 * accent is the brand colour; the second is the palette's muted text. A
 * third would have to invent a hue, and the only unclaimed colours on the
 * page are the status ones, which MEAN something — teal is a moderator
 * confirmed this. A name that borrowed teal would be lying in the one
 * colour the site cannot afford to have lie.
 *
 * THE QUOTES ARE NEVER SHOWN and never leave these functions. A mail
 * subject, a browser tab and an Impressum all want the plain name, so
 * `plainName` is what everything except the rendered brand uses.
 *
 * A QUOTE THAT DOES NOT CLOSE IS A CHARACTER, NOT A MARK. That kind of
 * quote is dropped from the syntax and the name re-read without it, so
 * `Munich's Log` keeps its apostrophe instead of losing half the name to an
 * accent nobody asked for. Only when BOTH kinds fail to close is the name
 * drawn flat with the quotes stripped. Half a marked name is somebody
 * mid-keystroke, and drawing the rest of it in the accent colour makes a
 * typo look like a decision.
 */

/** Which accent each opening quote character starts. */
const MARK_OF = { '"': 'a', "'": 'b' };

/**
 * One pass, honouring only the quote kinds named in `active`. Returns null
 * if a quote of an active kind is left open.
 */
function scan(name, active) {
  const parts = [];
  let buf = '';
  let open = null;
  const push = (text, mark) => { if (text) parts.push({ text, mark }); };
  for (const ch of name) {
    if (open === null && active.includes(ch)) {
      push(buf, '');
      buf = '';
      open = ch;
    } else if (open === ch) {
      push(buf, MARK_OF[ch]);
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

/**
 * Returns the name as an ordered list of `{ text, mark }` runs, where mark
 * is '' for the plain part, 'a' for the first accent and 'b' for the
 * second. Always returns at least one run, so a caller never has to check.
 *
 * AN UNCLOSED QUOTE IS A CHARACTER, NOT A MARK. `Munich's Log` has one
 * apostrophe in it and means nothing by it, and an apostrophe is ordinary
 * in a name in a way a double quote is not. So a kind of quote that does
 * not close is dropped from the syntax and re-read as literal text rather
 * than swallowing half the name. Only if BOTH kinds fail to close is the
 * name drawn flat with the quotes stripped.
 */
export function parseBrand(raw) {
  const name = String(raw ?? '');
  const parts = scan(name, '"\'')
    || scan(name, '"')
    || scan(name, "'")
    || [{ text: name.split('"').join('').split("'").join(''), mark: '' }];
  // A name that is nothing but marks — `""` — leaves no runs at all. One
  // empty run rather than none, so no caller has to check.
  return parts.length ? parts : [{ text: '', mark: '' }];
}

/** Does this name mark anything at all? */
export function isMarked(raw) {
  return parseBrand(raw).some((part) => part.mark);
}

/** The name with no markup in it: tabs, mail subjects, anything plain. */
export function plainName(raw) {
  return parseBrand(raw).map((part) => part.text).join('');
}

/**
 * Whether the name will be read exactly as it was written.
 *
 * FALSE ONLY FOR AN UNCLOSED DOUBLE QUOTE, and the asymmetry is the point.
 * A double quote is unambiguous syntax: nobody puts one in the middle of
 * what their archive is called, so one that does not close is a typo and
 * the field should say so. A single quote is an APOSTROPHE first and a mark
 * second — `Sam's Archive` is an ordinary name — so one that does not
 * close is read as text and nothing is said about it. Rejecting those would
 * have refused every possessive an operator might reasonably type.
 *
 * `parseBrand` renders either case sensibly; this only decides whether the
 * field speaks up.
 */
export function accentMarksClose(raw) {
  return scan(String(raw ?? ''), '"') !== null;
}
