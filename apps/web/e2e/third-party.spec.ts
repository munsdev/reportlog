/**
 * NO PAGE ASKS A THIRD PARTY FOR ANYTHING (I1).
 *
 * The root CLAUDE.md asks every new public page for its own no-third-party
 * test. This walks EVERY page the router has instead, read from the route
 * tree the router plugin generates (src/routeTree.gen.ts), so a page added
 * tomorrow is walked without anybody remembering to. Each is opened as a
 * stranger and as an administrator, since staff screens and the signed-in
 * header load differently. The setup wizard, which no address reaches once a
 * site is set up, is opened by answering its status question the way a
 * fresh deployment would.
 *
 * Addresses with a parameter get the demo logbook, a filed report's
 * reference, or a value that names nothing (a page that cannot find what it
 * was asked for still loads its fonts, styles and scripts, which is where a
 * third party would come in).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { ADMIN } from './auth.ts';

const refs = JSON.parse(
  readFileSync(fileURLToPath(new URL('./.refs.json', import.meta.url)), 'utf8'),
) as string[];

/** Every page the router knows, as the generated route tree lists them. */
function everyPage(): string[] {
  const tree = readFileSync(
    fileURLToPath(new URL('../src/routeTree.gen.ts', import.meta.url)),
    'utf8',
  );
  const block = /fullPaths:\s*((?:\|\s*'[^']*'\s*)+)/.exec(tree)?.[1] ?? '';
  return [...block.matchAll(/'([^']*)'/g)].map((m) => m[1] ?? '');
}

/** A value for each parameter name the routes use. A new name fails loudly here. */
const PARAMS: Record<string, string> = {
  slug: 'demo',
  ref: refs[0] ?? 'RL-NONE',
  token: 'a-token-that-names-nothing',
  threadId: '00000000-0000-4000-8000-000000000000',
  id: '1',
};

function address(path: string): string {
  return path.replace(/\$(\w+)/g, (_m, name: string) => {
    const value = PARAMS[name];
    if (value === undefined) throw new Error(`${path}: give $${name} a value in PARAMS`);
    return value;
  });
}

/** Every request a page makes to a host other than this site's. */
function outsideRequests(page: Page): string[] {
  const outside: string[] = [];
  page.on('request', (r) => {
    const url = new URL(r.url());
    if (url.protocol === 'data:' || url.protocol === 'blob:') return;
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') outside.push(r.url());
  });
  return outside;
}

async function walk(page: Page, path: string) {
  const outside = outsideRequests(page);
  await page.goto(address(path), { waitUntil: 'networkidle' });
  // Something rendered: a page, the lock screen or a "nothing here", each in a <main>.
  await expect(page.locator('main').first()).toBeVisible();
  expect(outside, `${path} asked another host`).toEqual([]);
}

const PAGES = everyPage();

test('the walk has the route tree to walk', () => {
  // A floor, so a change to the generated file's shape cannot empty the walk.
  expect(PAGES.length).toBeGreaterThan(50);
  for (const p of ['/', '/submit', '/file/confirm/$token', '/access/invitation/$token']) {
    expect(PAGES).toContain(p);
  }
});

test.describe('as a stranger', () => {
  for (const path of PAGES) {
    test(`${path} asks no third party for anything`, async ({ page }) => {
      await walk(page, path);
    });
  }

  test('the setup wizard asks no third party for anything', async ({ page }) => {
    const outside = outsideRequests(page);
    await page.route('**/api/setup/status', (route) =>
      route.fulfill({ json: { needed: true, hasOwner: false, minPassword: 8 } }),
    );
    await page.goto('/', { waitUntil: 'networkidle' });
    await expect(
      page.getByRole('heading', { level: 1, name: 'Who will own this deployment?' }),
    ).toBeVisible();
    expect(outside).toEqual([]);
  });
});

test.describe('as an administrator', () => {
  test.use({ storageState: ADMIN });
  for (const path of PAGES) {
    test(`${path} asks no third party for anything`, async ({ page }) => {
      await walk(page, path);
    });
  }
});
