/**
 * A reporter's own switches on "My reports", where getting them wrong costs
 * something real (legacy's permissions.test.js):
 *
 *   - switching off file publication takes published files DOWN, at once,
 *     so while any are up the page asks first, and a "no" writes nothing;
 *   - a write the server refuses leaves the box as the server has it, and
 *     says why, so the page never shows a permission the archive does not
 *     have.
 *
 * The reporter, their report and their sign-in are real. What the server
 * says about this one report's files and switches is stood in for in this
 * page, because a published file needs a moderator, a worker and a public
 * archive, and the count itself is the server's own test
 * (apps/api/test/db/mine-published-files.test.ts).
 */
import { expect, test } from '@playwright/test';
import type { Page, PlaywrightWorkerArgs } from '@playwright/test';
import { signedIn } from '../files/helpers.ts';
import { countTo, lastMessageTo, linkIn } from '../identity/mail.ts';
import { expectAccessible } from './axe.ts';

const run = () => `${Date.now().toString(36)}${String(Math.floor(Math.random() * 1000))}`;

interface Posted {
  permission: string;
  granted: boolean;
}

/**
 * A reporter signed in, on their report's own page, with two of its files
 * published. `refuse` names a permission whose writes the server refuses.
 */
async function myReportWithPublishedFiles(
  page: Page,
  playwright: PlaywrightWorkerArgs['playwright'],
  baseURL: string,
  refuse?: string,
) {
  const email = `perms-${run()}@example.org`;
  const anon = await playwright.request.newContext({ baseURL });
  const card = (await (await anon.get('/api/publication-card')).json()) as { digest: string };
  const before = countTo(email);
  const sent = await anon.post('/api/reports', {
    data: {
      logbook: 'demo',
      email,
      consent: true,
      answers: { what: 'The doors were locked.' },
      may_publish: true,
      may_publish_digest: card.digest,
    },
  });
  expect(sent.ok(), await sent.text()).toBe(true);
  const token = /\/file\/confirm\/([a-f0-9]{64})/.exec(
    linkIn(await lastMessageTo(email, before)),
  )?.[1];
  expect((await anon.post(`/api/reports/confirm/${token ?? ''}`)).ok()).toBe(true);
  await anon.dispose();

  const reporter = await signedIn(playwright, baseURL, email);
  const thread = (
    (await (await reporter.get('/api/mine/reports')).json()) as {
      reports: { thread_id: string }[];
    }
  ).reports[0]?.thread_id;
  if (!thread) throw new Error('the report is not on My reports');
  await page.context().addCookies((await reporter.storageState()).cookies);
  await reporter.dispose();

  // The server's side of this one report, as the page will be told it.
  const state = { files: true, published: 2 };
  const posted: Posted[] = [];
  await page.route(
    (url) => url.pathname === `/api/mine/reports/${thread}`,
    async (route) => {
      const real = await route.fetch();
      const r = (await real.json()) as { permissions: Record<string, boolean> };
      await route.fulfill({
        response: real,
        json: {
          ...r,
          published_files: state.published,
          permissions: { ...r.permissions, attachment_publication: state.files },
        },
      });
    },
  );
  await page.route(
    (url) => url.pathname === `/api/mine/reports/${thread}/permissions`,
    async (route) => {
      const body = route.request().postDataJSON() as Posted;
      posted.push(body);
      if (body.permission === refuse) {
        await route.fulfill({
          status: 409,
          json: { error: { code: 'refused', message: 'That could not be saved. Try again.' } },
        });
        return;
      }
      if (body.permission === 'attachment_publication') {
        state.files = body.granted;
        // Switching off takes them down; switching on publishes nothing.
        if (!body.granted) state.published = 0;
      }
      await route.fulfill({
        json: {
          permissions: {
            contact_passing: body.permission === 'contact_passing' && body.granted,
            attachment_publication: state.files,
            evidence_request: false,
          },
        },
      });
    },
  );
  await page.goto(`/mine/${thread}`);
  const allow = page.getByRole('region', { name: 'What you allow' });
  await expect(allow).toBeVisible();
  return { allow, posted };
}

test('switching off file publication asks first while files are published, and "no" writes nothing', async ({
  page,
  playwright,
}, info) => {
  const { allow, posted } = await myReportWithPublishedFiles(
    page,
    playwright,
    info.project.use.baseURL ?? 'http://127.0.0.1:4173',
  );
  const files = allow.getByRole('checkbox', { name: 'The files I attached may be published' });
  await expect(files).toBeChecked();

  // Asked, and kept: nothing written, the box as it was.
  await files.click();
  const ask = page.getByRole('dialog', { name: 'Take your files down?' });
  await expect(ask).toBeVisible();
  await expect(ask).toContainText('2 of your files are published on this site.');
  await expect(ask).toContainText('takes them down now');
  await expectAccessible(page, 'the take-down question');
  await ask.getByRole('button', { name: 'Leave it on' }).click();
  await expect(ask).toHaveCount(0);
  expect(posted).toEqual([]);
  await expect(files).toBeChecked();

  // Escape is a "no" too.
  await files.click();
  await expect(ask).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(ask).toHaveCount(0);
  expect(posted).toEqual([]);
  await expect(files).toBeChecked();

  // Asked, and agreed: one write, taking it back.
  await files.click();
  await ask.getByRole('button', { name: 'Switch it off' }).click();
  await expect(allow.getByRole('status')).toHaveText('Saved.');
  expect(posted).toEqual([{ permission: 'attachment_publication', granted: false }]);
  await expect(files).not.toBeChecked();

  // With nothing published there is nothing to take down: no question.
  await files.click();
  await expect(files).toBeChecked();
  await files.click();
  await expect(ask).toHaveCount(0);
  await expect(files).not.toBeChecked();
  expect(posted).toEqual([
    { permission: 'attachment_publication', granted: false },
    { permission: 'attachment_publication', granted: true },
    { permission: 'attachment_publication', granted: false },
  ]);
});

test('a write the server refuses leaves the box as it was, and says so', async ({
  page,
  playwright,
}, info) => {
  const { allow, posted } = await myReportWithPublishedFiles(
    page,
    playwright,
    info.project.use.baseURL ?? 'http://127.0.0.1:4173',
    'contact_passing',
  );
  const passing = allow.getByRole('checkbox', { name: /pass my contact details/ });
  await expect(passing).not.toBeChecked();
  await passing.click();
  await expect(allow.getByRole('status')).toHaveText('That could not be saved. Try again.');
  expect(posted).toEqual([{ permission: 'contact_passing', granted: true }]);
  await expect(passing).not.toBeChecked();
  await expect(passing).toBeEnabled();
});
