/**
 * Attaching a photo in the filing form, in a real browser, then confirming
 * BY FOLLOWING THE LINK IN THE EMAIL, and checking that the filed report
 * seals the file. The worker runs inside the test server
 * (FILES_INLINE_WORKER), so the photo is really re-encoded on the way.
 */
import { expect, test } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import { ADMIN } from '../auth.ts';
import { countTo, lastMessageTo, linkIn } from '../identity/mail.ts';
import { photoWithLocation } from './helpers.ts';

const run = () => `${Date.now().toString(36)}${String(Math.floor(Math.random() * 1000))}`;
const heading = (page: Page, name: string | RegExp) =>
  page.getByRole('heading', { level: 1, name });

async function logbookTakingFiles(admin: APIRequestContext, title: string) {
  const made = await admin.post('/api/admin/logbooks', { data: { title } });
  expect(made.ok(), await made.text()).toBe(true);
  const lb = (await made.json()) as { id: number; slug: string };
  for (const data of [
    { kind: 'long_text', label: 'What happened?', required: true },
    // Placed BEFORE the date on purpose: its card still comes after the address.
    { kind: 'file', label: 'Photos or video' },
    { kind: 'date', label: 'When was it?' },
  ]) {
    const r = await admin.post(`/api/admin/logbooks/${String(lb.id)}/fields`, { data });
    expect(r.ok(), await r.text()).toBe(true);
  }
  expect((await admin.post(`/api/admin/logbooks/${String(lb.id)}/launch`)).ok()).toBe(true);
  return lb;
}

test('a reporter attaches a photo, sends, and the confirmed report seals it', async ({
  browser,
  playwright,
}, info) => {
  const baseURL = info.project.use.baseURL ?? 'http://127.0.0.1:4173';
  const admin = await playwright.request.newContext({ baseURL, storageState: ADMIN });
  const title = `Files ${info.project.name} ${run()}`;
  const lb = await logbookTakingFiles(admin, title);
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
  await page.getByRole('button', { name: 'Start' }).click();
  await page.getByRole('textbox', { name: 'What happened?' }).fill('A queue was turned away.');
  await next();
  // The upload question has no card among the questions: it comes after the address.
  await expect(heading(page, 'When was it?')).toBeVisible();
  await next();
  await expect(heading(page, 'Should this report be published?')).toBeVisible();
  await next();
  const email = `files-${run()}@example.org`;
  await page.getByLabel('Your email address').fill(email);
  await next();

  await expect(heading(page, 'Photos or video')).toBeVisible();
  await expect(page.getByText(/removed from any copy that could ever be shown/)).toBeVisible();
  await page.locator('input[type=file]').setInputFiles({
    name: 'IMG_0042.jpg',
    mimeType: 'image/jpeg',
    buffer: photoWithLocation(),
  });
  const files = page.getByRole('list', { name: 'Your files' });
  await expect(files.getByText('IMG_0042.jpg')).toBeVisible();
  await expect(files.getByText(/^(Preparing|Ready)$/)).toBeVisible();
  // A second file this form does not take is refused before it is sent.
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('x') });
  await expect(page.getByRole('alert')).toContainText('not a kind of file this form takes');
  await next();

  await expect(heading(page, 'Check your answers')).toBeVisible();
  await expect(page.getByText('IMG_0042.jpg')).toBeVisible();
  await page.getByRole('checkbox', { name: /I confirm this report is accurate/ }).check();
  const before = countTo(email);
  await page.getByRole('button', { name: 'Send report' }).click();
  await expect(heading(page, 'Check your email')).toBeVisible();
  await context.close();

  // The link, followed in a fresh browser, as the reporter would.
  const inbox = await browser.newContext();
  const mailPage = await inbox.newPage();
  await mailPage.goto(linkIn(await lastMessageTo(email, before)));
  await mailPage.getByRole('button', { name: 'Confirm and file my report' }).click();
  // The worker may still be preparing the photo; the page says so and waits for a press.
  await expect(async () => {
    if (await heading(mailPage, 'Your files are still being prepared').isVisible()) {
      await mailPage.getByRole('button', { name: 'Try again' }).click();
    }
    await expect(heading(mailPage, 'Your report is filed')).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 30_000 });
  await expect(mailPage.getByText('One file is part of the report.')).toBeVisible();
  const ref =
    /RL-[A-Z0-9-]+/.exec(
      (await mailPage.getByText(/Its reference is RL-/).textContent()) ?? '',
    )?.[0] ?? '';

  // The sealed fields come whole to staff only: verifying an unpublished
  // report shows anybody else its fingerprints alone (decisions.md §1).
  const staff = await playwright.request.newContext({ baseURL, storageState: ADMIN });
  const verified = await staff.get(`/api/reports/${ref}/verify`);
  const v = (await verified.json()) as {
    content: { ok: boolean };
    hashed_fields: { attachments?: { media_type: string; ordinal: number }[] };
  };
  expect(v.content.ok).toBe(true);
  expect(v.hashed_fields.attachments).toEqual([
    expect.objectContaining({ ordinal: 1, media_type: 'image/jpeg' }),
  ]);
  await staff.dispose();
  await inbox.close();
  expect(outside).toEqual([]);
});
