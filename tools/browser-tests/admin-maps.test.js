/**
 * Admin → Maps on screen: making a heat map, changing one, and the two
 * panels being two panels on purpose.
 *
 * The rules are proved where they live — scripts/heat-map-selftest.mjs
 * against a real database, for the thresholds and the refusals. What is
 * only true in a browser is here, and most of it is about what the panel
 * does NOT do:
 *
 *   - it does not offer an outcome view with no question behind it
 *   - it does not offer a free-text Place question as a map location
 *   - it does not invent its own words for a refusal
 *   - it does not let an operator set a threshold below the floor
 *
 * AND THE ONE ABOUT THE TWO PANELS. Which question places a report is the
 * LOGBOOK's, shared by every map reading it. Inside a map's own form it
 * would read as though the mark belonged to that map, and the next map
 * would appear to need its own.
 *
 * The API is intercepted; everything past the network is the real page.
 */
import { BASE, Report, open, settle } from './lib.js';

const json = (body, status = 200) => (route) => route.fulfill({
  status, contentType: 'application/json', body: JSON.stringify(body),
});

const ADMIN = { id: '1', email: 'admin@example.org', role: 'admin', is_tester: false, memberships: [] };

const SLOTS = [
  { id: 'board_tab', label: 'Its own tab on the board', description: 'A tab beside Reports.', container: 'map-slot-board-tab', pane: 'dash', sub: 'map' },
  { id: 'home', label: 'The home page', description: 'The most visible slot there is.', container: 'map-slot-home', pane: 'home', sub: null },
];

/* One logbook with a location question, a free-text place question and a
   choice that could colour an outcome. The shape the panel has to get
   right is that only ONE of the three can place a report. */
const CANDIDATES = [{
  id: 7,
  slug: 'polling',
  title: 'Polling places',
  launched: true,
  places: [
    { id: 11, key: 'where', kind: 'location', label: 'Where did it happen', map_location: true, map_outcome: false, stances: null, options: null },
    { id: 12, key: 'lives', kind: 'location', label: 'Where do you live', map_location: false, map_outcome: false, stances: null, options: null },
  ],
  outcomes: [
    { id: 13, key: 'served', kind: 'choice_one', label: 'Were you served?', map_location: false, map_outcome: true, stances: { Yes: 'positive' }, options: ['Yes', 'No'] },
  ],
}];

const EXISTING = {
  id: 3,
  slug: 'polling-map',
  title: 'Polling places',
  blurb: null,
  enabled: true,
  min_area: 3,
  planes: ['us'],
  views: ['volume'],
  logbook_ids: [7],
  outcome_field_id: null,
  slot: 'board_tab',
  position: 0,
};

const payload = (maps) => ({
  maps,
  candidates: CANDIDATES,
  slots: SLOTS,
  planes: ['us', 'world'],
  views: ['volume', 'outcome', 'severity'],
  floor: 2,
});

/** Opens the admin pane with the Maps tab showing. */
async function openMaps(browser, { maps = [EXISTING], onWrite = null } = {}) {
  const page = await open(browser, `${BASE}/admin`, undefined, async (p) => {
    await p.route('**/api/auth/me', json(ADMIN));
    await p.route('**/api/admin/heat-maps**', async (route) => {
      const method = route.request().method();
      if (method === 'GET') return json(payload(maps))(route);
      if (onWrite) return onWrite(route);
      return json({ ok: true })(route);
    });
  });
  await settle(page);
  await page.click('#admin-subnav button[data-adminsec="maps"]');
  await settle(page);
  return page;
}

export default async function run(browser) {
  const r = new Report('admin → maps');

  /* ---- the list, and what it tells an operator about each map ---------- */
  {
    const page = await openMaps(browser);
    r.ok('the Maps tab is in the admin page',
      Boolean(await page.$('#admin-subnav button[data-adminsec="maps"]')));
    r.ok('and it is the only section showing once chosen',
      (await page.$$eval('#pane-admin [data-sec]',
        (els) => [...new Set(els.filter((e) => !e.hidden).map((e) => e.getAttribute('data-sec')))]))
        .join(',') === 'maps');

    const row = await page.$eval('#hm-list', (e) => e.textContent);
    r.ok('an existing map says whether it is published', /published/.test(row), row);
    r.ok('and says its threshold in words, not as a number on its own',
      /3 reports or more/.test(row), row);
    r.ok('and says what feeds it', /Polling places/.test(row), row);
    r.ok('and gives its own address, so a link to it can be shared',
      /\/board\/map\/polling-map/.test(row), row);

    /* TWO PANELS. The question's flag is not inside the map's form. */
    r.ok('which question feeds a map is a panel of its own',
      Boolean(await page.$('#panel-map-feeds')));
    r.ok('and the map list is a different panel',
      Boolean(await page.$('#panel-heat-maps')));
    await page.close();
  }

  /* ---- what the feeds panel offers, and what it refuses to offer ------- */
  {
    const page = await openMaps(browser);
    const feeds = await page.$eval('#hm-feeds', (e) => e.textContent);
    r.ok('both of the logbook\'s location questions are offered',
      /Where did it happen/.test(feeds) && /Where do you live/.test(feeds), feeds);
    r.ok('and only one of them can be chosen, because a report is in one place',
      (await page.$$eval('#hm-feeds [data-hm-place]',
        (a) => a.filter((x) => x.type === 'radio').length)) >= 2);
    r.ok('the one the operator already chose is the one selected',
      await page.$eval('#hm-feeds [data-hm-place="11"]', (e) => e.checked) === true);
    r.ok('and "none of them" is offered, so a logbook can come off the map',
      Boolean(await page.$('#hm-feeds [data-hm-place="none"]')));

    /* A FREE-TEXT PLACE QUESTION IS NOT IN THE LIST AT ALL. Marking one
       would produce a map whose every report is unplaced — a blank map
       reporting no fault. */
    r.ok('a free-text Place question is not offered as a map location',
      !/Whereabouts/.test(feeds), feeds);
    r.ok('the outcome question is offered separately from the place one',
      /Were you served/.test(feeds), feeds);
    await page.close();
  }

  /* ---- making one ------------------------------------------------------ */
  {
    const sent = [];
    const page = await openMaps(browser, {
      maps: [],
      onWrite: (route) => {
        sent.push({
          method: route.request().method(),
          body: JSON.parse(route.request().postData() || '{}'),
        });
        return json({ ...EXISTING, id: 9 }, 201)(route);
      },
    });
    r.ok('a deployment with no map says so rather than showing an empty list',
      /No maps yet/.test(await page.$eval('#hm-list', (e) => e.textContent)));

    await page.click('#hm-new');
    await settle(page);
    r.ok('making one opens a form', Boolean(await page.$('#hm-title')));
    r.ok('and it opens UNPUBLISHED, so nothing is drawn by accident',
      await page.$eval('#hm-enabled', (e) => e.checked) === false);
    r.ok('with the threshold at the shipped default rather than the floor',
      await page.$eval('#hm-min', (e) => e.value) === '3');
    r.ok('and the floor is on the control, not only in the server',
      await page.$eval('#hm-min', (e) => e.getAttribute('min')) === '2');

    /* AN OUTCOME VIEW NEEDS A QUESTION, and the panel says so where the
       tick is rather than letting it be saved and refused. */
    r.ok('the Outcome view is offered, because a question is marked',
      await page.$eval('[data-hm-view="outcome"]', (e) => e.disabled) === false);
    r.ok('and the question that would colour it is offered by name',
      /Were you served/.test(await page.$eval('#hm-outcome', (e) => e.textContent)));

    await page.fill('#hm-title', 'Polling places');
    await page.fill('#hm-slug', 'polling-map');
    await page.click('#hm-save');
    await settle(page);
    r.ok('saving POSTs the whole map as one object',
      sent.length === 1 && sent[0].method === 'POST'
      && sent[0].body.title === 'Polling places' && sent[0].body.slug === 'polling-map',
      JSON.stringify(sent[0]));
    r.ok('including the threshold, which is never left for the server to guess',
      sent[0].body.min_area === 3, String(sent[0].body.min_area));
    r.ok('and the planes and views as lists',
      Array.isArray(sent[0].body.planes) && Array.isArray(sent[0].body.views));
    await page.close();
  }

  /* ---- a refusal is shown in the server's own words -------------------- */
  {
    const page = await openMaps(browser, {
      maps: [],
      onWrite: json({
        error: 'An outcome view needs a question to colour it. Pick one, or untick Outcome.',
        reason: 'outcome-needs-a-question',
      }, 400),
    });
    await page.click('#hm-new');
    await settle(page);
    await page.fill('#hm-title', 'Bad map');
    await page.fill('#hm-slug', 'bad-map');
    await page.click('#hm-save');
    await settle(page);
    /* THE SERVER'S WORDS, NOT THE PANEL'S. Each refusal names the box that
       is wrong and says why; a second explanation written here would be a
       second thing to keep true, and the server's is the one that matches
       what it actually did. */
    r.ok('a refusal is shown as the server worded it',
      /needs a question to colour it/.test(
        await page.$eval('#hm-edit-err', (e) => e.textContent)),
      await page.$eval('#hm-edit-err', (e) => e.textContent));
    r.ok('and the form stays open with the answers still in it',
      await page.$eval('#hm-title', (e) => e.value) === 'Bad map');
    await page.close();
  }

  /* ---- changing one --------------------------------------------------- */
  {
    const sent = [];
    const page = await openMaps(browser, {
      onWrite: (route) => {
        sent.push({ method: route.request().method(), body: JSON.parse(route.request().postData() || '{}') });
        return json({ ...EXISTING, min_area: 10 })(route);
      },
    });
    await page.click('[data-hm-open="3"]');
    await settle(page);
    r.ok('opening a map shows its own settings, not the defaults',
      await page.$eval('#hm-min', (e) => e.value) === '3'
      && await page.$eval('#hm-slug', (e) => e.value) === 'polling-map');
    r.ok('and which logbook feeds it is already ticked',
      await page.$eval('[data-hm-logbook="7"]', (e) => e.checked) === true);
    r.ok('and where it appears is already chosen',
      await page.$eval('#hm-slot', (e) => e.value) === 'board_tab');

    await page.fill('#hm-min', '10');
    await page.click('#hm-save');
    await settle(page);
    r.ok('saving a change PATCHes rather than making a second map',
      sent.length === 1 && sent[0].method === 'PATCH' && sent[0].body.min_area === 10,
      JSON.stringify(sent[0]));
    await page.close();
  }

  /* ---- a logbook that cannot be mapped is told so, in place ----------- */
  {
    const page = await open(browser, `${BASE}/admin`, undefined, async (p) => {
      await p.route('**/api/auth/me', json(ADMIN));
      await p.route('**/api/admin/heat-maps**', json({
        ...payload([]),
        candidates: [{
          id: 8, slug: 'workplace', title: 'Workplace', launched: true,
          places: [], outcomes: [],
        }],
      }));
    });
    await settle(page);
    await page.click('#admin-subnav button[data-adminsec="maps"]');
    await settle(page);
    const feeds = await page.$eval('#hm-feeds', (e) => e.textContent);
    /* LISTED WITH ITS REASON rather than silently left out. A panel that
       omitted it would leave an operator looking for a logbook that is
       right there — and the thing they need to be told is exactly why it
       cannot be mapped yet. */
    r.ok('a logbook with no location question is still listed',
      /Workplace/.test(feeds), feeds);
    r.ok('and is told what it is missing, and that it can be added after launch',
      /Location on a map/.test(feeds) && /optional question/.test(feeds), feeds);
    r.ok('no uncaught errors on the Maps tab', page.pageErrors.length === 0,
      page.pageErrors.join(' | '));
    await page.close();
  }

  {
    /* THE EDITOR'S FORM IS LAID OUT, and this is measured rather than read
       off the markup, because the markup was never wrong. `.form_label` and
       `.form_help` are a <label> and a <span> — inline elements — and they
       got their block behaviour from `.form_field-wrapper`, a flex column.
       This form does not use that wrapper, so every tick, its name and its
       explanation ran into the next one: "HOW MANY REPORTSEvery map can
       show this. THE ANSWER TO A QUESTIONNeeds a question below". Nothing
       in the DOM says that. Only geometry does. */
    const page = await openMaps(browser);
    await page.click('[data-hm-open="3"]');
    await settle(page);

    /* EVERY ONE OF THESE IS CHOSEN FOR WHAT IT DISCRIMINATES, because the
       obvious versions did not. Written first and then run against the
       stylesheet as it was before the fix, four of six still passed: an
       inline label with a sentence in it wraps onto several lines anyway,
       so "is its top different from the one before" and "is it wider than
       half the panel" are both true of the broken layout. These measure
       the property that is actually false when the rule is missing. Two
       more were written and then DROPPED for the same reason rather than
       kept as passengers: "every tick starts at the same left edge" and "a
       heading has a margin above it" are both true of the broken layout
       here, the first because the wrapped inline labels happened to land
       at the left edge anyway and the second because a bare <p> carries a
       1em default margin. An assertion that cannot fail is not a test. */
    const rows = await page.$$eval('#hm-editor label.form_label', (els) => els
      .filter((e) => e.querySelector('input[type="checkbox"]'))
      .map((e) => { const b = e.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, text: e.textContent.trim().slice(0, 40) }; }));
    r.ok('the editor has its checkbox rows', rows.length >= 3, `${rows.length} found`);
    r.ok('each tick is on its own line, below the one before it',
      rows.every((row, i) => i === 0 || row.top >= rows[i - 1].bottom - 1),
      rows.map((x) => `${Math.round(x.top)}`).join(','));

    /* A help line BELOWS its label rather than trailing off the end of it.
       Width proved nothing; vertical order proves it. */
    const pairs = await page.$$eval('#hm-editor label.form_label', (els) => els
      .filter((e) => e.nextElementSibling && e.nextElementSibling.classList.contains('form_help'))
      .map((e) => ({
        label: e.getBoundingClientRect().bottom,
        help: e.nextElementSibling.getBoundingClientRect().top,
        text: e.textContent.trim().slice(0, 40),
      })));
    r.ok('there are labels with an explanation under them', pairs.length >= 3, `${pairs.length}`);
    r.ok('and the explanation is UNDER its label, not trailing off the end of it',
      pairs.every((x) => x.help >= x.label - 1),
      pairs.filter((x) => x.help < x.label - 1).map((x) => x.text).join(' | '));

    /* `form_label-sep` had no rule in any stylesheet the app loads, so
       "What the colour shows" rendered as a plain body paragraph. A margin
       check does not catch that — a bare <p> has a 1em default margin and
       passes it. What the missing rule actually costs is the heading
       LOOKING like one, so that is what is asked. */
    const seps = await page.$$eval('#hm-editor .form_label-sep', (els) => els
      .map((e) => { const c = getComputedStyle(e); return { tt: c.textTransform, fw: c.fontWeight, mt: parseFloat(c.marginTop), text: e.textContent.trim() }; }));
    r.ok('the section headings exist', seps.length >= 3, `${seps.length} found`);
    r.ok('and each one is styled as a heading rather than left as body text',
      seps.every((x) => x.tt === 'uppercase' && Number(x.fw) >= 600 && x.mt >= 10),
      seps.map((x) => `${x.text}:${x.tt}/${x.fw}/${x.mt}`).join(' | '));
    r.ok('no uncaught errors laying the editor out', page.pageErrors.length === 0,
      page.pageErrors.join(' | '));
    await page.close();
  }

  return r;
}
