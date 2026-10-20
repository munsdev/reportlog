/**
 * An evidence request, end to end: a reporter files saying they have a
 * photo and agrees to be asked for it; a moderator asks; the reporter
 * FOLLOWS THE LINK IN THE EMAIL, sends the photo, and it lands on the report
 * as a new version. The setup goes through the API (the moderator's screen
 * is the moderation workstream's); the reporter's side is the real page.
 */
import { expect, test } from '@playwright/test';
import { ADMIN } from '../auth.ts';
import { countTo, identityState, lastMessageTo, linkIn } from '../identity/mail.ts';
import { photoWithLocation, signedIn } from './helpers.ts';

const run = () => `${Date.now().toString(36)}${String(Math.floor(Math.random() * 1000))}`;

test('a moderator asks for the photo a reporter mentioned, and the reporter sends it from the email', async ({
  browser,
  playwright,
}, info) => {
  const baseURL = info.project.use.baseURL ?? 'http://127.0.0.1:4173';

  // A logbook that asks whether there is evidence.
  const admin = await playwright.request.newContext({ baseURL, storageState: ADMIN });
  const made = await admin.post('/api/admin/logbooks', {
    data: { title: `Evidence ${info.project.name} ${run()}` },
  });
  const lb = (await made.json()) as { id: number; slug: string };
  const add = async (data: Record<string, unknown>) =>
    (
      (await (
        await admin.post(`/api/admin/logbooks/${String(lb.id)}/fields`, { data })
      ).json()) as { key: string }
    ).key;
  const what = await add({ kind: 'long_text', label: 'What happened?', required: true });
  const has = await add({ kind: 'evidence_declaration', label: 'Do you have photos of it?' });
  expect((await admin.post(`/api/admin/logbooks/${String(lb.id)}/launch`)).ok()).toBe(true);
  const card = (await (await admin.get('/api/publication-card?variant=general')).json()) as {
    digest: string;
  };
  await admin.dispose();

  // Filed and confirmed, saying there is a photo.
  const reporterEmail = `evidence-${run()}@example.org`;
  const anon = await playwright.request.newContext({ baseURL });
  let before = countTo(reporterEmail);
  const sent = await anon.post('/api/reports', {
    data: {
      logbook: lb.slug,
      email: reporterEmail,
      consent: true,
      answers: { [what]: 'The queue was turned away.', [has]: 'yes' },
      may_publish: false,
      may_publish_digest: card.digest,
    },
  });
  expect(sent.ok(), await sent.text()).toBe(true);
  const token =
    /\/file\/confirm\/([a-f0-9]{64})/.exec(
      linkIn(await lastMessageTo(reporterEmail, before)),
    )?.[1] ?? '';
  const done = (await (await anon.post(`/api/reports/confirm/${token}`)).json()) as {
    confirmation: { public_ref: string };
  };
  await anon.dispose();

  // The reporter agrees to be asked, from their own reports.
  const reporter = await signedIn(playwright, baseURL, reporterEmail);
  const mine = (await (await reporter.get('/api/mine/reports')).json()) as {
    reports: { thread_id: string; public_ref: string }[];
  };
  const thread =
    mine.reports.find((r) => r.public_ref === done.confirmation.public_ref)?.thread_id ?? '';
  expect(
    (
      await reporter.post(`/api/mine/reports/${thread}/permissions`, {
        data: { permission: 'evidence_request', granted: true },
      })
    ).ok(),
  ).toBe(true);
  await reporter.dispose();

  // A moderator asks.
  const modEmail = `evidence-mod-${run()}@example.org`;
  identityState('seat', modEmail, 'moderator');
  const moderator = await signedIn(playwright, baseURL, modEmail);
  before = countTo(reporterEmail);
  const asked = await moderator.post(`/api/moderate/evidence/${thread}`, {
    data: { message: 'Could you send the photo of the queue you mentioned?' },
  });
  expect(asked.ok(), await asked.text()).toBe(true);
  await moderator.dispose();

  // The reporter follows the link in a fresh browser.
  const link = linkIn(await lastMessageTo(reporterEmail, before));
  expect(link).toMatch(/\/evidence\/[a-f0-9]{48}$/);
  const context = await browser.newContext();
  const page = await context.newPage();
  const outside: string[] = [];
  page.on('request', (r) => {
    const host = new URL(r.url()).hostname;
    if (host !== '127.0.0.1' && host !== 'localhost') outside.push(r.url());
  });
  await page.goto(link);
  await expect(page.getByRole('heading', { name: 'A request about your report' })).toBeVisible();
  await expect(
    page.getByText('Could you send the photo of the queue you mentioned?'),
  ).toBeVisible();
  // Nothing of what the report says is on this page.
  await expect(page.getByText('The queue was turned away.')).toHaveCount(0);

  await page
    .locator('input[type=file]')
    .setInputFiles({ name: 'queue.jpg', mimeType: 'image/jpeg', buffer: photoWithLocation() });
  await expect(page.getByRole('list', { name: 'Your files' }).getByText('Ready')).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole('button', { name: 'Send these files' }).click();
  await expect(page.getByRole('heading', { name: 'Thank you' })).toBeVisible();
  const ref =
    /RL-[A-Z0-9-]+/.exec(
      (await page.getByText(/Your files are part of report/).textContent()) ?? '',
    )?.[0] ?? '';

  // The sealed fields come whole to staff only: verifying an unpublished
  // report shows anybody else its fingerprints alone (decisions.md §1).
  const staff = await playwright.request.newContext({ baseURL, storageState: ADMIN });
  const v = (await (await staff.get(`/api/reports/${ref}/verify`)).json()) as {
    content: { ok: boolean };
    hashed_fields: { attachments?: unknown[]; answers?: Record<string, unknown> };
  };
  expect(v.content.ok).toBe(true);
  expect(v.hashed_fields.attachments).toHaveLength(1);
  // The words carried forward untouched.
  expect(v.hashed_fields.answers?.[what]).toBe('The queue was turned away.');
  // And the reporter, holding only the reference, is shown none of it.
  const anyone = (await (await page.request.get(`/api/reports/${ref}/verify`)).json()) as object;
  expect(anyone).not.toHaveProperty('hashed_fields');
  await staff.dispose();

  // Spent: the link does not open again.
  await page.goto(link);
  await expect(page.getByRole('heading', { name: 'This link is not open' })).toBeVisible();
  await context.close();
  expect(outside).toEqual([]);
});
