/**
 * An installed look pack, in a real browser (docs/design/checks.md section
 * 01 PACKS): its stylesheet and fonts are served from this site only, the
 * page links the stylesheet, and the pack's palette paints the page.
 *
 * The pack is the API suite's good fixture (apps/api/test/fixtures/looks/
 * good), installed through the real route with a step-up and removed after.
 * Each project (desktop, phone) installs its own copy under its own ids,
 * because the two run at the same time and ids are unique across packs.
 *
 * The site's stored look is never changed: the page is shown the pack's
 * palette by answering /api/site with it, as site.spec.ts does, so no other
 * test running meanwhile sees a pack look.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { crc32 } from 'node:zlib';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { ADMIN } from './auth.ts';
import { stepUp } from './second-factor.ts';

const FIXTURE = fileURLToPath(new URL('../../api/test/fixtures/looks/good/', import.meta.url));

/** A stored (uncompressed) zip: all a test needs, and nothing to install. */
function zip(files: [string, Buffer][]): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, data] of files) {
    const n = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(n.length, 26);
    parts.push(local, n, data);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt32LE(crc32(data), 16);
    c.writeUInt32LE(data.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(n.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}

interface Pack {
  id: string;
  fonts: { family: string }[];
  palettes: { id: string; colors: Record<string, string> }[];
  themes: { id: string; type: Record<string, { family: string }> }[];
  looks: { id: string; palette: string; theme: string }[];
}

/** The fixture under ids (and a font family) of this project's own. */
function packFor(project: string): { pack: Pack; zip: Buffer } {
  const pack = JSON.parse(readFileSync(`${FIXTURE}look.json`, 'utf8')) as Pack;
  const tag = project.toLowerCase().replace(/[^a-z0-9]/g, '');
  const family = `Tideline ${tag}`;
  const own = (id: string) => `${id}-${tag}`;
  pack.id = own('e2e');
  for (const f of pack.fonts) f.family = family;
  for (const p of pack.palettes) p.id = own(p.id);
  for (const t of pack.themes) {
    t.id = own(t.id);
    for (const slot of Object.values(t.type))
      if (slot.family === 'Tideline Sans') slot.family = family;
  }
  for (const l of pack.looks) {
    l.id = own(l.id);
    l.palette = own(l.palette);
    l.theme = own(l.theme);
  }
  const fonts = readdirSync(`${FIXTURE}fonts`).map((f): [string, Buffer] => [
    `fonts/${f}`,
    readFileSync(`${FIXTURE}fonts/${f}`),
  ]);
  return { pack, zip: zip([['look.json', Buffer.from(JSON.stringify(pack))], ...fonts]) };
}

/** Every request a page makes to a host other than this site's. */
function outsideRequests(page: Page): string[] {
  const outside: string[] = [];
  page.on('request', (r) => {
    const host = new URL(r.url()).hostname;
    if (host !== '127.0.0.1' && host !== 'localhost') outside.push(r.url());
  });
  return outside;
}

test.describe('an installed look pack', () => {
  test.use({ storageState: ADMIN });

  let mine: Pack;
  let stylesheet = '';

  test.beforeAll(async ({ browser }, info) => {
    const context = await browser.newContext({ storageState: ADMIN });
    const { pack, zip: z } = packFor(info.project.name);
    mine = pack;
    await stepUp(context.request);
    const res = await context.request.post('/api/admin/looks', {
      data: { zip: z.toString('base64') },
    });
    expect(res.ok(), await res.text()).toBe(true);
    stylesheet = ((await res.json()) as { pack: { stylesheet: string } }).pack.stylesheet;
    await context.close();
  });

  test.afterAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: ADMIN });
    await stepUp(context.request);
    await context.request.delete(`/api/admin/looks/${mine.id}`);
    await context.close();
  });

  async function wear(page: Page, palette: string, theme: string) {
    for (const path of ['**/api/site', '**/api/site-access/status']) {
      await page.route(path, async (route) => {
        const real = await route.fetch();
        const body = (await real.json()) as { look: Record<string, unknown> };
        await route.fulfill({ json: { ...body, look: { ...body.look, palette, theme } } });
      });
    }
  }

  test('its palette paints the page, through a stylesheet from this site only', async ({
    page,
  }) => {
    const outside = outsideRequests(page);
    const fromPacks: string[] = [];
    page.on('response', (r) => {
      if (new URL(r.url()).pathname.startsWith('/api/looks/')) fromPacks.push(r.url());
    });
    const night = mine.palettes.find((p) => p.id.startsWith('tideline-night'));
    const theme = mine.themes[0];
    if (!night || !theme) throw new Error('the fixture has a dark palette and a theme');
    await wear(page, night.id, theme.id);
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-palette', night.id);
    await expect(page.locator(`link[rel=stylesheet][href="${stylesheet}"]`)).toHaveCount(1);
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor))
      .toBe(hexToRgb(night.colors.background ?? ''));
    expect(fromPacks.some((u) => u.endsWith(stylesheet))).toBe(true);
    for (const u of fromPacks) expect(new URL(u).hostname).toBe('127.0.0.1');
    expect(outside).toEqual([]);
  });

  test('its files are named by their hash and cached for good', async ({ request }) => {
    const css = await request.get(stylesheet);
    expect(css.ok()).toBe(true);
    expect(css.headers()['content-type']).toBe('text/css; charset=utf-8');
    expect(css.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
    const body = await css.text();
    expect(body).not.toMatch(/https?:|@import|\/\/[a-z]/);
    const font = /url\('([^']+\.woff2)'\)/.exec(body)?.[1] ?? '';
    expect(font).toMatch(/^\/api\/looks\/[a-z0-9-]+\/[0-9a-f]{64}\.woff2$/);
    const woff2 = await request.get(font);
    expect(woff2.headers()['content-type']).toBe('font/woff2');
  });

  test('the remembered look brings the stylesheet back before the site answers', async ({
    page,
  }) => {
    const night = mine.palettes.find((p) => p.id.startsWith('tideline-night'));
    const theme = mine.themes[0];
    if (!night || !theme) throw new Error('the fixture has a dark palette and a theme');
    await wear(page, night.id, theme.id);
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-palette', night.id);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    for (const path of ['**/api/site', '**/api/site-access/status'])
      await page.route(path, () => new Promise(() => undefined));
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-palette', night.id);
    await expect(page.locator(`link[rel=stylesheet][href="${stylesheet}"]`)).toHaveCount(1);
  });
});

function hexToRgb(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${String(r)}, ${String(g)}, ${String(b)})`;
}
