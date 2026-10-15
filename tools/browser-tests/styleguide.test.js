/**
 * The style guide — /styleguide.html.
 *
 * It is the one page where the look and the Client-First layer are shown
 * working together, so what is checked here is that they really are: that
 * the page is drawn with the layer's own classes, that every palette and
 * theme the stylesheets offer is on offer in the bar, and that changing
 * either one repaints the samples. A style guide that had drifted from the
 * stylesheets would be worse than none, because it would be believed.
 */
import { BASE, Report, open, axeOn } from './lib.js';

export default async function run(browser) {
  const r = new Report('style guide');
  const page = await open(browser, `${BASE}/styleguide.html`, { width: 1100, height: 1000 });

  /* ---- it is built out of the layer ---------------------------------- */
  const has = async (sel) => Boolean(await page.$(sel));
  r.ok('the page is built on the structure classes',
    await has('.page-wrapper .main-wrapper .padding-global .container-large'));
  r.ok('and shows every part of the vocabulary',
    (await Promise.all(['.button.is-secondary', '.form_input', '.choice_item',
      '.card_component', '.chip.is-serious', '.layout_grid.is-auto', '.text-rich-text',
      '.heading-style-h1', '.text-size-tiny', '.divider']
      .map((s) => has(s)))).every(Boolean));

  /* ---- it offers what the stylesheets really have --------------------- */
  // Read out of the stylesheets at load rather than typed into the page, so
  // a palette added to tokens.css appears here with nobody editing it.
  const dials = await page.evaluate(() => {
    const ids = (attr) => {
      const out = new Set();
      for (const sheet of [...document.styleSheets]) {
        let rules; try { rules = sheet.cssRules; } catch (e) { rules = null; }
        if (!rules) continue;
        for (const rule of rules) {
          const re = new RegExp(`\\[data-${attr}="([a-z0-9-]+)"\\]`, 'g');
          let m;
          while ((m = re.exec(rule.selectorText || '')) !== null) out.add(m[1]);
        }
      }
      return [...out].sort();
    };
    const offered = (id) => [...document.getElementById(id).options].map((o) => o.value).sort();
    return {
      palettes: ids('palette'), themes: ids('theme'),
      palettesOffered: offered('sg-palette'), themesOffered: offered('sg-theme'),
    };
  });
  r.ok('every palette in the stylesheet is in the palette list',
    dials.palettes.length > 10
    && dials.palettes.join() === dials.palettesOffered.join(),
    `${dials.palettes.length} in css, ${dials.palettesOffered.length} offered`);
  r.ok('and every theme in the theme list',
    dials.themes.length > 3 && dials.themes.join() === dials.themesOffered.join(),
    `${dials.themes.join()} / ${dials.themesOffered.join()}`);

  /* ---- and changing a dial really repaints ---------------------------- */
  const look = () => page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const chip = document.querySelector('[data-token="--act"]');
    return {
      paper: cs.getPropertyValue('--paper').trim(),
      swatch: getComputedStyle(chip).backgroundColor,
      width: cs.getPropertyValue('--page-max').trim(),
      radius: getComputedStyle(document.querySelector('.card_component')).borderRadius,
      button: getComputedStyle(document.querySelector('.button')).backgroundColor,
    };
  });
  const flint = await look();
  r.ok('a swatch draws the colour it names, not a picture of one',
    flint.swatch && flint.swatch !== 'rgba(0, 0, 0, 0)', flint.swatch);

  // Bureau rather than a dark palette: its action colour is a blue where
  // flint's is the brand gold, so the button and the swatch both have to
  // move. Several palettes deliberately share the gold, and a test that
  // picked one of those would pass by accident.
  await page.selectOption('#sg-palette', 'bureau');
  await page.waitForTimeout(300);
  const dark = await look();
  r.ok('choosing a palette repaints the page', dark.paper !== flint.paper,
    `${flint.paper} → ${dark.paper}`);
  r.ok('and the swatches with it', dark.swatch !== flint.swatch,
    `${flint.swatch} → ${dark.swatch}`);
  r.ok('and the components, which name no colour of their own',
    dark.button !== flint.button, `${flint.button} → ${dark.button}`);
  r.ok('but not the measure, which belongs to the theme', dark.width === flint.width);

  await page.selectOption('#sg-theme', 'docket');
  await page.waitForTimeout(300);
  const docket = await look();
  r.ok('choosing a theme changes the shape', docket.radius !== dark.radius,
    `${dark.radius} → ${docket.radius}`);
  r.ok('and the width of the page', docket.width !== dark.width,
    `${dark.width} → ${docket.width}`);
  r.ok('and leaves the colours where they were', docket.paper === dark.paper);

  /* ---- it is a page somebody can actually use ------------------------- */
  const violations = await axeOn(page, null);
  violations.forEach((v) => r.ok(`axe: ${v}`, false));
  if (!violations.length) r.ok('no WCAG A/AA violations on the whole guide', true);

  // 44px for anything you tap, which is the size iOS and Android both call
  // reachable. `is-small` is the one deliberate exception — it is the Change
  // link beside an answer, not a control somebody hunts for — and it still
  // clears the 24px WCAG 2.2 AA minimum with room to spare.
  const tap = await page.$$eval('.button, .form_input, .form_select, .choice_item',
    (els) => els.map((e) => ({
      what: e.className || e.tagName,
      small: e.classList.contains('is-small'),
      h: Math.round(e.getBoundingClientRect().height),
    })));
  const short = tap.filter((t) => (t.small ? t.h < 24 : t.h < 44));
  r.ok('nothing you tap is under 44px tall, small controls under 24px',
    short.length === 0, short.map((t) => `${t.what} ${t.h}px`).join(', '));

  r.ok('no uncaught page errors', page.pageErrors.length === 0, page.pageErrors.join(' | '));
  await page.close();
  return r;
}
