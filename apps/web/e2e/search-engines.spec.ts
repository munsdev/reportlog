/**
 * What a search engine finds, through the same proxy the site runs behind
 * (vite.config.ts here, deploy/caddy/Caddyfile on a server): robots.txt and
 * the sitemap at the root, built by the API rather than answered with the
 * app's page, and each page saying whether it may be indexed.
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { ADMIN } from './auth.ts';

const robots = (page: Page) => page.locator('head meta[name="robots"]');
const canonical = (page: Page) => page.locator('head link[rel="canonical"]');

test('robots.txt and the sitemap come from the API, not the app', async ({ request, baseURL }) => {
  const r = await request.get('/robots.txt');
  expect(r.status()).toBe(200);
  expect(r.headers()['content-type']).toMatch(/^text\/plain/);
  const text = await r.text();
  expect(text).toContain('User-agent: *');
  expect(text).toContain('Disallow: /api/');
  expect(text).not.toContain('<!doctype');

  const s = await request.get('/sitemap.xml');
  expect(s.status()).toBe(200);
  const xml = await s.text();
  expect(xml).toContain('<urlset');
  // The API builds addresses from SITE_ORIGIN; the run's is this site.
  expect(xml).toContain(`<loc>${String(baseURL)}/board</loc>`);
});

test('a public page may be indexed, under its one address', async ({ page, baseURL }) => {
  await page.goto('/board?q=nothing');
  await expect(robots(page)).toHaveAttribute('content', 'index, follow');
  await expect(canonical(page)).toHaveAttribute('href', `${String(baseURL)}/board`);
});

test('a page that is not there may not', async ({ page }) => {
  await page.goto('/board/RL-NOTHING');
  await expect(robots(page)).toHaveAttribute('content', 'noindex');
  await expect(canonical(page)).toHaveCount(0);
});

test.describe('signed in', () => {
  test.use({ storageState: ADMIN });

  test('a staff screen may not, and leaving it for a public page changes the answer', async ({
    page,
  }) => {
    await page.goto('/moderate');
    await expect(robots(page)).toHaveAttribute('content', 'noindex');
    await page.goto('/about');
    await expect(robots(page)).toHaveAttribute('content', 'index, follow');
  });
});
