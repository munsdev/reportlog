/**
 * Compares two directories of screenshots from visual/shoot.mjs, pixel by
 * pixel, and lists what changed, worst first. Different heights count as
 * changed outright: a screen that got taller or shorter moved everything
 * under the change.
 */
import fs from 'node:fs';
import { launch } from '../lib.js';
const [a, b] = process.argv.slice(2);
if (!a || !b) { console.error('usage: node visual/compare.mjs <dirA> <dirB>'); process.exit(2); }
const files = fs.readdirSync(a).filter((f) => f.endsWith('.png') && fs.existsSync(`${b}/${f}`));
const browser = await launch();
const page = await browser.newPage();
const rows = [];
for (const f of files) {
  const r = await page.evaluate(async ([x, y]) => {
    const load = (s) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = 'data:image/png;base64,' + s; });
    const [ia, ib] = await Promise.all([load(x), load(y)]);
    const px = (i) => { const c = document.createElement('canvas'); c.width = i.width; c.height = i.height;
      const g = c.getContext('2d'); g.drawImage(i, 0, 0); return g.getImageData(0, 0, i.width, i.height).data; };
    if (ia.width !== ib.width || ia.height !== ib.height) return { size: [ia.height, ib.height] };
    const da = px(ia), db = px(ib); let diff = 0;
    for (let k = 0; k < da.length; k += 4) {
      if (Math.abs(da[k] - db[k]) + Math.abs(da[k + 1] - db[k + 1]) + Math.abs(da[k + 2] - db[k + 2]) > 24) diff += 1;
    }
    return { ratio: diff / (ia.width * ia.height) };
  }, [fs.readFileSync(`${a}/${f}`).toString('base64'), fs.readFileSync(`${b}/${f}`).toString('base64')]);
  rows.push({ f, ...r });
}
await browser.close();
rows.sort((p, q) => (q.size ? 1 : q.ratio) - (p.size ? 1 : p.ratio) || 0);
let same = 0;
for (const r of rows) {
  if (r.size) console.log(`  TALLER/SHORTER ${r.f}: ${r.size[0]}px -> ${r.size[1]}px`);
  else if (r.ratio > 0) console.log(`  ${(r.ratio * 100).toFixed(2).padStart(6)}%  ${r.f}`);
  else same += 1;
}
console.log(`${same} of ${rows.length} identical`);
