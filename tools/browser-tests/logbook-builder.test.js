/**
 * The condition picker in the logbook builder.
 *
 * WHY THIS IS SEPARATE FROM conditions.test.js. That one is a reporter
 * walking a form that already has a conditional question. This one is the
 * operator putting the condition there, which is a different screen, a
 * different risk, and the half nothing covered: the admin builder has no
 * suite of its own, and settings.test.js stops at the settings panels.
 *
 * Everything past the network is the real page. The endpoints are stubbed
 * because pointing this at a real logbook would make it pass or fail on
 * whatever happens to be in whichever database it is aimed at — the same
 * reasoning logbook.test.js states.
 */
import { BASE, Report } from './lib.js';

const json = (body, status = 200) => (route) => route.fulfill({
  status, contentType: 'application/json', body: JSON.stringify(body),
});

const ADMIN = {
  id: '1', email: 'admin@example.org', role: 'admin', is_tester: false, memberships: [],
};

const FIELD_TYPES = [
  { id: 'short_text', label: 'Short text', description: 'One line.', settings: {}, filterable: true },
  { id: 'yes_no', label: 'Yes or no', description: 'A plain either-or.', settings: {}, filterable: true },
  { id: 'choice_one', label: 'Choose one', description: 'A list.', settings: { options: [] }, filterable: true },
  { id: 'file', label: 'Photos, video or documents', description: 'A place to attach files.', settings: {}, filterable: false },
];

/* A draft with a yes/no question and a list, so the picker has two things to
   offer, plus a long_text one it must NOT offer. */
const DRAFT = {
  id: 4,
  slug: 'builder-draft',
  title: 'A draft being built',
  blurb: 'Still a draft.',
  state: 'draft',
  launched_at: null,
  accepts_files: false,
  files_frozen_at: null,
  opens_at: null,
  closes_at: null,
  closed_at: null,
  fields: [
    { id: 11, key: 'has_files', kind: 'yes_no', label: 'Do you have photos or video?', required: true, filterable: false, settings: {}, shown_when: null, position: 0 },
    { id: 12, key: 'what', kind: 'choice_one', label: 'What went wrong?', required: true, filterable: true, settings: { options: ['Long lines', 'Turned away'] }, shown_when: null, position: 1 },
    { id: 13, key: 'account', kind: 'long_text', label: 'Tell us what happened', required: false, filterable: false, settings: {}, shown_when: null, position: 2 },
  ],
};

export default async function run(browser) {
  const r = new Report('the logbook builder');
  const posted = [];

  const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.route('**://*.google*/**', (route) => route.abort());
  await page.route('**://*.gstatic.com/**', (route) => route.abort());
  await page.route('**/api/auth/me', json(ADMIN));
  await page.route('**/api/admin/logbooks/field-types', json(FIELD_TYPES));
  await page.route((u) => /\/api\/admin\/logbooks$/.test(u.pathname), json([DRAFT]));
  await page.route((u) => /\/api\/admin\/logbooks\/4$/.test(u.pathname), json(DRAFT));
  await page.route((u) => /\/api\/admin\/logbooks\/4\/fields$/.test(u.pathname), (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    posted.push(JSON.parse(route.request().postData() || '{}'));
    return json({ id: 99 }, 201)(route);
  });

  await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);

  // Open the logbook's questions, exactly as a person does.
  const opened = await page.evaluate(() => {
    const b = document.querySelector('[data-lb-open="4"]');
    if (!b) return false;
    b.click();
    return true;
  });
  r.ok('the draft can be opened for editing', opened,
    'the builder\'s open button was not found — the list may not have rendered');
  await page.waitForTimeout(900);

  const visible = (sel) => page.$eval(sel, (e) => e.offsetParent !== null).catch(() => false);

  r.ok('the condition picker is offered on a draft', await visible('#lb-field-when-wrap'));

  const opts = await page.$$eval('#lb-field-when option',
    (list) => list.map((o) => ({ value: o.value, text: o.textContent })));
  r.ok('it offers "always" first, so the default is to ask everybody',
    opts[0] && opts[0].value === '' && /Always/i.test(opts[0].text), JSON.stringify(opts[0]));
  r.ok('it offers the yes/no question and the list',
    opts.some((o) => o.value === 'has_files') && opts.some((o) => o.value === 'what'),
    JSON.stringify(opts));
  r.ok('AND IT DOES NOT OFFER THE FREE-PROSE QUESTION',
    !opts.some((o) => o.value === 'account'),
    'a condition over typed text is refused by the server; it must not be offered here');

  // Pick the yes/no question: its two answers should appear to tick.
  await page.selectOption('#lb-field-when', 'has_files');
  await page.waitForTimeout(300);
  r.ok('choosing a question reveals the answers to match', await visible('#lb-field-when-values'));
  const ticks = await page.$$eval('#lb-field-when-options [data-lb-when-value]',
    (list) => list.map((i) => i.getAttribute('data-lb-when-value')));
  r.ok('a yes/no question offers yes and no', ticks.join(',') === 'yes,no', ticks.join(','));

  // And a list offers its own options, not yes/no.
  await page.selectOption('#lb-field-when', 'what');
  await page.waitForTimeout(300);
  const listTicks = await page.$$eval('#lb-field-when-options [data-lb-when-value]',
    (list) => list.map((i) => i.getAttribute('data-lb-when-value')));
  r.ok('and a list offers its own choices', listTicks.join(',') === 'Long lines,Turned away',
    listTicks.join(','));

  // Now actually add a conditional question and check what is sent.
  await page.selectOption('#lb-field-kind', 'short_text');
  await page.waitForTimeout(200);
  await page.fill('#lb-field-label', 'What is it of?');
  await page.selectOption('#lb-field-when', 'has_files');
  await page.waitForTimeout(250);
  await page.check('#lb-field-when-options [data-lb-when-value="yes"]');
  await page.click('#lb-field-add');
  await page.waitForTimeout(600);

  r.ok('the question is sent', posted.length === 1, JSON.stringify(posted));
  r.ok('AND IT CARRIES THE CONDITION IN THE SHAPE THE SERVER WANTS',
    posted[0] && posted[0].shown_when
      && posted[0].shown_when.field === 'has_files'
      && Array.isArray(posted[0].shown_when.in)
      && posted[0].shown_when.in.join(',') === 'yes',
    JSON.stringify(posted[0] && posted[0].shown_when));

  // After adding, the picker goes back to "always": leaving it set is how
  // somebody adds three questions and finds two conditional by accident.
  r.ok('and the picker resets to "always" afterwards',
    (await page.$eval('#lb-field-when', (e) => e.value)) === '');

  // An upload question cannot carry a condition, so the control goes away
  // rather than refusing after the press.
  await page.selectOption('#lb-field-kind', 'file');
  await page.waitForTimeout(300);
  r.ok('THE PICKER IS HIDDEN FOR AN UPLOAD QUESTION',
    !(await visible('#lb-field-when-wrap')),
    'its card is not built from the questions, so a condition would be sealed and applied to nobody');

  await page.selectOption('#lb-field-kind', 'short_text');
  await page.waitForTimeout(300);
  r.ok('and comes back for an ordinary one', await visible('#lb-field-when-wrap'));

  // Nothing posted without a value ticked: an empty condition is "always",
  // not a broken one.
  posted.length = 0;
  await page.fill('#lb-field-label', 'Asked of everybody');
  await page.selectOption('#lb-field-when', 'has_files');
  await page.waitForTimeout(250);
  await page.click('#lb-field-add');
  await page.waitForTimeout(600);
  r.ok('a condition with nothing ticked sends no condition at all',
    posted.length === 1 && !('shown_when' in posted[0]),
    JSON.stringify(posted[0]));

  r.ok('no uncaught errors in the builder', errors.length === 0, errors.join(' | '));
  await page.close();

  /* ---- a logbook's own upload limits ---------------------------------
     EIGHT NUMBERS AND THREE LAYERS, and the whole job of the panel is to
     keep "I set this" and "I inherited this" apart. An operator shown only
     the effective number cannot tell them apart, and the first thing they
     do then is type all eight of the numbers already showing — which
     silently freezes the logbook against every later change to the site.
     So an inherited value is the PLACEHOLDER and an empty box means
     inherit, and both halves are checked here.

     The resolution itself is scripts/evidence-caps-selftest.mjs and
     scripts/upload-limits-selftest.mjs against a real database. What is
     only true on screen is this. */
  {
    const page2 = await browser.newPage({ viewport: { width: 420, height: 900 } });
    const errs2 = [];
    page2.on('pageerror', (e) => errs2.push(String(e)));
    await page2.route('**://*.google*/**', (route) => route.abort());
    await page2.route('**://*.gstatic.com/**', (route) => route.abort());
    await page2.route('**/api/auth/me', json(ADMIN));
    await page2.route('**/api/admin/logbooks/field-types', json(FIELD_TYPES));

    // A LAUNCHED logbook that asks for files. Launched on purpose: a limit
    // is not a question, so it stays settable after the one-way door — and
    // a cap that could only be set before launch could never be corrected
    // on the night it turned out to be wrong.
    const LIVE = {
      ...DRAFT, id: 5, slug: 'live-book', title: 'A launched logbook',
      state: 'launched', launched_at: '2026-10-01T00:00:00.000Z', accepts_files: true,
    };
    await page2.route((u) => /\/api\/admin\/logbooks$/.test(u.pathname), json([LIVE]));
    await page2.route((u) => /\/api\/admin\/logbooks\/5$/.test(u.pathname), json(LIVE));

    const L = (lb, site, shipped, eff, src) => ({
      logbook: lb, site, shipped, effective: eff, source: src,
    });
    const limPosted = [];
    await page2.route((u) => /\/api\/admin\/logbooks\/5\/limits$/.test(u.pathname), (route) => {
      if (route.request().method() === 'POST') {
        limPosted.push(JSON.parse(route.request().postData() || '{}'));
        return json({ ...LIVE, limits: {} })(route);
      }
      return json({
        limits: {
          // Three provenances on purpose, one per layer.
          maxImageBytes: L(null, null, 26214400, 26214400, 'shipped'),
          maxVideoBytes: L(20971520, 52428800, 157286400, 20971520, 'logbook'),
          maxAudioBytes: L(null, 62914560, 62914560, 62914560, 'site'),
          maxDocumentBytes: L(null, null, 31457280, 31457280, 'shipped'),
          maxVideoSeconds: L(30, null, 180, 30, 'logbook'),
          maxDocumentPages: L(null, null, 40, 40, 'shipped'),
          maxFiles: L(1, null, 10, 1, 'logbook'),
          maxTotalBytes: L(null, null, 419430400, 419430400, 'shipped'),
          kinds: L(['photo', 'video'], null,
            ['photo', 'video', 'audio', 'document'], ['photo', 'video'], 'logbook'),
        },
        ranges: {},
        acceptsFiles: true,
        filesFrozen: false,
      })(route);
    });

    await page2.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
    await page2.waitForTimeout(1200);
    const opened2 = await page2.evaluate(() => {
      const b = document.querySelector('[data-lb-open="5"]');
      if (!b) return false;
      b.click();
      return true;
    });
    r.ok('a launched logbook opens for editing', opened2);
    await page2.waitForTimeout(1200);

    const vis = (sel) => page2.$eval(sel, (e) => e.offsetParent !== null).catch(() => false);

    r.ok('THE LIMITS ARE SETTABLE ON A LAUNCHED LOGBOOK',
      await vis('#lb-limits-wrap'),
      'a limit is not a question, so the one-way door does not close on it');

    // Megabytes on the page, bytes in the column. One conversion, at the
    // edge, rather than in four places that would each round differently.
    r.ok('a number this logbook set shows in its box, in megabytes',
      (await page2.$eval('#lblim-maxVideoBytes', (e) => e.value)) === '20');
    r.ok('and one it did not is left EMPTY rather than filled in',
      (await page2.$eval('#lblim-maxAudioBytes', (e) => e.value)) === '',
      'a box pre-filled with an inherited number is how an operator freezes a logbook by accident');
    r.ok("with what it would inherit as the box's placeholder",
      (await page2.$eval('#lblim-maxAudioBytes', (e) => e.placeholder)) === '60');
    r.ok('and the SHIPPED number where the site has set nothing either',
      (await page2.$eval('#lblim-maxImageBytes', (e) => e.placeholder)) === '25');

    // Said in words, because 'site' and 'logbook' are labels an operator
    // has to decode and a sentence is not.
    const note = (key) => page2.textContent(`#lb-limits-wrap .limsrc[data-key="${key}"]`);
    r.ok('each row says which layer the number in force came from',
      /Set on this logbook: 20/.test(await note('maxVideoBytes'))
      && /From the site: 60/.test(await note('maxAudioBytes'))
      && /Not set anywhere, so 25/.test(await note('maxImageBytes')),
      [await note('maxVideoBytes'), await note('maxAudioBytes'), await note('maxImageBytes')].join(' // '));

    const state = (await page2.textContent('#lblim-state')) || '';
    r.ok('and the panel counts how many this logbook owns',
      /3 of 8 set on this logbook/.test(state), state);

    // A SAVE CARRIES THE WHOLE LAYER. Sending only the boxes somebody
    // touched would make an emptied box indistinguishable from one never
    // visited, and emptying is how a limit is cleared.
    await page2.fill('#lblim-maxFiles', '2');
    await page2.click('#lblim-save');
    await page2.waitForTimeout(700);
    r.ok('saving sends the typed number as bytes',
      limPosted.length === 1 && limPosted[0].maxFiles === 2
      && limPosted[0].maxVideoBytes === 20 * 1024 * 1024,
      JSON.stringify(limPosted[0]));
    r.ok('AND SENDS AN EMPTY BOX AS null, which is how a limit is cleared',
      limPosted[0].maxAudioBytes === null,
      'an omitted key leaves the stored value alone, so empty has to be explicit');

    // Not a number: refused on the page, before the server sees it, and the
    // box itself marked so somebody knows which of eight is wrong.
    await page2.fill('#lblim-maxFiles', 'lots');
    await page2.click('#lblim-save');
    await page2.waitForTimeout(400);
    r.ok('a limit that is not a number is refused on the page',
      limPosted.length === 1, 'it was sent anyway');
    r.ok('and says so where somebody will see it', await vis('#lblim-err'),
      (await page2.textContent('#lblim-err')) || '');
    r.ok('and marks the box that is wrong',
      await page2.$eval('#lblim-maxFiles', (e) => e.classList.contains('is-invalid')));

    // "Use the site's numbers" CLEARS the layer rather than writing today's
    // numbers into it: an operator pressing it wants to stop choosing.
    await page2.fill('#lblim-maxFiles', '2');
    await page2.click('#lblim-reset');
    await page2.waitForTimeout(700);
    const last = limPosted[limPosted.length - 1];
    r.ok('"use the site\'s numbers" clears every one of them',
      limPosted.length === 2 && Object.keys(last).length === 8
      && Object.values(last).every((v) => v === null),
      JSON.stringify(last));

    r.ok('no uncaught errors on the limits panel', errs2.length === 0, errs2.join(' | '));
    await page2.close();
  }

  return r;
}
