/**
 * The install guide as a STANDALONE SITE, built from the repository.
 *
 *   npm run docs:site            → dist/docs-site
 *   npm run docs:site -- <dir>   → somewhere else
 *
 * Meant for a static host (Cloudflare Pages and the like) so the guide can be
 * handed to somebody who is not reading it on a deployment.
 *
 * ──────────────────────────────────────────────────────────────────────
 * WHY THIS IS A BUILD AND NOT AN UPLOADED FILE.
 *
 * `npm run handout` already makes a one-file copy, and a copy of a document
 * that moves is the thing this project is built to avoid: it is correct the
 * day it is made and silently wrong afterwards. The handout is for emailing
 * once. A SITE is a standing promise, so it is generated from the repository
 * on every deploy and there is nowhere for a stale copy to live.
 *
 * WHY NOT JUST PUBLISH `public/`. It would work and it would also serve the
 * application's own shell — index.html, the board, the admin panes, every
 * page of a deployment — from a documentation hostname, with no server behind
 * any of it. A visitor would meet a site that looks like a ReportLog and
 * cannot accept a report. So this copies the guide and exactly what the guide
 * needs, and `assertComplete` below fails the build if that list ever drifts
 * from what the page actually asks for.
 * ──────────────────────────────────────────────────────────────────────
 *
 * ABSOLUTE PATHS ARE KEPT, NOT REWRITTEN. `docs.html` asks for
 * `/css/docs-page.css`, `/js/docs-page.js`, `/fonts/fonts.css` and
 * `/icons/favicon-32.png`, and those are the paths a deployment serves. The
 * tree below mirrors them, so the same HTML works in both places and nothing
 * here edits the page's markup. A rewrite would be a second thing to keep
 * level with the page.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(root, process.argv[2] || 'dist/docs-site');

const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

// WHAT THE GUIDE NEEDS, and nothing else. Checked against the page below
// rather than trusted: a stylesheet added to docs.html and not to this list
// would otherwise 404 only in production.
const ASSETS = [
  'css/docs-page.css',
  'js/docs-page.js',
  'fonts/fonts.css',
  'icons/favicon-32.png',
];

const page = read('public/docs.html');

/**
 * Every absolute asset path the page asks for is one we are copying.
 *
 * THE FAILURE THIS CATCHES IS PRODUCTION-ONLY. On a deployment the whole of
 * `public/` is served, so a new `<link>` works there and 404s only here —
 * and a 404 on `docs-page.js` is a guide with no copy buttons, no branching
 * and no fill-in panel, which still renders and still looks fine.
 */
function assertComplete() {
  const asked = [...page.matchAll(/(?:href|src)="\/([^"]+)"/g)].map((m) => m[1]);
  const missing = asked.filter((a) => !ASSETS.includes(a));
  if (missing.length) {
    console.error('public/docs.html asks for files this build does not copy:');
    for (const m of missing) console.error(`  /${m}`);
    console.error('\nAdd them to ASSETS in tools/make-docs-site.mjs. They would 404 in');
    console.error('production only — on a deployment all of public/ is served.');
    process.exit(1);
  }
  return asked;
}

const asked = assertComplete();

// The fonts stylesheet asks for its own files, relative to itself. Read them
// out of it rather than listing them here, so a font swapped in the CSS does
// not need a second edit.
const fontCss = read('public/fonts/fonts.css');
const fontFiles = [...new Set([...fontCss.matchAll(/url\(([^)]+)\)/g)]
  .map((m) => m[1].replace(/['"]/g, '').trim())
  .filter((u) => !/^(https?:)?\/\//.test(u)))];

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

function copy(rel, as = rel) {
  const dest = path.join(out, as);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(path.join(root, 'public', rel), dest);
}

// THE GUIDE IS THE SITE'S FRONT PAGE. Somebody handed a documentation
// hostname should meet the guide, not a directory listing or a 404.
copy('docs.html', 'index.html');
for (const a of ASSETS) copy(a);
for (const f of fontFiles) copy(path.posix.join('fonts', f));

// AND IT IS ALSO AT /docs, because that is where it lives on a deployment
// and every link anybody has ever written to it says /docs. A static host
// has no rewrite rules unless you give it some: this is a real file rather
// than a redirect, so it works on any host and needs no configuration.
copy('docs.html', 'docs/index.html');
copy('docs.html', 'docs.html');

// `robots.txt` rather than the page's own noindex meta, which stays as it is:
// the page carries `noindex` because on a DEPLOYMENT it is software
// documentation sitting on somebody's own domain. A documentation site is
// meant to be found, so the site says so at the site level and the page is
// left alone — editing the markup here is exactly what this build avoids.
fs.writeFileSync(path.join(out, 'robots.txt'), 'User-agent: *\nAllow: /\n');

// What this build is, for anybody who finds the directory without context.
const version = (page.match(/<span class="chip">([^<]+)<\/span>/) || [])[1] || 'unversioned';
fs.writeFileSync(path.join(out, 'BUILD.txt'),
  `Built from munsdev/reportlog by tools/make-docs-site.mjs\n`
  + `Guide version: ${version}\nBuilt: ${new Date().toISOString()}\n\n`
  + 'Do not edit these files. They are generated from public/docs.html and\n'
  + 'overwritten on every build. Change the guide in the repository.\n');

const count = (d) => fs.readdirSync(d, { withFileTypes: true })
  .reduce((n, e) => n + (e.isDirectory() ? count(path.join(d, e.name)) : 1), 0);

console.log(`${path.relative(root, out)} — ${count(out)} files`);
console.log(`  guide ${version}, ${asked.length} asset paths resolved, ${fontFiles.length} fonts`);
console.log('  served at /, /docs and /docs.html');
