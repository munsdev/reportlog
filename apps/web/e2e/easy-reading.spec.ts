/**
 * Easier reading in a real browser (docs/design/checks.md section 03):
 * turning it on paints High contrast with Commons for this browser only,
 * survives a reload, does nothing for another browser, follows a dark site
 * to High contrast dark, and the page still renders when localStorage
 * throws.
 *
 * The switch is placed in the footer (and the menu) by the navigation; this
 * uses the footer's, which every page has without opening anything.
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const footerSwitch = (page: Page) =>
  // A toggle button since the redesign (mockup/EasierReading.tsx): pressed is on.
  page.getByRole('contentinfo').getByRole('button', { name: /^Easier reading/ });

test('on for this browser: High contrast with Commons, kept across a reload', async ({ page }) => {
  await page.goto('/');
  const html = page.locator('html');
  await expect(footerSwitch(page)).toHaveAttribute('aria-pressed', 'false');
  await footerSwitch(page).click();
  await expect(footerSwitch(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(html).toHaveAttribute('data-palette', 'contrast');
  await expect(html).toHaveAttribute('data-theme', 'commons');
  await expect(html).toHaveAttribute('data-texture', 'none');
  const body = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  expect(body).toMatch(/Atkinson Hyperlegible/);

  await page.reload();
  await expect(html).toHaveAttribute('data-palette', 'contrast');
  await expect(footerSwitch(page)).toHaveAttribute('aria-pressed', 'true');

  // Off again brings the site's own look back.
  await footerSwitch(page).click();
  await expect(html).not.toHaveAttribute('data-palette', 'contrast');
});

test('another browser is not touched', async ({ page, browser }) => {
  await page.goto('/');
  await footerSwitch(page).click();
  await expect(page.locator('html')).toHaveAttribute('data-palette', 'contrast');

  const other = await browser.newContext();
  const elsewhere = await other.newPage();
  await elsewhere.goto('/');
  await expect(footerSwitch(elsewhere)).toHaveAttribute('aria-pressed', 'false');
  await expect(elsewhere.locator('html')).not.toHaveAttribute('data-palette', 'contrast');
  await other.close();
});

test('on a dark site it is High contrast dark', async ({ page }) => {
  for (const path of ['**/api/site', '**/api/site-access/status']) {
    await page.route(path, async (route) => {
      const real = await route.fetch();
      const body = (await real.json()) as { look: Record<string, unknown> };
      await route.fulfill({
        json: { ...body, look: { ...body.look, palette: 'midnight', theme: 'signal', dark: true } },
      });
    });
  }
  await page.goto('/');
  await footerSwitch(page).click();
  await expect(page.locator('html')).toHaveAttribute('data-palette', 'contrast-dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'commons');
});

test('the page still renders when localStorage throws', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
    });
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  // It still works for this page, and only this page.
  await footerSwitch(page).click();
  await expect(page.locator('html')).toHaveAttribute('data-palette', 'contrast');
  expect(errors).toEqual([]);
});
