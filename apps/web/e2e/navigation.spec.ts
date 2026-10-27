/**
 * NAVIGATION (stage 3; docs/design/checks.md, section 02), at the phone's
 * and the desktop's width (the `phone` and `chromium` projects).
 *
 *   - The header is one row at 320, 390, 768 and 1280 wide, and the page
 *     never scrolls sideways, with the menu shut or open.
 *   - Menu opens and closes by click, Enter, Space and Escape; focus moves
 *     in, stays in, and comes back to the Menu button.
 *   - The staff area's top bar is one row at every width, and nothing in it
 *     scrolls sideways.
 *   - Each role with staff pages finds one way into the staff area in the
 *     public menu, and none of the pages themselves there; in the staff
 *     area's sidebar it reaches every staff page it may open, and sees no
 *     page it may not open. The owner's case is in owner/backups.spec.ts,
 *     the only project that holds the owner's seat.
 *   - Sign out is reachable by keyboard and by tap at 390 wide, for every
 *     signed-in role, on the public site and in the staff area. (The bug
 *     that started the redesign.)
 *   - The current page is marked in the staff sidebar, once.
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
import type { Browser } from '@playwright/test';
import { ADMIN, MODERATOR } from './auth.ts';
import { identityState } from './identity/mail.ts';
import { accountMenu, isPhone, menuLink, named, openMenu, staffNav } from './menu.ts';
import { ALL_PAGES, MENU_FOR, pageByLabel } from './navigation-table.ts';
import type { MenuRole } from './navigation-table.ts';

const API = fileURLToPath(new URL('../../api/', import.meta.url));
const filingState = (...args: string[]) =>
  execFileSync('node', ['--env-file-if-exists=../../.env', 'src/filing/dev-state.ts', ...args], {
    cwd: API,
  });
/** A session token for an existing account, its second factor proven (dev-state.ts `session`). */
const sessionFor = (email: string) =>
  execFileSync(
    'node',
    ['--env-file-if-exists=../../.env', 'src/identity/dev-state.ts', 'session', email],
    {
      cwd: API,
    },
  ).toString();
const stamp = () => `${Date.now().toString(36)}${String(Math.floor(Math.random() * 10_000))}`;

type SignedInRole = Exclude<MenuRole, 'visitor' | 'owner'>;

/** A browser of its own, signed in as a new account in this role. */
async function as(browser: Browser, role: SignedInRole) {
  const email = `e2e-nav-${role.replace('_', '-')}-${stamp()}@example.org`;
  if (role === 'coordinator') filingState('coordinator', email, `Navigation Group ${stamp()}`);
  else if (role === 'reporter' || role === 'tester') identityState('seat', email, 'user');
  else identityState('seat', email, role);
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  // Signed in without the emailed code: these tests sign in some forty
  // people, which signing in for real would put past the sign-in limit of
  // 60 an hour from one client, and every sign-in test after them would
  // fail. Signing in itself is tested elsewhere (identity/, two-factor).
  const token = sessionFor(email);
  await context.addCookies([
    {
      name: 'session_token',
      value: token,
      domain: '127.0.0.1',
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    },
  ]);
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
          const rowBox = row?.getBoundingClientRect();
          // What sits in the bar itself: the open panel hangs below it from
          // the same element, and is not part of the row.
          const kids = [...(row?.children ?? [])]
            .map((k) => k.getBoundingClientRect())
            .filter((k) => k.width > 0 && k.height > 0 && k.top < (rowBox?.bottom ?? 120));
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

test.describe('the staff area’s top bar', () => {
  test.use({ storageState: ADMIN });
  for (const width of [320, 390, 768, 1280]) {
    test(`is one row at ${String(width)}px, and nothing scrolls sideways`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/settings/look');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      const banner = page.getByRole('banner');
      await expect(banner.getByRole('button', { name: /^Account:/ })).toBeVisible();
      const box = await banner.evaluate((el) => ({
        height: el.firstElementChild?.getBoundingClientRect().height ?? 0,
        sideways: document.documentElement.scrollWidth > window.innerWidth,
      }));
      expect(box.height).toBeLessThanOrEqual(72);
      expect(box.sideways).toBe(false);
      if (width < 900) {
        // The drawer (below the mock-up's 900px): open, Escape closes it, and focus is back on its button.
        const button = banner.getByRole('button', { name: 'Menu' });
        await button.click();
        await expect(page.getByRole('navigation', { name: 'Your pages' })).toBeVisible();
        await expect(page.locator('#staff-drawer :focus')).toHaveCount(1);
        await page.keyboard.press('Escape');
        await expect(page.locator('#staff-drawer')).toHaveCount(0);
        await expect(button).toBeFocused();
      } else {
        await expect(page.getByRole('navigation', { name: 'Your pages' })).toBeVisible();
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
      // Focus moved in, to the menu's first control (checks.md §02). On a
      // phone that may be an area's fold rather than a link.
      await expect(nav.locator(':focus')).toHaveCount(1);
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

    // The public menu: one way into the staff area, and no staff page itself.
    const menu = await openMenu(page);
    const door = menu.getByRole('link', { name: /^Your dashboard/ });
    await expect(door).toHaveCount(mine.length ? 1 : 0);
    // Everybody signed in has their own pages in the menu (decision 71).
    const ownPages = new Set(['My reports', 'Email updates', 'Your dashboard', 'Signing in']);
    for (const p of ALL_PAGES.filter((p) => !ownPages.has(p.label)))
      await expect(menu.getByRole('link', { name: named(p.label) }), p.label).toHaveCount(0);
    if (role === 'visitor') {
      await expect(menu.getByRole('link', { name: 'Sign in' })).toBeVisible();
      await expect(menu.getByRole('button', { name: 'Sign out' })).toHaveCount(0);
    } else {
      await expect(menu.getByText(who.email)).toBeVisible();
    }
    if (!mine.length) {
      await who.context.close();
      return;
    }

    // The staff area's sidebar: exactly this person's pages.
    const side = await staffNav(page);
    for (const label of mine) {
      const target = pageByLabel(label);
      const link = side.getByRole('link', { name: named(label) });
      await expect(link, label).toBeVisible();
      await expect(link, label).toHaveAttribute(
        'href',
        new RegExp(`^${target.href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/?$`),
      );
    }
    for (const other of ALL_PAGES.filter((p) => !mine.includes(p.label))) {
      await expect(side.getByRole('link', { name: named(other.label) }), other.label).toHaveCount(
        0,
      );
    }
    if (isPhone(page)) await page.keyboard.press('Escape');

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
      await expect(page.locator('#staff-drawer')).toHaveCount(0);
    }
    await who.context.close();
  });
}

test('an administrator reaches the maps from the menu', async ({ browser }) => {
  const context = await browser.newContext({ storageState: ADMIN });
  const page = await context.newPage();
  await page.goto('/');
  await (await menuLink(page, 'Maps', { area: 'Content' })).click();
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
      // Signing out closes the menu once the page knows who it is now; wait
      // for that, or the next line could find the old menu still open.
      await expect(page.getByRole('navigation', { name: 'Main menu' })).toBeHidden();
      const nav = await openMenu(page);
      await expect(nav.getByRole('link', { name: 'Sign in' })).toBeVisible();
      await context.close();
    }
  });
}

test('signs out from the staff area at 390 wide, by keyboard', async ({ browser }) => {
  const { context, page } = await as(browser, 'moderator');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/moderate/flood');
  const button = page.getByRole('banner').getByRole('button', { name: /^Account:/ });
  await button.focus();
  await page.keyboard.press('Enter');
  const panel = await accountMenu(page);
  const out = panel.getByRole('button', { name: 'Sign out' });
  let found = false;
  for (let i = 0; i < 20 && !found; i += 1) {
    await page.keyboard.press('Tab');
    found = await out.evaluate((el) => el === document.activeElement).catch(() => false);
  }
  expect(found, 'Sign out is in the Tab order').toBe(true);
  await page.keyboard.press('Enter');
  await expect
    .poll(async () => (await (await page.request.get('/api/auth/me')).json()) as unknown)
    .toEqual({ signedIn: false });
  await expect(page.locator('[data-staff-app]')).toHaveCount(0);
  await context.close();
});

// ── where you are ───────────────────────────────────────────────────────

test.describe('the current page', () => {
  test.use({ storageState: ADMIN });

  test('is marked in the staff sidebar, once', async ({ page }) => {
    await page.goto('/settings/look');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const side = await staffNav(page);
    await expect(side.getByRole('link', { name: 'Look', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(side.locator('[aria-current="page"]')).toHaveCount(1);
    // No row of area tabs any more: the sidebar is the only list of them.
    await expect(page.getByRole('navigation', { name: 'Site settings' })).toHaveCount(0);
  });

  test('a report’s own page is the queue’s, in the sidebar', async ({ browser }) => {
    const context = await browser.newContext({ storageState: MODERATOR });
    const page = await context.newPage();
    await page.goto('/moderate/00000000-0000-4000-8000-000000000000');
    const link = await menuLink(page, 'Reports queue', { area: 'Review' });
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
