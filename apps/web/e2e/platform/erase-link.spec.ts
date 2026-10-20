/**
 * I5: the erase link in the confirmation email. A reporter with no account
 * follows it out of the email; opening it changes nothing; the button
 * destroys the key their address is kept under; their report is NOT
 * withdrawn. The path nothing reaches by accident, so it is walked by link.
 */
import { expect, test } from '@playwright/test';
import { countTo, lastMessageTo, linkIn } from '../identity/mail.ts';

test('the link in the confirmation email erases the address only when the button is pressed, and does not withdraw the report', async ({
  browser,
  request,
}) => {
  const email = `erase-${Date.now().toString(36)}${String(Math.floor(Math.random() * 1000))}@example.org`;
  const card = (await (await request.get('/api/publication-card')).json()) as { digest: string };
  const before = countTo(email);
  const sent = await request.post('/api/reports', {
    data: {
      logbook: 'demo',
      email,
      consent: true,
      answers: { what: 'Erase my address; keep my report.' },
      may_publish: true,
      may_publish_digest: card.digest,
    },
  });
  expect(sent.ok(), await sent.text()).toBe(true);
  const mail = await lastMessageTo(email, before);

  // A visitor with no session at all.
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  const outside: string[] = [];
  page.on('request', (r) => {
    const host = new URL(r.url()).hostname;
    if (host !== '127.0.0.1' && host !== 'localhost') outside.push(r.url());
  });

  // File it by the confirmation link, the way a person does.
  await page.goto(linkIn(mail));
  await page.getByRole('button', { name: 'Confirm and file my report' }).click();
  await expect(page.getByRole('heading', { name: 'Your report is filed' })).toBeVisible();
  const ref = (await page.getByText(/Its reference is RL-/).textContent())?.match(/RL-\S+/)?.[0];
  expect(ref).toBeTruthy();

  // FOLLOW THE ERASE LINK OUT OF THE EMAIL. Looking at it changes nothing.
  const erase = /https?:\/\/\S+\/file\/erase\/[0-9a-f]{64}/.exec(mail.text)?.[0];
  expect(erase).toBeTruthy();
  await page.goto(erase ?? '');
  await expect(page.getByRole('heading', { name: 'Erase your email address' })).toBeVisible();
  await expect(page.getByText(/Your report is not withdrawn/)).toBeVisible();
  // Opening it again, as a mail scanner would: still nothing erased.
  await page.reload();
  const button = page.getByRole('button', { name: 'Erase my email address' });
  await expect(button).toBeDisabled();
  await page.getByRole('checkbox', { name: /cannot be undone/ }).click();
  await button.click();
  await expect(page.getByRole('heading', { name: 'Your email address is erased' })).toBeVisible();

  // The link finds nothing now, and the confirmation link with it.
  await page.goto(erase ?? '');
  await expect(
    page.getByRole('heading', { name: 'This link does not match anything' }),
  ).toBeVisible();

  // The report is still there and not withdrawn: the verify page still checks it.
  await page.goto(`/verify/${ref ?? ''}`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(ref ?? '');
  expect(outside).toEqual([]);
  await context.close();
});
