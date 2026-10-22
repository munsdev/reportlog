/**
 * Filing a report in a real browser, one card at a time, and confirming it
 * BY FOLLOWING THE LINK IN THE EMAIL the server wrote. A path that only runs
 * when somebody clicks a link in an email is the path nothing reaches by
 * accident: the old application's confirmation was broken in production for
 * three days under three green suites because none of them followed it.
 *
 * The logbook is made through the builder's API as the administrator; the
 * reporter is a fresh browser with no account and no session.
 */
import { expect, test } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import { ADMIN } from '../auth.ts';
import { countTo, lastMessageTo, linkIn } from '../identity/mail.ts';

const run = () => `${Date.now().toString(36)}${String(Math.floor(Math.random() * 1000))}`;

async function launchedLogbook(admin: APIRequestContext, title: string) {
  const made = await admin.post('/api/admin/logbooks', { data: { title } });
  expect(made.ok(), await made.text()).toBe(true);
  const lb = (await made.json()) as { id: number; slug: string };
  const add = async (data: Record<string, unknown>) => {
    const r = await admin.post(`/api/admin/logbooks/${String(lb.id)}/fields`, { data });
    expect(r.ok(), await r.text()).toBe(true);
    return (await r.json()) as { key: string };
  };
  await add({ kind: 'long_text', label: 'What happened?', required: true });
  const seen = await add({ kind: 'yes_no', label: 'Did anybody else see it?', required: true });
  await add({
    kind: 'short_text',
    label: 'Who saw it?',
    shown_when: { field: seen.key, in: ['yes'] },
  });
  await add({ kind: 'date', label: 'When was it?' });
  const launched = await admin.post(`/api/admin/logbooks/${String(lb.id)}/launch`);
  expect(launched.ok(), await launched.text()).toBe(true);
  return lb;
}

const heading = (page: Page, name: string | RegExp) =>
  page.getByRole('heading', { level: 1, name });

test('a reporter files a report card by card, and confirms it from the email', async ({
  browser,
  playwright,
}, info) => {
  const admin = await playwright.request.newContext({
    baseURL: info.project.use.baseURL ?? 'http://127.0.0.1:4173',
    storageState: ADMIN,
  });
  const title = `Filing ${info.project.name} ${run()}`;
  const lb = await launchedLogbook(admin, title);
  await admin.dispose();

  const context = await browser.newContext();
  const page = await context.newPage();
  const outside: string[] = [];
  page.on('request', (r) => {
    const host = new URL(r.url()).hostname;
    if (host !== '127.0.0.1' && host !== 'localhost') outside.push(r.url());
  });
  const next = () => page.getByRole('button', { name: 'Next' }).click();

  await page.goto(`/file/${lb.slug}`);
  await expect(heading(page, title)).toBeVisible();
  await page.getByRole('button', { name: 'Start' }).click();

  // One question per card, and a required one holds you until it is answered.
  await expect(heading(page, 'What happened?')).toBeVisible();
  await expect(heading(page, 'What happened?')).toBeFocused();
  await next();
  await expect(page.getByText('An answer is needed here.')).toBeVisible();
  await page
    .getByRole('textbox', { name: 'What happened?' })
    .fill('The doors were locked at eight.');
  await next();

  // NO AUTO-ADVANCE: choosing leaves you on the card, and nothing appears on it.
  await expect(heading(page, 'Did anybody else see it?')).toBeVisible();
  await page.getByRole('radio', { name: 'Yes' }).click();
  await expect(heading(page, 'Did anybody else see it?')).toBeVisible();
  await expect(page.getByText('Who saw it?')).toHaveCount(0);
  await next();

  // The question that answer turned on is the NEXT card.
  await expect(heading(page, 'Who saw it?')).toBeVisible();
  await expect(page.getByText('Optional.')).toBeVisible();
  // Changing the answer turns it off again.
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('radio', { name: 'No' }).click();
  await next();
  await expect(heading(page, 'When was it?')).toBeVisible();
  await next();

  // The publication card is the server's wording.
  await expect(heading(page, 'Should this report be published?')).toBeVisible();
  await expect(page.getByText('If you do not answer, it will not be published.')).toBeVisible();
  await page.getByRole('radio', { name: 'Yes, it may be published' }).click();
  await next();

  await expect(heading(page, 'Where can we reach you?')).toBeVisible();
  const email = `reporter-${run()}@example.org`;
  await page.getByLabel('Your email address').fill(email);
  await next();

  // Check your answers: only what was asked, each one changeable.
  await expect(heading(page, 'Check your answers')).toBeVisible();
  await expect(page.getByText('The doors were locked at eight.')).toBeVisible();
  await expect(page.getByText('Who saw it?')).toHaveCount(0);
  await page.getByRole('button', { name: 'Change: What happened?' }).click();
  await page
    .getByRole('textbox', { name: 'What happened?' })
    .fill('The doors were locked at nine.');
  await next();
  // Straight back to the review, not through every card again.
  await expect(heading(page, 'Check your answers')).toBeVisible();
  await expect(page.getByText('The doors were locked at nine.')).toBeVisible();

  const before = countTo(email);
  await page.getByRole('button', { name: 'Send report' }).click();
  await expect(page.getByText('Tick the statement above to send the report.')).toBeVisible();
  await page.getByRole('checkbox', { name: /I confirm this report is accurate/ }).check();
  await page.getByRole('button', { name: 'Send report' }).click();
  await expect(heading(page, 'Check your email')).toBeVisible();
  await expect(page.getByText(`We have sent a link to ${email}`)).toBeVisible();
  expect(outside).toEqual([]);
  await context.close();

  // ── the email, and its link, in a different browser ────────────────────
  const mail = await lastMessageTo(email, before);
  expect(mail.subject).toBe('Confirm your report');
  const link = linkIn(mail);
  expect(link).toMatch(/^http:\/\/127\.0\.0\.1:4173\/file\/confirm\/[a-f0-9]{64}$/);

  const reader = await browser.newContext();
  const inbox = await reader.newPage();
  await inbox.goto(link);
  // Opening the link files nothing: there is a button for that.
  await expect(heading(inbox, 'Confirm your report')).toBeVisible();
  // The logbook it is for, named above the heading.
  await expect(inbox.getByText(title, { exact: true })).toBeVisible();
  await inbox.reload();
  await expect(heading(inbox, 'Confirm your report')).toBeVisible();
  await inbox.getByRole('button', { name: 'Confirm and file my report' }).click();
  await expect(heading(inbox, 'Your report is filed')).toBeVisible();
  const refText = await inbox.getByText(/Its reference is RL-/).textContent();
  const ref = /RL-\S+/.exec(refText ?? '')?.[0] ?? '';
  expect(ref).toMatch(/^RL-/);

  // The link keeps working, and shows where the report stands.
  await inbox.goto(link);
  await expect(heading(inbox, 'Your report is filed')).toBeVisible();
  await expect(inbox.getByText(`Its reference is ${ref}`)).toBeVisible();

  // And the report it filed is sealed and verifies, with the answer given.
  await inbox.getByRole('link', { name: 'Check it has not been changed' }).click();
  const checks = inbox.getByRole('list', { name: 'Checks' }).getByRole('listitem');
  await expect(checks).toHaveCount(4);
  for (const item of await checks.all()) await expect(item).toContainText('Holds:');
  // Not published, so the page shows its fingerprints and none of its words
  // (decisions.md §1); the answer is in the sealed bytes staff can read.
  await expect(inbox.getByText('What this report says is not shown')).toBeVisible();
  await expect(inbox.getByText(/The doors were locked at nine/)).toHaveCount(0);
  const staff = await playwright.request.newContext({
    baseURL: info.project.use.baseURL ?? 'http://127.0.0.1:4173',
    storageState: ADMIN,
  });
  const sealed = (await (await staff.get(`/api/reports/${ref}/verify`)).json()) as {
    canonical_json?: string;
  };
  expect(sealed.canonical_json).toContain('The doors were locked at nine.');
  await staff.dispose();
  await reader.close();
});

test('a logbook that does not exist says so', async ({ page }) => {
  await page.goto('/file/no-such-logbook-here');
  await expect(heading(page, 'There is no logbook here')).toBeVisible();
});

test('a link that is not one this site sent says so', async ({ page }) => {
  await page.goto(`/file/confirm/${'f'.repeat(64)}`);
  await expect(heading(page, 'This link does not work')).toBeVisible();
});
