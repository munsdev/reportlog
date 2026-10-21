import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { ADMIN } from './auth.ts';
import { countTo, lastMessageTo, linkIn } from './identity/mail.ts';
import { doorFields } from './door.ts';

const refs = JSON.parse(
  readFileSync(fileURLToPath(new URL('./.refs.json', import.meta.url)), 'utf8'),
) as string[];
const ref = refs[0] ?? '';

test('a reader checks a report from the front page', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Report reference').fill(ref);
  await page.getByRole('button', { name: 'Check it' }).click();

  await expect(page).toHaveURL(new RegExp(`/verify/${ref}$`));
  const checks = page.getByRole('list', { name: 'Checks' }).getByRole('listitem');
  await expect(checks).toHaveCount(4);
  for (const item of await checks.all()) await expect(item).toContainText('Holds:');
});

test('an unknown reference says so plainly', async ({ page }) => {
  await page.goto('/verify/RL-NOT-REAL');
  await expect(page.getByRole('alert')).toContainText('There is no report with that reference.');
});

test('the site asks no third party for anything', async ({ page }) => {
  const outside: string[] = [];
  page.on('request', (r) => {
    const host = new URL(r.url()).hostname;
    if (host !== '127.0.0.1' && host !== 'localhost') outside.push(r.url());
  });
  await page.goto(`/verify/${ref}`);
  await expect(page.getByRole('list', { name: 'Checks' })).toBeVisible();
  expect(outside).toEqual([]);
});

test('an unpublished report shows its fingerprints and not its words, until it is published', async ({
  page,
  playwright,
}) => {
  // Filed by link and confirmed, as a reporter would; approved by an
  // administrator through the API.
  const baseURL = 'http://127.0.0.1:4173';
  const anon = await playwright.request.newContext({ baseURL });
  const word = `vq${Date.now().toString(36)}${String(Math.floor(Math.random() * 1e6))}`;
  const words = `Doors closed early at the hall ${word}.`;
  const email = `verify-${word}@example.org`;
  const card = (await (await anon.get('/api/publication-card')).json()) as { digest: string };
  const before = countTo(email);
  const sent = await anon.post('/api/reports', {
    data: {
      ...(await doorFields(anon)),
      logbook: 'demo',
      email,
      consent: true,
      answers: { what: words },
      may_publish: true,
      may_publish_digest: card.digest,
    },
  });
  expect(sent.ok(), await sent.text()).toBe(true);
  const token = /\/file\/confirm\/([a-f0-9]{64})/.exec(
    linkIn(await lastMessageTo(email, before)),
  )?.[1];
  const done = (await (await anon.post(`/api/reports/confirm/${token ?? ''}`)).json()) as {
    confirmation: { public_ref: string };
  };
  const filed = done.confirmation.public_ref;
  await anon.dispose();

  await page.goto(`/verify/${filed}`);
  const checks = page.getByRole('list', { name: 'Checks' }).getByRole('listitem');
  await expect(checks).toHaveCount(4);
  for (const item of await checks.all()) await expect(item).toContainText('Holds:');
  await expect(page.getByText('What this report says is not shown')).toBeVisible();
  await expect(page.getByText(word)).toHaveCount(0);
  await expect(page.getByText('Check it yourself')).toHaveCount(0);

  const admin = await playwright.request.newContext({ baseURL, storageState: ADMIN });
  const queue = (await (
    await admin.get(`/api/moderation/reports?status=pending&q=${word}`)
  ).json()) as { reports: { thread_id: string }[] };
  const ok = await admin.post(
    `/api/moderation/reports/${queue.reports[0]?.thread_id ?? ''}/decision`,
    { data: { status: 'valid', comment: 'Approved for the verify test.' } },
  );
  expect(ok.ok(), await ok.text()).toBe(true);
  await admin.dispose();

  await page.reload();
  for (const item of await checks.all()) await expect(item).toContainText('Holds:');
  await page.getByText('Check it yourself').click();
  await expect(page.getByText(new RegExp(word))).toBeVisible();
  await expect(page.getByText('What this report says is not shown')).toHaveCount(0);
});
