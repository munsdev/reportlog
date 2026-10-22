/**
 * NAVIGATION (stage 3; docs/design/checks.md, section 02), at the phone's
 * and the desktop's width (the `phone` and `chromium` projects).
 *
 *   - The header is one row at 320, 390, 768 and 1280 wide, and the page
 *     never scrolls sideways, with the menu shut or open.
 *   - Menu opens and closes by click, Enter, Space and Escape; focus moves
 *     in, stays in, and comes back to the Menu button.
 *   - Each role reaches every staff page it may open from the menu, in two
 *     activations on a desktop and three on a phone (Menu, the area, the
 *     page), and sees no page it may not open. The owner's case is in
 *     owner/backups.spec.ts, the only project that holds the owner's seat.
 *   - Sign out is reachable by keyboard and by tap at 390 wide, for every
 *     signed-in role. (The bug that started the redesign.)
 *   - The current page is marked in the menu and in its area tabs.
 *   - The Menu button's count is the queue's, in words.
 *
 * The filing door's header (no Menu button, no call outside the filing
 * calls) is checked in doors/doors.spec.ts, the project that turns the site
 * password on. Every account here is made for the test: signing out ends a
 * session, and the shared ADMIN and MODERATOR sessions must outlive this file.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';
import { ADMIN, MODERATOR } from './auth.ts';
import { identityState } from './identity/mail.ts';
import { isPhone, menuLink, named, openMenu } from './menu.ts';
import { ALL_PAGES, MENU_FOR, pageByLabel } from './navigation-table.ts';
import type { MenuRole } from './navigation-table.ts';
import { signInWithSecondFactor } from './second-factor.ts';

const API = fileURLToPath(new URL('../../api/', import.meta.url));
const filingState = (...args: string[]) =>
  execFileSync('node', ['--env-file-if-exists=../../.env', 'src/filing/dev-state.ts', ...args], {
    cwd: API,
  });
const stamp = () => `${Date.now().toString(36)}${String(Math.floor(Math.random() * 10_000))}`;

type SignedInRole = Exclude<MenuRole, 'visitor' | 'owner'>;

/** A browser of its own, signed in as a new account in this role. */
async function as(browser: Browser, role: SignedInRole) {
  const email = `e2e-nav-${role.replace('_', '-')}-${stamp()}@example.org`;
  if (role === 'coordinator') filingState('coordinator', email, `Navigation Group ${stamp()}`);
  else if (role === 'reporter' || role === 'tester') identityState('seat', email, 'user');
  else identityState('seat', email, role);
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  await signInWithSecondFactor(context.request, email);
  if (role === 'tester') {
    const admin = await browser.newContext({ storageState: ADMIN });
    const given = await admin.request.post('/api/admin/testers', {
      data: { email, tester: true },
    });
    expect(given.ok(), await given.text()).toBe(true);
    await admin.close();
  }
  return { context, page: await context.newPage(), email };
}

async function visitor(browser: Browser) {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  return { context, page: await context.newPage(), email: '' };
}

/** On a phone, every area unfolded, so a page that is not offered cannot hide in a fold. */
async function unfoldAll(page: Page) {
  const nav = await openMenu(page);
  if (!isPhone(page)) return nav;
  const folds = nav.getByRole('button', { expanded: false });
  while ((await folds.count()) > 0) await folds.first().click();
  return nav;
}

// ── the header ───────────────────────────────────────────────────────────

test.describe('the header', () => {
  test.use({ storageState: ADMIN });
  for (const width of [320, 390, 768, 1280]) {
    test(`is one row at ${String(width)}px, shut and open, and nothing scrolls sideways`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/');
      const banner = page.getByRole('banner');
      const button = banner.getByRole('button', { name: /Menu$/ });
      await expect(button).toBeVisible();
      for (const state of ['shut', 'open'] as const) {
        if (state === 'open') await button.click();
        const box = await banner.evaluate((el) => {
          const row = el.firstElementChild;
          const kids = [...(row?.children ?? [])]
            .map((k) => k.getBoundingClientRect())
            .filter((k) => k.width > 0 && k.height > 0 && k.top < 120);
          return {
            tops: kids.map((k) => k.top),
            bottoms: kids.map((k) => k.bottom),
            height: row?.getBoundingClientRect().height ?? 0,
            sideways: document.documentElement.scrollWidth > window.innerWidth,
          };
        });
        expect(Math.max(...box.tops), state).toBeLessThan(Math.min(...box.bottoms));
        expect(box.height, state).toBeLessThanOrEqual(64);
        expect(box.sideways, state).toBe(false);
      }
    });
  }
});

// ── opening and closing ─────────────────────────────────────────────────

test.describe('the Menu button', () => {
  test.use({ storageState: ADMIN });

  test('opens by click and closes by click, Escape, and the scrim', async ({ page }) => {
    await page.goto('/board');
    const nav = page.getByRole('navigation', { name: 'Main menu' });
    const button = page.getByRole('banner').getByRole('button', { name: /Menu$/ });
    await button.click();
    await expect(nav).toBeVisible();
    const close = page.getByRole('banner').getByRole('button', { name: 'Close' });
    await expect(close).toHaveAttribute('aria-expanded', 'true');
    await close.click();
    await expect(nav).toBeHidden();
    await expect(button).toBeFocused();

    await button.click();
    await page.keyboard.press('Escape');
    await expect(nav).toBeHidden();
    await expect(button).toBeFocused();

    if (!isPhone(page)) {
      // The scrim: a click on the dimmed page below the panel.
      await button.click();
      const vp = page.viewportSize() ?? { width: 1280, height: 800 };
      const bottom = (await nav.boundingBox())?.height ?? 0;
      if (bottom + 80 < vp.height) {
        await page.mouse.click(vp.width / 2, vp.height - 20);
        await expect(nav).toBeHidden();
      }
    }
  });

  for (const key of ['Enter', 'Space'] as const) {
    test(`opens by ${key}, moves focus in, keeps it in, and gives it back`, async ({ page }) => {
      await page.goto('/');
      const button = page.getByRole('banner').getByRole('button', { name: /Menu$/ });
      await button.focus();
      await page.keyboard.press(key);
      const nav = page.getByRole('navigation', { name: 'Main menu' });
      await expect(nav).toBeVisible();
      // Focus moved in: to the menu's first link.
      await expect(nav.getByRole('link').first()).toBeFocused();
      // And stays in, all the way round and back again.
      const inside = () =>
        page.evaluate(() => {
          const el = document.activeElement;
          return Boolean(el?.closest('#site-menu, header'));
        });
      for (let i = 0; i < 80; i += 1) {
        await page.keyboard.press('Tab');
        expect(await inside()).toBe(true);
      }
      for (let i = 0; i < 10; i += 1) {
        await page.keyboard.press('Shift+Tab');
        expect(await inside()).toBe(true);
      }
      await page.keyboard.press('Escape');
      await expect(nav).toBeHidden();
      await expect(button).toBeFocused();
    });
  }
});

// ── every role ───────────────────────────────────────────────────────────

const ROLES: readonly (SignedInRole | 'visitor')[] = [
  'visitor',
  'reporter',
  'moderator',
  'admin',
  'access_manager',
  'journalist',
  'coordinator',
  'tester',
];

for (const role of ROLES) {
  test(`${role}: reaches every page they may open, and is shown no other`, async ({ browser }) => {
    test.setTimeout(120_000);
    const who = role === 'visitor' ? await visitor(browser) : await as(browser, role);
    const { page } = who;
    await page.goto('/');
    const mine = MENU_FOR[role];

    for (const label of mine) {
      const target = pageByLabel(label);
      // Menu (1); on a phone the area (2); then the page. menuLink makes
      // exactly those activations, and no more.
      const link = await menuLink(page, label, target.area ? { area: target.area } : {});
      await expect(link, label).toBeVisible();
      await expect(link, label).toHaveAttribute(
        'href',
        new RegExp(`^${target.href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/?$`),
      );
    }

    const nav = await unfoldAll(page);
    for (const other of ALL_PAGES.filter((p) => !mine.includes(p.label))) {
      await expect(nav.getByRole('link', { name: named(other.label) }), other.label).toHaveCount(0);
    }
    if (role === 'visitor') {
      await expect(nav.getByRole('link', { name: 'Sign in' })).toBeVisible();
      await expect(nav.getByRole('button', { name: 'Sign out' })).toHaveCount(0);
    } else {
      await expect(nav.getByText(who.email)).toBeVisible();
    }
    await page.keyboard.press('Escape');

    // And they really go there: the first page of each area, and the rest.
    const firsts = new Map<string, string>();
    for (const label of mine) {
      const key = pageByLabel(label).area ?? label;
      if (!firsts.has(key)) firsts.set(key, label);
    }
    for (const label of firsts.values()) {
      const target = pageByLabel(label);
      await (await menuLink(page, label, target.area ? { area: target.area } : {})).click();
      await expect(page).toHaveURL(new RegExp(`${target.href.split('#')[0] ?? ''}/?(#.*)?$`));
      await expect(page.getByRole('navigation', { name: 'Main menu' })).toBeHidden();
    }
    await who.context.close();
  });
}

test('an administrator reaches the maps from the menu', async ({ browser }) => {
  const context = await browser.newContext({ storageState: ADMIN });
  const page = await context.newPage();
  await page.goto('/');
  await (await menuLink(page, 'Maps', { area: 'Logbooks and lists' })).click();
  await expect(page).toHaveURL(/\/maps\/?$/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await context.close();
});

// ── signing out at 390 wide ─────────────────────────────────────────────

for (const role of [
  'reporter',
  'moderator',
  'admin',
  'access_manager',
  'journalist',
  'coordinator',
  'tester',
] as const) {
  test(`${role}: signs out at 390 wide by keyboard, and again by tap`, async ({ browser }) => {
    test.setTimeout(120_000);
    for (const how of ['keyboard', 'tap'] as const) {
      const { context, page } = await as(browser, role);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto('/');
      const button = page.getByRole('banner').getByRole('button', { name: /Menu$/ });
      if (how === 'keyboard') {
        await button.focus();
        await page.keyboard.press('Enter');
        const out = page.getByRole('button', { name: 'Sign out' });
        let found = false;
        for (let i = 0; i < 80 && !found; i += 1) {
          await page.keyboard.press('Tab');
          found = await out.evaluate((el) => el === document.activeElement).catch(() => false);
        }
        expect(found, 'Sign out is in the Tab order').toBe(true);
        await page.keyboard.press('Enter');
      } else {
        await button.tap().catch(() => button.click());
        const out = page.getByRole('button', { name: 'Sign out' });
        await out.scrollIntoViewIfNeeded();
        await out.tap().catch(() => out.click());
      }
      await expect
        .poll(async () => (await (await page.request.get('/api/auth/me')).json()) as unknown)
        .toEqual({ signedIn: false });
      const nav = await openMenu(page);
      await expect(nav.getByRole('link', { name: 'Sign in' })).toBeVisible();
      await context.close();
    }
  });
}

// ── where you are ───────────────────────────────────────────────────────

test.describe('the current page', () => {
  test.use({ storageState: ADMIN });

  test('is marked in the menu and in its area tabs, once each', async ({ page }) => {
    await page.goto('/settings/look');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const tabs = page.getByRole('navigation', { name: 'Site settings' });
    await expect(tabs.getByRole('link', { name: 'Look', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(tabs.locator('[aria-current="page"]')).toHaveCount(1);
    const link = await menuLink(page, 'Look', { area: 'Site settings' });
    await expect(link).toHaveAttribute('aria-current', 'page');
    const nav = page.getByRole('navigation', { name: 'Main menu' });
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
  });

  test('a report’s own page is the queue’s, in the menu', async ({ browser }) => {
    const context = await browser.newContext({ storageState: MODERATOR });
    const page = await context.newPage();
    await page.goto('/moderate/00000000-0000-4000-8000-000000000000');
    const link = await menuLink(page, 'Queue', { area: 'Moderation' });
    await expect(link).toHaveAttribute('aria-current', 'page');
    await context.close();
  });
});

// ── the count ───────────────────────────────────────────────────────────

test.describe('the waiting count', () => {
  test.use({ storageState: MODERATOR });

  test('is the queue’s own count of reports waiting, said in words', async ({ page }) => {
    await page.goto('/');
    const button = page.getByRole('banner').getByRole('button', { name: /Menu$/ });
    await expect(button).toBeVisible();
    // Other tests file reports meanwhile: read the two until they agree.
    await expect(async () => {
      await page.reload();
      const waiting = (await (await page.request.get('/api/menu/waiting')).json()) as {
        reports?: number;
      };
      const queue = await page.request.get('/api/moderation/reports?status=pending');
      if (waiting.reports === undefined) {
        // A moderator agreement they have not accepted: the queue refuses
        // them, and the button says nothing.
        expect(queue.status()).toBe(403);
        await expect(button).toHaveAccessibleName(/^Menu$/);
        return;
      }
      const listed = ((await queue.json()) as { reports: unknown[] }).reports.length;
      expect(waiting.reports).toBe(listed);
      if (listed === 0) await expect(button).toHaveAccessibleName(/^Menu$/);
      else
        await expect(button).toHaveAccessibleName(
          new RegExp(`^${String(listed)} reports? waiting for a moderator\\.\\s*Menu$`),
        );
    }).toPass({ timeout: 30_000 });
  });
});
