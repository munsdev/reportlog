/**
 * THE PUBLIC SHELL (U2), at the phone's width and the desktop's: the header
 * and its one button, the menu, the ticker, the Follow along band wherever
 * its placement is on, the footer's accounts, the 404, and the on-page edit
 * bar that only the owner has.
 *
 * ONE FILE, ITS OWN PROJECT. It sets the site's social accounts and takes
 * the owner's seat (apps/api/src/anchor/dev-owner.ts), both of which the
 * whole site shares, so it runs alone after the first projects and puts
 * everything back. It signs in as the owner, who satisfies every guard an
 * administrator does, so one session does both the settings and the editing.
 *
 * No account here is real: the handles are made up and nothing is fetched
 * from them. The check that no page asks another host is made on every page
 * this file opens.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import type { APIRequestContext, Browser, BrowserContext, Locator, Page } from '@playwright/test';
import { codeIn, countTo, identityState, lastMessageTo } from '../identity/mail.ts';
import { passSecondFactor } from '../second-factor.ts';

const API = fileURLToPath(new URL('../../../api/', import.meta.url));
const run = Date.now().toString(36);
const OWNER = `e2e-shell-owner-${run}@example.org`;
const ADMIN = `e2e-shell-admin-${run}@example.org`;
let previousOwner = '-';

const ALL = [
  'front',
  'get_involved',
  'after_filing',
  'after_tip',
  'journalists',
  'menu',
  'ticker',
  'footer',
];
const LINKS = [
  { id: 'bluesky', address: 'bsky.app/profile/shell-test.example', shown: true },
  { id: 'instagram', address: '@shell.test', shown: true },
];

const SIZES = [
  { name: 'phone (390)', viewport: { width: 390, height: 844 } },
  { name: 'desktop (1280)', viewport: { width: 1280, height: 800 } },
];

function ownerSeat(...args: string[]): string {
  return execFileSync(
    'node',
    ['--env-file-if-exists=../../.env', 'src/anchor/dev-owner.ts', ...args],
    { cwd: API, encoding: 'utf8' },
  ).trim();
}

async function signIn(request: APIRequestContext, email: string) {
  const before = countTo(email);
  const asked = await request.post('/api/auth/code', { data: { email } });
  expect(asked.ok(), await asked.text()).toBe(true);
  const code = codeIn(await lastMessageTo(email, before));
  const signed = await request.post('/api/auth/sign-in', { data: { email, code } });
  expect(signed.ok(), await signed.text()).toBe(true);
  await passSecondFactor(request, email);
}

async function contextFor(
  browser: Browser,
  email: string,
  viewport?: { width: number; height: number },
): Promise<BrowserContext> {
  const context = await browser.newContext(viewport ? { viewport } : {});
  await signIn(context.request, email);
  return context;
}

interface Editor {
  social_links: { id: string; url: string | null; shown: boolean }[];
  social_float: { on: boolean; pages: string[] };
  social_placements: string[];
}

let owner: BrowserContext;
let before: Editor;

async function setSocial(links: typeof LINKS, placements?: string[]) {
  const res = await owner.request.put('/api/admin/site/social', {
    data: { links, ...(placements ? { placements } : {}) },
  });
  expect(res.ok(), await res.text()).toBe(true);
}

/** A visitor, signed in as nobody, who reports every host the page asks. */
async function visitor(browser: Browser, viewport: { width: number; height: number }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const outside: string[] = [];
  page.on('request', (r) => {
    const host = new URL(r.url()).hostname;
    if (host !== '127.0.0.1' && host !== 'localhost') outside.push(r.url());
  });
  return { context, page, outside };
}

/** A locator's box; a test that cannot find one has failed. */
async function box(l: Locator) {
  const b = await l.boundingBox();
  if (!b) throw new Error('Nothing to measure: the element is not on the page.');
  return b;
}

const noSidewaysScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser }) => {
  previousOwner = ownerSeat('take', OWNER);
  identityState('seat', ADMIN, 'admin');
  owner = await contextFor(browser, OWNER);
  before = (await (await owner.request.get('/api/admin/site')).json()) as Editor;
});

test.afterAll(async () => {
  // Put the accounts back as they were found.
  await owner.request.put('/api/admin/site/social', {
    data: {
      links: before.social_links.map((l) => ({ id: l.id, address: l.url ?? '', shown: l.shown })),
      float: before.social_float,
      placements: before.social_placements,
    },
  });
  await owner.close();
  ownerSeat('give-back', previousOwner, OWNER);
});

for (const size of SIZES) {
  test.describe(size.name, () => {
    test('the header has one button, straight to the logbook, and the chooser is in the menu', async ({
      browser,
    }) => {
      await setSocial(LINKS, ALL);
      const { context, page, outside } = await visitor(browser, size.viewport);
      await page.goto('/');
      const header = page.getByRole('banner');
      const file = header.locator('[data-file-action]');
      await expect(file).toBeVisible();
      // Straight to the form, not to the page that asks which form.
      await expect(file).toHaveAttribute('href', /^\/file\//);
      await expect(header.getByRole('button', { name: /Menu$/ })).toBeVisible();
      expect(await noSidewaysScroll(page)).toBe(true);
      // One row, at every width: the bar is as tall as one row.
      expect((await header.boundingBox())?.height ?? 999).toBeLessThan(90);

      await file.click();
      await expect(page).toHaveURL(/\/file\//);
      expect(outside).toEqual([]);
      await context.close();
    });

    test('the menu opens, holds focus, closes on Escape and puts focus back', async ({
      browser,
    }) => {
      await setSocial(LINKS, ALL);
      const { context, page, outside } = await visitor(browser, size.viewport);
      await page.goto('/');
      const button = page.getByRole('banner').getByRole('button', { name: /Menu$/ });
      await button.click();
      const nav = page.getByRole('navigation', { name: 'Main menu' });
      await expect(nav).toBeVisible();
      // Focus has moved inside.
      await expect(nav.locator(':focus')).toHaveCount(1);

      // Accounts at the top of the menu, above the main action.
      const icons = nav.locator('[data-menu-follow] a');
      await expect(icons).toHaveCount(2);
      const iconsAt = await nav.locator('[data-menu-follow]').boundingBox();
      const actionAt = await nav.locator('a:not([data-social])').first().boundingBox();
      expect(iconsAt?.y ?? 0).toBeLessThan(actionAt?.y ?? 0);
      for (const a of await icons.all()) {
        const box = await a.boundingBox();
        expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      }

      // The chooser lives here.
      await expect(nav.getByRole('link', { name: 'What do you want to send?' })).toHaveAttribute(
        'href',
        '/submit',
      );
      expect(await noSidewaysScroll(page)).toBe(true);

      // Tab stays inside: after many presses focus is still in the menu or on its button.
      for (let i = 0; i < 40; i++) await page.keyboard.press('Tab');
      expect(
        await page.evaluate(() => {
          const at = document.activeElement;
          return Boolean(at?.closest('#site-menu') ?? at?.closest('header'));
        }),
      ).toBe(true);

      await page.keyboard.press('Escape');
      await expect(nav).toBeHidden();
      await expect(button).toBeFocused();
      expect(outside).toEqual([]);
      await context.close();
    });

    test('the Follow along band sits full width under the header, before the page, with a large button per account', async ({
      browser,
    }) => {
      await setSocial(LINKS, ALL);
      const { context, page, outside } = await visitor(browser, size.viewport);
      await page.goto('/');
      const band = page.locator('[data-follow-band="front"]');
      await expect(band).toBeVisible();
      const header = await box(page.getByRole('banner'));
      const bandAt = await box(band);
      const heading = await box(page.getByRole('heading', { level: 1 }));
      // Directly under the header (the ticker may stand between), before the headline.
      expect(bandAt.y).toBeGreaterThanOrEqual(header.y + header.height - 1);
      expect(bandAt.y).toBeLessThan(heading.y);
      // Full width.
      expect(bandAt.width).toBeGreaterThanOrEqual(size.viewport.width - 1);
      const links = band.getByRole('link');
      await expect(links).toHaveCount(2);
      await expect(band).toContainText('Bluesky');
      await expect(band).toContainText('@shell-test.example');
      await expect(band).toContainText('Instagram');
      await expect(band).toContainText('@shell.test');
      for (const a of await links.all()) {
        expect((await a.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
        await expect(a).toHaveAttribute('referrerpolicy', 'no-referrer');
      }
      expect(await noSidewaysScroll(page)).toBe(true);
      expect(outside).toEqual([]);
      await context.close();
    });

    test('the ticker follows the first account on a page, and is not on a form; the footer carries the marks', async ({
      browser,
    }) => {
      await setSocial(LINKS, ALL);
      const { context, page, outside } = await visitor(browser, size.viewport);
      await page.goto('/about');
      const ticker = page.locator('[data-ticker]');
      await expect(ticker).toBeVisible();
      await expect(ticker.getByRole('link')).toContainText(/^Follow @/);
      await expect(
        page.getByRole('navigation', { name: 'Follow us elsewhere' }).getByRole('link'),
      ).toHaveCount(2);
      expect(await noSidewaysScroll(page)).toBe(true);

      await page.goto('/submit');
      await expect(page.locator('[data-ticker]')).toHaveCount(0);
      expect(outside).toEqual([]);
      await context.close();
    });

    test('each placement is its own switch, and with none shown nothing is drawn', async ({
      browser,
    }) => {
      const { context, page } = await visitor(browser, size.viewport);
      const seen = async () => {
        await page.goto('/');
        await page.getByRole('banner').getByRole('button', { name: /Menu$/ }).click();
        return {
          band: await page.locator('[data-follow-band]').count(),
          menu: await page.locator('[data-menu-follow]').count(),
          ticker: await page.locator('[data-ticker]').count(),
          footer: await page.getByRole('navigation', { name: 'Follow us elsewhere' }).count(),
        };
      };

      await setSocial(LINKS, ['menu']);
      expect(await seen()).toEqual({ band: 0, menu: 1, ticker: 0, footer: 0 });
      await setSocial(LINKS, ['ticker', 'footer']);
      expect(await seen()).toEqual({ band: 0, menu: 0, ticker: 1, footer: 1 });
      await setSocial(LINKS, ['front']);
      expect(await seen()).toEqual({ band: 1, menu: 0, ticker: 0, footer: 0 });
      await setSocial(LINKS, []);
      expect(await seen()).toEqual({ band: 0, menu: 0, ticker: 0, footer: 0 });
      // No account, every placement on: no empty box anywhere.
      // A platform left out of a save is kept, so each is switched off by name.
      await setSocial(
        LINKS.map((l) => ({ ...l, address: '', shown: false })),
        ALL,
      );
      expect(await seen()).toEqual({ band: 0, menu: 0, ticker: 0, footer: 0 });
      await context.close();
    });

    test('a wrong address says so in the mock-up’s words and offers filing and the front page', async ({
      browser,
    }) => {
      await setSocial(LINKS, ALL);
      const { context, page, outside } = await visitor(browser, size.viewport);
      await page.goto('/nothing/at-this-address');
      await expect(
        page.getByRole('heading', { level: 1, name: "That page isn't here" }),
      ).toBeVisible();
      await expect(page.getByText('404', { exact: true })).toBeVisible();
      const main = page.getByRole('main');
      await expect(main.locator('a[href^="/file/"]').first()).toBeVisible();
      await main.getByRole('link', { name: 'Front page' }).click();
      await expect(page).toHaveURL(/\/$/);
      expect(await noSidewaysScroll(page)).toBe(true);
      expect(outside).toEqual([]);
      await context.close();
    });

    test('the edit bar is the owner’s, with its buttons at the left; an administrator and a stranger have none', async ({
      browser,
    }) => {
      const ownerCtx = await contextFor(browser, OWNER, size.viewport);
      const page = await ownerCtx.newPage();
      await page.goto('/');
      const bar = page.getByRole('region', { name: 'Page editor' });
      await expect(bar).toBeVisible();
      const buttons = bar.getByRole('button');
      await expect(buttons).toHaveText([/Edit this page/, /Edit headline/]);
      const barAt = await box(bar);
      const firstAt = await box(buttons.first());
      // At the left of the bar, whatever the width.
      expect(firstAt.x - barAt.x).toBeLessThan(24);
      for (const b of await buttons.all()) {
        expect((await b.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
      }
      expect(await noSidewaysScroll(page)).toBe(true);
      await ownerCtx.close();

      const adminCtx = await contextFor(browser, ADMIN, size.viewport);
      const adminPage = await adminCtx.newPage();
      await adminPage.goto('/');
      await expect(adminPage.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(adminPage.getByRole('region', { name: 'Page editor' })).toHaveCount(0);
      await expect(adminPage.getByRole('button', { name: 'Edit this page' })).toHaveCount(0);
      await adminCtx.close();

      const { context, page: stranger } = await visitor(browser, size.viewport);
      await stranger.goto('/');
      await expect(stranger.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(stranger.getByRole('region', { name: 'Page editor' })).toHaveCount(0);
      await context.close();
    });
  });
}

test('the owner rewords the headline block, a stranger sees it, and Undo puts it back', async ({
  browser,
  baseURL,
}) => {
  const ownerCtx = await contextFor(browser, OWNER);
  const page = await ownerCtx.newPage();
  await page.goto('/');
  // The headline is the software's name until the page's own words arrive.
  await page.waitForLoadState('networkidle');
  const was = (await page.getByRole('heading', { level: 1 }).textContent()) ?? '';
  await page.getByRole('button', { name: 'Edit headline' }).click();
  await page.getByLabel('Layout').selectOption('info');
  await page.getByLabel('Headline', { exact: true }).fill('Every report, kept as written');
  await page.getByLabel('Introduction').fill('Read the **record** and [how it works](/how).');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved. It is live.')).toBeVisible();

  const stranger = await browser.newContext({ baseURL: baseURL ?? '' });
  const seen = await stranger.newPage();
  await seen.goto('/');
  await expect(seen.getByRole('heading', { level: 1 })).toHaveText('Every report, kept as written');
  await expect(seen.getByRole('link', { name: 'how it works' })).toBeVisible();

  await page.getByRole('button', { name: 'Undo last save' }).click();
  await expect(page.getByText('Put back as it was before the last save.')).toBeVisible();
  await seen.reload();
  await expect(seen.getByRole('heading', { level: 1 })).toHaveText(was);
  await stranger.close();
  await ownerCtx.close();
});

test('the Social media screen switches each placement, and a visitor sees the change', async ({
  browser,
}) => {
  await setSocial(LINKS, ALL);
  const ownerCtx = await contextFor(browser, OWNER, { width: 1280, height: 900 });
  const page = await ownerCtx.newPage();
  await page.goto('/settings/social');
  const placements = page.getByRole('group', { name: 'Where the accounts show' });
  await expect(placements.getByRole('checkbox')).toHaveCount(8);
  await expect(placements.getByRole('checkbox', { name: 'In the ticker' })).toBeChecked();
  await placements.getByRole('checkbox', { name: 'In the ticker' }).click();
  await placements.getByRole('checkbox', { name: 'In the footer' }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText(/^Saved\./)).toBeVisible();

  const { context, page: seen, outside } = await visitor(browser, { width: 1280, height: 800 });
  await seen.goto('/');
  await expect(seen.locator('[data-follow-band="front"]')).toBeVisible();
  await expect(seen.locator('[data-ticker]')).toHaveCount(0);
  await expect(seen.getByRole('navigation', { name: 'Follow us elsewhere' })).toHaveCount(0);
  expect(outside).toEqual([]);
  await context.close();
  await ownerCtx.close();
});
