/**
 * The logbook builder, in a real browser against the real server: making a
 * logbook, asking a question only sometimes, launching it through the
 * one-way door, and what the screen still allows afterwards.
 *
 * TODO(workstream A): these screens are staff-only. Once sign-in exists,
 * sign in as an administrator before each test here.
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { ADMIN } from './auth.ts';

// The builder is for administrators: every test here is signed in as one.
test.use({ storageState: ADMIN });

const unique = (stem: string, project: string) =>
  `${stem} ${project} ${String(Date.now())}-${String(Math.floor(Math.random() * 1000))}`;

async function makeDraft(page: Page, title: string) {
  await page.goto('/logbooks');
  await page.getByLabel('Title', { exact: true }).fill(title);
  await page.getByRole('button', { name: 'Make the draft' }).click();
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
}

async function addQuestion(
  page: Page,
  kind: string,
  label: string,
  extra?: (p: Page) => Promise<void>,
) {
  const panel = page.getByRole('region', { name: 'Questions' });
  await panel.getByLabel('Kind of question').selectOption({ label: kind });
  await panel.getByLabel('The question, as the reporter will read it').last().fill(label);
  if (extra) await extra(page);
  await panel.getByRole('button', { name: 'Add the question' }).click();
  await expect(panel.getByRole('list', { name: 'The questions, in order' })).toContainText(label);
}

test('an operator builds a logbook, launches it, and the questions are fixed afterwards', async ({
  page,
}, info) => {
  const title = unique('Polling day', info.project.name);
  await makeDraft(page, title);
  await expect(page.getByText('Draft: still being written')).toBeVisible();

  await addQuestion(page, 'Yes or no', 'Were you hurt?', async (p) => {
    await p
      .getByRole('region', { name: 'Questions' })
      .getByLabel('An answer is needed')
      .last()
      .check();
  });
  await addQuestion(page, 'Short text', 'How were you hurt?', async (p) => {
    const panel = p.getByRole('region', { name: 'Questions' });
    await panel
      .getByLabel('Ask it', { exact: true })
      .selectOption({ label: 'Only depending on “Were you hurt?”' });
    await panel.getByLabel('Yes', { exact: true }).check();
  });
  const list = page.getByRole('list', { name: 'The questions, in order' });
  await expect(list).toContainText('Asked only when “Were you hurt?” is yes.');

  // A question cannot be moved in front of the one it depends on, and the
  // screen says why rather than doing nothing.
  await page.getByRole('button', { name: 'Move up: “How were you hurt?”' }).click();
  await expect(page.getByRole('alert')).toContainText('in front of the one it depends on');

  const launch = page.getByRole('region', { name: 'Launch' });
  const go = launch.getByRole('button', { name: 'Launch this logbook' });
  await expect(go).toBeDisabled();
  await launch.getByLabel(/Type the title/).fill(title);
  await go.click();

  await expect(
    page.getByText('This logbook has launched, so what its questions ask is fixed'),
  ).toBeVisible();
  await expect(page.getByText(/^Open, and taking reports/)).toBeVisible();
  await expect(page.getByRole('button', { name: /^Move/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Remove/ })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Delete this draft' })).toHaveCount(0);

  // THE ONE OPENING: a new optional question, and only optional.
  const panel = page.getByRole('region', { name: 'Questions' });
  await expect(panel.getByLabel('An answer is needed')).toBeDisabled();
  await addQuestion(page, 'Long text', 'Anything else?');
  await expect(list.getByRole('listitem')).toHaveCount(3);

  // REWORDING IS ALLOWED (ruling 48): the words change, the key does not.
  await list.getByRole('button', { name: 'Reword “Were you hurt?”' }).click();
  await list.getByLabel('The question, as the reporter will read it').fill('Were you hurt at all?');
  await list.getByRole('button', { name: 'Save the wording' }).click();
  await expect(list.getByText('1. Were you hurt at all?')).toBeVisible();

  // The public form now exists, and has the condition on it.
  const slug = (await page.locator('header p.font-mono').innerText()).replace('/file/', '');
  const res = await page.request.get(`/api/logbooks/${slug}`);
  expect(res.status()).toBe(200);
  const form = (await res.json()) as { fields: { key: string; shown_when?: unknown }[] };
  expect(form.fields.map((f) => f.key)).toEqual([
    'were_you_hurt',
    'how_were_you_hurt',
    'anything_else',
  ]);

  // Closing is the reversible thing.
  await page.getByRole('button', { name: 'Close this logbook' }).click();
  await expect(page.getByText(/^Closed\. Reports already filed/)).toBeVisible();
  await page.getByRole('button', { name: 'Reopen this logbook' }).click();
  await expect(page.getByText(/^Open, and taking reports/)).toBeVisible();
});

test('a logbook made from a starting point arrives as a draft with its questions', async ({
  page,
}) => {
  await page.goto('/logbooks');
  await page.getByLabel(/^Election day: how did it go\?/).check();
  await page.getByRole('button', { name: 'Make the draft' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Election day: how did it go?' }),
  ).toBeVisible();
  await expect(page.getByText('Draft: still being written')).toBeVisible();
  await expect(
    page.getByRole('list', { name: 'The questions, in order' }).getByRole('listitem'),
  ).toHaveCount(9);

  // A draft can be deleted, by typing its title.
  const del = page.getByRole('region', { name: 'Delete this draft' });
  await del.getByLabel(/Type the title/).fill('Election day: how did it go?');
  await del.getByRole('button', { name: 'Delete this draft' }).click();
  await expect(page).toHaveURL(/\/logbooks$/);
});

test('a refusal from the server is said on the screen, in a sentence', async ({ page }, info) => {
  await makeDraft(page, unique('Choices', info.project.name));
  const panel = page.getByRole('region', { name: 'Questions' });
  await panel.getByLabel('Kind of question').selectOption({ label: 'Choose one' });
  await panel.getByLabel('The question, as the reporter will read it').fill('Pick one');
  await panel.getByRole('button', { name: 'Add the question' }).click();
  await expect(panel.getByRole('alert')).toContainText(
    'A list of choices needs at least one choice',
  );
});

test('the front page is arranged by order, and the first button is the main one', async ({
  page,
}) => {
  const rows = page.getByRole('list', { name: 'Buttons, in order' }).getByRole('listitem');
  let second = '';
  // RETRIED AS A WHOLE ROUND, not because the screen is slow: the other
  // tests open and close logbooks at the same time, and the server rightly
  // refuses an arrangement naming a logbook that closed while it was edited.
  await expect(async () => {
    await page.goto('/logbooks/front-page');
    await expect(rows.first()).toContainText('(the main button)');
    expect(await rows.count()).toBeGreaterThan(1);
    second = (await rows.nth(1).locator('p.font-semibold').innerText()).trim();

    await page.getByRole('button', { name: `Move up: “${second}”` }).click();
    await expect(rows.first()).toContainText(second);
    await expect(rows.first()).toContainText('(the main button)');
    await page.getByRole('button', { name: 'Save this order' }).click();
    await expect(page.getByRole('status')).toHaveText('Saved.', { timeout: 2000 });

    const res = await page.request.get('/api/home-buttons');
    const { buttons } = (await res.json()) as { buttons: { label: string; accent: boolean }[] };
    expect(buttons[0]).toMatchObject({ label: second, accent: true });
  }).toPass({ timeout: 20_000 });

  await page.getByRole('button', { name: 'Go back to the standard order' }).click();
  await expect(page.getByRole('status')).toHaveText('Back to the standard order.');
});

test('the builder asks no third party for anything', async ({ page }) => {
  const outside: string[] = [];
  page.on('request', (r) => {
    const host = new URL(r.url()).hostname;
    if (host !== '127.0.0.1' && host !== 'localhost') outside.push(r.url());
  });
  await page.goto('/logbooks');
  await expect(page.getByRole('heading', { name: 'Logbooks' })).toBeVisible();
  await page.goto('/logbooks/front-page');
  await expect(page.getByRole('heading', { name: 'The front page’s buttons' })).toBeVisible();
  expect(outside).toEqual([]);
});
