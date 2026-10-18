/**
 * Shared machinery for the browser tests.
 *
 * These check things the unit tests structurally cannot: that a control is
 * visible when focused, that choosing an answer does not move the page, that
 * a screen reader is told an error appeared. All of it needs a real browser
 * against a real server.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
export const AXE = fs.readFileSync(
  path.join(path.dirname(require.resolve('axe-core/package.json')), 'axe.min.js'), 'utf8',
);

export const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

export const BASE = arg('base', 'http://localhost:3000').replace(/\/$/, '');
export const PHONE = { width: 390, height: 844 };

export async function launch() {
  // CHROMIUM_PATH covers a machine where the browser is installed somewhere
  // Playwright does not look for it.
  return chromium.launch(
    process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  );
}

/** Every Content-Security-Policy refusal any page in the run reported. The
 *  policy refuses silently as far as the page is concerned — a blocked style
 *  attribute does nothing and throws nothing — so run.js fails the run on any. */
export const CSP_VIOLATIONS = [];

export async function open(browser, url, viewport = PHONE, before = null) {
  const page = await browser.newPage({ viewport });
  // Routes a test needs in place BEFORE the page's first request.
  if (before) await before(page);
  // The site loads its typefaces from Google. On a machine that cannot
  // reach them every page waits out a timeout, which turns a two minute
  // run into twenty. Refusing them changes nothing any of these tests look
  // at — none of them measure type.
  await page.route('**://*.google*/**', (r) => r.abort());
  await page.route('**://*.gstatic.com/**', (r) => r.abort());
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.pageErrors = errors;
  page.on('console', (m) => {
    if (/content security policy/i.test(m.text())) CSP_VIOLATIONS.push(`${page.url()} — ${m.text().slice(0, 160)}`);
  });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  return page;
}

/** One test run's results. Any failure makes the whole run exit non-zero. */
export class Report {
  constructor(name) {
    this.name = name;
    this.failures = [];
    this.passes = 0;
  }

  ok(what, condition, detail = '') {
    if (condition) {
      this.passes += 1;
      console.log(`  ok    ${what}`);
    } else {
      this.failures.push(what);
      console.log(`  FAIL  ${what}${detail ? ` — ${detail}` : ''}`);
    }
  }

  note(line) { console.log(`        ${line}`); }
}

// ---- driving the card form -------------------------------------------

export const card = (page) => page.$eval('.card.on', (e) => e.getAttribute('data-card'));
export const settle = (page) => page.waitForTimeout(250);

export async function next(page) {
  await page.click('#card-next');
  await settle(page);
}

export async function pick(page, label) {
  await page.click(`.card.on .picktile:has(b:text-is("${label}"))`);
  await settle(page);
}

/* ---- the report form's logbook --------------------------------------

   EVERY REPORT IS FILED THROUGH A LOGBOOK, so the form has nothing to show
   until one is open. What is open depends on the database the suite is aimed
   at, which a browser test has no business depending on — so the form tests
   are handed this logbook through the same interception the settings tests
   use for their endpoints. Everything past the network is the real page.

   The server's side of filing — the answers checked, the confirmation link,
   the seal — is walked for real by scripts/confirm-selftest.mjs. */
export const FIXTURE_LOGBOOK = {
  slug: 'browser-fixture',
  title: 'Polling place incidents',
  blurb: 'Something went wrong at a polling place.',
  state: 'open',
  accepting: true,
  acceptsFiles: true,
  fields: [
    { key: 'role', kind: 'choice_one', label: 'What was your role?', required: true,
      settings: { options: ['A voter', 'A poll worker', 'An observer'] } },
    { key: 'state', kind: 'place', label: 'Which state?', required: true,
      settings: { options: ['Ohio', 'Indiana'], allowOther: false } },
    { key: 'when', kind: 'date', label: 'What day was it?', required: true, settings: {} },
    { key: 'what', kind: 'choice_many', label: 'What happened?', required: true,
      settings: { options: ['Long lines', 'Equipment failure', 'Observer expelled',
        'Late opening', 'Untrained staff'] } },
    { key: 'stopped', kind: 'yes_no', label: 'Was anyone stopped from voting?', required: false,
      help: 'If you are not sure, leave it.', settings: {} },
    { key: 'account', kind: 'long_text', label: 'Tell us what happened', required: true,
      settings: { maxLength: 5000 } },
  ],
  filters: [],
};

export const SECOND_LOGBOOK = {
  slug: 'browser-second',
  title: 'Something else entirely',
  blurb: 'A second logbook, so there is a choice to make.',
  state: 'open',
  accepting: true,
  acceptsFiles: false,
  fields: [
    { key: 'note', kind: 'short_text', label: 'What is it?', required: true, settings: { maxLength: 200 } },
  ],
  filters: [],
};

const json = (body, status = 200) => (route) => route.fulfill({
  status, contentType: 'application/json', body: JSON.stringify(body),
});

/**
 * Put these logbooks on the form. `posted` collects every report body the
 * form sends, which is answered the way the server answers a good one.
 */
export async function withLogbooks(page, logbooks = [FIXTURE_LOGBOOK], posted = []) {
  await page.route((u) => u.pathname === '/api/logbooks', json(logbooks.map((l) => ({
    slug: l.slug, title: l.title, blurb: l.blurb, state: l.state, questions: l.fields.length,
  }))));
  for (const l of logbooks) {
    await page.route((u) => u.pathname === `/api/logbooks/${l.slug}`, json(l));
  }
  await page.route((u) => u.pathname === '/api/reports/intake',
    json({ open: logbooks.length > 0, switchOpen: true, logbooks: logbooks.length }));
  await page.route((u) => u.pathname === '/api/reports', (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    posted.push(JSON.parse(route.request().postData() || '{}'));
    return json({ ok: true, pending: true }, 202)(route);
  });
  return posted;
}

/** The form, with logbooks on it. */
export async function openForm(browser, { logbooks, posted, viewport } = {}) {
  const page = await open(browser, `${BASE}/submit`, viewport || PHONE,
    (p) => withLogbooks(p, logbooks, posted));
  await page.waitForTimeout(300);
  return page;
}

/** Answer whatever question the current card asks, with its first choice. */
export async function answerCard(page) {
  const on = await page.$('.card.on');
  const radio = await on.$('input[type=radio]');
  if (radio) {
    const id = await radio.getAttribute('id');
    await page.click(`label[for="${id}"]`);
  } else if (await on.$('.ticks input[type=checkbox]')) {
    await page.check('.card.on .ticks input[type=checkbox]');
  } else if (await on.$('input[type=date]')) {
    await page.fill('.card.on input[type=date]', '2026-11-03');
  } else if (await on.$('textarea')) {
    await page.fill('.card.on textarea', 'An account long enough to say what happened.');
  } else if (await on.$('input[type=text]')) {
    await page.fill('.card.on input[type=text]', 'An answer');
  }
  await settle(page);
}

/**
 * Off the opening card and past the logbook chooser, which is only asked
 * when more than one logbook is open.
 */
export async function pastIntro(page) {
  await next(page);
  if ((await card(page)) === 'logbook') {
    await pick(page, FIXTURE_LOGBOOK.title);
    await next(page);
  }
}

/**
 * Walk the form as far as the named card, answering each question on the
 * way with its first choice. Saves every test re-writing the same steps.
 */
export async function walkTo(page, target) {
  await pastIntro(page);
  for (let i = 0; i < 30; i += 1) {
    const here = await card(page);
    if (here === target || here === 'send') return;
    if (here !== 'publish') await answerCard(page);
    await next(page);
  }
}

/** Run axe against one element, returning violation summaries. */
export async function axeOn(page, selector) {
  await page.evaluate(AXE);
  const result = await page.evaluate(async (sel) => {
    const el = sel ? document.querySelector(sel) : document;
    return window.axe.run(el, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] });
  }, selector);
  return result.violations.map((v) => `[${v.impact}] ${v.id} (${v.nodes.length})`);
}
