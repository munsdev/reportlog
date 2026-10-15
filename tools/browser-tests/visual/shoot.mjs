/**
 * A screenshot of every screen, so a change to markup or CSS can be compared
 * with what was there before. NOT part of the suite: it asserts nothing. It
 * exists because the suites cannot see a screen that is merely ugly, and the
 * Client-First conversion changes how nearly every screen is built.
 *
 *   node visual/shoot.mjs <outdir> [--base=http://localhost:3000]
 *   node visual/compare.mjs <dirA> <dirB>
 *
 * Signed in as an owner by mocking /api/auth/me. Every other API answers with
 * an empty list unless a fixture below says otherwise, so what is drawn is the
 * layout of each screen and its empty state, which is what a markup change can
 * break. The same fixtures before and after is what makes the comparison mean
 * anything.
 */
import fs from 'node:fs';
import { BASE, launch } from '../lib.js';

const out = process.argv[2];
if (!out) { console.error('usage: node visual/shoot.mjs <outdir>'); process.exit(2); }
fs.mkdirSync(out, { recursive: true });

const json = (body, status = 200) => (route) => route.fulfill({
  status, contentType: 'application/json', body: JSON.stringify(body) });

const ME = { email: 'owner@example.org', role: 'owner', is_tester: true,
  memberships: [{ organization_id: 1, name: 'Example Coalition', role: 'org_admin' }], desks: [] };

const REPORT = { id: 'RL-260929-000001', received_at: '2026-09-29T09:00:00.000Z', recipe: 1,
  answers: { what: 'Something happened at the polling place.' }, thread_id: 't1',
  chain_hash: 'a'.repeat(64), may_publish: true, withdrawn: false, moderation_status: 'valid',
  severity: 'serious', veracity: 'likely_true', corroboration_count: 2,
  logbook_slug: 'polling', logbook_title: 'Polling place incidents', erasable: true,
  attachment_count: 0, attachment_published_count: 0,
  permissions: { contact_passing: false, attachment_publication: false } };

async function mock(page) {
  await page.route((u) => u.pathname.startsWith('/api/'), (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p === '/api/auth/me') return json(ME)(route);
    if (p === '/api/me/reports' || p === '/api/reports' || p === '/api/board') return json([REPORT])(route);
    if (p === '/api/me/notifications') return json({ notify_mode: 'weekly', notify_logbooks: [] })(route);
    if (p === '/api/logbooks') return json([{ slug: 'polling', title: 'Polling place incidents' }])(route);
    if (p.startsWith('/api/site-access') || p.startsWith('/api/health')) return route.continue();
    return json([])(route);
  });
}

const PHONE = { width: 390, height: 844 };
const DESK = { width: 1100, height: 900 };

const SCREENS = [
  ['home', '/'], ['submit', '/submit'], ['board', '/board'], ['numbers', '/board/numbers'],
  ['check', '/board/check'], ['about', '/about'], ['docs', '/about/documents'], ['how', '/how'],
  ['standards', '/standards'], ['alliance', '/alliance'], ['impressum', '/impressum'],
  ['privacy', '/privacy'], ['login', '/login'], ['mine', '/my-reports'],
  ['notify', '/notifications'], ['issues', '/issues'], ['intake', '/intake'],
  ['org', '/organization'], ['mods', '/moderators'], ['team', '/team'],
  ['access', '/access'], ['admin', '/admin'], ['invitation', '/invitation/sometoken'],
  ['report', '/r/RL-260929-000001'],
];
const LOOKS = [['a', null], ['dark', 'blackedition']];

const browser = await launch();
let n = 0;
for (const [look, palette] of LOOKS) {
  for (const [vpName, vp] of [['phone', PHONE], ['desk', DESK]]) {
    if (look === 'dark' && vpName === 'phone') continue;   // one dark set is enough
    const page = await browser.newPage({ viewport: vp });
    await page.route('**://*.google*/**', (r) => r.abort());
    await page.route('**://*.gstatic.com/**', (r) => r.abort());
    await mock(page);
    for (const [name, path] of SCREENS) {
      try {
        await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
        if (palette) await page.evaluate((t) => document.documentElement.setAttribute('data-palette', t), palette);
        await page.waitForTimeout(700);
        await page.screenshot({ path: `${out}/${name}.${vpName}.${look}.png`, fullPage: true });
        n += 1;
        // Sub-navigations: one shot per tab, so every panel is drawn.
        if ((name === 'admin' || name === 'team') && look === 'a') {
          const id = name === 'admin' ? 'admin-subnav' : 'portal-subnav';
          const count = await page.$$eval(`#${id} button`, (b) => b.length);
          for (let i = 0; i < count; i += 1) {
            await page.$$eval(`#${id} button`, (b, k) => b[k].click(), i);
            await page.waitForTimeout(350);
            await page.screenshot({ path: `${out}/${name}-tab${i}.${vpName}.${look}.png`, fullPage: true });
            n += 1;
          }
        }
      } catch (e) { console.log(`  skipped ${name} ${vpName} ${look}: ${e.message.split('\n')[0]}`); }
    }
    await page.close();
  }
}
await browser.close();
console.log(`${n} screenshots in ${out}`);
