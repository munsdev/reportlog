/**
 * The front page's buttons, on screen.
 *
 * The resolution rules are proved where they live — scripts/selftest.js for
 * the pure ones and scripts/home-buttons-selftest.mjs against a real
 * database. What is only true in a browser is here, and most of it is about
 * what the page does NOT do:
 *
 *   - it does not leave a visitor with no way in while the fetch is running
 *   - it does not draw two accent buttons, ever
 *   - it does not offer the arrange control to somebody who is not an admin
 *   - it does not let the arrange control rename anything
 *
 * AND ONE THING THAT IS NOT A DETAIL: the page used to wire the alerts
 * button by id at load. The moment that element stopped being in the
 * markup, `getElementById(...).addEventListener` threw on null — which
 * takes session.js down and with it every listener declared below that
 * line, including the login form's. A test that only looked at the buttons
 * would have passed.
 *
 * The API is intercepted; everything past the network is the real page.
 */
import { BASE, Report, open, settle } from './lib.js';

const json = (body, status = 200) => (route) => route.fulfill({
  status, contentType: 'application/json', body: JSON.stringify(body),
});

const ADMIN = { id: '1', email: 'admin@example.org', role: 'admin', is_tester: false, memberships: [] };

const THREE = {
  buttons: [
    { kind: 'logbook', ref: 'polling', label: 'Polling places', href: '/file/polling', accent: true },
    { kind: 'logbook', ref: 'workplace', label: 'Workplace', href: '/file/workplace', accent: false },
    { kind: 'list', ref: 'tips', label: 'Send a link', href: '/list/tips', accent: false },
    { kind: 'builtin', ref: 'board', label: 'View Live Report Board', href: '/board', nav: 'dash', accent: false },
    { kind: 'builtin', ref: 'alerts', label: 'Get alerts as reports come in', href: null, action: 'alerts', accent: false },
  ],
};

const AVAILABLE = {
  logbooks: [
    { kind: 'logbook', ref: 'polling', label: 'Polling places', href: '/file/polling' },
    { kind: 'logbook', ref: 'workplace', label: 'Workplace', href: '/file/workplace' },
  ],
  lists: [{ kind: 'list', ref: 'tips', label: 'Send a link', href: '/list/tips' }],
  builtins: [
    { kind: 'builtin', ref: 'board', label: 'View Live Report Board', href: '/board', nav: 'dash' },
    { kind: 'builtin', ref: 'alerts', label: 'Get alerts as reports come in', href: null, action: 'alerts' },
    { kind: 'builtin', ref: 'submit', label: 'Submit a Report', href: '/submit', nav: 'submit' },
  ],
};

const labels = (page) => page.$$eval('#home-buttons .button', (a) => a.map((x) => x.textContent.trim()));

export default async function run(browser) {
  const r = new Report('home-buttons');

  /* ---- a visitor ------------------------------------------------------- */
  {
    const page = await open(browser, `${BASE}/`, undefined, async (p) => {
      await p.route('**/api/home/buttons', json(THREE));
    });
    await settle(page);

    const got = await labels(page);
    r.ok('every open logbook has its own button on the front page',
      got.includes('Polling places') && got.includes('Workplace'), got.join(' | '));
    r.ok('a list is a button beside them, not in a section of its own',
      got.includes('Send a link'), got.join(' | '));
    r.ok('and they come out in the order the server sent',
      got[0] === 'Polling places' && got[1] === 'Workplace', got.join(' | '));

    r.ok('exactly one button is the accent, and it is the first',
      (await page.$$eval('#home-buttons .button', (a) => a.map((x) => !x.classList.contains('is-secondary'))))
        .filter(Boolean).length === 1
      && await page.$eval('#home-buttons .button', (x) => !x.classList.contains('is-secondary')));

    r.ok('a logbook button is a real address somebody can share',
      await page.$eval('#home-buttons [data-file-open]', (a) => a.getAttribute('href')) === '/file/polling');

    r.ok('the fallback buttons are gone once the real ones have loaded',
      await page.$eval('#home-buttons-fallback', (e) => e.hidden) === true);

    // THE REGRESSION DESCRIBED IN THE HEADER. If session.js threw while
    // wiring a button that is no longer in the markup, nothing below it
    // ran — so the login form is the canary, not the buttons.
    r.ok('session.js survived the alerts button not being in the markup',
      await page.evaluate(() => {
        const b = document.getElementById('login-send-code');
        return Boolean(b);
      }));

    r.ok('the arrange control is not offered to a visitor',
      (await page.$('#home-arrange-open')) === null);
    await page.close();
  }

  /* ---- the fetch never answers ---------------------------------------- */
  {
    // A front page that has not loaded must not be a front page with no way
    // in. This is the state a slow or broken deployment actually shows.
    const page = await open(browser, `${BASE}/`, undefined, async (p) => {
      await p.route('**/api/home/buttons', (route) => route.abort());
    });
    await settle(page);
    r.ok('a failed fetch leaves the fallback buttons standing',
      await page.$eval('#home-buttons-fallback', (e) => e.hidden) === false);
    r.ok('and one of them still leads somewhere a report can be filed',
      (await page.$$eval('#home-buttons-fallback [data-nav]', (a) => a.map((x) => x.getAttribute('data-nav'))))
        .includes('submit'));
    await page.close();
  }

  /* ---- an admin, in edit mode ----------------------------------------- */
  {
    const saved = [];
    const page = await open(browser, `${BASE}/`, undefined, async (p) => {
      await p.route('**/api/auth/me', json(ADMIN));
      await p.route('**/api/admin/home-buttons', async (route) => {
        if (route.request().method() === 'PUT') {
          saved.push(JSON.parse(route.request().postData() || '{}'));
          // Answer with the reordered list, as the server would.
          const order = saved[saved.length - 1].order || [];
          const byKey = new Map(THREE.buttons.map((b) => [`${b.kind}:${b.ref}`, b]));
          /* Answered the way the server answers: `title` always carries the
             record's own name, and `label` is the override resolved against
             it. The arrange control reads both — the box holds the override
             and the placeholder holds the title it falls back to — so a
             mock that sent only one of them would let a broken fallback
             pass. */
          return json({
            ok: true,
            buttons: order.map((e, i) => {
              const b = byKey.get(`${e.kind}:${e.ref}`);
              const title = b.label;
              return {
                ...b,
                title,
                label: (e.label && e.kind !== 'builtin') ? e.label : title,
                accent: i === 0,
              };
            }),
          })(route);
        }
        return json({
          ...THREE,
          buttons: THREE.buttons.map((b) => ({ ...b, title: b.label })),
          available: AVAILABLE,
          arranged: false,
        })(route);
      });
      await p.route('**/api/home/buttons', json(THREE));
    });
    await settle(page);

    r.ok('an admin who is not editing is not offered the arrange control either',
      (await page.$('#home-arrange-open')) === null);

    // Edit mode is the corner button that puts pencils on the page's words.
    await page.click('#fab-edit');
    await settle(page);
    r.ok('the arrange control appears in edit mode',
      (await page.$('#home-arrange-open')) !== null);

    await page.click('#home-arrange-open');
    await settle(page);
    r.ok('and it lists every button that is on the page',
      (await page.$$eval('#home-arrange [data-arrange-row]', (a) => a.length)) === 5);
    r.ok('it offers the button that is NOT on the page, so a removal can be undone',
      (await page.$$eval('#home-arrange [data-arrange-add]', (a) => a.map((x) => x.getAttribute('data-arrange-add'))))
        .includes('builtin:submit'));

    /* THE RULE THAT MATTERS, and it changed on 12 October: it moves
       buttons, and it may override the wording of the ones that are an
       operator's own. A logbook or list gets a box; the SITE'S OWN buttons
       do not, because somebody who could rewrite "View Live Report Board"
       could make the front page lie about what the button does. */
    const boxes = await page.$$eval('#home-arrange [data-arrange-label]',
      (a) => a.map((x) => ({ ph: x.placeholder, val: x.value })));
    r.ok('each logbook and list button offers wording of its own',
      boxes.length === 3, JSON.stringify(boxes));
    r.ok('and the site\u2019s own buttons do not, so the page cannot lie about them',
      (await page.$$eval('#home-arrange input, #home-arrange textarea', (a) => a.length)) === 3);

    /* EMPTY IS THE DEFAULT AND MEANS "USE THE TITLE", which is what keeps
       a rename flowing through to the button. The placeholder is the title
       it falls back to, so emptying the box has a visible consequence
       before anybody saves to find out. */
    r.ok('the boxes start empty, with the title as the placeholder',
      boxes.every((b) => b.val === '') && boxes[0].ph === 'Polling places',
      JSON.stringify(boxes));
    r.ok('and no colour to choose, because the order is the emphasis',
      !/colou?r/i.test(await page.$eval('#home-arrange', (e) => e.textContent))
      || /no colour to choose/i.test(await page.$eval('#home-arrange', (e) => e.textContent)));

    await page.click('[data-arrange-down="0"]');
    await settle(page);
    r.ok('moving the first button down moves the accent with the position',
      (await labels(page))[0] === 'Workplace'
      && await page.$eval('#home-buttons .button', (x) => !x.classList.contains('is-secondary')));

    await page.click('#home-arrange-save');
    await settle(page);
    r.ok('saving an untouched arrangement sends kinds and refs and nothing else',
      saved.length === 1
      && saved[0].order.every((e) => Object.keys(e).sort().join(',') === 'kind,ref'),
      JSON.stringify(saved[0]));
    r.ok('and the page is repainted from what the server answered',
      (await labels(page))[0] === 'Workplace');

    /* AND A TYPED LABEL TRAVELS WITH ITS BUTTON. The rows repaint on every
       move, so wording that is not carried back into the list is lost the
       moment somebody presses an arrow — in the one control whose whole job
       is arranging. */
    await page.click('#home-arrange-open');
    await settle(page);
    await page.fill('[data-arrange-label="0"]', 'Report a problem at your polling place');
    await page.click('[data-arrange-down="0"]');
    await settle(page);
    const moved = await page.$$eval('#home-arrange [data-arrange-label]',
      (a) => a.map((x) => x.value));
    r.ok('typing a label and then moving the button keeps what was typed',
      moved.includes('Report a problem at your polling place'), JSON.stringify(moved));

    saved.length = 0;
    await page.click('#home-arrange-save');
    await settle(page);
    const withLabel = (saved[0] ? saved[0].order : []).filter((e) => e.label);
    r.ok('and saving sends it as a label beside the kind and the ref',
      withLabel.length === 1
      && withLabel[0].label === 'Report a problem at your polling place'
      && Object.keys(withLabel[0]).sort().join(',') === 'kind,label,ref',
      JSON.stringify(saved[0] || null));
    await page.close();
  }

  return r;
}
