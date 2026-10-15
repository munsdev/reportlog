/**
 * The reading screens converted to the Client-First layer: how, standards,
 * impressum, privacy. (Volunteer was one; it is a list's form now.)
 *
 * They are prose, so what could go wrong is quiet: a heading sitting on the
 * paragraph above it, inline code drawn as plain text, a card the JavaScript
 * writes into that loses its heading style, or an inline style creeping back.
 * site.test.js already runs axe over most of them and checks the legal text is
 * shown as written; this checks the conversion itself.
 */
import { BASE, PHONE, Report, open, axeOn } from './lib.js';

const SCREENS = [
  ['how', '/how'], ['standards', '/standards'],
  ['impressum', '/impressum'], ['privacy', '/privacy'],
];

export default async function run(browser) {
  const r = new Report('reading screens');

  for (const [id, path] of SCREENS) {
    const page = await open(browser, `${BASE}${path}`, PHONE);
    const pane = `#pane-${id}`;
    r.ok(`${id}: is the active pane`, await page.$eval(pane, (e) => e.classList.contains('active')));
    r.ok(`${id}: carries no inline style`,
      (await page.$$eval(`${pane} [style]`, (e) => e.length)) === 0);
    r.ok(`${id}: is built from the layer, with none of the old prose classes`,
      Boolean(await page.$(`${pane} .container-small .layout_stack`))
      && !(await page.$(`${pane} .prose, ${pane} .ab-card, ${pane} > header`)));

    // A heading that follows something must have air above it.
    const tight = await page.$$eval(`${pane} .text-rich-text > h2, ${pane} .text-rich-text > h3`, (hs) =>
      hs.filter((h) => h.previousElementSibling && parseFloat(getComputedStyle(h).marginTop) < 8)
        .map((h) => h.textContent.trim().slice(0, 30)));
    r.ok(`${id}: no heading sits on the paragraph above it`, tight.length === 0, tight.join(' | '));

    // And so must anything under a heading, and between two paragraphs: the
    // layer's own gap once lost to its margin:0 resets and left them flush.
    const flush = await page.$$eval(`${pane} .text-rich-text > p, ${pane} .text-rich-text > ul`, (els) =>
      els.filter((e) => e.previousElementSibling && parseFloat(getComputedStyle(e).marginTop) < 4)
        .map((e) => e.textContent.trim().slice(0, 30)));
    r.ok(`${id}: nothing sits flush against what is above it`, flush.length === 0, flush.join(' | '));

    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth);
    r.ok(`${id}: nothing pushes the page sideways on a phone`, !overflow);
    const violations = await axeOn(page, pane);
    r.ok(`${id}: axe finds nothing`, violations.length === 0, violations.join(', '));
    r.ok(`${id}: no script errors`, page.pageErrors.length === 0, page.pageErrors.join(' | '));
    await page.close();
  }

  return r;
}
