/**
 * Every public page, in both states of the card-form flag: accessibility,
 * and the plain form being untouched by any of the card form's work.
 */
import { readFileSync } from 'node:fs';
import { BASE, Report, open, axeOn } from './lib.js';
// READ FROM THE CATALOGUE, never retyped. Both lists were hardcoded here,
// so a palette or a theme added to look.js was simply never swept — the
// check would go on passing while covering less than it claimed. Two
// themes were added on 13 September and would have slipped straight
// through. The suite's own selftest already asserts offered and painted
// agree; this makes the contrast sweep agree with both.
import { PALETTE_IDS, THEME_IDS } from '../../src/look.js';

// Whatever the app under test was started with, so a run against a dev
// server with an override still checks the real rule.
const VOLUNTEER_ORIGIN = process.env.VOLUNTEER_ORIGIN || null;

const PUBLIC_PAGES = ['/', '/submit', '/board', '/verify', '/about',
  '/about/technical', '/about/changelog', '/how', '/standards',
  '/standards/evidence', '/login', '/impressum', '/privacy'];

export default async function run(browser) {
  const r = new Report('every page');

  const scanAll = async (base, label) => {
    const bad = [];
    for (const route of PUBLIC_PAGES) {
      const page = await open(browser, base + route);
      for (const v of await axeOn(page, null)) bad.push(`${label} ${route}: ${v}`);
      await page.close();
    }
    bad.forEach((v) => r.ok(v, false));
    if (!bad.length) r.ok(`${label}: no WCAG A/AA violations on any public page`, true);
  };

  await scanAll(BASE, 'the whole site');

  // The form is markup now, not a rearrangement of some other form, so
  // these check the page as authored rather than what a script made of it.
  const page = await open(browser, `${BASE}/submit`);
  // Counted against STEPS itself rather than a number written here, which
  // is the whole point of the check: a card added to one and not the other
  // is exactly the bug it exists to catch, and a hardcoded 13 turns that
  // into an annoyance to be edited away every time the form changes.
  // A logbook's own question cards are made in script when it is chosen,
  // so they are left out of both counts; what is compared is the fixed
  // cards every report has.
  const cardCounts = await page.evaluate(() => ({
    markup: document.querySelectorAll('#rcards .card:not([data-card^="lbf-"])').length,
    steps: window.STEPS ? window.STEPS.filter((s) => !/^lbf-/.test(s.id)).length : null,
    ids: [...document.querySelectorAll('#rcards .card')].map((c) => c.dataset.card),
  }));
  r.ok('every card in STEPS has markup to match',
    cardCounts.steps !== null && cardCounts.markup === cardCounts.steps,
    JSON.stringify(cardCounts));
  r.ok('and nothing was left over from the form it replaced',
    !(await page.$('#rform .panel_component')) && !(await page.$('#card-hidden')));
  r.ok('the built-in questions are gone: a report is its logbook\'s questions',
    ['reporter', 'where', 'when', 'category', 'narrative'].every((c) => !cardCounts.ids.includes(c)),
    cardCounts.ids.join(','));
  r.ok('errors announce themselves',
    (await page.$$eval('[role="alert"]', (n) => n.length)) > 5);
  r.ok('no uncaught page errors', page.pageErrors.length === 0, page.pageErrors.join('; '));
  await page.close();

  // Separators have to be visible. This is not a WCAG rule — a decorative
  // border is exempt — but on this site the line between two entries is
  // often the ONLY thing separating them, and at 1.25:1 it was not there.
  // The list read as floating text and the spacing was doing the line's
  // job, which is how a page ends up loose and structureless.
  const edges = await open(browser, `${BASE}/about`);
  await edges.waitForTimeout(700);
  const faint = await edges.evaluate(() => {
    // TWO SPELLINGS, and reading one of them wrong is how this check lied.
    // Chromium serialises an ordinary colour as `rgb(r, g, b)` with 0-255
    // components, but a colour that went through color-mix() comes back as
    // `color(srgb r g b)` with 0-1 components. Dividing those by 255 turns
    // any mixed colour into near-black, which reported a 2.39:1 border as
    // 1.20:1 and would just as happily have hidden a real failure in the
    // other direction. So the form is matched explicitly, and anything
    // neither form returns null — unreadable is skipped, never guessed.
    const L = (c) => {
      const s = String(c || '');
      const nums = (s.match(/[\d.]+(?:e-?\d+)?/g) || []).map(Number);
      if (nums.length < 3) return null;
      let rgb;
      if (/^color\(\s*srgb\b/i.test(s)) rgb = nums.slice(0, 3);
      else if (/^rgba?\(/i.test(s)) rgb = nums.slice(0, 3).map((x) => x / 255);
      else return null;
      if (rgb.some((x) => !Number.isFinite(x))) return null;
      const v = rgb.map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
      return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
    };
    const bgOf = (el) => {
      let n = el;
      while (n) {
        const c = getComputedStyle(n).backgroundColor;
        if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) return c;
        n = n.parentElement;
      }
      return 'rgb(255,255,255)';
    };
    const bad = [];
    document.querySelectorAll('.pane.active *').forEach((el) => {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || !el.getBoundingClientRect().height) return;
      for (const side of ['Top', 'Bottom', 'Left', 'Right']) {
        if (!parseFloat(cs[`border${side}Width`])) continue;
        const bc = cs[`border${side}Color`];
        if (/rgba\(0, 0, 0, 0\)/.test(bc)) continue;
        const a = L(bc); const b = L(bgOf(el.parentElement || el));
        if (a === null || b === null) continue;
        const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        if (ratio < 1.6) bad.push(`${el.className || el.tagName} ${side} ${ratio.toFixed(2)}:1`);
      }
    });
    return [...new Set(bad)];
  });
  r.ok('every visible border separates something at 1.6:1 or better',
    faint.length === 0, faint.slice(0, 5).join('; '));

  // Two sticky bars stack above the content. Without scroll padding, an
  // anchor link, an in-page Find, or the browser restoring your position
  // all land the thing you asked for underneath them.
  await edges.evaluate(() => { window.location.hash = '#ab-how-it-works'; });
  await edges.waitForTimeout(600);
  const anchored = await edges.evaluate(() => {
    const el = document.getElementById('ab-how-it-works');
    const strip = document.getElementById('abtoc');
    const stack = document.querySelector('.tabs').offsetHeight
      + (strip && !strip.hidden ? strip.offsetHeight : 0);
    return { top: Math.round(el.getBoundingClientRect().top), stack };
  });
  r.ok('an anchor lands below the sticky bars, not behind them',
    anchored.top >= anchored.stack - 2, JSON.stringify(anchored));
  await edges.close();

  // Everything between here and the gate used to check this deployment's own
  // writing — the About document, the guide, the changelog, the standards page.
  // Those assertions belong to a deployment, not to the software, and they
  // moved out with the content they were about. What is left below is the
  // software: the gate, the public API, and the embeddable widget.


  // The password gate, with the lock forced on at the boundary rather than
  // in the database — the leak this catches was entirely in the frontend,
  // and a test that locks the real site leaves it locked if it crashes.
  //
  // What went wrong: every pane is in the DOM from the first byte. Going to
  // the one open page and pressing Back ran the ordinary router, which
  // cheerfully opened whatever was behind it. The API refused it its data,
  // so nothing private leaked — but About, the privacy policy and every
  // other word on the site were readable by someone who had no password.
  const gate = await browser.newPage({ viewport: { width: 390, height: 844 } });
  gate.on('pageerror', (e) => gate.pageErrors = (gate.pageErrors || []).concat(String(e)));
  gate.pageErrors = [];
  await gate.route('**://*.google*/**', (r) => r.abort());
  await gate.route('**://*.gstatic.com/**', (r) => r.abort());
  await gate.route('**/api/site-access/status', (r) => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ locked: true, devMode: false, devModeUntil: null, version: 'MK test' }),
  }));

  const gateState = async () => gate.evaluate(() => ({
    locked: document.getElementById('site-lock').classList.contains('on'),
    // Nothing may be mounted behind the overlay. It is opaque and covers the
    // viewport, but a gate that relies on a z-index is one CSS change from
    // being no gate at all.
    pane: (document.querySelector('.pane.active') || {}).id || null,
  }));

  await gate.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await gate.waitForTimeout(800);
  let g = await gateState();
  r.ok('a locked visitor gets the password and no page behind it',
    g.locked && g.pane === null, JSON.stringify(g));
  // A real cross-origin link now — the recruitment subdomain is a different
  // host, and reachable whether or not this app is up.
  // Whether the lock screen offers a way to reach a person, and where that
  // goes, is a deployment's choice — so what it points at is not asserted here.

  // The link in an old volunteer confirmation email must not land on a
  // password prompt. Volunteering is a list now (migration 047), open without
  // the password, so the old link lands on its form.
  await gate.goto(`${BASE}/involve/confirm/nosuchtoken`, { waitUntil: 'domcontentloaded' });
  await gate.waitForTimeout(800);
  g = await gateState();
  r.ok('an old volunteer confirmation link opens the volunteer form while locked',
    !g.locked && g.pane === 'pane-list', JSON.stringify(g));

  await gate.goBack();
  await gate.waitForTimeout(800);
  g = await gateState();
  r.ok('and pressing Back puts the password back, with nothing readable behind it',
    g.locked && g.pane === null, JSON.stringify(g));

  // The other direction has to work too, or a confirmation link becomes
  // unreachable the moment somebody presses Back once.
  await gate.goForward();
  await gate.waitForTimeout(800);
  g = await gateState();
  r.ok('Forward returns to it rather than stranding it under the lock',
    !g.locked && g.pane === 'pane-list', JSON.stringify(g));

  // And nothing else does.
  for (const path_ of ['/about', '/standards', '/board', '/how']) {
    await gate.goto(`${BASE}${path_}`, { waitUntil: 'domcontentloaded' });
    await gate.waitForTimeout(700);
    const st = await gateState();
    r.ok(`${path_} still asks for the password`, st.locked && st.pane === null, JSON.stringify(st));
  }
  r.ok('no uncaught errors behind the gate', gate.pageErrors.length === 0, gate.pageErrors.join('; '));
  await gate.close();


  // The public API. Different rules from everything else here: it is meant
  // to be read by pages we do not control, by people who will never have a
  // password for this site.
  const api = await open(browser, `${BASE}/api.html`);
  await api.waitForTimeout(400);
  const shape = await api.evaluate(async (base) => {
    const r1 = await fetch(`${base}/api/v1`);
    const r2 = await fetch(`${base}/api/v1/stats`);
    const stats = await r2.json();
    // The wording behind a sealed publication answer. Reachable here for the
    // same reason stats is: a published report seals the digest of the
    // sentence its reporter answered, and somebody checking that report is by
    // definition somebody with no password for this site.
    const r3 = await fetch(`${base}/api/v1/consent-texts`);
    const texts = r3.ok ? await r3.json() : {};
    // And the gated copy must not be the one people are pointed at.
    const r4 = await fetch(`${base}/api/reports/consent-texts`);
    return {
      index: r1.status, statsStatus: r2.status,
      consentTextsStatus: r3.status,
      consentTextsListed: Boolean((r1.status === 200) && texts.texts && texts.texts.length),
      consentTextsDigests: (texts.texts || []).every((t) => /^[a-f0-9]{64}$/.test(t.digest || '')),
      consentTextsNoPerson: (texts.texts || []).every((t) => !('introduced_by' in t)),
      gatedCopyGone: r4.status === 404 || r4.status === 401,
      cors: r2.headers.get('access-control-allow-origin'),
      cache: r2.headers.get('cache-control'),
      // The two rules the endpoint exists to enforce.
      noBareTotal: !Object.keys(stats).some((k) => typeof stats[k] === 'number' && k !== 'api_version'),
      denominatorVisible: ['published', 'under_review', 'declined', 'unclear', 'withdrawn']
        .every((k) => k in (stats.confirmed_reports || {}).by_disposition),
      licenced: Boolean(stats.licence && stats.documentation),
    };
  }, BASE);
  r.ok('the public API answers, with CORS and a cache window',
    shape.index === 200 && shape.statsStatus === 200 && shape.cors === '*'
      && /max-age=60/.test(shape.cache || ''), JSON.stringify(shape));
  r.ok('and still publishes no bare total, with the denominator visible',
    shape.noBareTotal && shape.denominatorVisible && shape.licenced, JSON.stringify(shape));
  r.ok('the wording behind a sealed publication answer is readable without the password',
    shape.consentTextsStatus === 200 && shape.consentTextsListed, JSON.stringify(shape));
  r.ok('and every wording it publishes is addressed by a full digest',
    shape.consentTextsDigests, JSON.stringify(shape));
  r.ok('and names a role rather than a person, because this leaves the building',
    shape.consentTextsNoPerson, JSON.stringify(shape));

  // The documentation is a static file so it is reachable while the site
  // itself is closed — an API nobody can read the documentation for is not
  // usable by the people it is for.
  const docs = await api.evaluate(() => ({
    title: document.title,
    hasWidget: document.body.textContent.includes('reportlog-stats'),
    describesFields: document.body.textContent.includes('by_veracity'),
  }));
  r.ok('the documentation page carries the widget and the field reference',
    /Public API/.test(docs.title) && docs.hasWidget && docs.describesFields,
    JSON.stringify(docs));
  r.ok('no uncaught errors on the API documentation', api.pageErrors.length === 0,
    api.pageErrors.join('; '));
  await api.close();

  // The widget renders the whole response, on a page whose own styles are
  // actively hostile — a host page styling its own h2 is what silently
  // repainted this the first time it was tried.
  const host = await browser.newPage({ viewport: { width: 900, height: 1200 } });
  host.pageErrors = [];
  host.on('pageerror', (e) => host.pageErrors.push(String(e)));
  const widget = readFileSync(new URL('../embed/stats-widget.html', import.meta.url), 'utf8');
  await host.route('**/api/v1/stats', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify({
      as_of: '2026-09-01T20:00:00.000Z', note: 'A note.', release: 'MK test',
      licence: 'CC BY 4.0', confirmed_reports: {
        by_disposition: { published: 412, under_review: 63, declined: 28, unclear: 9, withdrawn: 4 },
        excludes: 'Not counted.' },
      published_reports: {
        by_veracity: { pending: 301, likely_true: 51 },
        by_reporter_type: { credentialed_observer: 174, member_of_public: 238 },
        by_account_type: { direct: 356, secondhand: 56 },
        by_state: { PA: 88, GA: 71 },
        by_category_group: { A: { label: 'Someone could not vote', count: 141 } },
        corroboration: { corroborated_accounts: 137, single_accounts: 275,
          distinct_incidents_with_multiple_accounts: 54 } },
    }),
  }));
  await host.setContent(
    '<style>body{font-family:Georgia;color:#900}h2,h3{color:#900;font-family:Georgia}</style>'
    + '<h2>Another site</h2>' + widget, { waitUntil: 'networkidle' });
  await host.waitForTimeout(500);
  const drawn = await host.evaluate(() => {
    const w = document.getElementById('reportlog-stats');
    const h2 = w.querySelector('h2');
    return {
      sections: w.querySelectorAll('h3').length,
      numbers: w.querySelectorAll('.el-n').length,
      // Not the host page's crimson: the widget keeps its own look.
      headingColour: getComputedStyle(h2).color,
      text: w.textContent.length,
    };
  });
  r.ok('the widget renders every section and keeps its own styling',
    drawn.sections >= 6 && drawn.numbers > 10 && drawn.headingColour !== 'rgb(153, 0, 0)'
      && drawn.text > 500, JSON.stringify(drawn));
  r.ok('no uncaught errors in the widget', host.pageErrors.length === 0, host.pageErrors.join('; '));
  await host.close();

  // The docs embed a copy of the widget for people to paste. A stale copy
  // is worse than none: it is the version that gets used.
  const docHtml = readFileSync(new URL('../../public/api.html', import.meta.url), 'utf8');
  const escaped = widget.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  r.ok('the pasteable copy in the documentation is the widget, character for character',
    docHtml.includes(escaped.trim()),
    'the two have drifted — regenerate, see tools/embed/README.md');

  /* ---- every offered look, measured ---------------------------------- */
  {
    // The palettes came from a preview built around different components,
    // so "it looked fine there" proves nothing here. Every combination an
    // operator can actually reach is measured on real pages.
    //
    // It found seven of the nine light palettes failing on the first port —
    // all of them text on the dark nav, where a brand colour drawn for a
    // light surface measured as low as 1.66:1, and the palettes carried
    // -on-deep tokens for exactly that ground that nothing was using. It
    // then found sixty of a hundred and twelve pairs failing the moment the
    // nine DARK palettes were switched on, which is what the
    // inverse-surface pass fixed.
    //
    // MORE THAN ONE PAGE, deliberately. The failures were not evenly spread:
    // the worst were on Standards and inside the verify panel, and a sweep
    // that only looked at the front page would have passed all of them.
    const PALETTES = PALETTE_IDS;
    const THEMES = THEME_IDS;
    const ROUTES = ['/standards', '/', '/submit', '/about', '/verify'];
    const bad = [];
    for (const route of ROUTES) {
      const page = await open(browser, `${BASE}${route}`);
      // THE NAME IS MARKED FOR THIS SWEEP, and that is not decoration. The
      // accent spans only exist when a deployment's name carries quotes, so
      // a sweep over the default name never renders one and never measures
      // it. The first accent on a light card measured 1.9:1 and nothing
      // caught it for exactly that reason.
      await page.evaluate(() => {
        const brand = {
          parts: [
            { text: 'Report', mark: '' },
            { text: 'Log', mark: 'a' },
            { text: '.org', mark: 'b' },
          ],
          plain: 'ReportLog.org',
          marked: true,
        };
        document.querySelectorAll('[data-brand],.brand,.lockbrand').forEach((el) => {
          if (typeof window.paintBrand === 'function') window.paintBrand(el, brand, brand.plain);
        });
      });
      for (const palette of PALETTES) {
        for (const theme of (palette === 'flint' ? THEMES : ['signal'])) {
          await page.evaluate(([p2, t2]) => {
            document.documentElement.setAttribute('data-palette', p2);
            document.documentElement.setAttribute('data-theme', t2);
          }, [palette, theme]);
          await page.waitForTimeout(80);
          for (const v of await axeOn(page, null)) {
            if (/color-contrast/.test(v)) bad.push(`${palette}/${theme}${route}: ${v}`);
          }
        }
      }
      await page.close();
    }
    bad.forEach((v) => r.ok(v, false));
    if (!bad.length) {
      r.ok(`every offered palette and theme passes WCAG AA contrast, on a marked name `
        + `(${PALETTES.length} palettes and ${THEMES.length} themes over ${ROUTES.length} pages)`, true);
    }
  }

  /* ---- the words an operator writes on their own pages -------------- */
  {
    // The page is in the DOM from the first byte with the shipped wording
    // in it, so it must read correctly before the fetch answers, after it
    // answers, and if it never does.
    const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
    await page.route('**://*.google*/**', (x) => x.abort());
    await page.route('**://*.gstatic.com/**', (x) => x.abort());
    await page.route('**/api/legal/copy', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        home_headline: 'Every incident on the Ruhr line, on the record.',
        home_intro: 'Drivers and dispatchers file here.\n\nAnyone may read it.',
        standards: 'We publish what two moderators agree on.',
      }),
    }));
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1400);

    r.ok('the operator\u2019s headline replaces the shipped one',
      (await page.textContent('[data-copy="home_headline"]'))
        === 'Every incident on the Ruhr line, on the record.');
    r.ok('and their paragraph breaks survive',
      (await page.textContent('[data-copy="home_intro"]'))
        === 'Drivers and dispatchers file here.\n\nAnyone may read it.');
    // A slot they did not write keeps the shipped wording rather than going
    // blank — every slot always resolves to something.
    r.ok('a slot they left alone still says what it shipped saying',
      ((await page.textContent('[data-copy="home_lede"]')) || '').includes('A moderator reviews it'));
    await page.close();
  }

  /* ---- an optional slot shows nothing until it is written ------------- */
  {
    /* THE EXCEPTION TO THE RULE ABOVE, and the reason it exists. Every slot
       checked above falls back to the wording that ships, which is right for a
       front page: obviously unfinished beats looking finished. It is wrong for
       an extra paragraph on the reporting form, where the reader is somebody
       filing an account of something that happened to them — a placeholder
       there spends their attention on a note meant for the operator.

       So an optional slot is `hidden` in the markup and revealed only once
       somebody writes it. Checked on the REPORTING FORM, because that is the
       page where getting it wrong costs the most. */
    const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
    await page.route('**://*.google*/**', (x) => x.abort());
    await page.route('**://*.gstatic.com/**', (x) => x.abort());
    await page.route('**/api/legal/copy', (route) => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({}),
    }));
    await page.goto(`${BASE}/submit`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1400);

    r.ok('a reporter is shown nothing where nobody has written anything',
      await page.$eval('[data-copy="submit_intro"]', (e) => e.hidden));
    // And the software's own promise beside it is NOT a slot: an operator who
    // could rewrite "sealed and chained" could make the form lie about what
    // happens to what somebody tells it.
    r.ok('while the form\u2019s own promise is there and is not editable',
      /timestamped/.test((await page.textContent('#pane-submit .lede')) || '')
      && !(await page.$('#pane-submit .lede[data-copy]')));
    await page.close();
  }

  {
    const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
    await page.route('**://*.google*/**', (x) => x.abort());
    await page.route('**://*.gstatic.com/**', (x) => x.abort());
    await page.route('**/api/legal/copy', (route) => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ submit_intro: 'File incidents from the Munich count here.' }),
    }));
    await page.goto(`${BASE}/submit`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1400);
    r.ok('and it appears, with their words, once they have written it',
      !(await page.$eval('[data-copy="submit_intro"]', (e) => e.hidden))
      && (await page.textContent('[data-copy="submit_intro"]'))
        === 'File incidents from the Munich count here.');
    await page.close();
  }

  {
    // Somebody else's writing arriving from a database. Published as typed,
    // never interpreted — the same rule as the imprint.
    const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
    await page.route('**://*.google*/**', (x) => x.abort());
    await page.route('**://*.gstatic.com/**', (x) => x.abort());
    await page.route('**/api/legal/copy', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ home_intro: '<img src=x onerror="window.__pwned=1">' }),
    }));
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1400);
    r.ok('markup in an operator\u2019s copy is shown, not interpreted',
      (await page.$$eval('[data-copy="home_intro"] *', (els) => els.length)) === 0);
    r.ok('and injects nothing', (await page.evaluate(() => window.__pwned)) === undefined);
    await page.close();
  }

  {
    // The safe direction: a fetch that never answers leaves the shipped
    // wording, which is the same string the module carries as the fallback.
    const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
    await page.route('**://*.google*/**', (x) => x.abort());
    await page.route('**://*.gstatic.com/**', (x) => x.abort());
    await page.route('**/api/legal/copy', (route) => route.abort());
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1400);
    r.ok('a copy read that fails leaves the page reading correctly',
      ((await page.textContent('[data-copy="home_headline"]')) || '')
        .includes('cannot be quietly changed'));
    await page.close();
  }

  /* ---- the imprint and the privacy policy --------------------------- */
  // Both panes used to say an operator publishes their own there and gave
  // them no way to. Now they carry it — and, until one is written, they say
  // that plainly rather than showing a placeholder somebody might mistake
  // for a notice.
  const legalPage = async (body) => {
    const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
    await page.route('**://*.google*/**', (x) => x.abort());
    await page.route('**://*.gstatic.com/**', (x) => x.abort());
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    if (body !== null) {
      await page.route('**/api/legal', (route) => route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify(body),
      }));
    } else {
      // Nothing answers at all: the failure case.
      await page.route('**/api/legal', (route) => route.abort());
    }
    await page.goto(`${BASE}/impressum`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    page.pageErrors = errors;
    return page;
  };

  {
    const page = await legalPage({ impressum: null, privacy: null });
    const text = (await page.textContent('#pane-impressum')) || '';
    r.ok('an unwritten imprint says it has not been published', /has not published an imprint/i.test(text), text.slice(0, 120));
    r.ok('and shows no placeholder notice', await page.$eval('#impressum-text', (e) => e.hidden));
    const priv = (await page.textContent('#pane-privacy')) || '';
    r.ok('and the same for the privacy policy', /has not published a privacy policy/i.test(priv), priv.slice(0, 120));
    await page.close();
  }

  {
    const written = 'Munich Incident Archive e.V.\nBeispielstraße 1\n80331 München';
    const page = await legalPage({ impressum: written, privacy: null });
    r.ok('an operator\u2019s imprint is shown as written, newlines kept',
      (await page.textContent('#impressum-text')) === written);
    r.ok('and the "not published" wording is gone',
      await page.$eval('#impressum-none', (e) => e.hidden));
    // Checked by what the element is set to rather than by whether it is on
    // screen: the privacy pane is not the active one on this route, so
    // everything inside it is hidden either way.
    r.ok('while the unwritten policy still says so',
      !(await page.$eval('#privacy-none', (e) => e.hidden))
      && await page.$eval('#privacy-text', (e) => e.hidden));
    await page.close();
  }

  {
    // Somebody else's writing arriving from a database. Published as typed,
    // never interpreted.
    const page = await legalPage({
      impressum: '<img src=x onerror="window.__pwned=1"><b>not bold</b>',
      privacy: null,
    });
    r.ok('markup in an operator\u2019s text is shown, not interpreted',
      (await page.$$eval('#impressum-text *', (els) => els.length)) === 0);
    r.ok('and injects nothing', (await page.evaluate(() => window.__pwned)) === undefined);
    await page.close();
  }

  {
    // The safe direction to be wrong in: a deployment that has published no
    // imprint must never appear to have published one.
    const page = await legalPage(null);
    r.ok('a legal read that fails leaves the page saying nothing is published',
      !(await page.$eval('#impressum-none', (e) => e.hidden))
      && await page.$eval('#impressum-text', (e) => e.hidden));
    r.ok('and raises no uncaught error', page.pageErrors.length === 0, page.pageErrors.join(' | '));
    await page.close();
  }



  return r;
}
