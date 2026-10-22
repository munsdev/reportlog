/**
 * What works IN FRONT of the site password (decisions.md §3 and §4), with
 * the password on.
 *
 *   - The evidence-request link: a reporter who never had the password
 *     follows it from the email the server wrote, and sends the photo.
 *   - The lock screen: the site's name and the paragraph its operator wrote
 *     in the settings, the development badge, and no call behind the gate.
 *
 * Runs alone and last (the `in-front-of-password` project), because the
 * password, the site's name and the development notice are the whole site's.
 * Everything is put back after.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import { photoWithLocation, signedIn } from '../files/helpers.ts';
import { countTo, identityState, lastMessageTo, linkIn } from '../identity/mail.ts';
import { doorFields } from '../door.ts';

test.describe.configure({ mode: 'serial' });

const BASE = 'http://127.0.0.1:4173';
const API = fileURLToPath(new URL('../../../api/', import.meta.url));
const curtain = (password: string) => {
  execFileSync(
    'node',
    ['--env-file-if-exists=../../.env', 'src/filing/dev-state.ts', 'curtain', password],
    { cwd: API },
  );
};
const run = () => `${Date.now().toString(36)}${String(Math.floor(Math.random() * 1000))}`;
const lockHeading = (page: Page) =>
  page.getByRole('heading', { name: 'This site needs a password' });

/** Every request a page makes, by path, and any to another host. */
function watch(page: Page) {
  const paths: string[] = [];
  const outside: string[] = [];
  page.on('request', (r) => {
    const url = new URL(r.url());
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') outside.push(r.url());
    else if (url.pathname.startsWith('/api/')) paths.push(url.pathname);
  });
  return { paths, outside };
}

let admin: APIRequestContext;

// Its own administrator, signed in now: the identity project, earlier in the
// run, rearranges the seats, so the session saved at the start may be gone.
let adminState: Awaited<ReturnType<APIRequestContext['storageState']>>;
test.beforeAll(async ({ playwright }) => {
  const email = `in-front-admin-${run()}@example.org`;
  identityState('seat', email, 'admin');
  admin = await signedIn(playwright, BASE, email);
  adminState = await admin.storageState();
});
test.afterAll(async () => {
  // Password off first: the settings routes are behind it.
  identityState('set-up');
  await admin.put('/api/admin/site/name', { data: { name: null } });
  await admin.put('/api/admin/site/copy/lock_intro', { data: { body: '' } });
  await admin.put('/api/admin/site/dev-mode', { data: { hours: null } });
  await admin.dispose();
});

test('a reporter without the password follows the evidence link from the email and sends the photo', async ({
  browser,
  playwright,
}) => {
  // A logbook asking whether there is evidence, a report saying yes, the
  // reporter's permission, and a moderator's ask: all before the password.
  const made = await admin.post('/api/admin/logbooks', { data: { title: `In front ${run()}` } });
  expect(made.ok(), await made.text()).toBe(true);
  const lb = (await made.json()) as { id: number; slug: string };
  const add = async (data: Record<string, unknown>) =>
    (
      (await (
        await admin.post(`/api/admin/logbooks/${String(lb.id)}/fields`, { data })
      ).json()) as { key: string }
    ).key;
  const what = await add({ kind: 'long_text', label: 'What happened?', required: true });
  const has = await add({ kind: 'evidence_declaration', label: 'Do you have photos of it?' });
  const launched = await admin.post(`/api/admin/logbooks/${String(lb.id)}/launch`);
  expect(launched.ok(), await launched.text()).toBe(true);
  const card = (await (await admin.get('/api/publication-card?variant=general')).json()) as {
    digest: string;
  };

  const reporterEmail = `in-front-${run()}@example.org`;
  const anon = await playwright.request.newContext({ baseURL: BASE });
  let before = countTo(reporterEmail);
  const sent = await anon.post('/api/reports', {
    data: {
      ...(await doorFields(anon)),
      logbook: lb.slug,
      email: reporterEmail,
      consent: true,
      answers: { [what]: 'The side door was chained.', [has]: 'yes' },
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

  const reporter = await signedIn(playwright, BASE, reporterEmail);
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

  const modEmail = `in-front-mod-${run()}@example.org`;
  identityState('seat', modEmail, 'moderator');
  const moderator = await signedIn(playwright, BASE, modEmail);
  before = countTo(reporterEmail);
  const asked = await moderator.post(`/api/moderate/evidence/${thread}`, {
    data: { message: 'Could you send the photo of the chained door?' },
  });
  expect(asked.ok(), await asked.text()).toBe(true);
  await moderator.dispose();
  const link = linkIn(await lastMessageTo(reporterEmail, before));
  expect(link).toMatch(/\/evidence\/[a-f0-9]{48}$/);

  // Now the password goes on. The reporter never had it.
  curtain(`in-front-${run()}`);

  const context = await browser.newContext();
  const page = await context.newPage();
  const seen = watch(page);
  // The rest of the site is behind the password.
  await page.goto('/');
  await expect(lockHeading(page)).toBeVisible();

  await page.goto(link);
  await expect(page.getByRole('heading', { name: 'A moderator asked for evidence' })).toBeVisible();
  await expect(page.getByText('Could you send the photo of the chained door?')).toBeVisible();
  await expect(lockHeading(page)).toHaveCount(0);
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: 'door.jpg', mimeType: 'image/jpeg', buffer: photoWithLocation() });
  await expect(page.getByRole('list', { name: 'Your files' }).getByText('Ready')).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole('button', { name: 'Send these files' }).click();
  await expect(page.getByRole('heading', { name: 'Thank you' })).toBeVisible();
  // A door page asks for nothing it may not have, so the lock never came back.
  await expect(lockHeading(page)).toHaveCount(0);
  const behind = seen.paths.filter(
    (p) => !p.startsWith('/api/evidence/') && !p.startsWith('/api/telemetry'),
  );
  expect(behind.filter((p) => p !== '/api/site-access/status' && p !== '/api/doors')).toEqual([]);

  // Spent, and still in front of the password: the page says so in its own words.
  await page.goto(link);
  await expect(page.getByRole('heading', { name: 'This link is not open' })).toBeVisible();
  await expect(lockHeading(page)).toHaveCount(0);

  // A link nobody sent gets the password screen.
  await page.goto(`/evidence/${'0'.repeat(48)}`);
  await expect(lockHeading(page)).toBeVisible();
  await context.close();
  expect(seen.outside).toEqual([]);
  identityState('set-up');
});

test('the lock screen shows the site’s name and the operator’s paragraph, and asks nothing behind the gate', async ({
  browser,
}) => {
  // Written in the settings, as an operator would, while the password is off.
  const staff = await browser.newContext({ storageState: adminState });
  const settings = await staff.newPage();
  await settings.goto('/settings/words');
  const box = settings.getByRole('textbox', { name: 'Your own words on the password screen' });
  await box.fill('Run by the harbour residents.\nAsk at the office for the password.');
  const form = settings.locator('form').filter({ has: box });
  // Numbers are for the pages behind the password, never this one.
  await expect(form.getByRole('button', { name: 'Insert a number' })).toHaveCount(0);
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(form.getByText('Saved. The page shows it now.')).toBeVisible();
  await staff.close();
  expect((await admin.put('/api/admin/site/name', { data: { name: 'Harbour Watch' } })).ok()).toBe(
    true,
  );
  expect((await admin.put('/api/admin/site/dev-mode', { data: { hours: 1 } })).ok()).toBe(true);

  curtain(`in-front-${run()}`);
  const context = await browser.newContext();
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto('/board');
  await expect(lockHeading(page)).toBeVisible();
  await expect(page.getByText('Harbour Watch')).toBeVisible();
  await expect(page.locator('[data-copy="lock_intro"]')).toHaveText(
    'Run by the harbour residents.\nAsk at the office for the password.',
  );
  await expect(page.getByRole('button', { name: 'Under active development' })).toBeVisible();
  // Nothing of the board, and nothing behind the gate was asked to draw this.
  await expect(page.getByRole('heading', { name: 'Live report board' })).toHaveCount(0);
  await page.waitForLoadState('networkidle');
  expect(
    seen.paths.filter(
      (p) =>
        p !== '/api/site-access/status' && p !== '/api/doors' && !p.startsWith('/api/telemetry'),
    ),
  ).toEqual([]);
  expect(seen.outside).toEqual([]);

  // The badge on a door too: the demo logbook opened by link.
  execFileSync(
    'node',
    ['--env-file-if-exists=../../.env', 'src/filing/dev-state.ts', 'outside', 'demo', 'link'],
    { cwd: API },
  );
  try {
    await page.goto('/file/demo');
    await expect(page.getByRole('heading', { level: 1, name: 'Demo logbook' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Under active development' })).toBeVisible();
    await expect(lockHeading(page)).toHaveCount(0);
  } finally {
    execFileSync(
      'node',
      ['--env-file-if-exists=../../.env', 'src/filing/dev-state.ts', 'outside', 'demo', 'closed'],
      { cwd: API },
    );
  }
  await context.close();
});
