/**
 * THE STAFF SHELL (U3; docs/ui-mockup `staff_chrome`): one frame for every
 * staff page, the sidebar a column from 900px and a full-screen drawer below.
 *
 *   - Desktop: the sidebar is beside the page, there is no Menu button, the
 *     bar carries the Staff badge, "View the public site" and the account
 *     chip, and the current page is marked once.
 *   - Phone: Menu opens a dialog with its own Close; focus goes in and stays
 *     in; Escape and Close shut it and give focus back to Menu; following a
 *     link shuts it.
 *   - A moderator who is not an administrator, and a journalist, are shown
 *     only their own pages.
 *   - Every staff page this person may open loads inside the shell (a sweep).
 *
 * Who sees what, role by role, is in navigation.spec.ts; this file is the
 * shell's own shape.
 */
import { expect, test } from '@playwright/test';
import type { Browser } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ADMIN, MODERATOR } from './auth.ts';
import { identityState } from './identity/mail.ts';
import { ALL_PAGES, MENU_FOR, pageByLabel } from './navigation-table.ts';
import { openGroups } from './menu.ts';

const API = fileURLToPath(new URL('../../api/', import.meta.url));
const desktop = (width: number) => width >= 900;

test.describe('the shell on a desktop', () => {
  test.use({ storageState: ADMIN });

  test('has the sidebar beside the page, the badge and the chip, and no Menu button', async ({
    page,
  }) => {
    test.skip(!desktop(page.viewportSize()?.width ?? 0), 'a desktop test');
    await page.goto('/settings/look');
    const bar = page.getByRole('banner');
    await expect(bar.getByText('Staff', { exact: true })).toBeVisible();
    await expect(bar.getByRole('link', { name: 'View the public site' })).toBeVisible();
    // The account chip, one link since the redesign.
    await expect(bar.getByRole('link', { name: /^Account, / })).toBeVisible();
    await expect(bar.getByRole('button', { name: 'Menu' })).toHaveCount(0);
    const side = page.getByRole('navigation', { name: 'Staff areas' });
    await expect(side).toBeVisible();
    await openGroups(side);
    const [s, m] = await Promise.all([side.boundingBox(), page.getByRole('main').boundingBox()]);
    // Beside, not above: the sidebar's right edge is left of the page's.
    expect((s?.x ?? 0) + (s?.width ?? 0)).toBeLessThanOrEqual(m?.x ?? 0);
    await expect(side.locator('[aria-current="page"]')).toHaveCount(1);
    await expect(side.getByRole('link', { name: 'Name and look', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    // The mock-up's groups, in its order.
    const labels = await side.locator('summary h3').allTextContents();
    expect(labels.slice(0, 4)).toEqual(['You', 'Review', 'Content', 'Site settings']);
  });
});

test.describe('the shell on a phone', () => {
  test.use({ storageState: ADMIN });

  test('opens a dialog, keeps focus inside, closes by Close, Escape and a link', async ({
    page,
  }) => {
    test.skip(desktop(page.viewportSize()?.width ?? 0), 'a phone test');
    await page.goto('/settings/look');
    const menu = page.getByRole('banner').getByRole('button', { name: 'Menu' });
    await expect(page.getByRole('navigation', { name: 'Staff areas' })).toHaveCount(0);

    await menu.click();
    const dialog = page.getByRole('dialog', { name: 'Staff menu' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Close' })).toBeFocused();
    await expect(dialog.getByRole('link', { name: 'View the public site' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Sign out' })).toBeVisible();
    // No sideways scroll with it open.
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
    ).toBe(false);
    // Focus stays in, round and back.
    for (let i = 0; i < 90; i += 1) {
      await page.keyboard.press('Tab');
      expect(
        await page.evaluate(() => Boolean(document.activeElement?.closest('#staff-drawer'))),
      ).toBe(true);
    }
    for (let i = 0; i < 6; i += 1) {
      await page.keyboard.press('Shift+Tab');
      expect(
        await page.evaluate(() => Boolean(document.activeElement?.closest('#staff-drawer'))),
      ).toBe(true);
    }
    // Every target is 44px at least.
    const small = await dialog
      .locator('a, button')
      .evaluateAll(
        (els) =>
          els.map((e) => e.getBoundingClientRect()).filter((b) => b.height > 0 && b.height < 43.5)
            .length,
      );
    expect(small).toBe(0);

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(menu).toBeFocused();

    await menu.click();
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(menu).toBeFocused();

    await menu.click();
    await dialog.getByRole('link', { name: 'Wording', exact: true }).click();
    await expect(page).toHaveURL(/\/settings\/words\/?$/);
    await expect(page.locator('#staff-drawer')).toHaveCount(0);
  });
});

// ── who is shown what ────────────────────────────────────────────────────

async function sidebarFor(browser: Browser, email: string, role: string) {
  identityState('seat', email, role);
  const token = execFileSync(
    'node',
    ['--env-file-if-exists=../../.env', 'src/identity/dev-state.ts', 'session', email],
    { cwd: API },
  ).toString();
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
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
  return { context, page: await context.newPage() };
}

for (const [role, gone, kept] of [
  [
    'moderator',
    ['Logbooks', 'Name and look', 'People', 'Checked links'],
    ['Reports queue', 'Flood screen'],
  ],
  [
    'journalist',
    ['Reports queue', 'Logbooks', 'Flood screen'],
    ['Checked links', 'Your alerts', 'Signing in'],
  ],
] as const) {
  test(`${role}: the sidebar shows only their pages`, async ({ browser }) => {
    const { context, page } = await sidebarFor(
      browser,
      `e2e-shell-${role}-${Date.now().toString(36)}@example.org`,
      role,
    );
    await page.goto('/home');
    await expect(page.locator('[data-staff-app]')).toBeVisible();
    if ((page.viewportSize()?.width ?? 1280) < 900) {
      // Pressed again until the drawer is there: a press before the page has
      // finished loading is lost, and under a busy machine that happened.
      await expect(async () => {
        if ((await page.getByRole('dialog', { name: 'Staff menu' }).count()) === 0)
          await page.getByRole('banner').getByRole('button', { name: 'Menu' }).click();
        await expect(page.getByRole('dialog', { name: 'Staff menu' })).toBeVisible({
          timeout: 2000,
        });
      }).toPass({ timeout: 20_000 });
    }
    const side = page
      .getByRole('navigation', { name: 'Staff areas' })
      .filter({ visible: true })
      .first();
    await openGroups(side);
    for (const label of kept)
      await expect(side.getByRole('link', { name: label, exact: true }), label).toBeVisible({
        timeout: 15_000,
      });
    for (const label of gone)
      await expect(side.getByRole('link', { name: label, exact: true }), label).toHaveCount(0);
    await context.close();
  });
}

// ── every staff page loads in the shell ──────────────────────────────────

test.describe('every staff page, in the shell', () => {
  test.use({ storageState: ADMIN });

  test('an administrator opens each page the sidebar offers, and none is refused', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    for (const label of MENU_FOR.admin) {
      const { href } = pageByLabel(label, 'admin');
      const [path = href, hash] = href.split('#');
      await page.goto(hash ? `${path}#${hash}` : path);
      await expect(page.locator('[data-staff-app]'), label).toBeVisible();
      await expect(page.getByRole('heading', { level: 1 }).first(), label).toBeVisible();
      await expect(page.getByText('Not for this account'), label).toHaveCount(0);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
        `${label}: no sideways scroll`,
      ).toBe(false);
    }
    expect(ALL_PAGES.length).toBeGreaterThan(30);
  });

  test('a moderator opens the pages the queue offers', async ({ browser }) => {
    const context = await browser.newContext({ storageState: MODERATOR });
    const page = await context.newPage();
    for (const label of MENU_FOR.moderator) {
      const { href } = pageByLabel(label, 'moderator');
      await page.goto(href);
      await expect(page.locator('[data-staff-app]'), label).toBeVisible();
      await expect(page.getByRole('heading', { level: 1 }).first(), label).toBeVisible();
    }
    await context.close();
  });
});
