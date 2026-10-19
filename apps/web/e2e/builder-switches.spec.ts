/**
 * The builder's switches that are not questions (B2), in a real browser
 * against the real server: freezing a launched logbook's uploads and taking
 * the freeze off, choosing who can file without the site password, and the
 * site's intake switch on the logbook list.
 *
 * The intake switch is site-wide and the other browser tests file reports
 * at the same time, so this test only READS it: closing the site here would
 * fail somebody else's filing test.
 */
import { expect, test } from '@playwright/test';
import { ADMIN } from './auth.ts';

test.use({ storageState: ADMIN });

const unique = (stem: string, project: string) =>
  `${stem} ${project} ${String(Date.now())}-${String(Math.floor(Math.random() * 1000))}`;

test('an operator freezes a launched logbook’s uploads, and opens it outside the password', async ({
  page,
}, info) => {
  const title = unique('Freeze', info.project.name);
  await page.goto('/logbooks');
  await page.getByLabel('Title', { exact: true }).fill(title);
  await page.getByRole('button', { name: 'Make the draft' }).click();
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();

  // A logbook with no upload question has nothing to freeze.
  await expect(page.getByRole('region', { name: 'Files' })).toHaveCount(0);

  const questions = page.getByRole('region', { name: 'Questions' });
  await questions.getByLabel('Kind of question').selectOption({ label: 'Long text' });
  await questions.getByLabel('The question, as the reporter will read it').fill('What happened?');
  await questions.getByRole('button', { name: 'Add the question' }).click();
  await questions
    .getByLabel('Kind of question')
    .selectOption({ label: 'Photos, video or documents' });
  await questions.getByLabel('The question, as the reporter will read it').fill('Any photos?');
  await questions.getByRole('button', { name: 'Add the question' }).click();
  await expect(questions.getByRole('list', { name: 'The questions, in order' })).toContainText(
    'Any photos?',
  );

  const launch = page.getByRole('region', { name: 'Launch' });
  await launch.getByLabel(/Type the title/).fill(title);
  await launch.getByRole('button', { name: 'Launch this logbook' }).click();
  await expect(page.getByText(/^Open, and taking reports/)).toBeVisible();
  const slug = (await page.locator('header p.font-mono').innerText()).replace('/file/', '');

  // THE FREEZE: asked first, then frozen, and the form stops offering files.
  const files = page.getByRole('region', { name: 'Files' });
  await files.getByRole('button', { name: 'Freeze uploads…' }).click();
  await expect(files.getByText('Freeze uploads on this logbook?')).toBeVisible();
  await files.getByRole('button', { name: 'Freeze uploads', exact: true }).click();
  await expect(files.getByText('Uploads are frozen')).toBeVisible();
  const frozen = await page.request.get(`/api/uploads/config?logbook=${slug}`);
  expect(await frozen.json()).toMatchObject({ enabled: false });
  // Still taking reports: the freeze is about files only.
  await expect(page.getByText(/^Open, and taking reports/)).toBeVisible();

  await files.getByRole('button', { name: 'Take the freeze off' }).click();
  await expect(files.getByRole('button', { name: 'Freeze uploads…' })).toBeVisible();
  const thawed = await page.request.get(`/api/uploads/config?logbook=${slug}`);
  expect(await thawed.json()).toMatchObject({ enabled: true });

  // WITHOUT THE PASSWORD: the choice is saved and shown after a reload.
  const outside = page.getByRole('region', { name: 'Without the site password' });
  const who = outside.getByLabel('Who can file without the password');
  await expect(who).toHaveValue('closed');
  await who.selectOption('link');
  await expect(outside.getByText(/Anybody with the address of its form/)).toBeVisible();
  await page.reload();
  await expect(
    page
      .getByRole('region', { name: 'Without the site password' })
      .getByLabel('Who can file without the password'),
  ).toHaveValue('link');
});

test('the logbook list says whether the site is taking reports at all', async ({ page }) => {
  await page.goto('/logbooks');
  const panel = page.getByRole('region', { name: 'New reports, across the site' });
  await expect(panel.getByText(/^The site is (not )?taking new reports/)).toBeVisible();
});

test('the builder’s switches ask no third party for anything', async ({ page }) => {
  const outside: string[] = [];
  page.on('request', (r) => {
    const host = new URL(r.url()).hostname;
    if (host !== '127.0.0.1' && host !== 'localhost') outside.push(r.url());
  });
  await page.goto('/logbooks');
  await expect(page.getByRole('region', { name: 'New reports, across the site' })).toBeVisible();
  expect(outside).toEqual([]);
});
