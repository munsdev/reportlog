/**
 * The Alliance directory, on screen.
 *
 * The counting and ordering are asserted against a real database by
 * scripts/alliance-selftest.mjs. What only exists here is the page: that
 * the disclaimer is actually rendered, that the rows read as a list of
 * participants rather than a league table, and that no report count ever
 * reaches the screen.
 *
 * The directory is served from the API so the rows can be supplied here.
 * Everything below the intercept is the real page and the real script —
 * including the rule that the disclaimer comes from the API rather than
 * from a copy in the template, which is the thing worth checking.
 */
import { BASE, Report, settle } from './lib.js';

const DIRECTORY = {
  name: 'Participating organizations',
  disclaimer: 'Listing here is not verification. These organizations asked to be '
    + 'listed; nobody has checked them against a standard, because no standard for '
    + 'verifying an organization has been published yet. Treat this as a list of who '
    + 'is taking part, not as an endorsement of any of them.',
  organizations: [
    { name: 'Big Coalition', details: 'Statewide.', joined: '2026-03-04T00:00:00Z', member_count: 47 },
    { name: 'Lone Voice', details: null, joined: '2026-05-09T00:00:00Z', member_count: 1 },
    { name: 'Brand New', details: 'Just signed up.', joined: '2026-09-01T00:00:00Z', member_count: 0 },
  ],
};

async function openAlliance(browser, payload) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.route('**://*.google*/**', (r) => r.abort());
  await page.route('**://*.gstatic.com/**', (r) => r.abort());
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.route('**/api/alliance', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(payload),
  }));
  await page.goto(`${BASE}/alliance`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  page.errors = errors;
  return page;
}

export default async function run(browser) {
  const r = new Report('the Alliance directory');

  const page = await openAlliance(browser, DIRECTORY);

  r.ok('/alliance opens the directory',
    await page.$eval('#pane-alliance', (e) => e.classList.contains('active')));

  /* ---- the sentence the name costs -------------------------------- */
  const disclaimer = (await page.textContent('#alliance-disclaimer')) || '';
  r.ok('the page carries the disclaimer', disclaimer.length > 0, disclaimer);
  r.ok('which says listing is not verification',
    /not verification/i.test(disclaimer), disclaimer);
  r.ok('and that no standard for it exists yet',
    /no standard/i.test(disclaimer), disclaimer);
  r.ok('and it is visible, not tucked away',
    await page.$eval('#alliance-disclaimer', (e) => e.offsetParent !== null));

  /* ---- the rows ---------------------------------------------------- */
  const rows = await page.$$eval('#alliance-list .orgrow', (els) => els.map((e) => ({
    name: e.querySelector('.nm')?.textContent || '',
    count: e.querySelector('.mc')?.textContent || '',
    meta: e.querySelector('.meta')?.textContent || '',
    text: e.textContent || '',
  })));

  r.ok('every listed organization has a row', rows.length === 3, String(rows.length));
  r.ok('in the order the server sent, largest first',
    rows.map((x) => x.name).join('|') === 'Big Coalition|Lone Voice|Brand New',
    rows.map((x) => x.name).join('|'));
  r.ok('the count is exact, not banded', rows[0].count.includes('47'), rows[0].count);
  r.ok('one member reads as "1 member"', rows[1].count.trim() === '1 member', rows[1].count);
  r.ok('and an organization with nobody in it shows an honest zero',
    rows[2].count.trim() === '0 members', rows[2].count);
  r.ok('each row says when they joined', rows.every((x) => /\d{4}/.test(x.meta)),
    rows.map((x) => x.meta).join(' | '));

  /* ---- what must never appear -------------------------------------- */
  // Ranking by report count would be a public incentive to file more
  // reports, and the archive's value is that its contents were not
  // manufactured. Nothing on this page may hint at such a league table.
  const listText = (await page.textContent('#alliance-list')) || '';
  r.ok('no report count appears anywhere in the list',
    !/\breports?\b/i.test(listText), listText.slice(0, 120));
  r.ok('and no row is numbered like a league table',
    !/^\s*[1-9][.)]\s/m.test(listText), listText.slice(0, 120));

  r.ok('no uncaught errors on the directory', page.errors.length === 0, page.errors.join(' | '));
  await page.close();

  /* ---- an empty directory ------------------------------------------ */
  const bare = await openAlliance(browser, { ...DIRECTORY, organizations: [] });
  r.ok('an empty directory says so rather than showing nothing',
    await bare.$eval('#alliance-empty', (e) => e.offsetParent !== null));
  r.ok('and still carries the disclaimer',
    ((await bare.textContent('#alliance-disclaimer')) || '').length > 0);
  await bare.close();

  return r;
}
