/**
 * W1 in the browser: a report with text and links held outside it, one link
 * erased, still checks out in the reader's own browser, and the page never
 * shows what was held.
 *
 * Filed through the API as the form files and confirmed from the emailed
 * link; the erasure stands in for a moderator (src/dev/held-state.ts), since
 * no route erases a held value yet.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { ADMIN } from './auth.ts';
import { doorFields } from './door.ts';
import { countTo, lastMessageTo, linkIn } from './identity/mail.ts';

const apiDir = fileURLToPath(new URL('../../api/', import.meta.url));
const heldState = (...args: string[]) =>
  execFileSync('node', ['--env-file-if-exists=../../.env', 'src/dev/held-state.ts', ...args], {
    cwd: apiDir,
    encoding: 'utf8',
    // The test server's own key (playwright.config.ts), not the one in .env:
    // the held values were stored under the server's.
    env: { ...process.env, CONTACT_KEY: Buffer.alloc(32, 9).toString('base64') },
  }).trim();

const baseURL = 'http://127.0.0.1:4173';
const WORDS = 'Both scanners stopped and people left the line';
const LINK = 'https://example.org/held-post';
const OTHER = 'https://example.net/held-video';

let ref = '';

test.beforeAll(async ({ playwright }) => {
  const tag = `${Date.now().toString(36)}${String(Math.floor(Math.random() * 1e6))}`;
  const slug = heldState('logbook', `held-${tag}`);
  const anon = await playwright.request.newContext({ baseURL });
  const email = `held-${tag}@example.org`;
  const card = (await (await anon.get('/api/publication-card')).json()) as { digest: string };
  const before = countTo(email);
  const sent = await anon.post('/api/reports', {
    data: {
      ...(await doorFields(anon)),
      logbook: slug,
      email,
      consent: true,
      answers: { outcome: 'bad', what: WORDS, links: [LINK, OTHER] },
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
  ref = done.confirmation.public_ref;
  await anon.dispose();
  expect(heldState('erase-first-link', ref)).toBe('1');
});

async function checksHold(page: Page) {
  await page.goto(`/verify/${ref}`);
  await page.getByText('Technical details').click();
  const checks = page.getByRole('list', { name: 'Checks' }).getByRole('listitem');
  await expect(checks).toHaveCount(4);
  for (const item of await checks.all()) await expect(item).toContainText('Holds:');
}

test('a report with an erased link still checks out, and shows nothing it held', async ({
  page,
}) => {
  const outside: string[] = [];
  page.on('request', (r) => {
    const host = new URL(r.url()).hostname;
    if (host !== '127.0.0.1' && host !== 'localhost') outside.push(r.url());
  });
  await checksHold(page);
  await expect(page.getByText(WORDS)).toHaveCount(0);
  await expect(page.getByText(/example\.(org|net)/)).toHaveCount(0);
  expect(outside).toEqual([]);
});

test.describe('read whole by staff', () => {
  test.use({ storageState: ADMIN });

  test('the browser recomputes the fingerprint from bytes that hold only fingerprints', async ({
    page,
  }) => {
    await checksHold(page);
    await expect(page.getByText('This page recomputed the fingerprint itself')).toBeVisible();
    const bytes = page.locator('pre').filter({ hasText: '"link_fingerprints"' });
    await expect(bytes).toHaveCount(1);
    await expect(bytes).toContainText('"text_fingerprints"');
    await expect(bytes).toContainText('"recipe":2');
    await expect(page.getByText(WORDS)).toHaveCount(0);
    await expect(page.getByText(/example\.(org|net)/)).toHaveCount(0);
  });
});
