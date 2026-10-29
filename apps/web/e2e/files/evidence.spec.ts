/**
 * An evidence request, end to end: a reporter files saying they have a
 * photo and agrees to be asked for it; a moderator asks; the reporter
 * FOLLOWS THE LINK IN THE EMAIL, sends the photo, and it lands on the report
 * as a new version. The setup goes through the API (the moderator's screen
 * is the moderation workstream's); the reporter's side is the real page.
 *
 * Then what the page says when it cannot take anything (legacy's
 * evidence.test.js): how to stop being asked at all, the site not taking
 * files, an ask the moderator withdrew, and the reporter having switched
 * being asked off.
 */
import { expect, test } from '@playwright/test';
import type { Browser, Page, PlaywrightWorkerArgs } from '@playwright/test';
import { ADMIN } from '../auth.ts';
import { countTo, identityState, lastMessageTo, linkIn } from '../identity/mail.ts';
import { expectAccessible } from '../filing/axe.ts';
import { heldTextOf } from '../held.ts';
import { photoWithLocation, signedIn } from './helpers.ts';
import { doorFields } from '../door.ts';

const run = () => `${Date.now().toString(36)}${String(Math.floor(Math.random() * 1000))}`;

const ASKED = 'Could you send the photo of the queue you mentioned?';

/**
 * A confirmed report that says it has a photo, its reporter's permission to
 * be asked, and a moderator's ask. Everything but the reporter's page goes
 * through the API.
 */
async function askedForEvidence(
  playwright: PlaywrightWorkerArgs['playwright'],
  baseURL: string,
  name: string,
) {
  // A logbook that asks whether there is evidence.
  const admin = await playwright.request.newContext({ baseURL, storageState: ADMIN });
  const made = await admin.post('/api/admin/logbooks', {
    data: { title: `Evidence ${name} ${run()}` },
  });
  const lb = (await made.json()) as { id: number; slug: string };
  // A logbook asks for words only as a held note (isPublishedFreeText), and
  // asks that only where the operator turned notes on.
  const notes = await admin.patch(`/api/admin/logbooks/${String(lb.id)}`, {
    data: { accepts_notes: true },
  });
  expect(notes.ok(), await notes.text()).toBe(true);
  const add = async (data: Record<string, unknown>) => {
    const r = await admin.post(`/api/admin/logbooks/${String(lb.id)}/fields`, { data });
    expect(r.ok(), await r.text()).toBe(true);
    return ((await r.json()) as { key: string }).key;
  };
  const what = await add({ kind: 'private_text', label: 'What happened?', required: true });
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
      ...(await doorFields(anon)),
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
  const permit = async (granted: boolean) => {
    const r = await reporter.post(`/api/mine/reports/${thread}/permissions`, {
      data: { permission: 'evidence_request', granted },
    });
    expect(r.ok(), await r.text()).toBe(true);
  };
  await permit(true);

  // A moderator asks. Returns the link the email carried.
  const modEmail = `evidence-mod-${run()}@example.org`;
  identityState('seat', modEmail, 'moderator');
  const moderator = await signedIn(playwright, baseURL, modEmail);
  const ask = async () => {
    before = countTo(reporterEmail);
    const asked = await moderator.post(`/api/moderate/evidence/${thread}`, {
      data: { message: ASKED },
    });
    expect(asked.ok(), await asked.text()).toBe(true);
    const link = linkIn(await lastMessageTo(reporterEmail, before));
    expect(link).toMatch(/\/evidence\/[a-f0-9]{48}$/);
    return link;
  };
  const link = await ask();
  return {
    what,
    first: done.confirmation.public_ref,
    link,
    thread,
    ask,
    permit,
    moderator,
    async dispose() {
      await reporter.dispose();
      await moderator.dispose();
    },
  };
}

/** A page in a browser with nobody signed in, that notes any other host it asks. */
async function stranger(browser: Browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const outside: string[] = [];
  page.on('request', (r) => {
    const host = new URL(r.url()).hostname;
    if (host !== '127.0.0.1' && host !== 'localhost') outside.push(r.url());
  });
  return { context, page, outside };
}

const requestPage = (page: Page) =>
  page.getByRole('heading', { name: 'A moderator asked for evidence' });

test('a moderator asks for the photo a reporter mentioned, and the reporter sends it from the email', async ({
  browser,
  playwright,
}, info) => {
  const baseURL = info.project.use.baseURL ?? 'http://127.0.0.1:4173';
  const asked = await askedForEvidence(playwright, baseURL, info.project.name);
  const { what, first, link } = asked;
  await asked.dispose();

  // The reporter follows the link in a fresh browser.
  const { context, page, outside } = await stranger(browser);
  await page.goto(link);
  await expect(requestPage(page)).toBeVisible();
  await expect(page.getByText(ASKED)).toBeVisible();
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
    hashed_fields: { attachments?: unknown[]; text_fingerprints?: Record<string, string> };
  };
  expect(v.content.ok).toBe(true);
  expect(v.hashed_fields.attachments).toHaveLength(1);
  // The words carried forward untouched: held apart from the report, the
  // new version seals the same fingerprint of them as the first, and they
  // read as they were written.
  const original = (await (await staff.get(`/api/reports/${first}/verify`)).json()) as {
    hashed_fields: { text_fingerprints?: Record<string, string> };
  };
  expect(v.hashed_fields.text_fingerprints?.[what]).toMatch(/^[a-f0-9]{64}$/);
  expect(v.hashed_fields.text_fingerprints?.[what]).toBe(
    original.hashed_fields.text_fingerprints?.[what],
  );
  expect(await heldTextOf(staff, ref)).toBe('The queue was turned away.');
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

test('the page says how to stop being asked, and says plainly why it cannot take anything', async ({
  browser,
  playwright,
}, info) => {
  const baseURL = info.project.use.baseURL ?? 'http://127.0.0.1:4173';
  const asked = await askedForEvidence(playwright, baseURL, info.project.name);
  const { context, page, outside } = await stranger(browser);

  // Open: what was asked, that they need not answer, and how to stop being
  // asked at all, in the words of the switch they will find.
  await page.goto(asked.link);
  await expect(requestPage(page)).toBeVisible();
  await expect(page.getByText('You do not have to answer.')).toBeVisible();
  await expect(page.getByText(/To stop being asked for evidence about this report/)).toContainText(
    '“An editor may contact me to ask for the evidence I said I have”',
  );
  await expectAccessible(page, 'an open request');

  // The site not taking files: no box that cannot work, and the reason.
  const evidenceCall = (url: URL) => /^\/api\/evidence\/[a-f0-9]{48}$/.test(url.pathname);
  await page.route(evidenceCall, async (route) => {
    const real = await route.fetch();
    const body = (await real.json()) as { uploads: Record<string, unknown> };
    await route.fulfill({
      response: real,
      json: { ...body, uploads: { ...body.uploads, enabled: false } },
    });
  });
  await page.reload();
  await expect(requestPage(page)).toBeVisible();
  await expect(page.getByText(ASKED)).toBeVisible();
  await expect(page.getByText('Files cannot be taken at the moment')).toBeVisible();
  await expect(page.locator('input[type=file]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Send these files' })).toHaveCount(0);
  await expectAccessible(page, 'a request while files are off');
  await page.unroute(evidenceCall);

  // The moderator withdraws the ask: closed, with what to do about it.
  expect((await asked.moderator.delete(`/api/moderate/evidence/${asked.thread}`)).ok()).toBe(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'This link is not open' })).toBeVisible();
  await expect(page.getByText(/no longer open/)).toBeVisible();
  await expect(page.getByText(/can send you a new one/)).toBeVisible();
  await expect(page.locator('input[type=file]')).toHaveCount(0);
  await expect(page.getByText(ASKED)).toHaveCount(0);
  await expectAccessible(page, 'a closed request');

  // Asked again, then the reporter switches being asked off: the link sent
  // closes, and the page says it was their switch, which they can undo.
  const again = await asked.ask();
  await page.goto(again);
  await expect(requestPage(page)).toBeVisible();
  await asked.permit(false);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'This link is not open' })).toBeVisible();
  await expect(page.getByText(/You have switched off being asked for evidence/)).toBeVisible();
  await expect(page.getByText(/switch it back on/)).toBeVisible();
  await expect(page.locator('input[type=file]')).toHaveCount(0);

  await asked.dispose();
  await context.close();
  expect(outside).toEqual([]);
});
