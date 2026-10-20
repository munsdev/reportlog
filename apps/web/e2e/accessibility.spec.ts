/**
 * EVERY PAGE PASSES AN AUTOMATED ACCESSIBILITY CHECK (decision 12).
 *
 * axe-core, from node_modules, run inside each page: the checker is
 * evaluated in the page as a string, never fetched, so the check itself asks
 * no third party for anything (and works under the site's CSP, which allows
 * no inline script).
 *
 * The pages are found the way the no-third-party walk finds them
 * (e2e/third-party.spec.ts): from the route tree the router plugin
 * generates, so a page added tomorrow is checked without anybody remembering
 * to. Each is opened as a stranger and as an administrator.
 *
 * The lock screen stands in front of every page once the site has a password,
 * and this walk runs with the password off; it has its own pass with the
 * password on (a11y-locked/lock-screen.spec.ts).
 *
 * The rules are WCAG 2.0, 2.1 and 2.2 at levels A and AA (e2e/a11y.ts). A violation fails
 * the test, naming the rule, the elements and axe's own explanation. The
 * only way past one is an entry in ALLOWED below: one rule on one page for
 * one visitor, with the reason written next to it. There is no blanket
 * disable, and an entry that no longer matches anything fails too, so a fix
 * cannot leave its allowance behind.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { axe, describeViolation as describe } from './a11y.ts';
import { ADMIN } from './auth.ts';

type Visitor = 'stranger' | 'administrator';

/**
 * Known violations that are not fixed yet. Each one: the rule, the route as
 * the route tree spells it, who sees it, and why it is allowed for now.
 * docs/status/Q3-quality-ops.md lists the same entries.
 */
interface Allowance {
  rule: string;
  page: string;
  visitor: Visitor;
  why: string;
  /**
   * Set when what breaks the rule is drawn only once other tests have made
   * it (a published report, say): files run in no fixed order, so a run can
   * reach the page before then. Then, and only then, an allowance that
   * matched nothing is not called stale. Say why in the value.
   */
  onlyWhenPresent?: string;
}

// The board's "Read in full" link was the first allowance; Q2 fixed it
// ("Read in full: RL-…").
// Empty: nothing is excused. The heat map's inset tiles were the last
// allowance; R9 fixed their names.
const ALLOWED: Allowance[] = [];

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

async function check(page: Page, path: string, visitor: Visitor) {
  await page.goto(address(path), { waitUntil: 'networkidle' });
  // Something rendered: a page, the lock screen or a "nothing here", each in a <main>.
  await expect(page.locator('main').first()).toBeVisible();
  const { violations } = await axe(page);

  const allowedHere = ALLOWED.filter((a) => a.page === path && a.visitor === visitor);
  const found = violations.filter((v) => !allowedHere.some((a) => a.rule === v.id));
  expect(found.map(describe).join('\n\n'), `${path} as ${visitor}`).toBe('');
  const stale = allowedHere.filter(
    (a) => !a.onlyWhenPresent && !violations.some((v) => v.id === a.rule),
  );
  expect(
    stale.map((a) => a.rule),
    `${path} as ${visitor}: allowed but no longer found, so remove the allowance`,
  ).toEqual([]);
}

const PAGES = everyPage();

test('the check has the route tree to walk', () => {
  // A floor, so a change to the generated file's shape cannot empty the walk.
  expect(PAGES.length).toBeGreaterThan(50);
  // Every allowance names a page that exists and gives a reason.
  for (const a of ALLOWED) {
    expect(PAGES, a.rule).toContain(a.page);
    expect(a.why.length, `${a.page} ${a.rule}`).toBeGreaterThan(20);
  }
});

test.describe('as a stranger', () => {
  for (const path of PAGES) {
    test(`${path} passes the accessibility check`, async ({ page }) => {
      await check(page, path, 'stranger');
    });
  }

  test('the setup wizard passes the accessibility check', async ({ page }) => {
    await page.route('**/api/setup/status', (route) =>
      route.fulfill({ json: { needed: true, hasOwner: false, minPassword: 8 } }),
    );
    await page.goto('/', { waitUntil: 'networkidle' });
    await expect(
      page.getByRole('heading', { level: 1, name: 'Who will own this deployment?' }),
    ).toBeVisible();
    const { violations } = await axe(page);
    expect(violations.map(describe).join('\n\n')).toBe('');
  });
});

test.describe('as an administrator', () => {
  test.use({ storageState: ADMIN });
  for (const path of PAGES) {
    test(`${path} passes the accessibility check`, async ({ page }) => {
      await check(page, path, 'administrator');
    });
  }
});
