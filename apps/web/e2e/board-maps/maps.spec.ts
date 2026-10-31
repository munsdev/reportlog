/**
 * The board's three map slots, as a reader sees them: above the reports, with
 * the numbers, and the board's own Maps page. Each is the same map a reader
 * gets anywhere else: an area under the threshold reaches the browser as a
 * bare code with no count, and NO PAGE ASKS ANY OTHER HOST FOR ANYTHING.
 *
 * Its own project, after every other (playwright.config.ts): a map placed
 * above the report board changes that page, and the board's other tests run
 * in parallel with each other. It files nothing through the filing route,
 * so it spends none of the filing limit: I's fixture writes its reports.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { codeIn, countTo, identityState, lastMessageTo } from '../identity/mail.ts';
import { passSecondFactor } from '../second-factor.ts';

/** A launched logbook with approved reports in six places (api/src/maps/dev-state.ts). */
function fixture(): { id: number; slug: string; title: string } {
  const api = fileURLToPath(new URL('../../../api/', import.meta.url));
  const out = execFileSync(
    'node',
    ['--env-file-if-exists=../../.env', 'src/maps/dev-state.ts', 'fixture'],
    { cwd: api, encoding: 'utf8' },
  );
  return JSON.parse(out.trim().split('\n').pop() ?? '{}') as {
    id: number;
    slug: string;
    title: string;
  };
}

function watchOutside(page: Page): string[] {
  const outside: string[] = [];
  page.on('request', (r) => {
    const host = new URL(r.url()).hostname;
    if (host !== '127.0.0.1' && host !== 'localhost') outside.push(r.url());
  });
  return outside;
}

const unique = (stem: string) =>
  `${stem}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;

const SLOTS = ['board_tab', 'board_reports', 'board_numbers'] as const;

test('a map in each of the board’s slots, no count under the threshold, and no other host asked', async ({
  browser,
  playwright,
}) => {
  // An administrator signed in here, not from the saved session: the
  // identity project, which runs before this one, ends that session.
  const admin = await playwright.request.newContext({ baseURL: 'http://127.0.0.1:4173' });
  const email = `e2e-board-maps-${Date.now().toString(36)}@example.org`;
  identityState('seat', email, 'admin');
  const before = countTo(email);
  expect((await admin.post('/api/auth/code', { data: { email } })).ok()).toBe(true);
  const code = codeIn(await lastMessageTo(email, before));
  expect((await admin.post('/api/auth/sign-in', { data: { email, code } })).ok()).toBe(true);
  await passSecondFactor(admin, email);
  const lb = fixture();
  const placed = await admin.put(`/api/admin/maps/places/logbooks/${String(lb.id)}`, {
    data: { key: 'where' },
  });
  expect(placed.ok(), await placed.text()).toBe(true);
  const made: Record<string, { id: number; slug: string; title: string }> = {};
  for (const slot of SLOTS) {
    const slug = unique('board');
    const title = `On the board ${slot} ${slug}`;
    const r = await admin.post('/api/admin/maps', {
      data: { title, slug, enabled: true, min_area: 3, slot, logbook_ids: [lb.id] },
    });
    expect(r.ok(), await r.text()).toBe(true);
    made[slot] = { id: ((await r.json()) as { id: number }).id, slug, title };
  }

  // A reader with no account.
  const context = await browser.newContext();
  const page = await context.newPage();
  const outside = watchOutside(page);
  // Every map payload the reader's browser received, as the network carried it.
  const payloads: string[] = [];
  page.on('response', (res) => {
    if (new URL(res.url()).pathname.startsWith('/api/maps/board-')) {
      void res.text().then((t) => payloads.push(t));
    }
  });
  const mapOf = (slot: (typeof SLOTS)[number]) =>
    page.getByRole('figure').filter({ hasText: made[slot]?.title ?? '' });

  try {
    // Beside the report list, under the filters (decision 82).
    await page.goto('/board');
    await expect(page.getByRole('heading', { level: 1, name: 'Reports' })).toBeVisible();
    const above = mapOf('board_reports');
    await expect(above.getByRole('img')).toBeVisible();
    await expect(page.getByRole('search', { name: 'Search reports' })).toBeVisible();
    const order = await page.evaluate(
      ([title]) => {
        const fig = [...document.querySelectorAll('figure')].find((f) =>
          f.textContent.includes(title ?? ''),
        );
        const form = document.querySelector('form[aria-label="Search reports"]');
        return fig && form
          ? Boolean(fig.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING)
          : null;
      },
      [made.board_reports?.title],
    );
    // The filters come first now: the map is not before them.
    expect(order).toBe(false);
    // Only that slot's map is here.
    await expect(mapOf('board_tab')).toHaveCount(0);
    await expect(mapOf('board_numbers')).toHaveCount(0);

    // Arizona is counted; Nevada (2, under 3) says only that it is under the threshold.
    await above.locator('path[data-code="US-AZ"]').click();
    await expect(above).toContainText('4 published reports');
    // Clicking Arizona narrows the list beside it to Arizona, and the address says so.
    await expect(page).toHaveURL(/place=US-AZ/);
    const list = page.locator('section[aria-label="Reports"]');
    await expect(list).toContainText(/4 reports/);
    await expect(
      page.getByRole('button', { name: 'Remove the filter Place: Arizona' }),
    ).toBeVisible();
    // On a desktop the map is two thirds of the width and the list the third beside it.
    const mapBox = await above.boundingBox();
    const listBox = await list.boundingBox();
    expect(mapBox && listBox && listBox.x > mapBox.x + mapBox.width - 1).toBe(true);
    expect(mapBox && listBox && mapBox.width > listBox.width * 1.6).toBe(true);
    // Nevada is under the threshold: the card says so, and the list is not narrowed to it.
    await above.locator('path[data-code="US-NV"]').click();
    await expect(above).toContainText(/Fewer than 3 published reports/);
    await expect(page).not.toHaveURL(/place=/);
    await expect(page.getByRole('button', { name: /Remove the filter Place/ })).toHaveCount(0);
    // Arizona again, then clearing the filter from its tag lets go of the map too.
    await above.locator('path[data-code="US-AZ"]').click();
    await expect(page).toHaveURL(/place=US-AZ/);
    await page.getByRole('button', { name: 'Remove the filter Place: Arizona' }).click();
    await expect(page).not.toHaveURL(/place=/);
    await expect(above.locator('path[data-selected="true"]')).toHaveCount(0);
    // A link naming an area under its threshold is no filter and selects nothing.
    await page.goto('/board?place=US-NV');
    // The server sends no list and no count for it: only the sentence.
    await expect(page.getByText(/Fewer than 3/).first()).toBeVisible();
    await expect(page.locator('section[aria-label="Reports"]')).toHaveCount(0);
    await expect(above.locator('path[data-selected="true"]')).toHaveCount(0);

    // The board's own Maps page, reached from the board.
    await page.getByRole('link', { name: 'Maps', exact: true }).click();
    await expect(page).toHaveURL(/\/board\/maps$/);
    await expect(page.getByText(/Where published reports say things happened/)).toBeVisible();
    await expect(mapOf('board_tab').getByRole('img')).toBeVisible();
    await expect(mapOf('board_reports')).toHaveCount(0);

    // With the numbers, below the counts.
    await page.goto('/board/numbers');
    await expect(page.getByRole('link', { name: 'Numbers', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(mapOf('board_numbers').getByRole('img')).toBeVisible();
    await expect(mapOf('board_reports')).toHaveCount(0);

    // What reached the browser: Nevada, Wyoming and Guam as bare codes, never with a count.
    expect(payloads.length).toBeGreaterThanOrEqual(3);
    for (const body of payloads) {
      expect(body).toContain('"US-NV"');
      expect(body).not.toMatch(/"US-(NV|WY|GU)"\s*:/);
    }

    expect(outside).toEqual([]);
  } finally {
    for (const m of Object.values(made)) await admin.delete(`/api/admin/maps/${String(m.id)}`);
    await admin.dispose();
  }

  // With none placed, the board has no Maps button and its Maps page says so.
  await page.goto('/board');
  await expect(page.getByRole('search', { name: 'Search reports' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Maps', exact: true })).toHaveCount(0);
  await page.goto('/board/maps');
  await expect(page.getByText('There are no maps on the board.')).toBeVisible();
  expect(outside).toEqual([]);
  await context.close();
});
