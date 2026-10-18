/**
 * The install guide as ONE FILE you can hand somebody.
 *
 *   node tools/make-handout.mjs [out.html]
 *
 * Takes public/docs.html, inlines its stylesheet and its script, drops the
 * two links that would reach the network, and writes a single self-contained
 * page. Default output is var/handout-standing-up-reportlog.html.
 *
 * WHY THIS FILE EXISTS, which is the only interesting thing about it. The
 * handout was first built on 7 October by a script that lived in a session's
 * scratchpad, and the scratchpad does not survive the session. The script was
 * eight lines and regenerating it is trivial; THE TRAP IT RECORDED IS NOT,
 * and that is what was actually lost. So it lives here now.
 *
 * ──────────────────────────────────────────────────────────────────────
 * THE TRAP: A REPLACEMENT STRING IS NOT A STRING.
 *
 * The original was Python, and it used `re.sub` with the contents of
 * docs-page.js as the replacement. Python reads `\d`, `\/` and `\1` in a
 * replacement as escapes and backreferences, so the injected JavaScript came
 * out mangled — and the specific damage was that `buildCopyButtons` never
 * ran. The page shipped with ZERO COPY BUTTONS and one console error that
 * named nothing a reader would connect to it. Everything looked fine.
 *
 * JAVASCRIPT HAS THE SAME TRAP WEARING A DIFFERENT HAT. In
 * `String.prototype.replace`, a `$&`, `` $` ``, `$'` or `$1` inside the
 * replacement string is substituted, not inserted. docs-page.js is full of
 * `$` — every DOM helper in it — so passing it as a replacement string is
 * the same bug in a different language.
 *
 * SO EVERY REPLACEMENT HERE IS A FUNCTION. A function's return value is
 * inserted literally, with no escape processing of any kind, in both
 * languages. That is the whole defence, and it is why this file does not
 * use a regular expression anywhere it is inserting a file's contents.
 * ──────────────────────────────────────────────────────────────────────
 *
 * AND IT CHECKS ITS OWN WORK, because the failure above was invisible. A
 * handout with no copy buttons, no `data-when` engine or an unreplaced
 * `<link>` is refused rather than written.
 *
 * THE LIVE PAGE AT /docs IS CANONICAL. This is a snapshot: it carries a
 * version and a date, and says so at the top, because a guide handed out as
 * a file is the kind of thing somebody still has in six months.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const out = process.argv[2] || 'var/handout-standing-up-reportlog.html';

let page = read('public/docs.html');
const css = read('public/css/docs-page.css');
const js = read('public/js/docs-page.js');

/**
 * Replace one exact literal, once, and complain if it is not there.
 *
 * NOT A REGULAR EXPRESSION, and the replacement is a FUNCTION — see the
 * trap at the top of this file. `indexOf` and `slice` cannot interpret
 * anything in either half.
 *
 * Refuses a target it cannot find rather than carrying on: every one of
 * these is a thing the handout would otherwise try to fetch off a server
 * the reader does not have.
 */
function swap(what, find, replace) {
  const at = page.indexOf(find);
  if (at < 0) {
    console.error(`could not find the ${what} in public/docs.html — looked for:\n  ${find}`);
    console.error('The page has changed shape. Fix this script rather than the page.');
    process.exit(1);
  }
  page = page.slice(0, at) + replace() + page.slice(at + find.length);
}

// The fonts and the favicon both reach the network, and a handout is read on
// a laptop beside a server rack. The page's own CSS names a fallback stack.
swap('favicon link', '<link rel="icon" href="/icons/favicon-32.png">',
  () => '<!-- favicon dropped: a handout fetches nothing -->');
swap('fonts link', '<link rel="stylesheet" href="/fonts/fonts.css">',
  () => '<!-- webfonts dropped: the stylesheet below names a fallback stack -->');
swap('stylesheet link', '<link rel="stylesheet" href="/css/docs-page.css">',
  () => `<style>\n${css}\n</style>`);
swap('script tag', '<script src="/js/docs-page.js"></script>',
  () => `<script>\n${js}\n</script>`);

// What this copy is, said at the top where somebody reading it in six months
// will see it. The live page is the one that gets corrected.
const stamp = new Date().toISOString().slice(0, 10);
const version = (page.match(/<span class="chip">([^<]+)<\/span>/) || [])[1] || 'unversioned';
swap('header bar', '<span class="f">standing up a deployment</span>',
  () => '<span class="f">standing up a deployment</span>\n'
    + `  <span class="f">snapshot of ${version}, ${stamp} — `
    + 'the copy at /docs on any deployment is the current one</span>');

/* ---- and then check it, because the original failure was silent ---- */
const problems = [];
if (/(?:src|href)="\//.test(page)) problems.push('something still points at a server path');
if (!page.includes('buildCopyButtons')) problems.push('the copy buttons are not in the page');
if (!page.includes('data-when')) problems.push('the branching engine is not in the page');
if (!page.includes('<style>')) problems.push('the stylesheet was not inlined');
// The exact shape of the original bug: `$&` or `$1` left behind where a file
// was inserted means something interpreted the replacement after all.
if (/\$&|\$`|\$'/.test(js) && !page.includes(js.slice(0, 200))) {
  problems.push('the script was altered on its way in — see the trap at the top of this file');
}
if (problems.length) {
  console.error('the handout is broken and was NOT written:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

// Resolved against the repository root, so the default `var/...` lands
// there wherever this was run from — and an absolute path given on the
// command line is honoured as given.
const target = path.resolve(root, out);
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, page);
console.log(`${out} — ${(page.length / 1024).toFixed(0)} KB, self-contained, ${version} as of ${stamp}`);
