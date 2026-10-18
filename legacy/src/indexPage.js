/**
 * The two things a deployment needs from the shipped `public/index.html`
 * that a static file server cannot give it: a page whose FIRST BYTE carries
 * the operator's name, and the palette colours the web app manifest has to
 * state as literals.
 *
 * WHY THIS IS DERIVED RATHER THAN DECLARED. Both could have been written
 * out by hand — a second copy of the title, a table of hexes beside
 * `PALETTES`. Both would then be a second source of truth for something the
 * stylesheet already states, and the palette work of 13 September is a long
 * account of what happens when one surface's idea of a colour drifts from
 * another's. The file is parsed instead, so there is nothing to keep in step.
 *
 * NEVER HASHED, and nothing here may ever be read by `reportCore.js` or
 * `verify.js`. This is the shell around the record, not the record.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOFTWARE_NAME, plainSiteName } from './siteIdentity.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
export const INDEX_PATH = path.join(PUBLIC_DIR, 'index.html');
// The palettes and themes, which used to be inside the page and now sit
// beside it so the Client-First layer and the style guide can read the same
// values rather than each keeping a copy.
export const TOKENS_PATH = path.join(PUBLIC_DIR, 'tokens.css');

/**
 * Read once. The file does not change under a running process — a deploy
 * restarts the service, which is what `deploy.sh` does last and on purpose.
 *
 * It used to be half a megabyte, because it carried the whole frontend. The
 * rules and the code are files of their own now (docs/frontend-files.md) and
 * nginx or express.static serves those; this reads the markup, which is the
 * only part with a name in it to rewrite.
 */
let source = null;
function indexSource() {
  if (source === null) source = fs.readFileSync(INDEX_PATH, 'utf8');
  return source;
}

/** Only for the suite, which needs to parse a string it made up. */
export function __setSource(s) { source = s; cache = { name: null, html: null }; }

let tokens = null;
function tokensSource() {
  if (tokens === null) tokens = fs.readFileSync(TOKENS_PATH, 'utf8');
  return tokens;
}

/** Only for the suite. */
export function __setTokens(s) { tokens = s; colors = null; }

/* ------------------------------------------------------------------ */
/* The page                                                            */

// The two places the software's name is written into the static shell. They
// are LEFT AS LITERALS in the file on purpose: nginx serves public/ straight
// from disk in production, so a `{{TOKEN}}` here would be shown to a visitor
// verbatim on every deployment that has not also updated its nginx config.
// A literal degrades to the software's name, which is what the page said
// before this existed and is never wrong-looking. See contrib/nginx/.
const TITLE = `<title>${SOFTWARE_NAME}</title>`;
const APPLE = `<meta name="apple-mobile-web-app-title" content="${SOFTWARE_NAME}">`;

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Both anchors must be present, or a silent no-op ships: the page would go
 * on saying ReportLog and nothing would say why. The suite asserts this too,
 * but a deployment that edited its own copy of the file deserves the throw.
 */
export function assertAnchors(html = indexSource()) {
  for (const [what, anchor] of [['title', TITLE], ['apple-mobile-web-app-title', APPLE]]) {
    if (!html.includes(anchor)) {
      throw new Error(`indexPage: the ${what} anchor is not in public/index.html — `
        + 'a rename would not reach it. Restore it or update src/indexPage.js.');
    }
  }
}

let cache = { name: null, html: null };

/**
 * The page with the deployment's name in the tab from the first byte.
 *
 * A rename is rare and a page load is not, so the rendered page is cached
 * against the name it was rendered for and rebuilt only when that changes.
 */
export async function renderIndex() {
  const name = await plainSiteName();
  if (cache.name === name && cache.html !== null) return cache.html;
  const src = indexSource();
  const html = name === SOFTWARE_NAME
    ? src
    : src
      .replace(TITLE, `<title>${escapeHtml(name)}</title>`)
      .replace(APPLE, `<meta name="apple-mobile-web-app-title" content="${escapeHtml(name)}">`);
  cache = { name, html };
  return html;
}

export function clearIndexCache() { cache = { name: null, html: null }; }

/* ------------------------------------------------------------------ */
/* The palette colours                                                 */

/**
 * `--color--background` and `--color--background-deep` for every palette,
 * read out of the stylesheet that defines them.
 *
 * The manifest has to state `background_color` and `theme_color` as literal
 * hexes — a manifest cannot reference a CSS variable — and an operator on a
 * dark palette whose phone paints the status bar light navy is looking at a
 * bug. These are the only two colours anything outside the stylesheet needs.
 *
 * The default palette is the bare `:root` block; the other seventeen are
 * `:root[data-palette="id"]`. Both shapes are read, so `flint` is not
 * a special case anybody has to remember.
 *
 * Read out of public/tokens.css, which is where the palettes live now. It
 * is still parsed rather than restated: a table of hexes beside `PALETTES`
 * would be a second source of truth for a colour, which is the mistake the
 * whole look system is arranged to avoid.
 */
// Every palette block now carries its id, including the default — which is
// written `:root, [data-palette="flint"]` so the attribute-less page
// and a preview frame asking for it by name share one set of values.
const BLOCK = /\[data-palette="([a-z]+)"\]\s*\{([^}]*)\}/g;
const TOKEN = (name, body) => (body.match(new RegExp(`--color--${name}\\s*:\\s*([^;]+);`)) || [])[1];

let colors = null;
export function paletteColors() {
  if (colors) return colors;
  const out = new Map();
  for (const [, id, body] of tokensSource().matchAll(BLOCK)) {
    const background = TOKEN('background', body);
    const deep = TOKEN('background-deep', body);
    // The bare `:root` appears more than once — theme blocks, print rules.
    // Only the one carrying both palette tokens is the default palette.
    if (!background || !deep) continue;
    out.set(id, { background: background.trim(), deep: deep.trim() });
  }
  colors = out;
  return out;
}

export function clearPaletteColorCache() { colors = null; }
