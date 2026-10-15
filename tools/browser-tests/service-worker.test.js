/**
 * A returning browser gets the code of the deploy it is looking at.
 *
 * WHY THIS EXISTS. Page loads were network-first so a deploy would land
 * immediately, but every script and stylesheet was served CACHE-FIRST,
 * refreshed only when somebody bumped the cache name in public/sw.js. Nobody
 * did for 37 commits. A browser that had visited once kept that day's
 * JavaScript forever, under every later page — new HTML running old modules.
 * It surfaced on the first real install, where the admin pane went on drawing
 * the old build line after the server had moved on.
 *
 * Every other suite here starts with an empty profile, which is exactly the
 * browser this fault never touches. So this one makes a RETURNING browser:
 * it lets the worker take control, then plants an old copy of a real script
 * in the worker's cache — what a previous deploy would have left there — and
 * asks whether the page is handed that copy or the real one.
 */
import { BASE, Report, open } from './lib.js';

const STALE = '/* AN OLDER DEPLOY LEFT THIS HERE */';

export default async function run(browser) {
  const r = new Report('a returning browser');

  const page = await open(browser, `${BASE}/`, { width: 900, height: 900 });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  const controlled = await page.evaluate(() => Boolean(navigator.serviceWorker.controller));
  r.ok('the service worker is controlling the page', controlled);

  const plant = (path, body, type) => page.evaluate(async ({ path, body, type }) => {
    const name = (await caches.keys()).find((k) => k.startsWith('reportlog-shell-'));
    const c = await caches.open(name);
    await c.put(path, new Response(body, { headers: { 'Content-Type': type } }));
    return name;
  }, { path, body, type });
  const fetchText = (path) => page.evaluate(async (p) => (await fetch(p)).text(), path);

  // Scripts: an old copy in the cache must not be what the page receives.
  const cacheName = await plant('/js/nav.js', STALE, 'text/javascript');
  r.ok('there is a shell cache to plant in', Boolean(cacheName), String(cacheName));
  const script = await fetchText('/js/nav.js');
  r.ok('A SCRIPT COMES FROM THE SERVER, not from a copy an older deploy left behind',
    !script.includes(STALE) && script.length > 200, script.slice(0, 80));

  // Styles: same rule, same reason — new markup with old CSS draws wrong.
  await plant('/css/page.css', STALE, 'text/css');
  const style = await fetchText('/css/page.css');
  r.ok('so does a stylesheet', !style.includes(STALE) && style.length > 200, style.slice(0, 80));

  // And the page as a whole runs, with an old copy of every module it
  // imports planted underneath it. Under the old worker this reload ran the
  // planted comment as nav.js and everything importing from it broke.
  await plant('/js/nav.js', STALE, 'text/javascript');
  page.pageErrors.length = 0;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  r.ok('a reload over a stale cache runs the deployed code without errors',
    page.pageErrors.length === 0, page.pageErrors.join(' | '));

  // Offline, the cache is exactly what it is for.
  await page.context().setOffline(true);
  const offline = await page.evaluate(async () => {
    try { return (await (await fetch('/js/routes.js')).text()).length; } catch { return -1; }
  });
  r.ok('offline, a script still comes from the cache', offline > 200, `got ${offline}`);
  await page.context().setOffline(false);

  // Icons stay cache-first on purpose: they change only with a cache bump,
  // and staleness there costs nothing. Stated so it reads as a choice.
  await plant('/icons/favicon-32.png', 'planted', 'image/png');
  r.ok('an icon is still served from the cache, which is deliberate',
    (await fetchText('/icons/favicon-32.png')) === 'planted');

  await page.close();
  /* ---- the white page: one stale module beside new ones ---------------- */
  // 10 October: an owner's browser held an old copy of one module after an
  // update. Its missing export stopped every module, and the page — hidden
  // until the app says it booted — stayed white. A private window was fine.
  // A module with no exports is that old copy, near enough.
  const OLD_MODULE = 'export const nothingTheOthersNeed = 1;\n';
  // SERVICE WORKERS BLOCKED for these two: Playwright's interception does not
  // see a worker's own fetches, so with one running the "old copy" below would
  // be quietly replaced by the real file and neither check would test anything.
  const isolated = async () => (await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' })).newPage();
  {
    let served = 0;
    const page = await isolated();
    await page.route('**://*.google*/**', (q) => q.abort());
    await page.route('**://*.gstatic.com/**', (q) => q.abort());
    await page.route('**/js/routes.js', (route) => {
      served += 1;
      // Stale the first time only; the repair's refetch gets the real file.
      if (served === 1) return route.fulfill({ status: 200, contentType: 'text/javascript', body: OLD_MODULE });
      return route.continue();
    });
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(9000);
    const st = await page.evaluate(() => ({
      booting: document.documentElement.classList.contains('booting'),
      ran: document.documentElement.hasAttribute('data-modules'),
      fail: Boolean(document.getElementById('bootfail')),
    }));
    r.ok('a stale module no longer means a white page: it refetches, reloads once, and boots',
      served >= 2 && st.ran && !st.booting && !st.fail, JSON.stringify({ served, ...st }));
    await page.context().close();
  }
  {
    const page = await isolated();
    await page.route('**://*.google*/**', (q) => q.abort());
    await page.route('**://*.gstatic.com/**', (q) => q.abort());
    await page.route('**/js/routes.js', (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: OLD_MODULE }));
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(14000);
    const st = await page.evaluate(() => ({
      booting: document.documentElement.classList.contains('booting'),
      fail: (document.getElementById('bootfail') || {}).textContent || '',
    }));
    r.ok('and if refetching cannot fix it, it says so with a button instead of staying white',
      !st.booting && /did not load properly/.test(st.fail), JSON.stringify(st));
    await page.context().close();
  }

  return r;
}
