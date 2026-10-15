/**
 * Runs every browser test against a running app. Exits non-zero if anything
 * failed, so this can be trusted rather than read.
 *
 *   node run.js --base=http://localhost:3000
 */
import { BASE, launch, CSP_VIOLATIONS } from './lib.js';
import form from './form.test.js';
import nav from './nav.test.js';
import site from './site.test.js';
import setup from './setup.test.js';
import alliance from './alliance.test.js';
import settings from './settings.test.js';
import updates from './updates.test.js';
import docsPage from './docs-page.test.js';
import invitations from './invitations.test.js';
import branding from './branding.test.js';
import logbook from './logbook.test.js';
import staff from './staff.test.js';
import styleguide from './styleguide.test.js';
import permissions from './permissions.test.js';
import login from './login.test.js';
import proseScreens from './prose-screens.test.js';
import toggles from './toggles.test.js';
import conditions from './conditions.test.js';
import logbookBuilder from './logbook-builder.test.js';
import serviceWorker from './service-worker.test.js';
import evidence from './evidence.test.js';
import lists from './lists.test.js';
import map from './map.test.js';
import homeButtons from './home-buttons.test.js';
import adminMaps from './admin-maps.test.js';

const SUITES = [form, conditions, logbookBuilder, evidence, nav, site, setup, alliance, settings, updates, docsPage, invitations, branding, logbook, staff, styleguide, permissions, login, proseScreens, toggles, serviceWorker, lists, map, homeButtons, adminMaps];

const browser = await launch();
console.log(`Testing ${BASE}\n`);

let passes = 0;
const failures = [];
for (const suite of SUITES) {
  let report;
  try {
    report = await suite(browser);
  } catch (err) {
    console.log(`  FAIL  the suite itself threw — ${err.message}`);
    failures.push(`suite crashed: ${err.message}`);
    continue;
  }
  console.log(`── ${report.name}: ${report.passes} passed, ${report.failures.length} failed\n`);
  passes += report.passes;
  failures.push(...report.failures.map((f) => `${report.name}: ${f}`));
}
await browser.close();

if (CSP_VIOLATIONS.length) {
  const uniq = [...new Set(CSP_VIOLATIONS)];
  console.log(`  FAIL  the Content-Security-Policy refused something ${CSP_VIOLATIONS.length} time(s)`);
  uniq.slice(0, 10).forEach((v) => console.log(`        ${v}`));
  failures.push(`the policy refused something: ${uniq[0]}`);
}

console.log(`${passes} passed, ${failures.length} failed`);
if (failures.length) {
  failures.forEach((f) => console.log(`  ${f}`));
  process.exit(1);
}
