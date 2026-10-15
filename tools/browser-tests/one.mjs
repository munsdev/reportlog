/**
 * ONE SUITE, BY NAME. `run.js` runs all of them and takes the better part
 * of half an hour in a container, which is the right thing before shipping
 * and the wrong thing when you have changed one file.
 *
 *     CHROMIUM_PATH=$(ls -d /opt/pw-browsers/chromium-*\/chrome-linux/chrome | head -1) \
 *       node one.mjs updates
 *
 * The argument is the suite's filename without `.test.js`.
 *
 * NOT A SUBSTITUTE FOR run.js, and it exists because of a mistake worth
 * recording: a long run plus an impatient edit means the runner has the
 * OLD test file in memory, so it reports on code that is no longer there.
 * That happened twice in one session, and both times the fix was to start
 * over and wait. Use this to iterate, then run the whole thing once and
 * believe only that.
 *
 * It needs the same running, unlocked, set-up deployment run.js needs —
 * tools/browser-tests/README.md has the one-line UPDATE that prepares a
 * development database.
 */
import { launch, BASE, CSP_VIOLATIONS } from './lib.js';

const name = process.argv[2];
if (!name) {
  process.stdout.write('usage: node one.mjs <suite>   (e.g. node one.mjs updates)\n');
  process.exit(2);
}

const suite = (await import(`./${name}.test.js`)).default;
const browser = await launch();
process.stdout.write(`Testing ${BASE}\n\n`);
const r = await suite(browser);
await browser.close();

process.stdout.write(`── ${r.name}: ${r.passes} passed, ${r.failures.length} failed\n`);
r.failures.forEach((f) => process.stdout.write(`  FAIL ${f}\n`));

/* The policy refuses silently as far as the page is concerned — a blocked
   style attribute does nothing and throws nothing — so a refusal has to
   fail the run here exactly as it does in run.js. */
if (CSP_VIOLATIONS.length) {
  const uniq = [...new Set(CSP_VIOLATIONS)];
  process.stdout.write(`  FAIL  the Content-Security-Policy refused something ${CSP_VIOLATIONS.length} time(s)\n`);
  uniq.slice(0, 10).forEach((v) => process.stdout.write(`        ${v}\n`));
}

process.exit(r.failures.length || CSP_VIOLATIONS.length ? 1 : 0);
