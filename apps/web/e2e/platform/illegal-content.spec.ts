/**
 * D1: reporting illegal content, from the public form to the decision email.
 * A stranger fills in the form, gets a receipt by email, a moderator decides
 * it in the staff screen, and the sender follows the link in the DECISION
 * email to see the decision and its reason. Each public page here asks no
 * other host for anything.
 */
import { expect, test } from '@playwright/test';
import { ADMIN } from '../auth.ts';
import { countTo, lastMessageTo, linkIn } from '../identity/mail.ts';

test.use({ storageState: ADMIN });

test('a notice gets a receipt, a decision with its reason, and a link that shows both', async ({
  page,
  browser,
}) => {
  const stem = `notice-${Date.now().toString(36)}${String(Math.floor(Math.random() * 1000))}`;
  const email = `${stem}@example.org`;
  const where = `/board/RL-${stem}`;

  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const visitor = await context.newPage();
  const outside: string[] = [];
  visitor.on('request', (r) => {
    const host = new URL(r.url()).hostname;
    if (host !== '127.0.0.1' && host !== 'localhost') outside.push(r.url());
  });

  // The terms and the form are linked from the footer of any public page.
  await visitor.goto('/');
  await visitor.getByRole('link', { name: 'Report illegal content' }).click();
  await expect(
    visitor.getByRole('heading', { level: 1, name: 'Report illegal content' }),
  ).toBeVisible();
  await expect(visitor.getByRole('link', { name: 'terms of use' })).toBeVisible();

  const before = countTo(email);
  await visitor.getByLabel('Where is it?').fill(where);
  await visitor
    .getByLabel('Why do you think it is illegal?')
    .fill('It shows a private home address.');
  await visitor.getByLabel(/Your email address/).fill(email);
  await visitor.getByRole('checkbox', { name: /accurate and complete/ }).click();
  await visitor.getByRole('button', { name: 'Send the notice' }).click();
  await expect(visitor.getByText(/Your reference is IC-/)).toBeVisible();
  const receipt = (await visitor.getByText(/Your reference is IC-/).textContent())?.match(
    /IC-\w+/,
  )?.[0];

  // The receipt's link shows it open.
  const first = await lastMessageTo(email, before);
  expect(first.text).toContain(receipt);
  await visitor.goto(linkIn(first));
  await expect(visitor.getByRole('heading', { name: `Notice ${receipt ?? ''}` })).toBeVisible();
  await expect(visitor.getByText('Not decided yet')).toBeVisible();

  // A moderator decides it.
  await page.goto('/moderate/illegal-content');
  const notice = page.getByRole('article').filter({ hasText: receipt ?? '' });
  await notice.getByLabel('Decision').selectOption({ label: 'Remove the content' });
  await notice
    .getByLabel(/Reason, as the sender/)
    .fill('It named a private person, so we removed it.');
  const afterReceipt = countTo(email);
  await notice.getByRole('button', { name: 'Record the decision' }).click();
  await expect(
    notice.getByText('We removed').or(notice.getByText('Remove the content')).first(),
  ).toBeVisible();

  // FOLLOW THE LINK OUT OF THE DECISION EMAIL.
  const decided = await lastMessageTo(email, afterReceipt);
  expect(decided.subject).toContain(receipt ?? '');
  await visitor.goto(linkIn(decided));
  await expect(visitor.getByText('We removed the content.')).toBeVisible();
  await expect(visitor.getByText('It named a private person, so we removed it.')).toBeVisible();

  // The terms page, linked from the form, asks no third party for anything.
  await visitor.goto('/terms');
  await expect(
    visitor.getByRole('heading', { level: 1, name: 'Terms of use and contact' }),
  ).toBeVisible();
  await expect(visitor.getByRole('heading', { name: 'Contact for authorities' })).toBeVisible();
  expect(outside).toEqual([]);
  await context.close();
});
