/**
 * Moderation, end to end, as a moderator (not an administrator): a report
 * filed the way a reporter files it (the link followed out of the email),
 * waiting in the queue and absent from the board; its second read; its
 * contact details opened with a reason; approved, and then on the board;
 * and the reporter, signed in, seeing that their details were opened and
 * why, without being told who.
 */
import { expect, test } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import { MODERATOR } from '../auth.ts';
import { codeIn, countTo, lastMessageTo, linkIn } from '../identity/mail.ts';
import { doorFields } from '../door.ts';
import { stepUp } from '../second-factor.ts';

test.use({ storageState: MODERATOR });

const unique = () => `${Date.now().toString(36)}${String(Math.floor(Math.random() * 1e6))}`;

async function fileAndConfirm(page: Page, request: APIRequestContext, email: string, what: string) {
  const card = (await (await request.get('/api/publication-card')).json()) as { digest: string };
  const before = countTo(email);
  const sent = await request.post('/api/reports', {
    data: {
      ...(await doorFields(request)),
      logbook: 'demo',
      email,
      consent: true,
      answers: { what },
      may_publish: true,
      may_publish_digest: card.digest,
    },
  });
  expect(sent.ok(), await sent.text()).toBe(true);
  const link = linkIn(await lastMessageTo(email, before));
  // Confirmed by somebody with no session, as the reporter would be.
  const reporter = await page.context().browser()?.newContext();
  if (!reporter) throw new Error('no browser');
  const tab = await reporter.newPage();
  await tab.goto(link);
  await tab.getByRole('button', { name: 'Confirm and file my report' }).click();
  await expect(tab.getByRole('heading', { name: 'Your report is filed' })).toBeVisible();
  await reporter.close();
}

test('a moderator reads, opens, approves; the board shows it; the reporter sees the opening', async ({
  page,
  request,
}) => {
  const word = `zq${unique()}`;
  const email = `board-${word}@example.org`;
  await fileAndConfirm(page, request, email, `They threatened me at the door of hall ${word}.`);

  // Not on the board yet.
  await page.goto(`/board?q=${word}`);
  await expect(
    page.getByRole('status').filter({ hasText: 'No published report matches that.' }),
  ).toBeVisible();

  // Waiting in the queue, asking for a second read.
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Staff' })
    .getByRole('link', { name: 'Moderation', exact: true })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: 'Moderation' })).toBeVisible();
  await page.getByLabel('Search the words or a reference').fill(word);
  await page.getByRole('button', { name: 'Show' }).click();
  const row = page.getByRole('link', { name: /^Open RL-/ });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('second read asked for: threatened');
  await row.click();

  await expect(page.getByRole('region', { name: 'What the reporter said' })).toContainText(word);
  const second = page.getByRole('region', { name: 'Asks for a second read' });
  await expect(second).toContainText('threatened');
  await second.getByRole('button', { name: 'I have read it' }).click();
  await expect(second).toBeHidden();

  // Contact details: a reason first, and the reporter will see it.
  const contact = page.getByRole('region', { name: 'How to reach the reporter' });
  await contact.getByLabel('Why you need them').fill('To ask which door of the hall it was.');
  // Opening a reporter's email asks for the second factor again (plan E, E3).
  await stepUp(page.request);
  await contact.getByRole('button', { name: 'Open the contact details' }).click();
  await expect(contact).toContainText(email);

  // Approve.
  const decide = page.getByRole('region', { name: 'Decide' });
  await decide.getByLabel('Decision').selectOption('valid');
  await decide.getByLabel('Why').fill('Consistent and specific.');
  await decide.getByRole('button', { name: 'Record the decision' }).click();
  await expect(page.getByText('on the board now')).toBeVisible();
  await expect(page.getByRole('region', { name: 'What happened to it' })).toContainText(
    'Consistent and specific.',
  );

  // On the board, without any of moderation's workings.
  await page.goto('/board');
  await page.getByLabel('Search the words').fill(word);
  await page.getByRole('button', { name: 'Show reports' }).click();
  await expect(page).toHaveURL(new RegExp(`q=${word}`));
  await page.getByRole('link', { name: /^Read in full: RL-/ }).click();
  await expect(page.getByRole('region', { name: 'What the reporter said' })).toContainText(word);
  await expect(page.locator('main')).not.toContainText('second read');
  await expect(page.locator('main')).not.toContainText(email);

  // The reporter signs in and sees the opening, with the reason, and not who.
  const reporter = await page.context().browser()?.newContext();
  if (!reporter) throw new Error('no browser');
  const tab = await reporter.newPage();
  await tab.goto('/access/sign-in?next=/mine');
  const before = countTo(email);
  await tab.getByLabel('Your email address').fill(email);
  await tab.getByRole('button', { name: 'Send me a code' }).click();
  await tab.getByLabel('The code from the email').fill(codeIn(await lastMessageTo(email, before)));
  await tab.getByRole('button', { name: 'Sign in' }).click();
  await tab.getByRole('link', { name: /^Open RL-/ }).click();
  const seen = tab.getByRole('region', { name: 'Who looked at your details' });
  await expect(seen).toContainText('To ask which door of the hall it was.');
  await expect(seen).not.toContainText('@');
  await reporter.close();
});

test('a moderator is not shown the administrators’ settings', async ({ page }) => {
  await page.goto('/moderate/settings');
  await expect(page.getByRole('heading', { name: 'Not for this account' })).toBeVisible();
  await expect(page.getByText('Only an administrator can open this page.')).toBeVisible();
});
