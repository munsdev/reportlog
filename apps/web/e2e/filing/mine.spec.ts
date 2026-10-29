/**
 * "My reports": a reporter signs in with the address they filed from (the
 * code read from the email), corrects their report, and gives a permission.
 */
import { expect, test } from '@playwright/test';
import { codeIn, countTo, lastMessageTo, linkIn } from '../identity/mail.ts';
import { doorFields } from '../door.ts';
import { panel } from '../panel.ts';

test('a reporter corrects their own report and gives a permission', async ({ page, request }) => {
  const email = `mine-${Date.now().toString(36)}${String(Math.floor(Math.random() * 1000))}@example.org`;
  const card = (await (await request.get('/api/publication-card')).json()) as { digest: string };
  let before = countTo(email);
  const sent = await request.post('/api/reports', {
    data: {
      ...(await doorFields(request)),
      logbook: 'demo',
      email,
      consent: true,
      answers: { what: 'The first telling.' },
      may_publish: true,
      may_publish_digest: card.digest,
    },
  });
  expect(sent.ok(), await sent.text()).toBe(true);
  // Confirmed the way a person does: by the link in the email.
  const link = linkIn(await lastMessageTo(email, before));
  await page.goto(link);
  await page.getByRole('button', { name: 'Confirm and file my report' }).click();
  await expect(page.getByRole('heading', { name: 'Your report is filed' })).toBeVisible();

  await page.getByRole('link', { name: 'See your reports' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in first' })).toBeVisible();
  await page.getByRole('link', { name: 'Sign in' }).last().click();
  before = countTo(email);
  await page.getByRole('textbox', { name: 'Email' }).fill(email);
  await page.getByRole('button', { name: 'Send code' }).click();
  await page.getByLabel('The code from the email').fill(codeIn(await lastMessageTo(email, before)));
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'My reports' })).toBeVisible();
  await page.getByRole('link', { name: /^Open RL-/ }).click();
  await expect(panel(page, 'What it says now')).toContainText('The first telling.');

  const correct = panel(page, 'Correct it');
  await correct.getByRole('textbox', { name: 'What happened?' }).fill('The second telling.');
  await correct.getByLabel('Why are you correcting it?').fill('I remembered more.');
  await correct.getByRole('button', { name: 'Save the correction' }).click();
  await expect(correct.getByText(/Saved as a new version, RL-/)).toBeVisible();
  await expect(panel(page, 'What it says now')).toContainText('The second telling.');

  const allow = panel(page, 'What you allow');
  const passing = allow.getByRole('switch', { name: /pass my contact details/ });
  await expect(passing).not.toBeChecked();
  await passing.click();
  await expect(allow.getByRole('status')).toHaveText('Saved.');
  await expect(passing).toBeChecked();
  await page.reload();
  await expect(
    panel(page, 'What you allow').getByRole('switch', {
      name: /pass my contact details/,
    }),
  ).toBeChecked();
});
