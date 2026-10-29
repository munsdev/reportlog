/**
 * A location question at county depth (owner decision 44), in a real browser:
 * a state, then that state's counties, on one card. The county list follows
 * the state the person chose and nothing else on the card changes; the
 * answer is one code; the card passes the accessibility check; and no page
 * asks another host for anything (the county list is bundled).
 *
 * Both places the picker lives: a logbook's card and a list's form (the
 * election tips template, decision 45), the list one sent for real.
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { ADMIN } from './auth.ts';
import { expectAccessible } from './filing/axe.ts';

test.use({ storageState: ADMIN });

const run = () => `${Date.now().toString(36)}${String(Math.floor(Math.random() * 1000))}`;

function watch(page: Page): string[] {
  const outside: string[] = [];
  page.on('request', (r) => {
    const host = new URL(r.url()).hostname;
    if (host !== '127.0.0.1' && host !== 'localhost') outside.push(r.url());
  });
  return outside;
}

/** Choose a state, check the county list followed it, then choose a county. */
async function stateThenCounty(page: Page, label: string) {
  const state = page.getByRole('combobox', { name: 'State' });
  const county = page.getByRole('combobox', { name: 'County, if you know it' });
  await expect(county).toBeDisabled();
  await state.selectOption({ label: 'Texas' });
  await expect(county.getByRole('option', { name: 'Travis County' })).toHaveCount(1);
  await expect(county).toHaveValue('US-TX');
  await state.selectOption({ label: 'Arizona' });
  // The list followed the state: Texas's counties are gone, Arizona's are here.
  await expect(county.getByRole('option', { name: 'Travis County' })).toHaveCount(0);
  await expect(county.getByRole('option')).toHaveCount(16); // 15 counties and "Not sure"
  await county.selectOption({ label: 'Maricopa County' });
  await expect(county).toHaveValue('US-AZ-04013');
  await expect(state).toHaveValue('US-AZ');
  await expectAccessible(page, label);
}

test('a logbook card asks the state, then the county', async ({ page }) => {
  const title = `Counties ${run()}`;
  const made = await page.request.post('/api/admin/logbooks', { data: { title } });
  expect(made.ok(), await made.text()).toBe(true);
  const lb = (await made.json()) as { id: number; slug: string };
  const add = await page.request.post(`/api/admin/logbooks/${String(lb.id)}/fields`, {
    data: { kind: 'location', label: 'Where', settings: { scope: 'us', depth: 'county' } },
  });
  expect(add.ok(), await add.text()).toBe(true);
  const launched = await page.request.post(`/api/admin/logbooks/${String(lb.id)}/launch`);
  expect(launched.ok(), await launched.text()).toBe(true);

  const outside = watch(page);
  await page.goto(`/file/${lb.slug}`);
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Where', exact: true })).toBeVisible();
  await stateThenCounty(page, 'the county card');
  expect(outside).toEqual([]);
});

test('the election tips list sends a county as one code', async ({ page, browser }) => {
  const slug = `etips-${run()}`;
  const made = await page.request.post('/api/admin/lists', {
    data: { template: 'election-tips', slug, title: `Election tips ${slug}` },
  });
  expect(made.ok(), await made.text()).toBe(true);
  const { id } = (await made.json()) as { id: number };
  const listed = await page.request.patch(`/api/admin/lists/${String(id)}`, {
    data: { visibility: 'listed' },
  });
  expect(listed.ok(), await listed.text()).toBe(true);

  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const v = await context.newPage();
  const outside = watch(v);
  const sent: unknown[] = [];
  v.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith(`/api/lists/${slug}/entries`)) {
      sent.push(r.postDataJSON());
    }
  });
  const next = () => v.getByRole('button', { name: 'Next', exact: true }).click();

  await v.goto(`/list/${slug}`);
  await v.getByRole('button', { name: 'Start' }).click();
  await v.getByRole('textbox', { name: 'Link' }).fill('https://news.example.org/county');
  await next();
  await stateThenCounty(v, 'the list’s Where card');
  await next();
  await v.getByLabel('What day was it?').fill('2026-11-03');
  await next();
  await v.getByRole('radio', { name: 'Long lines or wait times' }).click();
  await next();
  await next();
  await v.getByRole('textbox', { name: /^Email/ }).fill(`county-${run()}@example.org`);
  // A form sent faster than it can be read is taken for a script.
  await v.waitForTimeout(2600);
  await v.getByRole('button', { name: 'Send' }).click();
  await expect(v.getByRole('heading', { name: 'Sent. Thank you.' })).toBeVisible();
  expect(sent).toHaveLength(1);
  expect((sent[0] as { answers: Record<string, unknown> }).answers).toMatchObject({
    where: 'US-AZ-04013',
    day: '2026-11-03',
  });
  expect(outside).toEqual([]);
  await context.close();

  // Closed again, so the front page's fifty-list limit is not used up.
  await page.request.patch(`/api/admin/lists/${String(id)}`, { data: { closed: true } });
});
