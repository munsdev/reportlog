/**
 * "My reports": a reporter signs in with the address they filed from (the
 * code read from the email), corrects their report, and gives a permission.
 */
import { expect, test } from '@playwright/test';
import { codeIn, countTo, lastMessageTo, linkIn } from '../identity/mail.ts';

test('a reporter corrects their own report and gives a permission', async ({ page, request }) => {
  const email = `mine-${Date.now().toString(36)}${String(Math.floor(Math.random() * 1000))}@example.org`;
  const card = (await (await request.get('/api/publication-card')).json()) as { digest: string };
  let before = countTo(email);
  const sent = await request.post('/api/reports', {
    data: {
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
  await page.getByLabel('Your email address').fill(email);
  await page.getByRole('button', { name: 'Send me a code' }).click();
  await page.getByLabel('The code from the email').fill(codeIn(await lastMessageTo(email, before)));
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'My reports' })).toBeVisible();
  await page.getByRole('link', { name: /^Open RL-/ }).click();
  await expect(page.getByRole('region', { name: 'What it says now' })).toContainText(
    'The first telling.',
  );

  const correct = page.getByRole('region', { name: 'Correct it' });
  await correct.getByRole('textbox', { name: 'What happened?' }).fill('The second telling.');
  await correct.getByLabel('Why are you correcting it?').fill('I remembered more.');
  await correct.getByRole('button', { name: 'Save the correction' }).click();
  await expect(correct.getByText(/Saved as a new version, RL-/)).toBeVisible();
  await expect(page.getByRole('region', { name: 'What it says now' })).toContainText(
    'The second telling.',
  );

  const allow = page.getByRole('region', { name: 'What you allow' });
  const passing = allow.getByRole('checkbox', { name: /pass my contact details/ });
  await expect(passing).not.toBeChecked();
  await passing.click();
  await expect(allow.getByRole('status')).toHaveText('Saved.');
  await expect(passing).toBeChecked();
  await page.reload();
  await expect(
    page.getByRole('region', { name: 'What you allow' }).getByRole('checkbox', {
      name: /pass my contact details/,
    }),
  ).toBeChecked();
});
