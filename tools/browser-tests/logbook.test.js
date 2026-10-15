/**
 * A report filed through a logbook, in a browser.
 *
 * WHY THIS IS ITS OWN FILE. form.test.js walks the fixture logbook for what
 * a card does; this one walks every KIND of question a logbook can ask. The
 * cards are generated at runtime from what the server says the logbook asks,
 * so nothing here can be checked against the markup — only against what a
 * reporter actually sees and what the form ends up posting.
 *
 * THE LOGBOOK IS STUBBED, deliberately. Pointing this at a real logbook
 * would make it pass or fail on whatever happens to be in the database of
 * whichever instance it is aimed at.
 */
import {
  BASE, Report, card, next, pick, settle, open, withLogbooks, PHONE, SECOND_LOGBOOK,
} from './lib.js';

/* lib.js keeps its own copy and does not export it; settings.test.js does the
   same. One line is cheaper than widening the shared module's surface. */
const json = (body, status = 200) => (route) => route.fulfill({
  status, contentType: 'application/json', body: JSON.stringify(body),
});

const LOGBOOK = {
  slug: 'munich-2026',
  title: 'Munich, November 2026',
  blurb: 'Incidents at the Munich count.',
  state: 'open',
  accepting: true,
  acceptsFiles: false,
  opensAt: null,
  closesAt: null,
  fields: [
    { key: 'where_it_happened', kind: 'place', label: 'Where did it happen?',
      help: 'The polling station or street.', required: true,
      settings: { options: [], allowOther: true } },
    { key: 'when_it_happened', kind: 'datetime', label: 'When did it happen?',
      help: null, required: true, settings: {} },
    { key: 'what_kind', kind: 'choice_one', label: 'What kind of thing was it?',
      help: null, required: true, settings: { options: ['Access', 'Conduct', 'Paperwork'] } },
    { key: 'who_was_there', kind: 'choice_many', label: 'Who was there?',
      help: null, required: false, settings: { options: ['Staff', 'Police', 'Observers'] } },
    { key: 'anyone_hurt', kind: 'yes_no', label: 'Was anyone hurt?',
      help: null, required: false, settings: {} },
    { key: 'how_many', kind: 'number', label: 'How many people were affected?',
      help: null, required: false, settings: {} },
  ],
  filters: [],
};

/* Uploads switched on at the DEPLOYMENT level.
 *
 * WHY THIS HAS TO BE STUBBED. Three things gate an upload and only two of
 * them are the logbook's: it has to ask for files, nobody may have frozen it,
 * and the site has to have somewhere to put them. The third is
 * /api/uploads/config, which 404s on any instance without object storage
 * configured — every development container — so without this the upload cards
 * never appear however the logbook is built, and a test that asserted they do
 * would fail for a reason that has nothing to do with the logbook.
 *
 * The shape is the real route's (src/routes/uploads.js), because the form
 * reads the limits out of it to write its own caption. */
const UPLOADS_ON = {
  enabled: true,
  kinds: ['photo', 'video'],
  allowedTypes: ['image/jpeg', 'image/png', 'video/mp4'],
  maxFileBytes: 104857600,
  maxImageBytes: 26214400,
  maxVideoBytes: 104857600,
  maxVideoSeconds: 180,
  maxFiles: 10,
  maxTotalBytes: 209715200,
};

/* Arrives at the form that asks WHICH LOGBOOK, which is what this suite is
 * about.
 *
 * STRAIGHT TO /submit, AND NOT VIA THE HOME PAGE'S BUTTON ANY MORE. The
 * front page no longer carries a generic "Submit a Report": it names each
 * open logbook, one button each, because the page that button led to
 * existed only to ask which one (src/homeButtons.js). So the home page is
 * no longer a route to this pane for a deployment that has logbooks, and
 * clicking a logbook's own button opens that logbook's form with the
 * choosing card already answered — which is a different screen from the
 * one tested here.
 *
 * `uploads` switches the deployment's own file storage on for this page. It is
 * off by default so the tests that do not care about files keep exercising the
 * ordinary case, which is also what a container without storage really does. */
async function openForm(browser, logbooks, { uploads = false } = {}) {
  const posted = [];
  const page = await open(browser, `${BASE}/submit`, PHONE, async (p) => {
    if (uploads) await p.route((u) => u.pathname === '/api/uploads/config', json(UPLOADS_ON));
    await withLogbooks(p, logbooks, posted);
  });
  page.errors = page.pageErrors;
  page.sent = posted;
  await page.waitForTimeout(700);
  return page;
}

export default async function run(browser) {
  const r = new Report('filing through a logbook');

  /* ---- the chooser ---------------------------------------------------- */
  const page = await openForm(browser, [LOGBOOK, SECOND_LOGBOOK]);
  await next(page);
  r.ok('with more than one open, the reporter chooses', (await card(page)) === 'logbook', await card(page));

  const tiles = await page.$$eval('.card.on .picktile b', (e) => e.map((x) => x.textContent));
  r.ok('the logbook is on the list by its title',
    tiles.includes('Munich, November 2026'), JSON.stringify(tiles));
  // Every report is filed through a logbook: there is no general form to
  // fall back to beside them.
  r.ok('and there is no general form beside the logbooks',
    !tiles.includes('Something else'), JSON.stringify(tiles));

  await pick(page, 'Munich, November 2026');
  await page.waitForTimeout(700);
  await next(page);

  /* ---- its questions, in its order ------------------------------------ */
  const seen = [];
  for (let i = 0; i < 8; i += 1) {
    const here = await card(page);
    if (!here.startsWith('lbf-')) break;
    seen.push(here);
    const key = here.slice(4);
    if (key === 'where_it_happened') await page.fill('#lbf-where_it_happened', 'Polling station 12');
    if (key === 'when_it_happened') await page.fill('#lbf-when_it_happened', '2026-11-03T09:30');
    if (key === 'what_kind') await pick(page, 'Access');
    if (key === 'who_was_there') {
      // Ticked in the OPPOSITE order to the operator's, to prove the form
      // does not invent an order of its own.
      await page.check('#lbf-who_was_there-2');
      await page.check('#lbf-who_was_there-0');
      await settle(page);
    }
    if (key === 'anyone_hurt') await pick(page, 'No');
    if (key === 'how_many') await page.fill('#lbf-how_many', '3');
    await next(page);
  }
  r.ok('every question the logbook asks gets its own card, in its order',
    seen.join(',') === LOGBOOK.fields.map((f) => `lbf-${f.key}`).join(','), seen.join(','));

  // THE BUILT-IN QUESTIONS ARE GONE. The logbook's questions are the report.
  r.ok('and there are no built-in ones',
    !seen.some((s2) => ['reporter', 'where', 'when', 'saw', 'category', 'impact', 'narrative'].includes(s2)),
    seen.join(','));
  r.ok('a logbook that takes no files goes straight to the publication question',
    (await card(page)) === 'publish', await card(page));

  /* ---- the spine still applies ---------------------------------------- */
  await pick(page, 'Yes, it may be published');
  await next(page);
  r.ok('and the form still ends at the review', (await card(page)) === 'send', await card(page));

  const review = ((await page.textContent('#review-box')) || '').replace(/\s+/g, ' ');
  r.ok('the review names the logbook', /Munich, November 2026/.test(review), review.slice(0, 160));
  r.ok('and lists the logbook’s own questions',
    /Where did it happen\?/.test(review) && /What kind of thing was it\?/.test(review),
    review.slice(0, 300));
  // A review listing "Where — Not answered" for a form that never asked
  // where would be the same lie the seal refuses to tell.
  r.ok('and none of the questions nobody was put',
    !/Reporting as|Anyone unable to vote/.test(review), review.slice(0, 300));
  r.ok('a datetime reads as a date, not as the UTC the seal stores',
    !/T09:30:00/.test(review) && /Nov 3, 2026/.test(review), review.slice(0, 300));

  /* ---- what it posts -------------------------------------------------- */
  await page.fill('#rEmail', 'reporter@example.org');
  await page.check('#consent');
  await settle(page);
  await next(page);
  await page.waitForTimeout(800);

  const body = page.sent[0] || {};
  r.ok('it posts the logbook by slug', body.logbook === 'munich-2026', JSON.stringify(body).slice(0, 200));
  r.ok('and every answer under the field’s own key',
    body.answers?.where_it_happened === 'Polling station 12'
    && body.answers?.what_kind === 'Access'
    && body.answers?.anyone_hurt === 'no'
    && body.answers?.how_many === '3',
    JSON.stringify(body.answers));
  r.ok('a datetime is posted as UTC, which is what gets sealed',
    /^2026-11-03T\d\d:30:00\.000Z$/.test(body.answers?.when_it_happened || ''),
    String(body.answers?.when_it_happened));

  // NOT ONE OF THE BUILT-IN KEYS. A body carrying observer_status alongside
  // a logbook is a body that disagrees with itself.
  const builtIn = ['observer_status', 'states', 'incident_date', 'categories',
    'direct_or_secondhand', 'severity', 'site', 'source_kind', 'narrative'];
  r.ok('and none of the built-in keys at all',
    builtIn.every((k) => !(k in body)), Object.keys(body).join(','));
  // The spine is not optional and never was.
  r.ok('while the spine is all there, and no written account is built in',
    body.email === 'reporter@example.org' && body.consent === true
    && !('narrative' in body) && body.may_publish === true
    && typeof body.may_publish_digest === 'string', Object.keys(body).join(','));

  r.ok('no uncaught errors filing through a logbook',
    page.errors.length === 0, page.errors.join(' | '));
  await page.close();

  /* ---- an upload is a question ---------------------------------------- */
  {
    /* THE WHOLE POINT OF THE CHANGE, checked where a reporter meets it.
       A logbook takes files because it ASKS for them — it has a question of
       kind `file` — rather than because a switch beside its questions said so.
       The server resolves that, the freeze and the site's storage into one
       `acceptsFiles`, which is what the form is gated on.

       So: the question must NOT draw a text box of its own (it would be a
       second, wrong-shaped place to put a photo), must not appear as an empty
       row on the review card, and the upload cards must appear. */
    const WITH_FILES = {
      ...LOGBOOK,
      slug: 'munich-files',
      title: 'Munich, with photographs',
      acceptsFiles: true,
      fields: [
        LOGBOOK.fields[0],
        { key: 'attachments', kind: 'file', label: 'Photos, video or documents',
          help: null, required: false, settings: {} },
      ],
    };
    const p2 = await openForm(browser, [WITH_FILES], { uploads: true });
    await next(p2);

    const cards = await p2.$$eval('#rcards [data-card]',
      (els) => els.map((e) => e.getAttribute('data-card')));
    r.ok('the upload question draws no card of its own',
      !cards.includes('lbf-attachments'), cards.join(','));
    r.ok('and no control under it either',
      (await p2.$$eval('#rcards [data-card="lbf-attachments"] input', (e) => e.length)) === 0);

    /* Walk to the upload gate. The place question is first and required. */
    await p2.fill('.card.on input[type="text"]', 'Polling station 12');
    await next(p2);

    /* AND THE ADDRESS IS ASKED BEFORE THE FILES, on a logbook that takes
       them. The staging quota is keyed on it, so it has to be in hand before
       a byte is staged — and the server refuses a slot without one. This card
       appearing here IS the ordering, so it is checked rather than walked
       past. */
    r.ok('the address is asked before the files, not on the last card',
      (await card(p2)) === 'contact', await card(p2));
    await next(p2);
    r.ok('and it cannot be skipped, because every upload would be refused',
      (await card(p2)) === 'contact', await card(p2));
    await p2.fill('#rEmail', 'browser-tests@example.org');
    await next(p2);

    r.ok('the form asks whether there are files, because the logbook asked',
      (await card(p2)) === 'evidence-ask', await card(p2));
    await pick(p2, 'Yes');
    await next(p2);
    r.ok('and then offers somewhere to put them',
      (await card(p2)) === 'evidence', await card(p2));

    r.ok('no uncaught errors on a logbook that asks for files',
      p2.errors.length === 0, p2.errors.join(' | '));
    await p2.close();
  }

  {
    /* THE OTHER HALF, and the one a regression would show up in: a logbook
       with no upload question is never asked about files at all. Same fixture
       minus the question, and acceptsFiles false the way the server would
       resolve it. */
    const NO_FILES = { ...LOGBOOK, slug: 'munich-none', acceptsFiles: false,
      fields: [LOGBOOK.fields[0]] };
    const p3 = await openForm(browser, [NO_FILES], { uploads: true });
    await next(p3);
    await p3.fill('.card.on input[type="text"]', 'Polling station 12');
    await next(p3);
    r.ok('a logbook that asks for no files never mentions them',
      (await card(p3)) !== 'evidence-ask' && (await card(p3)) !== 'evidence',
      await card(p3));
    r.ok('no uncaught errors on a logbook that asks for none',
      p3.errors.length === 0, p3.errors.join(' | '));
    await p3.close();
  }

  return r;
}
