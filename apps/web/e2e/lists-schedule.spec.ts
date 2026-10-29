/**
 * A list's opening times, set on the editor screen and read by a visitor.
 *
 * The API took `opens_at` and `closes_at` from the start; this is the
 * screen. Times are typed in the operator's own clock and mean the same
 * moment to anybody reading them.
 */
import { expect, test } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';
import { ADMIN } from './auth.ts';
import { saveChanges } from './save-bar.ts';

test.use({ storageState: ADMIN });

const unique = (project: string) =>
  `times-${project}-${Date.now().toString(36)}${String(Math.floor(Math.random() * 1000))}`;

/** As a date-and-time box takes it: local, to the minute. */
function box(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function visitorSees(browser: Browser, slug: string, text: RegExp | string) {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const v = await context.newPage();
  await v.goto(`/list/${slug}`);
  await expect(v.getByText(text)).toBeVisible();
  await context.close();
}

async function edit(page: Page) {
  // The settings are a closed panel until Edit; an error leaves it open.
  const open = page.getByRole('button', { name: 'Edit Settings' });
  if (await open.isVisible()) await open.click();
}

async function save(page: Page) {
  await saveChanges(page);
}

test('opening times on the editor screen decide when the form takes entries', async ({
  page,
  browser,
}, info) => {
  const slug = unique(info.project.name);
  const made = await page.request.post('/api/admin/lists', {
    data: { template: 'check-ins', slug },
  });
  expect(made.ok(), await made.text()).toBe(true);
  const { id } = (await made.json()) as { id: number };
  const listed = await page.request.patch(`/api/admin/lists/${String(id)}`, {
    data: { visibility: 'listed', title: `Times ${slug}` },
  });
  expect(listed.ok()).toBe(true);

  await page.goto(`/lists/${String(id)}`);
  await expect(page.getByText('It is taking entries.')).toBeVisible();

  // Opens tomorrow: not yet, and the visitor is told when.
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await edit(page);
  await page.getByLabel('Opens').fill(box(tomorrow));
  await save(page);
  await expect(page.getByText(/It is not taking entries yet\. It opens on/)).toBeVisible();
  const stored = (await (await page.request.get(`/api/admin/lists/${String(id)}`)).json()) as {
    opens_at: string | null;
  };
  // The moment typed, to the minute, whatever clock it is read in.
  expect(new Date(stored.opens_at ?? '').getTime()).toBe(new Date(box(tomorrow)).getTime());
  await visitorSees(browser, slug, /This form opens on/);

  // A list has to open before it closes: the server says so, and nothing moves.
  await edit(page);
  await page.getByLabel('Closes').fill(box(new Date(Date.now() + 60 * 60 * 1000)));
  await save(page);
  await expect(page.getByText(/A list has to open before it closes/)).toBeVisible();

  // No opening time, closed an hour ago.
  await page.reload();
  await edit(page);
  await page.getByLabel('Opens').fill('');
  await edit(page);
  await page.getByLabel('Closes').fill(box(new Date(Date.now() - 60 * 60 * 1000)));
  await save(page);
  await expect(page.getByText(/It is not taking entries\. It closed on/)).toBeVisible();
  await visitorSees(browser, slug, 'This form is not taking anything at the moment.');

  // Saving another setting leaves the times as they are.
  await page.reload();
  await edit(page);
  await page.getByLabel('Description').fill('Times stay put.');
  await save(page);
  const after = (await (await page.request.get(`/api/admin/lists/${String(id)}`)).json()) as {
    opens_at: string | null;
    closes_at: string | null;
  };
  expect(after.opens_at).toBeNull();
  expect(after.closes_at).not.toBeNull();

  // Cleared, it takes entries again.
  await edit(page);
  await page.getByLabel('Closes').fill('');
  await save(page);
  await expect(page.getByText('It is taking entries.')).toBeVisible();
});
