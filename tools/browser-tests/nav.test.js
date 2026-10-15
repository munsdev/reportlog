/**
 * The navigation bar, and the progress rule that is its bottom edge.
 */
import {
  BASE, Report, open, openForm, card, next, pick, settle, FIXTURE_LOGBOOK, SECOND_LOGBOOK,
} from './lib.js';

export default async function run(browser) {
  const r = new Report('navigation and progress');

  // The bar holds the menu and the site's name, on one row, at every width
  // it will meet. A second row would cost vertical space permanently on the
  // page it is pinned to.
  for (const width of [320, 360, 390, 430]) {
    const p = await open(browser, `${BASE}/submit`, { width, height: 800 });
    const fits = await p.evaluate(() => {
      const menu = document.querySelector('.menubtn').getBoundingClientRect();
      const wrap = document.querySelector('.tabs .wrap').getBoundingClientRect();
      const brand = document.querySelector('.brand').getBoundingClientRect();
      return {
        rows: Math.round(wrap.height / menu.height),
        overlaps: brand.left < menu.right - 1,
      };
    });
    r.ok(`${width}px: the name and the menu share one row`,
      fits.rows === 1 && !fits.overlaps, JSON.stringify(fits));
    await p.close();
  }

  // Two logbooks, so choosing one ADDS questions — the case where a step
  // counter's total used to jump. Short enough that the longest card has to
  // be scrolled.
  const page = await openForm(browser, {
    logbooks: [FIXTURE_LOGBOOK, SECOND_LOGBOOK], viewport: { width: 390, height: 520 },
  });
  r.ok('nothing else competes for the bar', !(await page.$('.cta-submit')));
  r.ok('the opening card shows the plain rule, not an empty track',
    !(await page.$eval('.tabs', (e) => e.classList.contains('progress'))));

  // The rule only ever fills forwards. It used to be a step counter whose
  // total grew as you answered.
  const widths = [];
  await next(page);
  const readBar = async () => Number(
    (await page.$eval('#navprog i', (e) => e.style.width)).replace('%', ''),
  );
  r.ok('starting the form turns the rule into a progress track',
    await page.$eval('.tabs', (e) => e.classList.contains('progress')));
  widths.push(await readBar());

  // Choosing the logbook brings its six questions into the form.
  await pick(page, FIXTURE_LOGBOOK.title); await page.waitForTimeout(300);
  await next(page); widths.push(await readBar());
  await pick(page, 'A voter'); await next(page); widths.push(await readBar());
  await pick(page, 'Ohio'); await next(page); widths.push(await readBar());
  await page.fill('.card.on input[type=date]', '2026-08-20'); await next(page); widths.push(await readBar());

  r.ok('the bar never goes backwards, even when an answer adds questions',
    widths.every((w, i) => i === 0 || w >= widths[i - 1]), widths.join(' → '));
  r.note(`fill: ${widths.join('% → ')}%`);

  // The choose-any card is taller than this window.
  r.ok('the card being measured is the long one', await card(page) === 'lbf-what', await card(page));
  await page.evaluate(() => window.scrollTo(0, 600));
  await settle(page);
  const still = await page.evaluate(() => {
    const box = document.querySelector('#navprog').getBoundingClientRect();
    return { top: Math.round(box.top), scrolled: Math.round(window.scrollY) };
  });
  r.ok('and stays in view scrolled down a long card',
    still.top >= 0 && still.top < 120 && still.scrolled > 100, JSON.stringify(still));

  // The name is the way home, including from inside the form.
  await page.click('.brand');
  await page.waitForTimeout(500);
  r.ok('the site name goes home', new URL(page.url()).pathname === '/');
  r.ok('leaving the form puts the plain rule back',
    !(await page.$eval('.tabs', (e) => e.classList.contains('progress'))));
  await page.close();

  // The call to action that moved out of the bar has to exist somewhere.
  // About is deliberately not one of those places any more: it is a
  // document about the project, not a landing page for the form, and it
  // ends on what the project needs rather than on a button.
  for (const [route, where] of [['/board', '#pane-dash']]) {
    const p = await open(browser, `${BASE}${route}`);
    r.ok(`${route} carries a Submit button`,
      Boolean(await p.$(`${where} button[data-nav="submit"]`)));
    await p.close();
  }
  {
    const p = await open(browser, `${BASE}/about`);
    await p.waitForTimeout(400);
    r.ok('and About deliberately does not',
      (await p.$$eval('#about-everyone [data-nav="submit"]', (n) => n.length)) === 0);

    /* About is two halves and the order is the argument: the operator says
       who they are, then the software says do not take their word for it.
       Part one is the operator's and is editable copy; part two describes
       ReportLog and is the same on every deployment. */
    r.ok('About opens with the operator\u2019s own words, in an editable slot',
      Boolean(await p.$('#ab-what [data-copy="about_archive"]')));
    r.ok('and a fresh install says plainly that it is unwritten',
      /has not written its About page yet/i.test(
        (await p.textContent('#ab-what [data-copy="about_archive"]')) || ''));

    // Everything after the seam is the software speaking about itself, and
    // has to say so — this marker is what keeps the branding audit sharp
    // rather than widened until it catches nothing.
    const unmarked = await p.$$eval('#about-everyone section[data-abnav]', (secs) => secs
      .filter((sec) => /ReportLog/.test(sec.textContent))
      .filter((sec) => !sec.hasAttribute('data-software-text'))
      .map((sec) => sec.id));
    r.ok('every section that says ReportLog is marked as software text',
      unmarked.length === 0, unmarked.join(', '));

    // The contents strip splits at the seam rather than from a second list
    // of section ids kept in step by hand.
    const split = await p.evaluate(() => ({
      one: document.querySelectorAll('#abtoc-list-1 li').length,
      two: document.querySelectorAll('#abtoc-list-2 li').length,
    }));
    r.ok('the contents strip indexes both halves separately',
      split.one === 2 && split.two === 10, JSON.stringify(split));

    r.ok('the software half names the licence and links the source',
      /AGPL-3\.0-or-later/.test((await p.textContent('#ab-source')) || '')
      && Boolean(await p.$('#ab-source a[href*="github.com"]')));
    await p.close();
  }

  // /print is the form with the dialog already open. The dialog itself
  // cannot be driven from here, so it is stubbed to record the call.
  const printed = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await printed.addInitScript(() => { window.print = () => { window.__printed = true; }; });
  await printed.goto(`${BASE}/print`, { waitUntil: 'domcontentloaded' });
  await printed.waitForTimeout(1400);
  r.ok('/print opens the report form', Boolean(await printed.$('#pane-submit.active')));
  r.ok('/print raises the print dialog', await printed.evaluate(() => !!window.__printed));
  await printed.close();

  // The documents list is deployment-specific: which documents a deployment
  // publishes is its own choice, so the assertions about which files exist
  // and what they are called moved out with them.

  // /updatenotes used to serve a document that no longer exists. The
  // address was handed out, so it still has to land somewhere sensible
  // rather than 404 — it now goes to the documents list.
  const notes = await browser.newPage();
  const got = await notes.goto(`${BASE}/updatenotes`, { waitUntil: 'domcontentloaded' })
    .catch(() => null);
  r.ok('/updatenotes does not dead-end', Boolean(got) && got.status() < 400,
    got ? String(got.status()) : 'no response');
  await notes.close();

  // In production nginx serves public/ directly and proxies only /api/*, so
  // unless it is told otherwise the server never sees this path — index.html
  // comes back and the app has to make sense of it. That is how this shipped
  // broken, landing on the home page. Simulated by serving the app the way
  // nginx would, and asserting the path still resolves somewhere useful.
  const asNginx = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await asNginx.route('**://*.google*/**', (x) => x.abort());
  await asNginx.route(`${BASE}/updatenotes`, (route) => route.continue({ url: `${BASE}/` }));
  await asNginx.goto(`${BASE}/updatenotes`, { waitUntil: 'domcontentloaded' });
  await asNginx.waitForTimeout(900);
  // Documents is a section of About rather than a page of its own, so
  // landing on About is not enough — that section has to be the one
  // actually showing, or the reader arrives at a page about the project
  // with the documents nowhere in sight.
  const landed = await asNginx.evaluate(() => {
    const active = document.querySelector('.pane.active');
    const press = document.getElementById('about-docs');
    return {
      pane: active ? active.id : 'none',
      pressShown: Boolean(press && press.getBoundingClientRect().height > 0),
    };
  });
  r.ok('/updatenotes still resolves if the server never sees it',
    landed.pane === 'pane-about' && landed.pressShown, JSON.stringify(landed));
  await asNginx.close();

  return r;
}
