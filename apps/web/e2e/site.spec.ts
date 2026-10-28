import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { ADMIN } from './auth.ts';

/** Every request a page makes to a host other than this site's. */
function outsideRequests(page: Page): string[] {
  const outside: string[] = [];
  page.on('request', (r) => {
    const host = new URL(r.url()).hostname;
    if (host !== '127.0.0.1' && host !== 'localhost') outside.push(r.url());
  });
  return outside;
}

test('the front page has one main button, and checking a report still works from it', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const buttons = page.getByRole('list', { name: 'What you can do here' }).getByRole('link');
  await expect(buttons.first()).toBeVisible();
  // Only the first wears the action colour.
  const action = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--rl-action').trim(),
  );
  const fills = await buttons.evaluateAll((els) =>
    els.map((el) => getComputedStyle(el).backgroundColor),
  );
  const hex = (rgb: string) =>
    `#${(rgb.match(/\d+/g) ?? [])
      .slice(0, 3)
      .map((n) => Number(n).toString(16).padStart(2, '0'))
      .join('')}`;
  expect(fills.map(hex).filter((c) => c === action)).toHaveLength(1);
  expect(hex(fills[0] ?? '')).toBe(action);
  await expect(page.getByLabel('Report reference')).toBeVisible();
});

test('the legal page says plainly what has not been published', async ({ page }) => {
  await page.goto('/legal');
  await expect(page.getByRole('heading', { name: 'Imprint', exact: true })).toBeVisible();
  // The dev database is the operator's; on a fresh one nothing is published,
  // and on any database the outline is never what the page shows.
  await expect(page.getByText('outline to complete')).toHaveCount(0);
  await page.getByRole('main').getByRole('link', { name: 'moderation standard' }).click();
  await expect(page).toHaveURL(/\/standards$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Standards' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Moderation standard' })).toBeVisible();
});

test('the footer reaches the legal page', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Imprint and privacy' }).click();
  await expect(page).toHaveURL(/\/legal$/);
});

test('the manifest is served in the site’s name and the browser finds it', async ({
  page,
  request,
}) => {
  const res = await request.get('/api/site/manifest.webmanifest');
  expect(res.ok()).toBe(true);
  expect(res.headers()['content-type']).toMatch(/application\/manifest\+json/);
  const manifest = (await res.json()) as { name: string; theme_color: string };
  await page.goto('/');
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    'href',
    '/api/site/manifest.webmanifest',
  );
  const site = (await (await request.get('/api/site')).json()) as { plain_name: string };
  expect(manifest.name).toBe(site.plain_name);
  const icon = await request.get('/icons/icon-192.png');
  expect(icon.headers()['content-type']).toBe('image/png');
});

/**
 * The server's look replaced, so the dev database is not changed; what is
 * under test is the browser applying it. Both calls that carry the look are
 * answered, or whichever arrived last would decide the page (decision 60
 * put it on the password check too).
 */
async function wearLook(page: Page, look: Record<string, string>) {
  for (const path of ['**/api/site', '**/api/site-access/status']) {
    await page.route(path, async (route) => {
      const real = await route.fetch();
      const body = (await real.json()) as Record<string, unknown>;
      await route.fulfill({ json: { ...body, look } });
    });
  }
}

test('an operator’s palette and theme repaint every screen, through the stylesheet alone', async ({
  page,
}) => {
  await wearLook(page, {
    palette: 'midnight',
    theme: 'docket',
    panel_head: 'rule',
    texture: 'none',
  });
  await page.goto('/legal');
  await expect(page.locator('html')).toHaveAttribute('data-palette', 'midnight');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'docket');
  await expect(page.locator('html')).toHaveAttribute('data-panel-head', 'rule');
  // The heading first: read before the page has drawn it, the fallback to
  // <body> reports no text-transform, which failed about one run in four.
  await expect(page.locator('h1')).toBeVisible();
  const look = await page.evaluate(() => {
    const html = getComputedStyle(document.documentElement);
    const h1 = getComputedStyle(document.querySelector('h1') ?? document.body);
    return { bg: html.backgroundColor, font: h1.fontFamily, transform: h1.textTransform };
  });
  expect(look.bg).toBe('rgb(18, 26, 36)');
  expect(look.font).toMatch(/Courier Prime/);
  expect(look.transform).toBe('uppercase');
});

test('the look is remembered, so a returning reader is not shown the default first', async ({
  page,
}) => {
  await wearLook(page, {
    palette: 'phosphor',
    theme: 'signal',
    panel_head: 'plain',
    texture: 'none',
  });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-palette', 'phosphor');
  // Hold both answers back on the next visit: the remembered look is applied first.
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  for (const path of ['**/api/site', '**/api/site-access/status'])
    await page.route(path, () => new Promise(() => undefined));
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-palette', 'phosphor');
});

test('the settings ask a visitor to sign in, rather than showing an empty form', async ({
  page,
}) => {
  await page.goto('/settings/look');
  await expect(page.getByRole('heading', { name: 'Sign in first' })).toBeVisible();
  await expect(page.getByRole('radio')).toHaveCount(0);
});

test.describe('signed in as an administrator', () => {
  test.use({ storageState: ADMIN });

  test('the settings open, with every palette to choose from', async ({ page }) => {
    await page.goto('/settings/look');
    await expect(page.getByRole('radio').first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Sign in first' })).toHaveCount(0);
  });
});

test('none of these pages asks a third party for anything', async ({ page }) => {
  const outside = outsideRequests(page);
  for (const path of ['/', '/legal', '/settings/look']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
  }
  expect(outside).toEqual([]);
});
