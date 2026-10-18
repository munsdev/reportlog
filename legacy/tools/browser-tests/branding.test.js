/**
 * A deployment wearing its own name, in a browser.
 *
 * The resolution order is asserted without a database in the main suite.
 * What only exists on screen is whether the name actually reaches every
 * surface — and whether the software's attribution survives, which is the
 * thing a rename must NOT touch.
 *
 * The name is served by /api/site-access/status, the first call every page
 * makes, so supplying it here exercises the real page and the real script.
 */
import { BASE, Report } from './lib.js';
// READ FROM THE CATALOGUE, never retyped. site.test.js was fixed for
// exactly this in b44278c and this file was missed: the list below was a
// second hand-typed copy of PALETTES, so a nineteenth palette would have
// gone unmeasured here while the check went on reporting eighteen.
import { PALETTE_IDS } from '../../src/look.js';
// The real parser, not a copy. The stub below sends the same `brand` shape
// the live route sends, so these tests exercise the payload the page
// actually receives rather than a simplified one that happens to pass.
import { parseBrand, plainName, isMarked } from '../../src/look.js';

const NAME = 'Wahlbeobachtung Berlin';

async function openBranded(browser, { siteName, path = '/' }) {
  const page = await browser.newPage({ viewport: { width: 420, height: 950 } });
  await page.route('**://*.google*/**', (r) => r.abort());
  await page.route('**://*.gstatic.com/**', (r) => r.abort());
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.route('**/api/site-access/status', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      locked: false, devMode: false, devModeUntil: null,
      version: 'v0.0.01', siteName, software: 'ReportLog',
      brand: {
        parts: parseBrand(siteName),
        plain: plainName(siteName),
        marked: isMarked(siteName),
      },
    }),
  }));
  await page.goto(BASE + path, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1600);
  page.errors = errors;
  return page;
}

export default async function run(browser) {
  const r = new Report('the deployment’s name');

  /* ---- renamed ------------------------------------------------------ */
  {
    const page = await openBranded(browser, { siteName: NAME });

    r.ok('the browser tab carries it', (await page.title()).includes(NAME), await page.title());

    // THE BAR AT THE TOP OF EVERY PAGE. It carried `data-nav` and not
    // `data-brand`, so applyBrand never reached it and a renamed deployment
    // went on calling itself ReportLog in the one place that is on screen
    // no matter where you are. Nothing caught it because every other test
    // of the name reads `[data-brand]`, which is exactly the set this
    // button was missing from.
    r.ok('the bar at the top of every page carries it',
      (await page.$eval('.brand', (e) => e.textContent)) === NAME,
      await page.$eval('.brand', (e) => e.textContent));
    r.ok('and so does the lock screen',
      (await page.$eval('#lock-brand', (e) => e.textContent)) === NAME,
      await page.$eval('#lock-brand', (e) => e.textContent));

    const eyebrows = await page.$$eval('[data-brand]', (els) => els.map((e) => e.textContent));
    r.ok('every page header carries it', eyebrows.length > 15, String(eyebrows.length));
    r.ok('and not one still says ReportLog',
      eyebrows.every((t) => t === NAME), JSON.stringify([...new Set(eyebrows)]));

    const phrases = await page.$$eval('[data-brand-phrase]', (els) => els.map((e) => e.textContent));
    r.ok('sentences with the name in them are rewritten',
      phrases.length >= 4 && phrases.every((t) => t.includes(NAME)), JSON.stringify(phrases));
    r.ok('and none of them leaked a template placeholder',
      phrases.every((t) => !t.includes('{}')), JSON.stringify(phrases));
    r.ok('nor an unrendered HTML entity',
      phrases.every((t) => !t.includes('&rarr;')), JSON.stringify(phrases));

    // The one thing a rename must not touch.
    const powered = (await page.textContent('.poweredby')) || '';
    r.ok('the footer still credits ReportLog', /Powered by\s+ReportLog/.test(powered), powered);
    r.ok('and links to it', await page.$eval('.poweredby a', (e) => e.href.length > 0));

    r.ok('no uncaught errors on a renamed deployment',
      page.errors.length === 0, page.errors.join(' | '));
    await page.close();
  }

  /* ---- the About contents strip ------------------------------------- */
  {
    // ABTOC_EXTRA was a top-level array that concatenated the name at parse
    // time, before the server had answered, so it kept the default forever.
    // This is the check for that specific bug.
    const page = await openBranded(browser, { siteName: NAME, path: '/about' });
    const toc = (await page.textContent('#pane-about')) || '';
    r.ok('the About index uses the deployment name, not the default',
      !/How to use ReportLog/.test(toc), 'still found "How to use ReportLog"');
    await page.close();
  }

  /* ---- not renamed -------------------------------------------------- */
  {
    const page = await openBranded(browser, { siteName: 'ReportLog' });
    r.ok('a deployment that never chose a name looks exactly as before',
      (await page.$$eval('[data-brand]', (els) => els.every((e) => e.textContent === 'ReportLog'))));
    // The software's own name keeps its two-tone lock screen treatment.
    const lock = await page.$eval('#lock-brand', (e) => e.innerHTML);
    r.ok('and keeps the two-tone lock screen brand', lock.includes('<span class="a">'), lock);
    await page.close();
  }

  /* ---- the accent, measured where it is actually drawn -------------- */
  {
    // THE BUG THIS EXISTS FOR. The lock screen's brand sits INSIDE the light
    // card, not on the deep ground behind it, and was painting the accent
    // with the palette's on-deep value: bright gold as text on white, at
    // 1.9:1 where 4.5:1 is required.
    //
    // Nothing caught it for two compounding reasons, and both are closed
    // here. The accessibility sweep skips `display:none`, so a lock screen
    // is never scanned; and the default name carries no quotes, so no
    // accent span is ever rendered to scan. A test therefore has to mark a
    // name AND open the screen itself.
    const page = await openBranded(browser, { siteName: `Report"Log"'.org'` });
    const PALETTES = PALETTE_IDS;
    const bad = await page.evaluate((palettes) => {
      // Same two serialisations as the border check in site.test.js: a
      // plain colour comes back as rgb(0-255), anything that went through
      // color-mix() as color(srgb 0-1). Guessing either way is how a check
      // reports a number nobody should believe.
      const L = (c) => {
        const s = String(c || '');
        const nums = (s.match(/[\d.]+(?:e-?\d+)?/g) || []).map(Number);
        if (nums.length < 3) return null;
        let rgb;
        if (/^color\(\s*srgb\b/i.test(s)) rgb = nums.slice(0, 3);
        else if (/^rgba?\(/i.test(s)) rgb = nums.slice(0, 3).map((x) => x / 255);
        else return null;
        const v = rgb.map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
        return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
      };
      const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      const bgOf = (el) => {
        let n = el;
        while (n) {
          const c = getComputedStyle(n).backgroundColor;
          if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) return c;
          n = n.parentElement;
        }
        return 'rgb(255, 255, 255)';
      };
      // Open the screen for real rather than reading rules off a hidden
      // node: the card's own background is what the accent has to clear,
      // and that only resolves once something is laid out.
      const lock = document.querySelector('.lockscreen');
      if (!lock) return ['no lock screen in the page'];
      lock.classList.add('on');
      // The links to what is open without the password are drawn from
      // /api/doors; one is planted so its colour can be measured.
      const doors = document.getElementById('site-lock-doors');
      if (doors) { doors.hidden = false; doors.innerHTML = '<p>No password?</p><ul><li><a href="/list/x">Volunteer</a></li></ul>'; }
      const out = [];
      for (const palette of palettes) {
        document.documentElement.setAttribute('data-palette', palette);
        // The lock screen's own link is measured too: it sits inside the
        // same light card and took the same on-deep value, at 1.9:1.
        for (const sel of ['#lock-brand .a', '#lock-brand .b',
          '.lockscreen .lockdoors a', '.brand .a', '.brand .b']) {
          const el = document.querySelector(sel);
          if (!el) { out.push(`${palette}: ${sel} was never rendered`); continue; }
          const fg = L(getComputedStyle(el).color);
          const bg = L(bgOf(el.parentElement || el));
          if (fg === null || bg === null) { out.push(`${palette}: ${sel} unreadable colour`); continue; }
          const v = ratio(fg, bg);
          if (v < 4.5) out.push(`${palette} ${sel}: ${v.toFixed(2)}:1`);
        }
      }
      lock.classList.remove('on');
      return out;
    }, PALETTES);
    bad.forEach((v) => r.ok(v, false));
    if (!bad.length) {
      r.ok(`both accents clear 4.5:1 on the lock screen and the nav, in all ${PALETTES.length} palettes`, true);
    }
    await page.close();
  }

  /* ---- a name that is markup ---------------------------------------- */
  {
    // The name comes from a database field an operator types into. It is
    // rendered as text, so a stray angle bracket is a stray angle bracket.
    const page = await openBranded(browser, { siteName: '<b>Bold</b> & Co' });
    const first = await page.$eval('[data-brand]', (e) => e.textContent);
    r.ok('a name containing markup is shown, not interpreted',
      first === '<b>Bold</b> & Co', first);
    r.ok('and injects no elements',
      (await page.$$eval('[data-brand] b', (e) => e.length)) === 0);
    await page.close();
  }

  /* ---- the boot gate ------------------------------------------------ */
  {
    /* THE ONLY THING THAT WATCHES THIS. Two faults shared one cause and
       neither is visible to any other check: every pane is in the DOM from
       the first byte, and the name is a literal in the markup, so between
       first paint and the status call answering a locked deployment showed
       the whole site's writing and a renamed one said ReportLog and then
       corrected itself. Both are invisible to a test that waits for the page
       to settle before it looks — which is every other test in this file.

       So the call is HELD OPEN and the page is read in the middle of it.
       That is the state a visitor on a slow connection sees for real. */
    const page = await browser.newPage({ viewport: { width: 420, height: 950 } });
    await page.route('**://*.google*/**', (route) => route.abort());
    await page.route('**://*.gstatic.com/**', (route) => route.abort());
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    await page.route('**/api/site-access/status', async (route) => {
      await held;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          // LOCKED, because that is the case the gate exists for: the whole
          // point is that a visitor without the password never sees the
          // site's writing, not even for a frame.
          locked: true, devMode: false, devModeUntil: null,
          version: 'v0.0.01', siteName: NAME, software: 'ReportLog',
          brand: {
            parts: parseBrand(NAME), plain: plainName(NAME), marked: isMarked(NAME),
          },
        }),
      });
    });
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);

    const during = await page.evaluate(() => {
      const hidden = (sel) => {
        const el = document.querySelector(sel);
        return el ? getComputedStyle(el).visibility === 'hidden' : 'missing';
      };
      return {
        booting: document.documentElement.classList.contains('booting'),
        home: hidden('#pane-home'),
        bar: hidden('.tabs'),
        foot: hidden('.sitefoot'),
        brand: hidden('.brand'),
        lockBrand: hidden('#lock-brand'),
      };
    });
    r.ok('the page starts behind the boot gate', during.booting === true, String(during.booting));
    r.ok('and the site\u2019s own writing is not on screen while the first call is in flight',
      during.home === true, String(during.home));
    r.ok('nor the bar at the top of it', during.bar === true, String(during.bar));
    r.ok('nor the footer', during.foot === true, String(during.foot));
    r.ok('and no name is shown before it is known \u2014 not in the bar',
      during.brand === true, String(during.brand));
    r.ok('and not on the lock screen, which is the first word a locked deployment shows',
      during.lockBrand === true, String(during.lockBrand));

    release();
    await page.waitForFunction(
      () => !document.documentElement.classList.contains('booting'), null, { timeout: 5000 },
    );
    const after = await page.evaluate(() => ({
      lock: document.getElementById('site-lock').classList.contains('on'),
      brand: document.querySelector('.brand').textContent,
      brandVisible: getComputedStyle(document.querySelector('.brand')).visibility === 'visible',
    }));
    r.ok('the gate lifts once the call answers', after.brandVisible === true);
    r.ok('onto the lock screen, because that answer said locked', after.lock === true);
    r.ok('with the deployment\u2019s own name already painted, never the default first',
      after.brand === NAME, after.brand);
    await page.close();
  }

  {
    /* THE WATCHDOG, and it is the half that matters most. A boot gate that
       can stick is a permanently blank site, which is worse than the flash
       it replaces \u2014 so a status call that neither answers nor fails must
       still reveal the page. Held open forever here, which is what a captive
       portal or a proxy sitting on the socket does. */
    const page = await browser.newPage({ viewport: { width: 420, height: 950 } });
    await page.route('**://*.google*/**', (route) => route.abort());
    await page.route('**://*.gstatic.com/**', (route) => route.abort());
    await page.route('**/api/site-access/status', () => {});
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    let revealed = true;
    try {
      await page.waitForFunction(
        () => !document.documentElement.classList.contains('booting'), null, { timeout: 9000 },
      );
    } catch { revealed = false; }
    r.ok('a status call that never answers still reveals the page rather than leaving it blank',
      revealed === true);
    await page.close();
  }

  return r;
}
