/**
 * The moderator's report page, as a moderator reads it: the report, the
 * decision, its attachments, then the less-used actions.
 *
 * With SCREENS=before or SCREENS=after it also writes its screens into
 * docs/screens/moderation-83/ (desktop, and a 390-wide window for the phone
 * layout), on the desktop project only.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { MODERATOR } from './auth.ts';
import { doorFields } from './door.ts';
import { countTo, lastMessageTo, linkIn } from './identity/mail.ts';

const apiDir = fileURLToPath(new URL('../../api/', import.meta.url));
const heldState = (...args: string[]) =>
  execFileSync('node', ['--env-file-if-exists=../../.env', 'src/dev/held-state.ts', ...args], {
    cwd: apiDir,
    encoding: 'utf8',
    // The test server's own key (playwright.config.ts).
    env: { ...process.env, CONTACT_KEY: Buffer.alloc(32, 9).toString('base64') },
  }).trim();

const baseURL = 'http://127.0.0.1:4173';
const DIR = fileURLToPath(new URL('../../../docs/screens/moderation-83/', import.meta.url));
const WORDS = 'Both scanners stopped at ten and people left the line without voting.';

/** A tall window from the top, at desktop or phone width. */
async function shot(page: Page, name: string, width: 1280 | 390) {
  const tag = process.env.SCREENS;
  if (!tag || test.info().project.name !== 'chromium') return;
  const was = page.viewportSize();
  await page.setViewportSize({ width, height: width === 390 ? 2400 : 1600 });
  await page.evaluate(() => {
    window.scrollTo(0, 0);
  });
  await page.screenshot({ path: `${DIR}${tag}-${name}.png` });
  if (was) await page.setViewportSize(was);
}

let ref = '';
let threadUrl = '';

test.beforeAll(async ({ playwright }) => {
  const tag = `${Date.now().toString(36)}${String(Math.floor(Math.random() * 1e6))}`;
  const slug = heldState('logbook', `page-${tag}`);
  const anon = await playwright.request.newContext({ baseURL });
  const card = (await (await anon.get('/api/publication-card')).json()) as { digest: string };
  const email = `page-${tag}@example.org`;
  const before = countTo(email);
  const sent = await anon.post('/api/reports', {
    data: {
      ...(await doorFields(anon)),
      logbook: slug,
      email,
      consent: true,
      answers: { outcome: 'bad', what: WORDS, links: [`https://example.org/p-${tag}`] },
      may_publish: true,
      may_publish_digest: card.digest,
      journalist_sharing: true,
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
});

test.use({ storageState: MODERATOR });

test('the report page reads top to bottom: report, decision, attachments, more', async ({
  page,
}) => {
  await page.goto(`/moderate?status=all&q=${encodeURIComponent(ref)}`);
  await page.getByRole('link', { name: `Open ${ref}` }).click();
  await expect(page.getByRole('heading', { level: 1, name: ref })).toBeVisible();
  threadUrl = page.url();
  const attachments = page.getByRole('region', { name: 'Attachments' });
  const account = attachments.getByRole('region', { name: 'Written account' });
  // The less-used actions are folded, and nothing is open that nobody asked for.
  await expect(page.locator('details.more')).not.toHaveAttribute('open');
  await expect(account.getByLabel('The note journalists read')).toHaveCount(0);
  await shot(page, 'report-desktop', 1280);
  await shot(page, 'report-phone', 390);

  // The words once, and the note editor under them only when asked.
  await account.getByRole('button', { name: 'Show the written account' }).click();
  await expect(account.getByText(WORDS)).toBeVisible();
  await account.getByRole('button', { name: 'Write a note for journalists' }).click();
  await expect(account.getByLabel('The note journalists read')).toBeVisible();
  await expect(account.getByText(WORDS)).toHaveCount(1);
  await expect(account.getByRole('button', { name: 'Show the written account' })).toHaveCount(0);
  // Nothing is wider than the page, at either width.
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const wide = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(wide, `scrolls sideways at ${String(width)}`).toBe(false);
  }
  await shot(page, 'note-desktop', 1280);
  await shot(page, 'note-phone', 390);

  // Quoting a selection of the words puts it in the note, in quotation marks.
  await account.getByText(WORDS).selectText();
  await account.getByRole('button', { name: 'Quote selection' }).click();
  await expect(account.getByLabel('The note journalists read')).toHaveValue(`"${WORDS}"`);

  if (process.env.SCREENS && test.info().project.name === 'chromium') {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(threadUrl);
    await page.getByRole('button', { name: 'Approve…' }).click();
    await page.getByRole('dialog').getByRole('radio', { name: 'Approve' }).check();
    await page.screenshot({ path: `${DIR}${process.env.SCREENS}-approve-sheet-phone.png` });
  }
});
