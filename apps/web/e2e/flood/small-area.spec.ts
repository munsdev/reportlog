/**
 * Plan E, session PE4, in the browser: an administrator publishes a logbook
 * as counts only and sets its small-area threshold on the settings screen;
 * a reader then gets every place under it as a name WITHOUT A NUMBER, in
 * the bytes their browser receives, not only on the page; and the change is
 * in the public switch log with its time. Each page with the accessibility
 * check and no request to another host.
 *
 * In the flood project (playwright.config.ts), which runs alone: counts only
 * changes the board. The logbook is a fresh one from the maps fixture
 * (api/src/maps/dev-state.ts): Arizona 4, California 3, Alaska 3, Nevada 2,
 * Wyoming 1, Guam 1, all approved.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';
import { axe, describeViolation } from '../a11y.ts';
import { identityState } from '../identity/mail.ts';
import { signInWithSecondFactor } from '../second-factor.ts';

const unique = () => `${Date.now().toString(36)}${String(Math.floor(Math.random() * 1e6))}`;

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

function outsideRequests(page: Page): string[] {
  const outside: string[] = [];
  page.on('request', (r) => {
    const url = new URL(r.url());
    if (url.protocol === 'data:' || url.protocol === 'blob:') return;
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') outside.push(r.url());
  });
  return outside;
}

async function noViolations(page: Page) {
  const found = await axe(page);
  expect(found.violations.map(describeViolation)).toEqual([]);
}

async function administrator(browser: Browser): Promise<Page> {
  const email = `e2e-small-area-${unique()}@example.org`;
  identityState('seat', email, 'admin');
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  await signInWithSecondFactor(context.request, email);
  return context.newPage();
}

test('the small-area threshold, set on the settings screen, withholds every thin place’s number', async ({
  browser,
}) => {
  test.setTimeout(60_000);
  const lb = fixture();
  const page = await administrator(browser);
  const outside = outsideRequests(page);

  await page.goto('/moderate/settings');
  const section = page.getByRole('region', { name: 'Publish as counts only' });
  // Controlled by the server's answer, so it ticks once the change is saved.
  await section.getByLabel(`${lb.title} is published as counts only`).click();
  await expect(section.getByLabel(`${lb.title} is published as counts only`)).toBeChecked();

  const field = section.getByLabel(`Smallest place count published for ${lb.title}`);
  await expect(field).toHaveValue('2');
  const form = section.getByRole('form', { name: `The small-area threshold for ${lb.title}` });
  // Under the floor: refused, in a sentence beside the field.
  await field.fill('1');
  await form.getByRole('button', { name: 'Save the threshold' }).click();
  await expect(form.getByText(/at least 2/)).toBeVisible();
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  await noViolations(page);

  await field.fill('3');
  await form.getByRole('button', { name: 'Save the threshold' }).click();
  await expect(form.getByRole('status')).toContainText('fewer than 3');
  await noViolations(page);
  expect(outside).toEqual([]);

  // A reader with no account.
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const reader = await context.newPage();
  const readerOutside = outsideRequests(reader);
  const payloads: string[] = [];
  reader.on('response', (res) => {
    if (new URL(res.url()).pathname === '/api/board/counts') {
      void res.text().then((t) => payloads.push(t));
    }
  });
  await reader.goto(`/board?logbook=${lb.slug}`);
  const counted = reader.getByRole('region', { name: `${lb.title}, as counts` });
  const byPlace = counted.getByRole('table', { name: 'By place' });
  await expect(byPlace).toBeVisible();
  for (const [place, n] of [
    ['Arizona', '4'],
    ['Alaska', '3'],
    ['California', '3'],
  ] as const) {
    await expect(byPlace.getByRole('row', { name: new RegExp(`^${place}`) })).toContainText(n);
  }
  for (const place of ['Nevada', 'Wyoming', 'Guam']) {
    await expect(byPlace.getByRole('row', { name: new RegExp(`^${place}`) })).toHaveCount(0);
  }
  await expect(counted).toContainText(
    'Fewer than 3 accepted reports each, so these places are named without a number: Guam, Nevada, Wyoming (4 together).',
  );
  await noViolations(reader);

  // The bytes, not the page: no thin place's code travels with a count.
  await expect.poll(() => payloads.length).toBeGreaterThan(0);
  const mine = payloads
    .map(
      (t) =>
        JSON.parse(t) as {
          logbooks?: { slug: string; by_place: { place: string }[] }[];
        },
    )
    .flatMap((p) => p.logbooks ?? [])
    .find((l) => l.slug === lb.slug);
  expect(mine?.by_place.map((p) => p.place).sort()).toEqual(['US-AK', 'US-AZ', 'US-CA']);
  expect(JSON.stringify(mine)).not.toMatch(/US-(NV|WY|GU)/);

  // The change is public, with its time and never who.
  await reader.goto('/board/activity');
  const use = reader.getByRole('listitem').filter({
    hasText: `Places with fewer than 3 accepted reports counted without a number: ${lb.slug}`,
  });
  await expect(use.first()).toBeVisible();
  await expect(use.first().locator('time')).toHaveAttribute('datetime', /\d{4}-\d{2}-\d{2}T/);
  await expect(reader.locator('main')).not.toContainText('@example');
  await noViolations(reader);
  expect(readerOutside).toEqual([]);
  await context.close();
});
