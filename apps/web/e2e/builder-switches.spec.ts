/**
 * The builder's switches that are not questions (B2), in a real browser
 * against the real server: freezing a launched logbook's uploads and taking
 * the freeze off, choosing who can file without the site password, and the
 * site's intake switch, which moved to the settings overview.
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
  await page.getByRole('button', { name: 'Make a logbook' }).click();
  await page.getByLabel('Title', { exact: true }).fill(title);
  await page.getByRole('button', { name: 'Make the draft' }).click();
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();

  // A logbook with no upload question has nothing to freeze.
  await expect(page.getByRole('region', { name: 'Files' })).toHaveCount(0);

  const questions = page.getByRole('region', { name: 'Questions' });
  await questions.getByLabel('Kind of question').selectOption({ label: 'Long text' });
  await questions.getByLabel('The question, as the reporter will read it').fill('What happened?');
  await questions.getByRole('button', { name: 'Add the question' }).click();
  // Wait for each question to land: the form resets after an add, and a
  // kind chosen before then is chosen on the form that is about to go.
  await expect(questions.getByRole('list', { name: 'The questions, in order' })).toContainText(
    'What happened?',
  );
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
  const slug = (await page.locator('[data-filing-address]').innerText()).replace('/file/', '');

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

  // Put back: a launched logbook open outside opens the filing calls for the
  // whole site, and the password tests that run after this one expect none.
  await page
    .getByRole('region', { name: 'Without the site password' })
    .getByLabel('Who can file without the password')
    .selectOption('closed');
  await expect(
    page
      .getByRole('region', { name: 'Without the site password' })
      .getByText(/Filing needs the site password/),
  ).toBeVisible();
});

test('the settings overview says whether the site is taking reports at all, and the logbook list points there', async ({
  page,
}) => {
  await page.goto('/logbooks');
  await page.getByRole('link', { name: 'Site settings, Accepting reports' }).click();
  const panel = page.getByRole('region', { name: 'Accepting reports' });
  await expect(panel).toContainText(/Accepting(Yes|No)/);
  await expect(panel).toContainText(/Logbooks open\d+ of \d+/);
  // One of the two cards is chosen: what the site does now.
  await expect(panel.getByRole('radio', { checked: true })).toHaveCount(1);
});

test('the builder’s switches ask no third party for anything', async ({ page }) => {
  const outside: string[] = [];
  page.on('request', (r) => {
    const host = new URL(r.url()).hostname;
    if (host !== '127.0.0.1' && host !== 'localhost') outside.push(r.url());
  });
  await page.goto('/logbooks');
  await expect(page.getByRole('heading', { level: 1, name: 'Logbooks' })).toBeVisible();
  await page.goto('/settings');
  await expect(page.getByRole('region', { name: 'Accepting reports' })).toBeVisible();
  expect(outside).toEqual([]);
});
