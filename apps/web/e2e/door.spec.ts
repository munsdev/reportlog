/**
 * At the door, in a real browser (apps/api/src/door/, features/door/):
 *
 *   - the puzzle is solved in the page, by a worker this site serves, before
 *     Send works, and no other host is asked for anything;
 *   - a refusal is one plain sentence that names no check; sending again
 *     simply works, because the page solves a fresh puzzle on its own;
 *   - a form with only choices asks for no email and is filed on arrival
 *     (owner decision E1);
 *   - a date question's limits (E4) are the picker's own min and max, and an
 *     answer outside them is named as that on its card.
 *
 * Every card checked here passes the accessibility check.
 */
import { expect, test } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import { ADMIN } from './auth.ts';
import { expectAccessible } from './filing/axe.ts';

test.use({ storageState: ADMIN });

const run = () => `${Date.now().toString(36)}${String(Math.floor(Math.random() * 1000))}`;

/** A launched logbook asking these questions. */
async function logbook(api: APIRequestContext, fields: Record<string, unknown>[]): Promise<string> {
  const made = await api.post('/api/admin/logbooks', { data: { title: `Door ${run()}` } });
  expect(made.ok(), await made.text()).toBe(true);
  const lb = (await made.json()) as { id: number; slug: string };
  for (const data of fields) {
    const added = await api.post(`/api/admin/logbooks/${String(lb.id)}/fields`, { data });
    expect(added.ok(), await added.text()).toBe(true);
  }
  const launched = await api.post(`/api/admin/logbooks/${String(lb.id)}/launch`);
  expect(launched.ok(), await launched.text()).toBe(true);
  return lb.slug;
}

function watch(page: Page) {
  const outside: string[] = [];
  const workers: string[] = [];
  page.on('request', (r) => {
    const host = new URL(r.url()).hostname;
    if (host !== '127.0.0.1' && host !== 'localhost') outside.push(r.url());
  });
  page.on('worker', (w) => workers.push(w.url()));
  return { outside, workers };
}

const next = (page: Page) => page.getByRole('button', { name: 'Next', exact: true }).click();

test('the puzzle is solved in the page; a refusal is one plain sentence, and sending again works', async ({
  page,
  browser,
}) => {
  const slug = await logbook(page.request, [
    {
      kind: 'choice_one',
      label: 'How did it go?',
      required: true,
      settings: { options: ['Fine', 'Badly'] },
    },
  ]);
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const v = await context.newPage();
  const seen = watch(v);
  await v.goto(`/file/${slug}`);
  await v.getByRole('button', { name: 'Start' }).click();
  await v.getByRole('radio', { name: 'Badly' }).click();
  await next(v);
  await next(v);
  // Choices only: no address card, and the page says what that means.
  await expect(v.getByRole('heading', { level: 1, name: 'Check your answers' })).toBeVisible();
  await expect(
    v.getByText(/filed the moment you send it, and you cannot come back to it/),
  ).toBeVisible();
  await expect(v.getByText('Your email address')).toHaveCount(0);
  await v.getByRole('checkbox', { name: /I confirm this report is accurate/ }).click();

  // What only a script fills in: the box nobody can see.
  const hidden = v.locator('input[name="website"]');
  await expect(hidden).toHaveAttribute('tabindex', '-1');
  await expect(hidden).toHaveAttribute('autocomplete', 'off');
  await hidden.fill('http://spam.example', { force: true });
  const send = v.getByRole('button', { name: 'Send report' });
  // Enabled once the puzzle is solved, in the background.
  await expect(send).toBeEnabled({ timeout: 30_000 });
  await send.click();
  const refused = v.getByRole('alert').filter({ hasText: 'The report was not sent' });
  await expect(refused).toContainText('Something went wrong. Please try again.');
  // Never which check it was.
  await expect(refused).not.toContainText(/hidden|honeypot|puzzle|too fast|website/i);
  await expectAccessible(v, 'a refusal at the door');

  // A person never fills the box; sending again is all it takes.
  await hidden.fill('', { force: true });
  await expect(send).toBeEnabled({ timeout: 30_000 });
  await send.click();
  await expect(v.getByRole('heading', { level: 1, name: /on the record/ })).toBeVisible();
  await expectAccessible(v, 'filed on arrival');

  // The worker that solved it is this site's own file, and nothing went elsewhere.
  expect(seen.workers.length).toBeGreaterThan(0);
  for (const w of seen.workers) expect(new URL(w).hostname).toBe('127.0.0.1');
  expect(seen.outside).toEqual([]);
  await context.close();
});

test('a date question’s limits are the picker’s own, and an answer outside is named on its card', async ({
  page,
  browser,
}) => {
  const slug = await logbook(page.request, [
    {
      kind: 'date',
      label: 'What day was it?',
      required: true,
      settings: { earliest: '2026-09-18', latest: '2026-11-10' },
    },
  ]);
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const v = await context.newPage();
  const seen = watch(v);
  await v.goto(`/file/${slug}`);
  await v.getByRole('button', { name: 'Start' }).click();
  const day = v
    .getByRole('textbox', { name: 'What day was it?' })
    .or(v.getByLabel('What day was it?'));
  await expect(day).toHaveAttribute('min', '2026-09-18');
  await expect(day).toHaveAttribute('max', '2026-11-10');
  await day.fill('2026-12-01');
  await next(v);
  await expect(
    v.getByText('That is outside the dates or times this question takes.'),
  ).toBeVisible();
  await expectAccessible(v, 'a date outside its limits');
  await day.fill('2026-11-03');
  await next(v);
  await expect(v.getByRole('heading', { level: 1, name: /published/i })).toBeVisible();
  expect(seen.outside).toEqual([]);
  await context.close();
});
