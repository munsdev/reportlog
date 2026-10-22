/**
 * The site shell and public pages in a real browser (parity R5, R6):
 * the front page without its buttons, the page that says so when the app
 * cannot start, the header at every width, the prose pages on a phone, tap
 * targets, the deployment's name, and the directory.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { AxeResults, RunOptions } from 'axe-core';
import { ADMIN } from './auth.ts';
import { address, everyPage } from './site-walk.ts';

const AXE_SOURCE = readFileSync(
  createRequire(import.meta.url).resolve('axe-core/axe.min.js'),
  'utf8',
);

/** Every request a page makes to a host other than this site's. */
function outsideRequests(page: Page): string[] {
  const outside: string[] = [];
  page.on('request', (r) => {
    const host = new URL(r.url()).hostname;
    if (host !== '127.0.0.1' && host !== 'localhost') outside.push(r.url());
  });
  return outside;
}

async function violations(page: Page): Promise<string[]> {
  await page.evaluate(AXE_SOURCE);
  const results = await page.evaluate(() =>
    (
      window as unknown as { axe: { run(d: Document, o: RunOptions): Promise<AxeResults> } }
    ).axe.run(document, {
      runOnly: {
        type: 'tag',
        values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'],
      },
      resultTypes: ['violations'],
    }),
  );
  return results.violations.map((v) => `${v.id}: ${v.help}`);
}

test('the front page still offers the way in when its buttons cannot be fetched', async ({
  page,
}) => {
  await page.route('**/api/home-buttons', (route) => route.abort());
  await page.goto('/');
  const buttons = page.getByRole('list', { name: 'What you can do here' }).getByRole('link');
  // The query retries before it gives up, so allow for that.
  // The board's button may carry its count after the words.
  await expect(buttons).toHaveText(['Submit a Report', /^View Live Report Board/], {
    timeout: 15_000,
  });
  await expect(buttons.first()).toHaveAttribute('href', '/submit');
  await expect(page.getByLabel('Report reference')).toBeVisible();
});

test.describe('when the app cannot start', () => {
  test('the page says so in plain words, asks no third party, and passes the accessibility check', async ({
    page,
  }) => {
    const outside = outsideRequests(page);
    // The built app is a script; take it away.
    await page.route('**/assets/*.js', (route) => route.abort());
    await page.goto('/');
    const alert = page.getByRole('alert');
    await expect(alert.getByRole('heading', { name: 'This page did not load' })).toBeVisible();
    await expect(alert.getByRole('link', { name: 'Reload this page' })).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(await violations(page)).toEqual([]);
    expect(outside).toEqual([]);
  });

  test('a page that starts is left alone', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    // Past the longest the guard waits.
    await page.waitForTimeout(11_000);
    await expect(page.getByRole('heading', { name: 'This page did not load' })).toHaveCount(0);
  });
});

test.describe('the header', () => {
  test.use({ storageState: ADMIN });
  for (const width of [320, 390, 768, 1280]) {
    test(`stays on one row at ${String(width)}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/');
      const header = page.locator('header').first();
      // The wordmark and the Menu button, and nothing else in the bar.
      await expect(header.getByRole('button', { name: /Menu$/ })).toBeVisible();
      const row = await header.evaluate((el) => {
        const inner = el.firstElementChild;
        // What is drawn in the bar: the closed menu (hidden) takes no room.
        const kids = [...(inner?.children ?? [])]
          .map((k) => k.getBoundingClientRect())
          .filter((k) => k.width > 0);
        return {
          tops: kids.map((k) => k.top),
          bottoms: kids.map((k) => k.bottom),
          height: inner?.getBoundingClientRect().height ?? 0,
          overflowing: document.documentElement.scrollWidth > window.innerWidth,
        };
      });
      // Every child sits on the same row: they overlap vertically.
      expect(Math.max(...row.tops)).toBeLessThan(Math.min(...row.bottoms));
      expect(row.height).toBeLessThan(2 * 44);
      expect(row.overflowing).toBe(false);
    });
  }
});

test.describe('the prose pages on a phone', () => {
  for (const path of ['/about', '/how', '/standards', '/legal', '/public-api']) {
    test(`${path} has no sideways scroll at 320px and keeps its margin`, async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 700 });
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      const m = await page.evaluate(() => {
        const main = document.querySelector('main');
        const box = main?.getBoundingClientRect();
        const wide = [...document.querySelectorAll('main *')].filter(
          // A table or code block in its own scroller may be wider; the page may not.
          (el) =>
            el.getBoundingClientRect().right > window.innerWidth + 1 &&
            !el.closest('.overflow-x-auto'),
        );
        return {
          scroll: document.documentElement.scrollWidth - window.innerWidth,
          padLeft: main ? parseFloat(getComputedStyle(main).paddingLeft) : 0,
          mainWidth: box?.width ?? 0,
          wide: wide.slice(0, 3).map((e) => e.tagName + '.' + e.className),
        };
      });
      expect(m.wide).toEqual([]);
      expect(m.scroll).toBeLessThanOrEqual(0);
      expect(m.padLeft).toBeGreaterThanOrEqual(16);
    });
  }
});

test('buttons, and the links in the header, footer and menus, are at least 44px tall', async ({
  page,
}) => {
  for (const path of ['/', '/about', '/legal', '/organizations', '/submit']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const small = await page.evaluate(() => {
      const targets = document.querySelectorAll(
        // A radio's words are its click target (RadioOption), as for a checkbox.
        'button:not([role=radio]), input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, textarea, header a, footer nav a, nav a',
      );
      return (
        [...targets]
          .map((el) => ({ el, box: el.getBoundingClientRect() }))
          // Not drawn (the skip link until it is focused), or hidden.
          .filter(({ box }) => box.width > 1 && box.height > 1)
          .filter(({ box }) => box.height < 43.5)
          .map(({ el, box }) => `${el.tagName} "${el.textContent.trim()}" ${String(box.height)}px`)
      );
    });
    expect(small, path).toEqual([]);
  }
});

/**
 * Where a page may say "ReportLog" although the deployment has another name:
 * because it is describing the software, which no operator can rename.
 */
const SOFTWARE_PAGES: Record<string, string> = {
  '/about': 'part two describes the software by its name',
  '/docs/checking':
    'a checklist sentence that says the tab shows the deployment’s name, not “ReportLog”',
};

test('no page says ReportLog where it means the deployment', async ({ page }) => {
  test.skip(test.info().project.name !== 'chromium', 'the same walk twice would say the same');
  test.setTimeout(240_000);
  // The deployment is renamed in the browser only, so no shared setting is
  // touched. The wording defaults carry no name of their own, so a page that
  // still says ReportLog is saying it from its own text.
  await page.route('**/api/site', async (route) => {
    const real = await route.fetch();
    const body = (await real.json()) as Record<string, unknown>;
    await route.fulfill({
      json: {
        ...body,
        plain_name: 'Harbour Watch',
        name_parts: [{ text: 'Harbour Watch', mark: '' }],
      },
    });
  });
  const found: string[] = [];
  for (const path of everyPage()) {
    await page.goto(address(path), { waitUntil: 'networkidle' });
    // Not the footer: its attribution names the software on purpose.
    const text = await page.evaluate(() =>
      [...document.querySelectorAll('header, main')]
        .map((e) => (e as HTMLElement).innerText)
        .join('\n'),
    );
    if (text.includes('ReportLog') && !(path in SOFTWARE_PAGES)) found.push(path);
  }
  expect(
    found,
    'say the deployment’s name, or add the page to SOFTWARE_PAGES with a reason',
  ).toEqual([]);
});

test.describe('the site’s own controls', () => {
  test.use({ storageState: ADMIN });

  // docs/design/components.md §06: every choice is a choice card, and files
  // are chosen with a button. A real input may sit underneath (it is what
  // posts the form, or opens the phone's camera roll), but a person never
  // sees the browser's own. Walked as an administrator, so the staff screens
  // draw their forms rather than a request to sign in.
  test('no page shows a browser-default radio, checkbox or file input', async ({ page }) => {
    test.skip(test.info().project.name !== 'chromium', 'the same walk twice would say the same');
    test.setTimeout(240_000);
    const found: string[] = [];
    for (const path of everyPage()) {
      await page.goto(address(path), { waitUntil: 'networkidle' });
      const shown = await page.evaluate(() =>
        [
          ...document.querySelectorAll<HTMLInputElement>(
            'input[type=radio], input[type=checkbox], input[type=file]',
          ),
        ]
          .filter((el) => {
            const style = getComputedStyle(el);
            const box = el.getBoundingClientRect();
            const clipped = style.clipPath.includes('inset(50%');
            return (
              style.opacity !== '0' &&
              style.visibility !== 'hidden' &&
              box.width > 2 &&
              box.height > 2 &&
              !clipped
            );
          })
          .map((el) => el.type),
      );
      if (shown.length) found.push(`${path}: ${shown.join(', ')}`);
    }
    expect(found).toEqual([]);
  });
});

test.describe('the directory', () => {
  test('lists no report counts and no ranking, and says plainly when it is empty', async ({
    page,
  }) => {
    const outside = outsideRequests(page);
    await page.goto('/organizations');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Participating organizations' }),
    ).toBeVisible();
    const text = await page.getByRole('main').innerText();
    expect(text).not.toMatch(/\b\d+\s+reports?\b/i);
    expect(text).not.toMatch(/\b(top|ranked|most active)\b/i);
    await page.waitForLoadState('networkidle');
    expect(outside).toEqual([]);
  });

  test('says there is nothing listed, when nothing is', async ({ page }) => {
    await page.route('**/api/directory', async (route) => {
      const real = await route.fetch();
      const body = (await real.json()) as Record<string, unknown>;
      await route.fulfill({ json: { ...body, organizations: [] } });
    });
    await page.goto('/organizations');
    await expect(page.getByText('No organization has asked to be listed yet.')).toBeVisible();
  });

  test('a stranger opening an organization’s listing is asked to sign in', async ({ page }) => {
    await page.goto('/organizations/1/listing');
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await expect(page.getByRole('main')).toContainText(/sign in/i);
  });
});

test.describe('an organization’s own listing switch', () => {
  test.use({ storageState: ADMIN });

  test('lists and unlists, and says what appears publicly', async ({ page }) => {
    // The server's answer is stood in for, so the dev database keeps its
    // organizations as they are; what is under test is the screen.
    let listed = false;
    const answer = () => ({
      organization: 'Harbour Group',
      listed,
      joined: listed ? '2026-10-01T00:00:00.000Z' : null,
      member_count: 3,
      directory_name: 'Participating organizations',
      what_appears: ['The organization’s name', 'How many members it has'],
      disclaimer: 'Listing is not an endorsement.',
      leaving: 'You can leave the directory at any time.',
    });
    await page.route('**/api/directory/listing/1', async (route) => {
      if (route.request().method() === 'PUT') {
        listed = (route.request().postDataJSON() as { listed: boolean }).listed;
      }
      await route.fulfill({ json: answer() });
    });
    await page.goto('/organizations/1/listing');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Harbour Group in the directory' }),
    ).toBeVisible();
    await expect(page.getByText('Harbour Group is not listed')).toBeVisible();
    await expect(page.getByText('Today its number of members would be 3.')).toBeVisible();
    // Two choice cards and the panel's own Save; nothing changes until Save.
    await page.getByRole('radio', { name: 'Listed', exact: true }).check();
    await expect(page.getByText('Harbour Group is not listed')).toBeVisible();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText(/Harbour Group is listed in .*since/)).toBeVisible();
    await expect(
      page.getByRole('status').filter({ hasText: 'listed in the directory now' }),
    ).toBeVisible();
    await page.getByRole('radio', { name: 'Not listed' }).check();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Harbour Group is not listed')).toBeVisible();
  });
});

test.describe('the front page editor', () => {
  test.use({ storageState: ADMIN });

  test('asks before it is left with an arrangement that is not saved', async ({ page }) => {
    await page.goto('/logbooks/front-page');
    const rows = page.getByRole('list', { name: 'Buttons, in order' }).getByRole('listitem');
    await expect(rows.first()).toBeVisible();
    // Nothing changed yet: leaving asks nothing.
    // Take a button off the page, but do not save.
    await rows
      .first()
      .getByRole('button', { name: /^Take off the page/ })
      .click();

    let asked = '';
    page.once('dialog', (d) => {
      asked = d.message();
      void d.dismiss();
    });
    await page.getByRole('link', { name: '← All logbooks' }).click();
    await expect
      .poll(() => asked)
      .toMatch(/changes to the front page’s buttons that are not saved/);
    await expect(page).toHaveURL(/\/logbooks\/front-page$/);
  });

  test('leaves without asking when nothing was changed', async ({ page }) => {
    await page.goto('/logbooks/front-page');
    await expect(
      page.getByRole('list', { name: 'Buttons, in order' }).getByRole('listitem').first(),
    ).toBeVisible();
    page.on('dialog', () => {
      throw new Error('asked although nothing was changed');
    });
    await page.getByRole('link', { name: '← All logbooks' }).click();
    await expect(page).toHaveURL(/\/logbooks$/);
  });
});
