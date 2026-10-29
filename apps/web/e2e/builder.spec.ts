/**
 * The logbook builder, in a real browser against the real server: making a
 * logbook, asking a question only sometimes, launching it through the
 * one-way door, and what the screen still allows afterwards.
 *
 * TODO(workstream A): these screens are staff-only. Once sign-in exists,
 * sign in as an administrator before each test here.
 */
import { expect, test } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';
import { ADMIN } from './auth.ts';
import { panel } from './panel.ts';
import { saveChanges } from './save-bar.ts';

// The builder is for administrators: every test here is signed in as one.
test.use({ storageState: ADMIN });

const unique = (stem: string, project: string) =>
  `${stem} ${project} ${String(Date.now())}-${String(Math.floor(Math.random() * 1000))}`;

async function makeDraft(page: Page, title: string) {
  await page.goto('/logbooks');
  await page.getByRole('button', { name: 'Make a logbook' }).click();
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
  const questions = panel(page, 'Questions');
  await questions.getByLabel('Kind of question').selectOption({ label: kind });
  await questions.getByLabel('The question, as the reporter will read it').last().fill(label);
  if (extra) await extra(page);
  await questions.getByRole('button', { name: 'Add the question' }).click();
  await expect(questions.getByRole('list', { name: 'The questions, in order' })).toContainText(
    label,
  );
}

test('an operator builds a logbook, launches it, and the questions are fixed afterwards', async ({
  page,
}, info) => {
  const title = unique('Polling day', info.project.name);
  await makeDraft(page, title);
  await expect(page.getByText('Draft: still being written')).toBeVisible();

  await addQuestion(page, 'Yes or no', 'Were you hurt?', async (p) => {
    await panel(p, 'Questions').getByLabel('An answer is needed').last().check();
  });
  // A logbook asks for words only as an attached note (isPublishedFreeText).
  await addQuestion(page, 'Attached note (never published)', 'How were you hurt?', async (p) => {
    const questions = panel(p, 'Questions');
    await questions
      .getByLabel('Ask it', { exact: true })
      .selectOption({ label: 'Only depending on “Were you hurt?”' });
    await questions.getByLabel('Yes', { exact: true }).check();
  });
  const list = page.getByRole('list', { name: 'The questions, in order' });
  await expect(list).toContainText('Asked only when “Were you hurt?” is yes.');
  // A note is asked only where the operator lets reporters attach one.
  await page.getByRole('button', { name: 'Edit Notes and links from reporters' }).click();
  await page.getByRole('checkbox', { name: /^Reporters may attach a note or link/ }).check();
  await saveChanges(page);
  await expect(panel(page, 'Notes and links from reporters').getByRole('definition')).toHaveText(
    'Yes',
  );

  // A question cannot be moved in front of the one it depends on, and the
  // screen says why rather than doing nothing.
  await page.getByRole('button', { name: 'Move up: “How were you hurt?”' }).click();
  await expect(page.getByRole('alert')).toContainText('in front of the one it depends on');

  const launch = panel(page, 'Launch');
  const go = launch.getByRole('button', { name: 'Launch this logbook' });
  await expect(go).toBeDisabled();
  await launch.getByLabel(/Type the title/).fill(title);
  await go.click();

  await expect(page.getByText(/are frozen, so every sealed report still checks/)).toBeVisible();
  await expect(page.getByText(/^Open, and taking reports/)).toBeVisible();
  await expect(page.getByRole('button', { name: /^Move/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Remove/ })).toHaveCount(0);
  await expect(panel(page, 'Delete this draft')).toHaveCount(0);

  // THE ONE OPENING: a new optional question, and only optional.
  const questions = panel(page, 'Questions');
  await expect(questions.getByLabel('An answer is needed')).toBeDisabled();
  await addQuestion(page, 'Attached note (never published)', 'Anything else?');
  await expect(list.getByRole('listitem')).toHaveCount(3);

  // REWORDING IS ALLOWED (ruling 48): the words change, the key does not.
  await list.getByRole('button', { name: 'Reword “Were you hurt?”' }).click();
  await list.getByLabel('The question, as the reporter will read it').fill('Were you hurt at all?');
  await list.getByRole('button', { name: 'Save the wording' }).click();
  // Its place, then its new words.
  await expect(list.getByRole('listitem').first()).toContainText(/^1Were you hurt at all\?/);

  // The public form now exists, and has the condition on it.
  const slug = (await page.locator('[data-filing-address]').innerText()).replace('/file/', '');
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
  await page.getByRole('button', { name: 'Make a logbook' }).click();
  await page.getByLabel(/^Log how voting went/).check();
  await page.getByRole('button', { name: 'Make the draft' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Log how voting went' })).toBeVisible();
  await expect(page.getByText('Draft: still being written')).toBeVisible();
  await expect(
    page.getByRole('list', { name: 'The questions, in order' }).getByRole('listitem'),
  ).toHaveCount(11);

  // A draft can be deleted, by typing its title.
  const del = panel(page, 'Delete this draft');
  await del.getByLabel(/Type the title/).fill('Log how voting went');
  await del.getByRole('button', { name: 'Delete this draft' }).click();
  await expect(page).toHaveURL(/\/logbooks$/);
});

test('a refusal from the server is said on the screen, in a sentence', async ({ page }, info) => {
  await makeDraft(page, unique('Choices', info.project.name));
  const questions = panel(page, 'Questions');
  await questions.getByLabel('Kind of question').selectOption({ label: 'Choose one' });
  await questions.getByLabel('The question, as the reporter will read it').fill('Pick one');
  await questions.getByRole('button', { name: 'Add the question' }).click();
  await expect(questions.getByRole('alert')).toContainText(
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
    await expect(rows.first()).toContainText('· highlighted');
    expect(await rows.count()).toBeGreaterThan(1);
    // The button's words, in bold above what it leads to.
    second = (await rows.nth(1).locator('b').first().innerText()).trim();

    await page.getByRole('button', { name: `Move up: “${second}”` }).click();
    await expect(rows.first()).toContainText(second);
    await expect(rows.first()).toContainText('· highlighted');
    await page.getByRole('button', { name: 'Save this order' }).click();
    await expect(page.getByRole('main').getByRole('status')).toHaveText('Saved.', {
      timeout: 2000,
    });

    const res = await page.request.get('/api/home-buttons');
    const { buttons } = (await res.json()) as { buttons: { label: string; accent: boolean }[] };
    expect(buttons[0]).toMatchObject({ label: second, accent: true });
  }).toPass({ timeout: 20_000 });

  await page.getByRole('button', { name: 'Go back to the standard order' }).click();
  await expect(page.getByRole('main').getByRole('status')).toHaveText(
    'Back to the standard order.',
  );
});

test('a front page button can lead to a page, say what the operator chose, and be removed again', async ({
  page,
  browser,
}, info) => {
  // One project only: both would arrange the one front page at the same time.
  test.skip(info.project.name !== 'chromium', 'arranges the one shared front page');
  // Put back for the other tests even if a step below fails, so one failure
  // here does not become every front page test's.
  try {
    await frontPageButton(page, browser);
  } finally {
    await page.request.delete('/api/admin/home-buttons');
  }
});

async function frontPageButton(page: Page, browser: Browser) {
  await page.goto('/logbooks/front-page');
  const rows = page.getByRole('list', { name: 'Buttons, in order' }).getByRole('listitem');
  await expect(rows.first()).toBeVisible();
  await page.getByRole('button', { name: 'Add a button' }).click();
  const added = rows.last();
  // The target is a drop-down of what the site owns, grouped, and nothing typed in.
  await added.getByLabel('Target').selectOption({ label: 'About this site' });
  await added.getByLabel('Main text').fill('Who runs this');
  await added.getByLabel('Subtext').fill('And how it works');
  // The site's own board button may be relabelled too. A row shows its
  // fields once opened with Change.
  const openBoard = page.getByRole('button', { name: 'Change: “View Live Report Board”' });
  if (await openBoard.count()) await openBoard.click();
  const board = rows.filter({ has: page.locator('option[value="builtin:board"]:checked') });
  if (await board.count()) await board.first().getByLabel('Main text').fill('The public record');
  await page.getByRole('button', { name: 'Save this order' }).click();
  await expect(page.getByRole('main').getByRole('status')).toHaveText('Saved.');

  // A visitor sees exactly that, and the link goes where the target said.
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const visitor = await context.newPage();
  await visitor.goto('/');
  // The buttons are the headline's row of links (home/HeroBlock.tsx).
  const ways = visitor.getByRole('main');
  const about = ways.getByRole('link', { name: /Who runs this\s*And how it works/ });
  await expect(about).toHaveAttribute('href', '/about');
  if (await board.count()) {
    await expect(ways.getByRole('link', { name: /The public record/ })).toHaveAttribute(
      'href',
      '/board',
    );
  }
  await context.close();

  // Put it back for the other tests.
  await page.getByRole('button', { name: 'Go back to the standard order' }).click();
  await expect(page.getByRole('main').getByRole('status')).toHaveText(
    'Back to the standard order.',
  );
}

test('the builder asks no third party for anything', async ({ page }) => {
  const outside: string[] = [];
  page.on('request', (r) => {
    const host = new URL(r.url()).hostname;
    if (host !== '127.0.0.1' && host !== 'localhost') outside.push(r.url());
  });
  await page.goto('/logbooks');
  await expect(page.getByRole('heading', { name: 'Logbooks' })).toBeVisible();
  await page.goto('/logbooks/front-page');
  await expect(page.getByRole('heading', { name: 'Front page' })).toBeVisible();
  expect(outside).toEqual([]);
});
