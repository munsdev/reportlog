/**
 * Decision 83 in the browser: approving a report and reviewing its
 * attachments are separate.
 *
 *   - the Reports queue's one work filter, "Has attachments to review",
 *     finds the reports holding a written account or link nobody decided;
 *   - a report holding them can be picked and approved in a batch, and
 *     approving decides none of them: they still wait afterwards;
 *   - on the report page each attachment says where it stands, and "Leave
 *     it" asks for no reason.
 *
 * With SCREENS=1 it also writes the screens in docs/screens/moderation-83/.
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
    // The test server's own key (playwright.config.ts): the held values are
    // stored under the server's.
    env: { ...process.env, CONTACT_KEY: Buffer.alloc(32, 9).toString('base64') },
  }).trim();

const baseURL = 'http://127.0.0.1:4173';
const SCREENS = fileURLToPath(new URL('../../../docs/screens/moderation-83/', import.meta.url));
const shot = async (page: Page, name: string) => {
  if (process.env.SCREENS) await page.screenshot({ path: `${SCREENS}${name}.png`, fullPage: true });
};

let slug = '';
const refs: string[] = [];

test.beforeAll(async ({ playwright }) => {
  const tag = `${Date.now().toString(36)}${String(Math.floor(Math.random() * 1e6))}`;
  slug = heldState('logbook', `att-${tag}`);
  const anon = await playwright.request.newContext({ baseURL });
  const card = (await (await anon.get('/api/publication-card')).json()) as { digest: string };
  // Two holding a written account and a link the reporter lets journalists
  // read, one holding nothing to review.
  const filings = [
    {
      what: 'Both scanners stopped and people left the line.',
      links: [`https://example.org/a-${tag}`],
    },
    { what: 'The drop box was locked before noon.', links: [`https://example.org/b-${tag}`] },
    {},
  ];
  for (const [i, extra] of filings.entries()) {
    const email = `att-${tag}-${String(i)}@example.org`;
    const before = countTo(email);
    const sent = await anon.post('/api/reports', {
      data: {
        ...(await doorFields(anon)),
        logbook: slug,
        email,
        consent: true,
        answers: { outcome: 'bad', ...extra },
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
    refs.push(done.confirmation.public_ref);
  }
  await anon.dispose();
});

test.use({ storageState: MODERATOR });

test('attachments are reviewed apart from the report, which approves in a batch', async ({
  page,
}) => {
  const [first = '', second = '', plain = ''] = refs;
  const outside: string[] = [];
  page.on('request', (r) => {
    const host = new URL(r.url()).hostname;
    if (host !== '127.0.0.1' && host !== 'localhost') outside.push(r.url());
  });
  const rows = page.getByRole('list', { name: 'Reports' }).getByRole('listitem');
  const row = (ref: string) => rows.filter({ hasText: ref });

  // The one filter.
  await page.goto(`/moderate?logbook=${slug}`);
  await expect(row(plain)).toBeVisible();
  const filter = page
    .getByRole('group', { name: 'Only reports that' })
    .getByRole('button', { name: /^Has attachments to review/ });
  await filter.click();
  await expect(filter).toHaveAttribute('aria-pressed', 'true');
  await expect(row(first)).toBeVisible();
  await expect(row(second)).toBeVisible();
  await expect(row(plain)).toHaveCount(0);
  await expect(row(first).getByText('2 attachments to review')).toBeVisible();
  await shot(page, 'queue-filter');

  // A report page: each attachment with its own status.
  await page.getByRole('link', { name: `Open ${second}` }).click();
  await expect(page.getByRole('heading', { level: 1, name: second })).toBeVisible();
  const attachments = page.getByRole('region', { name: 'Attachments' });
  await expect(attachments.getByText(/shows none of these to anybody/)).toBeVisible();
  await expect(attachments.getByText('Waiting')).toHaveCount(2);
  const account = attachments.getByRole('region', { name: /^Written account/ });
  await account.getByRole('button', { name: 'Leave it with the report (staff only)' }).click();
  await expect(account.getByText('Kept back')).toBeVisible();
  await expect(attachments.getByText('Waiting')).toHaveCount(1);
  await shot(page, 'report-attachments');

  // Bulk approval takes every report, those holding attachments too.
  await page.goto(`/moderate?logbook=${slug}`);
  await row(first)
    .getByRole('checkbox', { name: `Select ${first}` })
    .check();
  await row(second)
    .getByRole('checkbox', { name: `Select ${second}` })
    .check();
  await row(plain)
    .getByRole('checkbox', { name: `Select ${plain}` })
    .check();
  await expect(page.getByRole('region', { name: 'Selected reports' })).toContainText('3 selected');
  await shot(page, 'bulk-approve-selected');
  await page.getByRole('button', { name: 'Approve selected' }).click();
  await expect(page.getByText('Approved 3.').first()).toBeVisible();
  await expect(page.getByText(/Left alone/)).toHaveCount(0);

  // Approving decided none of them: the approved ones still wait.
  await page.goto(`/moderate?logbook=${slug}&status=valid&attachments=true`);
  await expect(row(first)).toBeVisible();
  await expect(row(first).getByText('2 attachments to review')).toBeVisible();
  await expect(row(second).getByText('1 attachment to review')).toBeVisible();
  await expect(row(plain)).toHaveCount(0);
  await shot(page, 'bulk-approve-after');
  expect(outside).toEqual([]);
});
