/**
 * The files staff screens (F2), in a real browser against the real server.
 *
 *   - a moderator finds a report with a photo nobody has decided on, sees the
 *     re-encoded copy, publishes it (description, then reason, one card each),
 *     opens the original only with a reason, and asks the reporter for
 *     evidence, which reaches them by email;
 *   - an administrator sets a logbook's own limits and sees the site's;
 *   - admin does not imply moderator: an administrator is turned away from
 *     the moderator's screen.
 *
 * Every page here is checked for requests to any other host. The report is
 * set up through the API; the filing form has its own tests.
 */
import { expect, test } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import { ADMIN } from '../auth.ts';
import { goViaMenu } from '../menu.ts';
import { countTo, identityState, lastMessageTo, linkIn } from '../identity/mail.ts';
import { photoWithLocation, signedIn } from './helpers.ts';
import { doorFields } from '../door.ts';

test.use({ storageState: ADMIN });

const run = () => `${Date.now().toString(36)}${String(Math.floor(Math.random() * 1000))}`;

/** Every request to a host other than this one, for the end of the test. */
function watchOutside(page: Page): string[] {
  const outside: string[] = [];
  page.on('request', (r) => {
    const host = new URL(r.url()).hostname;
    if (host !== '127.0.0.1' && host !== 'localhost') outside.push(r.url());
  });
  return outside;
}

/** A launched logbook taking photos and asking whether there is evidence. */
async function logbookWithFiles(admin: APIRequestContext, title: string) {
  const lb = (await (await admin.post('/api/admin/logbooks', { data: { title } })).json()) as {
    id: number;
    slug: string;
  };
  const add = async (data: Record<string, unknown>) =>
    (
      (await (
        await admin.post(`/api/admin/logbooks/${String(lb.id)}/fields`, { data })
      ).json()) as { key: string }
    ).key;
  const what = await add({ kind: 'long_text', label: 'What happened?', required: true });
  const has = await add({ kind: 'evidence_declaration', label: 'Do you have photos of it?' });
  await add({ kind: 'file', label: 'Photos' });
  expect((await admin.post(`/api/admin/logbooks/${String(lb.id)}/launch`)).ok()).toBe(true);
  return { ...lb, what, has };
}

test('a moderator publishes a photo the reporter allowed, opens the original with a reason, and asks for evidence', async ({
  browser,
  playwright,
}, info) => {
  const baseURL = info.project.use.baseURL ?? 'http://127.0.0.1:4173';
  const admin = await playwright.request.newContext({ baseURL, storageState: ADMIN });
  const lb = await logbookWithFiles(admin, `Files staff ${info.project.name} ${run()}`);
  const card = (await (await admin.get('/api/publication-card?variant=general')).json()) as {
    digest: string;
  };
  await admin.dispose();

  // A report with one photo, allowed to be published, through the API.
  const reporterEmail = `files-staff-${run()}@example.org`;
  const anon = await playwright.request.newContext({ baseURL });
  const draft = ((await (await anon.post('/api/uploads/draft')).json()) as { draft_token: string })
    .draft_token;
  const photo = photoWithLocation();
  const slot = await anon.post('/api/uploads', {
    data: {
      draft_token: draft,
      logbook: lb.slug,
      email: reporterEmail,
      name: 'queue.jpg',
      type: 'image/jpeg',
      size: photo.length,
    },
  });
  expect(slot.ok(), await slot.text()).toBe(true);
  const slotToken = ((await slot.json()) as { slot_token: string }).slot_token;
  const put = await anon.put(`/api/uploads/${slotToken}`, {
    headers: { 'x-draft-token': draft, 'content-type': 'application/octet-stream' },
    data: photo,
  });
  expect(put.ok(), await put.text()).toBe(true);
  let before = countTo(reporterEmail);
  const sent = await anon.post('/api/reports', {
    data: {
      ...(await doorFields(anon)),
      logbook: lb.slug,
      email: reporterEmail,
      consent: true,
      answers: { [lb.what]: 'The queue was turned away.', [lb.has]: 'yes' },
      may_publish: true,
      may_publish_digest: card.digest,
      draft_token: draft,
    },
  });
  expect(sent.ok(), await sent.text()).toBe(true);
  const token =
    /\/file\/confirm\/([a-f0-9]{64})/.exec(
      linkIn(await lastMessageTo(reporterEmail, before)),
    )?.[1] ?? '';
  let ref = '';
  await expect(async () => {
    const c = (await (await anon.post(`/api/reports/confirm/${token}`)).json()) as {
      confirmation: { state: string; public_ref?: string };
    };
    expect(c.confirmation.state).not.toBe('preparing');
    ref = c.confirmation.public_ref ?? '';
  }).toPass({ timeout: 60_000 });
  expect(ref).toMatch(/^RL-/);
  await anon.dispose();

  const reporter = await signedIn(playwright, baseURL, reporterEmail);
  const mine = (await (await reporter.get('/api/mine/reports')).json()) as {
    reports: { thread_id: string; public_ref: string }[];
  };
  const thread = mine.reports.find((r) => r.public_ref === ref)?.thread_id ?? '';
  for (const permission of ['attachment_publication', 'evidence_request']) {
    const g = await reporter.post(`/api/mine/reports/${thread}/permissions`, {
      data: { permission, granted: true },
    });
    expect(g.ok(), await g.text()).toBe(true);
  }
  await reporter.dispose();

  // The moderator, in a browser of their own.
  const modEmail = `files-staff-mod-${run()}@example.org`;
  identityState('seat', modEmail, 'moderator');
  const modApi = await signedIn(playwright, baseURL, modEmail);
  const context = await browser.newContext({ storageState: await modApi.storageState() });
  await modApi.dispose();
  const page = await context.newPage();
  const outside = watchOutside(page);

  await page.goto('/');
  await goViaMenu(page, 'Files', { area: 'Moderation' });
  await expect(page.getByRole('heading', { level: 1, name: 'Files' })).toBeVisible();
  await page
    .getByRole('list', { name: 'Reports with files waiting' })
    .getByRole('link', { name: new RegExp(ref) })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: `Files of ${ref}` })).toBeVisible();
  await expect(page.getByText('The reporter allows their files to be published')).toBeVisible();

  // The copy that would be published, from this site, really an image.
  await page.getByRole('button', { name: 'Show the copy that would be published' }).click();
  const img = page.getByRole('img', { name: /would be published/ });
  await expect(img).toBeVisible();
  await expect
    .poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);

  // Publishing: one question, then the next, each by the moderator's press.
  await page.getByRole('button', { name: 'Publish…' }).click();
  let dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Question 1 of 2')).toBeVisible();
  await dialog
    .getByLabel('Describe the file for somebody who cannot see it')
    .fill('A queue outside a polling station door');
  await dialog.getByRole('button', { name: 'Next' }).click();
  await expect(dialog.getByText('Question 2 of 2')).toBeVisible();
  await dialog.getByLabel('Why publish it?').fill('It shows the queue the report describes');
  await dialog.getByRole('button', { name: 'Publish this file' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('Now: Published')).toBeVisible();
  await expect(page.getByText('“A queue outside a polling station door”')).toBeVisible();

  // The original needs a reason first; the link then carries it.
  await page.getByRole('button', { name: 'Open the original…' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Why do you need the original?').fill('To check when it was taken');
  await dialog.getByRole('button', { name: 'Next' }).click();
  const download = page.waitForEvent('download');
  await dialog.getByRole('link', { name: 'Download the original' }).click();
  await download;
  await page.keyboard.press('Escape');
  await page.reload();
  await page.getByText(/This file’s record/).click();
  await expect(
    page.getByRole('list', { name: 'This file’s record' }).getByText('Original opened'),
  ).toBeVisible();

  // Asking for evidence, in the moderator's words, reaches the reporter.
  before = countTo(reporterEmail);
  await page.getByRole('button', { name: 'Ask for evidence…' }).click();
  dialog = page.getByRole('dialog');
  await dialog
    .getByLabel('What are you asking them for?')
    .fill('Could you send a second photo, from further back?');
  await dialog.getByRole('button', { name: 'Send the ask' }).click();
  await expect(page.getByText('An ask is open')).toBeVisible();
  expect(linkIn(await lastMessageTo(reporterEmail, before))).toMatch(/\/evidence\/[a-f0-9]{48}$/);

  // Withdrawing it is a second press, and the record stays.
  await page.getByRole('button', { name: 'Withdraw the ask…' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Withdraw it' }).click();
  await expect(page.getByText('An ask is open')).toHaveCount(0);
  await page.getByText(/Every ask on this report/).click();
  await expect(page.getByRole('list', { name: 'Every ask' })).toContainText('withdrawn');

  await context.close();
  expect(outside).toEqual([]);
});

test('an administrator sets a logbook’s own limits over the site’s, and opens the files queue too', async ({
  page,
  playwright,
}, info) => {
  const outside = watchOutside(page);
  const baseURL = info.project.use.baseURL ?? 'http://127.0.0.1:4173';
  const admin = await playwright.request.newContext({ baseURL, storageState: ADMIN });
  const title = `Limits ${info.project.name} ${run()}`;
  const lb = await logbookWithFiles(admin, title);
  await admin.dispose();

  await page.goto('/');
  await goViaMenu(page, 'File limits', { area: 'Logbooks and lists' });
  await expect(page.getByRole('heading', { level: 1, name: 'Files: the site' })).toBeVisible();
  await expect(page.getByLabel('Largest photo (MB)')).toBeVisible();

  await page
    .getByRole('navigation', { name: 'File settings' })
    .getByRole('link', { name: 'Each logbook' })
    .click();
  await page.getByRole('link', { name: new RegExp(title) }).click();
  await expect(page.getByRole('heading', { level: 1, name: `Files: ${title}` })).toBeVisible();
  const files = page.getByLabel('Most files on one report (files)');
  await expect(files).toHaveValue('');
  await files.fill('500');
  await page.getByRole('button', { name: 'Save the limits' }).click();
  await expect(page.getByText('Between 1 and 50 files.')).toBeVisible();
  await files.fill('2');
  await page.getByRole('button', { name: 'Save the limits' }).click();
  await expect(page.getByText(/Saved/)).toBeVisible();

  // It holds, and the filing form reads it.
  await page.reload();
  await expect(page.getByLabel('Most files on one report (files)')).toHaveValue('2');
  await expect(page.getByText('Set on this logbook: 2 files.')).toBeVisible();
  const config = (await (
    await page.request.get(`/api/uploads/config?logbook=${lb.slug}`)
  ).json()) as {
    max_files: number;
  };
  expect(config.max_files).toBe(2);

  // The queue names administrators as well as moderators, as moderation
  // does. (Admin still does not imply moderator: the screen names both.)
  await page.goto('/files');
  await expect(page.getByRole('heading', { name: 'Files', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Not for this account' })).toHaveCount(0);
  expect(outside).toEqual([]);
});
