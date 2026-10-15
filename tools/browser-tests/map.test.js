/**
 * Heat maps on screen: that they are reachable, that they say so honestly
 * when the operator has made none, that several of them can be on a page
 * at once — and the one that matters most, that nothing of a map is
 * fetched before somebody opens the screen holding it.
 *
 * Leaflet and the outlines are about six hundred kilobytes between them.
 * They are deliberately NOT in the service worker's shell and must not be
 * pulled in by a page load, by the board, or while the site is gated. With
 * several maps on a page they must also be pulled in ONCE.
 *
 * AND ONE THING THE SINGLETON VERSION OF THIS MODULE COULD NOT BE TESTED
 * FOR: that two maps on a page do not read each other's parts. Everything
 * inside a map used to be addressed by id, so a second map's code found
 * the first map's legend — these assertions are why the markup is a
 * template addressed by `data-map` now.
 */
import { BASE, Report, open, PHONE, settle } from './lib.js';

const HEAVY = /\/vendor\/leaflet\.(js|css)$|\/geo\/maps\.json$/;

const json = (body, status = 200) => (route) => route.fulfill({
  status, contentType: 'application/json', body: JSON.stringify(body),
});

/** Watches what a page asks the network for, from before its first request. */
function watch(page) {
  const seen = [];
  page.on('request', (r) => seen.push(new URL(r.url()).pathname));
  return seen;
}

const SLOTS = [
  { id: 'board_tab', container: 'map-slot-board-tab', pane: 'dash', sub: 'map' },
  { id: 'board_reports', container: 'map-slot-board-reports', pane: 'dash', sub: 'reports' },
  { id: 'home', container: 'map-slot-home', pane: 'home', sub: null },
];

/** An aggregate with two shaded areas and one withheld. */
const agg = (slug, title, threshold) => ({
  published: true,
  slug,
  title,
  threshold,
  planes: ['us'],
  views: ['volume'],
  filter_key: 'where',
  areas: {
    'US-AZ': { n: 9, pos: 0, neg: 0, neu: 0, sev: {} },
    'US-CA': { n: 4, pos: 0, neg: 0, neu: 0, sev: {} },
  },
  // Two of them, so the subtotal is a sum nobody can take apart.
  suppressed: { areas: ['US-NV', 'US-WY'], reports: 3 },
  unplaced: { no_question: 1, country_only: 0 },
  note: 'Not a survey and not a sample.',
});

export default async function run(browser) {
  const r = new Report('the map');

  // 1 · A PAGE LOAD PULLS IN NONE OF IT.
  {
    let seen;
    const page = await open(browser, `${BASE}/board`, PHONE, async (p) => { seen = watch(p); });
    r.ok('the board does not fetch Leaflet or the outlines',
      !seen.some((p) => HEAVY.test(p)), seen.filter((p) => HEAVY.test(p)).join(' '));
    r.ok('and the Map tab is in the page from the first byte',
      Boolean(await page.$('#dash-tab-map')));
    r.ok('and so is its view, hidden',
      await page.$eval('#dash-map', (e) => e.hasAttribute('hidden')));
    r.ok('and every slot a map can go in is in the page too, empty',
      (await page.$$eval('[id^="map-slot-"]', (n) => n.length)) >= 4);
    r.ok('the board drew without errors', page.pageErrors.length === 0,
      page.pageErrors.join(' | '));
    await page.close();
  }

  // 2 · AN OPERATOR WHO HAS MADE NO MAP. The shipped state: the board's own
  // tab says so in words, because an empty tab beside Reports and Figures
  // reads as broken.
  {
    let seen;
    const page = await open(browser, `${BASE}/board/map`, PHONE, async (p) => {
      seen = watch(p);
      await p.route((u) => u.pathname === '/api/map',
        json({ published: true, maps: [], slots: SLOTS }));
    });
    await settle(page);
    r.ok('opening the map tab asks which maps exist', seen.includes('/api/map'));
    r.ok('a board tab with no map on it says so in words',
      !(await page.$eval('#map-slot-board-tab-empty', (e) => e.hidden))
      && (await page.$eval('#map-slot-board-tab-empty', (e) => e.textContent)).length > 20);
    r.ok('and draws no map behind the message',
      (await page.$$('#map-slot-board-tab .map-stage')).length === 0);
    r.ok('and fetches none of the heavy files',
      !seen.some((p) => HEAVY.test(p)), seen.filter((p) => HEAVY.test(p)).join(' '));
    r.ok('it drew without errors', page.pageErrors.length === 0, page.pageErrors.join(' | '));
    await page.close();
  }

  // 3 · ONE MAP, TURNED ON. It must actually draw, and it must ask no tile
  // server: a tile request tells a third party which states the readers of
  // an incident archive are looking at.
  {
    let seen;
    const page = await open(browser, `${BASE}/board/map`, PHONE, async (p) => {
      seen = watch(p);
      await p.route((u) => u.pathname === '/api/map', json({
        published: true,
        maps: [{ slug: 'polling', title: 'Polling places', blurb: null, slot: 'board_tab', position: 0, planes: ['us'] }],
        slots: SLOTS,
      }));
      await p.route((u) => u.pathname === '/api/map/polling', json(agg('polling', 'Polling places', 3)));
    });
    await page.waitForTimeout(2500);

    r.ok('a map that is on fetches its outlines', seen.some((p) => HEAVY.test(p)));
    r.ok('and draws areas',
      (await page.$$('#map-slot-board-tab .map-canvas path.map-area')).length > 10);
    r.ok('and asks no tile server', !seen.some((p) => /\/\d+\/\d+\/\d+\.png$/.test(p)));
    r.ok('it wears the name the operator gave it',
      /Polling places/.test(await page.$eval('#map-slot-board-tab [data-map="title"]', (e) => e.textContent)));
    r.ok('the legend says what the threshold is, so a reader knows what is missing',
      /3 reports or more/.test(await page.$eval('#map-slot-board-tab [data-map="figures"]', (e) => e.textContent)));

    /* THE WITHHELD AREAS ARE NOT NAMED WITH NUMBERS ANYWHERE ON THE PAGE.
       The server sent them as bare codes; a page that put a count beside
       one would be publishing what the threshold withheld. */
    const text = await page.$eval('#map-slot-board-tab', (e) => e.textContent);
    r.ok('an area under the threshold gets no count on the page',
      !/US-NV\s*[:\s]\s*\d/.test(text) && !/Nevada[^.]{0,20}\b1\b/.test(text));
    r.ok('and the suppressed areas share one row in the table, not one each',
      (await page.$$eval('#map-slot-board-tab [data-map="table"] tr.below', (n) => n.length)) === 1);

    r.ok('it drew without errors', page.pageErrors.length === 0, page.pageErrors.join(' | '));
    await page.close();
  }

  // 4 · TWO MAPS ON ONE PAGE, which is the whole point of the rework.
  {
    let seen;
    const page = await open(browser, `${BASE}/board/map`, PHONE, async (p) => {
      seen = watch(p);
      await p.route((u) => u.pathname === '/api/map', json({
        published: true,
        maps: [
          { slug: 'polling', title: 'Polling places', blurb: null, slot: 'board_tab', position: 0, planes: ['us'] },
          { slug: 'workplace', title: 'Workplace', blurb: null, slot: 'board_tab', position: 1, planes: ['us'] },
        ],
        slots: SLOTS,
      }));
      await p.route((u) => u.pathname === '/api/map/polling', json(agg('polling', 'Polling places', 3)));
      await p.route((u) => u.pathname === '/api/map/workplace', json(agg('workplace', 'Workplace', 7)));
    });
    await page.waitForTimeout(3000);

    r.ok('both maps are on the page',
      (await page.$$('#map-slot-board-tab .map-stage')).length === 2);
    r.ok('each wears its own name',
      (await page.$$eval('#map-slot-board-tab [data-map="title"]', (a) => a.map((x) => x.textContent)))
        .join('|') === 'Polling places|Workplace');

    /* THE ASSERTION THE OLD MODULE COULD NOT PASS. Two thresholds on one
       page: with everything addressed by id, the second map's legend write
       landed on the first map's element and both read the same. */
    const thresholds = await page.$$eval('#map-slot-board-tab [data-map="figures"]',
      (a) => a.map((x) => (x.textContent.match(/Shaded once an area has (\d+)/) || [])[1]));
    r.ok('and its own threshold, which is what one map per id could not do',
      thresholds.join(',') === '3,7', thresholds.join(','));

    r.ok('both maps drew areas',
      (await page.$$eval('#map-slot-board-tab .map-canvas', (a) => a.length)) === 2
      && (await page.$$('#map-slot-board-tab .map-canvas path.map-area')).length > 20);

    r.ok('the outlines were fetched once between them',
      seen.filter((p) => /\/geo\/maps\.json$/.test(p)).length === 1,
      String(seen.filter((p) => /\/geo\/maps\.json$/.test(p)).length));
    r.ok('two maps drew without errors', page.pageErrors.length === 0, page.pageErrors.join(' | '));
    await page.close();
  }

  // 5 · A LINK THAT PREFILTERS, and one that does not overreach.
  {
    const page = await open(browser, `${BASE}/board/map?map=polling&area=US-CA`, PHONE, async (p) => {
      await p.route((u) => u.pathname === '/api/map', json({
        published: true,
        maps: [{ slug: 'polling', title: 'Polling places', blurb: null, slot: 'board_tab', position: 0, planes: ['us'] }],
        slots: SLOTS,
      }));
      await p.route((u) => u.pathname === '/api/map/polling', json(agg('polling', 'Polling places', 3)));
    });
    await page.waitForTimeout(2500);
    r.ok('?area= opens the map with that area already read out',
      /California/.test(await page.$eval('#map-slot-board-tab [data-map="readout"]', (e) => e.textContent)));
    r.ok('and offers a link that hands the board the same filter',
      (await page.$eval('#map-slot-board-tab [data-board-filter]', (a) => a.getAttribute('href')))
      === '/board?a.where=US-CA');
    await page.close();
  }

  {
    /* AN AREA THE SERVER WITHHELD IS NOT SELECTABLE FROM A LINK. Selecting
       it would draw a readout for a place whose count was deliberately not
       sent — and a URL is the one input a reader controls completely. */
    const page = await open(browser, `${BASE}/board/map?map=polling&area=US-NV`, PHONE, async (p) => {
      await p.route((u) => u.pathname === '/api/map', json({
        published: true,
        maps: [{ slug: 'polling', title: 'Polling places', blurb: null, slot: 'board_tab', position: 0, planes: ['us'] }],
        slots: SLOTS,
      }));
      await p.route((u) => u.pathname === '/api/map/polling', json(agg('polling', 'Polling places', 3)));
    });
    await page.waitForTimeout(2500);
    const readout = await page.$eval('#map-slot-board-tab [data-map="readout"]', (e) => e.textContent);
    r.ok('?area= naming a withheld area selects nothing',
      !/Nevada/.test(readout), readout.slice(0, 120));
    await page.close();
  }

  // 6 · THE ADDRESS IS REAL, so a link to the map is one somebody can send.
  {
    const page = await open(browser, `${BASE}/board/map`);
    r.ok('/board/map lands on the map view',
      await page.$eval('#dash-map', (e) => !e.hasAttribute('hidden')));
    r.ok('and marks its tab', await page.$eval('#dash-tab-map', (e) => e.classList.contains('active')));
    await page.close();
  }

  /* 7 · AND EACH MAP HAS ONE OF ITS OWN. The admin panel names
     `/board/map/<slug>` beside every map, so it has to resolve — including
     for a map placed on the FRONT page, which is exactly the one somebody
     wants to link to without sending a reader to the front page. */
  {
    const page = await open(browser, `${BASE}/board/map/frontpager`, PHONE, async (p) => {
      await p.route((u) => u.pathname === '/api/map', json({
        published: true,
        // Deliberately in the `home` slot and not on the board tab.
        maps: [{ slug: 'frontpager', title: 'On the front page', blurb: null, slot: 'home', position: 0, planes: ['us'] }],
        slots: SLOTS,
      }));
      await p.route((u) => u.pathname === '/api/map/frontpager', json(agg('frontpager', 'On the front page', 3)));
    });
    await page.waitForTimeout(2500);
    r.ok('a map\'s own address opens the board\'s map tab',
      await page.$eval('#dash-map', (e) => !e.hasAttribute('hidden')));
    r.ok('and draws that map there, though its slot is the front page',
      /On the front page/.test(
        await page.$eval('#map-slot-board-tab', (e) => e.textContent)),
      await page.$eval('#map-slot-board-tab', (e) => e.textContent.slice(0, 80)));
    r.ok('it drew without errors', page.pageErrors.length === 0, page.pageErrors.join(' | '));
    await page.close();
  }

  {
    // A slug nobody has says so, and says it the same way an unpublished
    // map does — answering differently would tell an unauthenticated caller
    // which maps an operator has made and not published.
    const page = await open(browser, `${BASE}/board/map/nosuchmap`, PHONE, async (p) => {
      await p.route((u) => u.pathname === '/api/map',
        json({ published: true, maps: [], slots: SLOTS }));
    });
    await settle(page);
    r.ok('an address with no map behind it says so rather than showing a blank tab',
      !(await page.$eval('#map-slot-board-tab-empty', (e) => e.hidden))
      && /no map/i.test(await page.$eval('#map-slot-board-tab-empty', (e) => e.textContent)));
    await page.close();
  }

  return r;
}
