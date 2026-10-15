/**
 * The rendered install guide at /docs.
 *
 * NOTHING COVERED THIS PAGE UNTIL 7 OCTOBER, which is how it shipped with a
 * horizontal scroll on every phone: `ol.steps>li` is a `34px 1fr` grid, a
 * `1fr` track is `min-width:auto`, and so the step body refused to shrink
 * below the longest `sudo adduser --system --group --home …` line inside it.
 * The body stayed 528px wide in a 390px viewport and the whole page slid
 * sideways. `pre` already had `overflow-x:auto` and never got to use it.
 *
 * Every check here is about the page being USABLE rather than correct: the
 * install guide is read on a laptop beside a terminal and on a phone beside
 * a laptop, and a guide you have to drag left and right to read is a guide
 * people stop following.
 */
import { BASE, Report, settle, PHONE } from './lib.js';

/** Does the document itself scroll sideways? */
const slidesSideways = (page) => page.evaluate(() => (
  document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
));

/**
 * Contrast, measured against WHAT IS ACTUALLY PAINTED under the text.
 *
 * THE PAGE SHIPPED WITH A 1.21:1 CHOOSER IN DARK MODE and three green suites
 * said nothing: `.choice-opt` set `background:#fff` with `color:inherit`, so
 * in dark mode the button stayed white while `inherit` brought down --ink,
 * which is near-white. White buttons, pale grey labels, on the first control
 * anybody is asked to touch. It was found by opening the page.
 *
 * TWO THINGS MAKE THIS HARDER THAN IT LOOKS, and getting either wrong
 * reports a failure that is not there — which is worse than no check,
 * because somebody then "fixes" working colours:
 *
 *  - ALPHA MUST BE COMPOSITED. A copy button on `rgba(255,255,255,.07)` over
 *    a near-black code block is near-black, not white.
 *  - THE DOM IS NOT THE PAINT ORDER. That button is absolutely positioned
 *    over a code block that is its SIBLING, so walking parentElement finds
 *    the page background. `elementsFromPoint` returns what is really under
 *    the point, and the element's OWN background belongs in that stack too.
 */
const RATIOS = `(() => {
  const parse = (s) => { const n = (s.match(/[-\\d.]+/g) || []).map(Number);
    return n.length >= 3 ? { r: n[0], g: n[1], b: n[2], a: n.length > 3 ? n[3] : 1 } : null; };
  const bgOf = (el) => {
    const rect = el.getBoundingClientRect();
    const x = Math.min(innerWidth - 1, Math.max(0, rect.left + rect.width / 2));
    const y = Math.min(innerHeight - 1, Math.max(0, rect.top + rect.height / 2));
    const under = document.elementsFromPoint(x, y);
    const at = under.indexOf(el);
    const stack = [];
    for (const n of (at >= 0 ? under.slice(at) : under)) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0) { stack.push(c); if (c.a === 1) break; }
    }
    stack.push({ r: 255, g: 255, b: 255, a: 1 });
    let out = stack[stack.length - 1];
    for (let i = stack.length - 2; i >= 0; i--) {
      const t = stack[i];
      out = { r: t.r * t.a + out.r * (1 - t.a), g: t.g * t.a + out.g * (1 - t.a),
              b: t.b * t.a + out.b * (1 - t.a), a: 1 };
    }
    return out;
  };
  const lum = (c) => { const f = (v) => { v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const SELS = ['.choice-opt', '.choice-q', '.setup .hint', '.setup input',
    '.setup .needs', '.setup .has-default', '.cleared', 'button.copy', 'pre .c'];
  return SELS.map((sel) => {
    const el = document.querySelector(sel);
    if (!el) return { sel, missing: true };
    el.scrollIntoView({ block: 'center' });
    const cs = getComputedStyle(el);
    const bg = bgOf(el);
    let fg = parse(cs.color);
    if (fg.a < 1) fg = { r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a),
                         b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 };
    const l1 = lum(fg), l2 = lum(bg);
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    const px = parseFloat(cs.fontSize);
    const large = px >= 24 || (Number(cs.fontWeight) >= 700 && px >= 18.66);
    return { sel, ratio, need: large ? 3 : 4.5, px,
      fg: [fg.r, fg.g, fg.b].map(Math.round), bg: [bg.r, bg.g, bg.b].map(Math.round) };
  });
})()`;

/**
 * Walk through the start screen, the way a reader does.
 *
 * THE GUIDE IS GATED BEHIND IT ON A FIRST VISIT, so a check that measures
 * anything in the guide must get past it first. Without this the phone
 * no-horizontal-scroll check measures `display:none` elements, which are
 * 0px wide and pass for the wrong reason, and the contrast check finds no
 * paint stack and composites everything onto white.
 *
 * Returns whether it had to click, so a test can assert the gate was there.
 */
const openStartScreen = async (page) => {
  // The suite shares one browser, so localStorage carries `started` over from
  // whichever block clicked through first — and then the panels are hidden and
  // a fill times out. This takes the same route back a reader does: the nav
  // button. Idempotent: it does nothing when the screen is already open.
  const panel = await page.$('[data-start-screen]');
  if (panel && await panel.isVisible()) return;
  const back = await page.$('[data-open-start]');
  if (back && await back.isVisible()) { await back.click(); await settle(page); }
};

const enterGuide = async (page) => {
  const go = await page.$('.startgo');
  if (!go) return false;
  if (!(await go.isVisible())) return false;
  await go.click();
  await settle(page);
  return true;
};

export default async function run(browser) {
  const r = new Report('the install guide page');

  /* ---- the fill-in panel actually reaches every command -------------- */
  {
    const page = await browser.newPage();
    // A FRESH READER EVERY TIME. One browser is shared by the whole suite, so
    // `started` and the saved answers leak between blocks and decide whether
    // the start screen is up — which is how a fill timed out against a panel
    // another block had clicked past.
    await page.addInitScript(() => { try { localStorage.clear(); } catch (e) { /* private window */ } });
    await page.goto(`${BASE}/docs`, { waitUntil: 'networkidle' });
    // NOT entering the guide here: this block types into the panel, and the
    // panel is what the start screen IS. The commands are read with
    // textContent, which does not care that the guide is not on screen yet.
    await openStartScreen(page);
    await settle(page);

    // textContent, NOT innerText. A command block inside a collapsed
    // <details> has an empty innerText, so reading it that way reports a
    // substitution that did not happen — which is how an hour went into
    // chasing `adduser` through a working regex.
    const commands = () => page.evaluate(() =>
      [...document.querySelectorAll('.cmd pre')].map((x) => x.textContent).join('\n'));

    // EVERY FIELD MUST EARN ITS PLACE. A panel field whose placeholder
    // appears in no command is a box that does nothing when you type in it.
    const placeholders = await page.evaluate(() =>
      [...document.querySelectorAll('[data-setup-panel] input')].map((i) => i.placeholder));
    const before = await commands();
    const dead = placeholders.filter((ph) => !before.includes(ph));
    r.ok('every panel field substitutes into at least one command',
      dead.length === 0, dead.join(', '));

    const VALUES = {
      host: 'log.myarchive.net', ip: '203.0.113.99', admin: 'someone',
      email: 'someone@example.net', dir: '/opt/rl',
    };
    for (const [id, v] of Object.entries(VALUES)) {
      if (await page.$(`#f-${id}`)) await page.fill(`#f-${id}`, v);
    }
    await settle(page);
    const after = await commands();

    // NOT ONE PLACEHOLDER SURVIVES. This is the promise the panel makes —
    // copy the commands without editing them — and the only honest way to
    // check it is to look for the shipped example values afterwards.
    const left = placeholders.filter((ph) => after.includes(ph));
    r.ok('NOTHING A READER TYPED IS LEFT AS AN EXAMPLE VALUE',
      left.length === 0, left.join(', '));
    for (const v of Object.values(VALUES)) {
      r.ok(`the commands carry ${v}`, after.includes(v));
    }
    // AND THE COMMANDS IN THE PROSE, not just the blocks. The troubleshooting
    // fold-outs are where a stuck reader is — `ssh-keygen -R <ip>` after a
    // rebuild, the host/nslookup fallbacks when dig is missing — and they were
    // left showing example values, so the page filled in every command that
    // works and none of the ones you reach for when it does not.
    const prose = await page.evaluate(() =>
      [...document.querySelectorAll('code:not(pre code)')].map((c) => c.textContent).join('\n'));
    const staleInline = placeholders.filter((ph) => prose.includes(ph));
    r.ok('INLINE COMMANDS ARE FILLED IN TOO', staleInline.length === 0, staleInline.join(', '));
    r.ok('and every one of them can be clicked to copy', await page.evaluate(() =>
      [...document.querySelectorAll('code:not(pre code)')]
        .every((c) => c.classList.contains('cancopy') && c.getAttribute('tabindex') === '0')));

    // The registrable domain is DERIVED from the hostname rather than asked
    // for: NS records live at the zone apex, so `dig NS <hostname>` answers
    // nothing and reads as a broken zone.
    r.ok('and the domain is derived for the nameserver lookup',
      after.includes('NS myarchive.net'), 'dig NS still names the example domain');

    // A blank field keeps its default, which is what the panel says it does.
    await page.fill('#f-dir', '');
    await settle(page);
    r.ok('clearing a field puts its default back',
      (await commands()).includes('/srv/reportlog'));

    // AND THE SERVICE ACCOUNT IS NOT OFFERED AS A FIELD. `reportlog` is the
    // unit name, the repository name, the database and the account all at
    // once, so substituting the bare word rewrote the clone URL and every
    // systemctl command. It is a stated fact in the panel instead.
    r.ok('no field offers to rename the service account',
      !placeholders.includes('reportlog'),
      'a `reportlog` placeholder is back — it would rename units and the repo');
    r.ok('and the clone URL and unit name survived everything typed above',
      after.includes('munsdev/reportlog.git') && /journalctl -u reportlog\b/.test(after));

    // NO PERSONAL NAME IN A COMMAND SOMEBODY ELSE WILL PASTE. The guide once
    // named a real person's account in `adduser`, so a stranger following it
    // literally made an account named after this project's maintainer. Every
    // login account the shipped page creates is the generic `admin`.
    const users = [...before.matchAll(/^\s*(?:sudo\s+)?adduser\s+(?!--)(\S+)/gm)].map((m) => m[1]);
    r.ok('no personal name in any command',
      users.length > 0 && users.every((u) => u === 'admin'), users.join(', '));
    await page.close();
  }

  /* ---- one step at a time -------------------------------------------- */
  {
    const page = await browser.newPage();
    await page.addInitScript(() => { try { localStorage.clear(); } catch (e) { /* private */ } });
    await page.goto(`${BASE}/docs`, { waitUntil: 'networkidle' });
    await enterGuide(page);

    const live = () => page.evaluate(() => [...document.querySelectorAll('ol.steps > li')]
      .filter((li) => !li.hidden && !li.classList.contains('stepaway')).length);
    const all = await live();
    r.ok('the whole guide is the default, not the wizard', all > 5, `${all} steps`);

    await page.click('.walktoggle');
    await settle(page);
    r.ok('ONE STEP AT A TIME SHOWS EXACTLY ONE', (await live()) === 1);
    await page.click('[data-walk-next]');
    await settle(page);
    r.ok('and Next moves to the second',
      (await page.textContent('[data-walk-at]')).startsWith('Step 2'));

    // THE BAR BELONGS TO THE GUIDE. `walk` is remembered, so a reader who
    // turned it on once came back to a fixed Next button under the start
    // screen, stepping through a list that was not on screen.
    await page.click('[data-open-start]');
    await settle(page);
    r.ok('the walk bar hides behind the start screen',
      await page.evaluate(() => document.querySelector('[data-walk-bar]').hidden));
    await page.click('.startgo');
    await settle(page);
    r.ok('and comes back with the guide',
      await page.evaluate(() => !document.querySelector('[data-walk-bar]').hidden));

    // IT IS A VIEW, NOT A SECOND COPY. Turning it off has to put the document
    // back, or there are two versions of the guide to keep level.
    await page.click('.walktoggle');
    await settle(page);
    r.ok('turning it off restores every step', (await live()) === all);
    await page.close();
  }

  /* ---- a saved step that is rubbish ---------------------------------- */
  {
    // Its OWN page, with no storage-clearing init script: the point is what
    // happens when the page LOADS with a bad saved value, so it has to
    // survive the navigation.
    const page = await browser.newPage();
    await page.addInitScript(() => {
      try {
        localStorage.setItem('reportlog-install-guide',
          JSON.stringify({ started: true, walk: true, at: 'rubbish' }));
      } catch (e) { /* private window */ }
    });
    await page.goto(`${BASE}/docs`, { waitUntil: 'networkidle' });
    await settle(page);

    // Browser storage is INPUT. `undefined + 1` is NaN, Math.min(NaN, 12) is
    // NaN, and the bar read "Step NaN of 13" for ever after because every
    // later click did NaN + 1.
    r.ok('A NONSENSE SAVED STEP CANNOT PRODUCE NaN',
      (await page.textContent('[data-walk-at]')).startsWith('Step 1'),
      await page.textContent('[data-walk-at]'));
    await page.click('[data-walk-next]');
    await settle(page);
    r.ok('and Next still advances from it',
      (await page.textContent('[data-walk-at]')).startsWith('Step 2'),
      await page.textContent('[data-walk-at]'));
    await page.close();
  }

  /* ---- contrast, in BOTH themes -------------------------------------- */
  for (const scheme of ['light', 'dark']) {
    const ctx = await browser.newContext({ colorScheme: scheme });
    const page = await ctx.newPage();
    // A FRESH READER EVERY TIME. One browser is shared by the whole suite, so
    // `started` and the saved answers leak between blocks and decide whether
    // the start screen is up — which is how a fill timed out against a panel
    // another block had clicked past.
    await page.addInitScript(() => { try { localStorage.clear(); } catch (e) { /* private window */ } });
    await page.goto(`${BASE}/docs`, { waitUntil: 'networkidle' });
    await enterGuide(page);
    await settle(page);
    const rows = await page.evaluate(RATIOS);
    const missing = rows.filter((x) => x.missing).map((x) => x.sel);
    r.ok(`${scheme}: every measured element is still on the page`,
      missing.length === 0, missing.join(', '));
    const bad = rows.filter((x) => !x.missing && x.ratio < x.need)
      .map((x) => `${x.sel} ${x.ratio.toFixed(2)} (needs ${x.need}) ` +
        `fg rgb(${x.fg}) on rgb(${x.bg})`);
    r.ok(`${scheme}: NOTHING IS BELOW WCAG AA`, bad.length === 0, bad.join(' | '));
    await ctx.close();
  }


  /* ---- phone, which is where it broke --------------------------------- */
  {
    const page = await browser.newPage({ viewport: PHONE });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    // A FRESH READER EVERY TIME. One browser is shared by the whole suite, so
    // `started` and the saved answers leak between blocks and decide whether
    // the start screen is up — which is how a fill timed out against a panel
    // another block had clicked past.
    await page.addInitScript(() => { try { localStorage.clear(); } catch (e) { /* private window */ } });
    await page.goto(`${BASE}/docs`, { waitUntil: 'networkidle' });
    await enterGuide(page);

    r.ok('the guide answers at /docs', Boolean(await page.$('ol.steps')));
    r.ok('AND DOES NOT SCROLL SIDEWAYS ON A PHONE', !(await slidesSideways(page)));

    // The specific thing that caused it: a step body wider than the screen.
    const widest = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      let worst = 0;
      document.querySelectorAll('ol.steps>li>div').forEach((d) => {
        worst = Math.max(worst, Math.round(d.getBoundingClientRect().width - vw));
      });
      return worst;
    });
    r.ok('no step body is wider than the screen', widest <= 0,
      `widest step body overflows by ${widest}px`);

    // Long commands have to go somewhere, and that somewhere is their own
    // scroller rather than the page's.
    const preScrolls = await page.$$eval('pre', (els) => els.every(
      (e) => ['auto', 'scroll'].includes(getComputedStyle(e).overflowX),
    ));
    r.ok('every command block scrolls on its own instead', preScrolls);

    r.ok('no script errors on the guide', errors.length === 0, errors[0]);
    await page.close();
  }

  /* ---- desktop, and the parts that do the hand-holding ---------------- */
  {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    // A FRESH READER EVERY TIME. One browser is shared by the whole suite, so
    // `started` and the saved answers leak between blocks and decide whether
    // the start screen is up — which is how a fill timed out against a panel
    // another block had clicked past.
    await page.addInitScript(() => { try { localStorage.clear(); } catch (e) { /* private window */ } });
    await page.goto(`${BASE}/docs`, { waitUntil: 'networkidle' });
    await enterGuide(page);

    r.ok('it does not scroll sideways on a laptop either',
      !(await slidesSideways(page)));

    const steps = await page.$$eval('li[data-step]', (e) => e.length);
    r.ok("all thirteen steps are on the page", steps === 13, `found ${steps}`);

    const copies = await page.$$eval('.copy', (e) => e.length);
    r.ok('every command has a copy button', copies >= 25, `found ${copies}`);

    /* THE FILL-IN-ONCE PANEL IS THE POINT OF THE RENDERED GUIDE. Typing the
       hostname once has to reach the command blocks, or a reader edits
       every pasted line by hand and the page is worse than the markdown. */
    // Back to the start screen to type, because that is where the panel is
    // now. This check predates the screen and used to find the panel sitting
    // above the guide.
    await openStartScreen(page);
    const field = await page.$('.setup input');
    r.ok('the fill-in-once panel is there', Boolean(field));
    if (field) {
      await field.fill('reports.test.invalid');
      await settle(page);
      const text = await page.$$eval('pre', (e) => e.map((x) => x.textContent).join('\n'));
      r.ok('and what you type reaches the commands',
        text.includes('reports.test.invalid'));
    }

    // The DNS step is the one a reader cannot guess, so it has to say which
    // record to create rather than that one is needed.
    const dns = await page.$('#dns');
    r.ok('the guide says how to point a hostname, not just that you need one',
      Boolean(dns));
    if (dns) {
      const body = await page.$eval('#dns', (e) => e.parentElement.textContent);
      for (const must of ['AAAA', 'TTL', 'dig +short']) {
        r.ok(`the DNS section names ${must}`, body.includes(must));
      }
    }

    await page.close();
  }

  /* ---- the chooser, which decides what the reader is shown ----------- */
  {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    // A FRESH READER EVERY TIME. One browser is shared by the whole suite, so
    // `started` and the saved answers leak between blocks and decide whether
    // the start screen is up — which is how a fill timed out against a panel
    // another block had clicked past.
    await page.addInitScript(() => { try { localStorage.clear(); } catch (e) { /* private window */ } });
    await page.goto(`${BASE}/docs`, { waitUntil: 'networkidle' });
    // EVERY EITHER/OR IS A QUESTION, not a decision left in the prose. A
    // reader at a terminal with a half-built server should have had that
    // argument on the first screen, not at step 9.
    const qs = await page.evaluate(() =>
      [...document.querySelectorAll('.choice-q')].map((x) => x.textContent));
    for (const must of ['send mail', 'log in to the server', 'Scripted install']) {
      r.ok(`the start screen asks about ${must}`,
        qs.some((q) => q.includes(must)), qs.join(' | '));
    }

    // The chooser is on the start screen too, so this one stays there.
    await openStartScreen(page);

    const opts = await page.$$eval('.choice-opt', (e) => e.map((x) => x.textContent.trim()));
    r.ok('the page asks what the reader has', opts.length >= 8, `${opts.length} options`);

    /* NOTHING IS HIDDEN BEFORE A QUESTION IS ANSWERED. A guide that starts
       with most of itself invisible is worse than one that shows every
       branch, and with scripting off that is exactly what happens — so the
       unanswered state has to match it. */
    const hiddenAtRest = await page.$$eval('[data-when]', (e) => e.filter((x) => x.hidden).length);
    r.ok('and hides nothing until it is answered', hiddenAtRest === 0,
      `${hiddenAtRest} blocks hidden with no answers given`);

    await page.click('.choice-opt:text-is("Windows")');
    await settle(page);
    const win = await page.$eval('[data-when="from:windows"]', (e) => !e.hidden);
    const mac = await page.$eval('[data-when="from:mac"]', (e) => !e.hidden);
    r.ok('answering Windows shows the Windows path', win);
    r.ok('and hides the Mac one', !mac);

    // A clause with several accepted values has to keep matching.
    const both = await page.$eval('[data-when="from:mac|linux"]', (e) => e.hidden);
    r.ok('a branch for mac-or-linux hides for a Windows reader', both);

    await page.click('.choice-opt:text-is("Hetzner Cloud")');
    await settle(page);
    r.ok('answering Hetzner shows the Hetzner path',
      await page.$eval('[data-when="host:hetzner"]', (e) => !e.hidden));
    r.ok('and hides the other-provider one',
      await page.$eval('[data-when="host:other"]', (e) => e.hidden));

    /* The media step disappears for a text-only deployment, and the step
       numbers have to close up behind it rather than skipping a number. */
    await page.click('.choice-opt:text-is("No, text only")');
    await settle(page);
    r.ok('text-only hides the media-tools step',
      await page.$eval('li[data-step="media"]', (e) => e.hidden));
    const numbers = await page.$$eval('ol.steps > li:not([hidden])',
      (els) => els.map((e) => getComputedStyle(e, '::before').content));
    r.ok('and the remaining steps are still numbered without a gap',
      numbers.length > 0 && !numbers.includes('none'));

    // Clicking the same answer again is the way back to the whole guide.
    await page.click('.choice-opt:text-is("No, text only")');
    await settle(page);
    r.ok('clicking the same answer again brings the step back',
      await page.$eval('li[data-step="media"]', (e) => !e.hidden));

    r.ok('no script errors from the chooser', errors.length === 0, errors[0]);
    await page.close();
  }

  return r;
}
