/**
 * The owner's header background, in a real browser: choose an element on the
 * Look screen, add a picture, save, and the front page draws it. The picture
 * is scaled in the browser, kept on this site and served from it, and
 * nothing is requested from another host.
 *
 * Its own project (owner/): it hands the owner's seat to a test address and
 * gives it back, which the whole site shares.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import type { APIRequestContext, Browser, BrowserContext } from '@playwright/test';
import { codeIn, countTo, lastMessageTo } from '../identity/mail.ts';
import { passSecondFactor } from '../second-factor.ts';

const API = fileURLToPath(new URL('../../../api/', import.meta.url));
const OWNER = `e2e-look-owner-${Date.now().toString(36)}@example.org`;
let previous = '-';

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

async function ownerContext(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext();
  await signIn(context.request, OWNER);
  return context;
}

/** A real 8 by 8 PNG, so the browser has something to decode and scale. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAbElEQVR4nA3JQQEAMAgDMZSgpEqqhOepQAlKqmjLN1VFFypcTLHFFSmqmm7UuJlmm2vSP0QLCYsRK05EP0wbGZsxa87EP4YeNHiYYYcbMj+WXrR4mWWXW7I/jj50+JhjjztyP0IHBYcJGy4kPLAsVIExyOP/AAAAAElFTkSuQmCC',
  'base64',
);

test.beforeAll(() => {
  previous = ownerSeat('take', OWNER);
});
test.afterAll(async ({ browser }) => {
  // Put the site back whatever happened: no element, no picture.
  const context = await ownerContext(browser);
  const site = await context.request.get('/api/admin/site');
  const state = (await site.json()) as { look_options: Record<string, unknown> };
  const header = state.look_options.header as Record<string, unknown>;
  await context.request.put('/api/admin/site/look-options', {
    data: { ...state.look_options, header: { ...header, on: {}, image: null } },
  });
  await context.close();
  ownerSeat('give-back', previous, OWNER);
});

test('the owner switches on ruled lines and adds a picture; the front page draws both', async ({
  browser,
}) => {
  const context = await ownerContext(browser);
  const page = await context.newPage();
  const outside: string[] = [];
  page.on('request', (r) => {
    const host = new URL(r.url()).hostname;
    if (host !== '127.0.0.1' && host !== 'localhost') outside.push(r.url());
  });

  await page.goto('/settings/look');
  await expect(page.getByRole('heading', { level: 2, name: 'Header background' })).toBeVisible();
  const lines = page.getByRole('button', { name: 'Ruled lines' });
  await expect(lines).toHaveAttribute('aria-pressed', 'false');
  await lines.click();
  await expect(lines).toHaveAttribute('aria-pressed', 'true');

  // The picture is sent at once, scaled in the browser.
  await page.locator('input[type=file][accept="image/*"]').setInputFiles({
    name: 'header.png',
    mimeType: 'image/png',
    buffer: PNG,
  });
  await expect(page.getByText('Image added.')).toBeVisible();
  const thumb = page.getByRole('img', { name: 'Current header' });
  await expect(thumb).toHaveAttribute('src', /^\/api\/site\/header-image\/[a-f0-9]{32}\.jpg$/);

  await page.getByRole('button', { name: 'Save these choices' }).click();
  await expect(page.getByText('Saved. The site now shows it.')).toBeVisible();

  await page.goto('/');
  const layers = page.locator('.rl-motif-host .rl-ov');
  await expect(layers).toHaveCount(1);
  await expect(layers.locator('svg.pat')).toHaveCount(1);
  await expect(layers.locator('.bgimg')).toHaveCount(1);

  // The picture is served from this site to the owner.
  const file = await page.evaluate<string>(() => {
    const el = document.querySelector<HTMLElement>('.rl-ov .bgimg');
    return el?.style.backgroundImage ?? '';
  });
  const path = /url\("?(\/api\/site\/header-image\/[a-f0-9]{32}\.jpg)"?\)/.exec(file)?.[1];
  expect(path).toBeTruthy();
  const served = await page.request.get(path ?? '');
  expect(served.status()).toBe(200);
  expect(served.headers()['content-type']).toBe('image/jpeg');

  expect(outside).toEqual([]);
  await context.close();
});

test('a reader who asked for less motion or Easier reading is not shown it moving', async ({
  browser,
}) => {
  const context = await ownerContext(browser);
  const page = await context.newPage();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const transforms = await page.$$eval('.rl-ov [data-depth]', (nodes) =>
    nodes.map((n) => (n as HTMLElement).style.transform),
  );
  expect(transforms.every((t) => t === '')).toBe(true);
  await context.close();
});

test('an administrator who is not the owner is told who can change it', async ({ browser }) => {
  // The stored admin session (staff.setup.ts) is an administrator, not the owner.
  const context = await browser.newContext({
    storageState: fileURLToPath(new URL('../.auth/admin.json', import.meta.url)),
  });
  const page = await context.newPage();
  await page.goto('/settings/look');
  await expect(page.getByText(/Only the owner can change these/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save these choices' })).toHaveCount(0);
  const res = await context.request.put('/api/admin/site/look-options', {
    data: { zones: 'single', motion: 'on', header: {} },
  });
  expect(res.status()).toBe(403);
  await context.close();
});
