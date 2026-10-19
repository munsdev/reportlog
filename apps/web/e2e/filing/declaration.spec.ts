/**
 * The signed declaration a reporter prints from "My reports" (legacy's
 * "Print / sign PDF"): their answers under the questions they read, the
 * declaration, the lines to sign, and the fingerprint of the exact sealed
 * version it declares, which the verify page also shows.
 */
import { expect, test } from '@playwright/test';
import { codeIn, countTo, lastMessageTo, linkIn } from '../identity/mail.ts';

test('a reporter prints a signed declaration of their report', async ({ page, request }) => {
  const email = `declare-${Date.now().toString(36)}${String(Math.floor(Math.random() * 1000))}@example.org`;
  const card = (await (await request.get('/api/publication-card')).json()) as { digest: string };
  let before = countTo(email);
  const sent = await request.post('/api/reports', {
    data: {
      logbook: 'demo',
      email,
      consent: true,
      answers: { what: 'The doors were locked at seven.' },
      may_publish: false,
      may_publish_digest: card.digest,
    },
  });
  expect(sent.ok(), await sent.text()).toBe(true);
  await page.goto(linkIn(await lastMessageTo(email, before)));
  await page.getByRole('button', { name: 'Confirm and file my report' }).click();
  await expect(page.getByRole('heading', { name: 'Your report is filed' })).toBeVisible();

  before = countTo(email);
  await page.request.post('/api/auth/code', { data: { email } });
  const code = codeIn(await lastMessageTo(email, before));
  expect((await page.request.post('/api/auth/sign-in', { data: { email, code } })).ok()).toBe(true);

  await page.goto('/mine');
  await page.getByRole('link', { name: /^Open RL-/ }).click();
  const ref = (await page.getByRole('heading', { level: 1 }).textContent())?.replace('Report ', '');
  expect(ref).toMatch(/^RL-/);
  await page.getByRole('link', { name: 'Print a signed declaration' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'A signed declaration' })).toBeVisible();
  await page.getByLabel('Your full name').fill('Alex Doe');
  await page.getByLabel('Where you will sign it').fill('Phoenix, Arizona');
  await page.getByRole('radio', { name: 'Outside the United States' }).click();

  const sheet = page.getByRole('region', { name: 'The declaration' });
  await expect(sheet).toContainText(String(ref));
  await expect(sheet).toContainText('Demo logbook');
  await expect(sheet).toContainText('What happened?');
  await expect(sheet).toContainText('The doors were locked at seven.');
  await expect(sheet).toContainText(
    'I declare under penalty of perjury under the laws of the United States of America that the foregoing is true and correct.',
  );
  await expect(sheet).toContainText('Signature: Alex Doe');
  await expect(sheet).toContainText('At: Phoenix, Arizona');

  // The fingerprint printed is the one the verify page recomputes.
  const verified = (await (await request.get(`/api/reports/${String(ref)}/verify`)).json()) as {
    content: { recorded: string };
    link: { recorded: string };
  };
  await expect(sheet).toContainText(verified.content.recorded);
  await expect(sheet).toContainText(verified.link.recorded);

  await expect(page.getByRole('button', { name: 'Print it or save it as a PDF' })).toBeVisible();

  // Printed, the page is the declaration and nothing else.
  await page.emulateMedia({ media: 'print' });
  await expect(page.getByRole('button', { name: 'Print it or save it as a PDF' })).toBeHidden();
  await expect(page.getByLabel('Your full name')).toBeHidden();
  await expect(sheet.getByText('Signature: Alex Doe')).toBeVisible();
  if (process.env.DECLARATION_SHOT)
    await page.screenshot({ path: process.env.DECLARATION_SHOT, fullPage: true });
});
