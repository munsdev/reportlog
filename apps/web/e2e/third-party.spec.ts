/**
 * NO PAGE ASKS A THIRD PARTY FOR ANYTHING (I1).
 *
 * The root CLAUDE.md asks every new public page for its own no-third-party
 * test. This walks EVERY page the router has instead, read from the route
 * tree the router plugin generates (src/routeTree.gen.ts), so a page added
 * tomorrow is walked without anybody remembering to. Each is opened as a
 * stranger and as an administrator, since staff screens and the signed-in
 * header load differently. The setup wizard, which no address reaches once a
 * site is set up, is opened by answering its status question the way a
 * fresh deployment would.
 *
 * Addresses with a parameter get the demo logbook, a filed report's
 * reference, or a value that names nothing (a page that cannot find what it
 * was asked for still loads its fonts, styles and scripts, which is where a
 * third party would come in).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { ADMIN } from './auth.ts';
import { codeIn, countTo, lastMessageTo, linkIn } from './identity/mail.ts';
import { doorFields } from './door.ts';
import { stepUp } from './second-factor.ts';

const refs = JSON.parse(
  readFileSync(fileURLToPath(new URL('./.refs.json', import.meta.url)), 'utf8'),
) as string[];

/** Every page the router knows, as the generated route tree lists them. */
function everyPage(): string[] {
  const tree = readFileSync(
    fileURLToPath(new URL('../src/routeTree.gen.ts', import.meta.url)),
    'utf8',
  );
  const block = /fullPaths:\s*((?:\|\s*'[^']*'\s*)+)/.exec(tree)?.[1] ?? '';
  return [...block.matchAll(/'([^']*)'/g)].map((m) => m[1] ?? '');
}

/** A value for each parameter name the routes use. A new name fails loudly here. */
const PARAMS: Record<string, string> = {
  slug: 'demo',
  ref: refs[0] ?? 'RL-NONE',
  token: 'a-token-that-names-nothing',
  threadId: '00000000-0000-4000-8000-000000000000',
  id: '1',
};

function address(path: string): string {
  return path.replace(/\$(\w+)/g, (_m, name: string) => {
    const value = PARAMS[name];
    if (value === undefined) throw new Error(`${path}: give $${name} a value in PARAMS`);
    return value;
  });
}

/** Every request a page makes to a host other than this site's. */
function outsideRequests(page: Page): string[] {
  const outside: string[] = [];
  page.on('request', (r) => {
    const url = new URL(r.url());
    if (url.protocol === 'data:' || url.protocol === 'blob:') return;
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') outside.push(r.url());
  });
  return outside;
}

async function walk(page: Page, path: string) {
  const outside = outsideRequests(page);
  await page.goto(address(path), { waitUntil: 'networkidle' });
  // Something rendered: a page, the lock screen or a "nothing here", each in a <main>.
  await expect(page.locator('main').first()).toBeVisible();
  expect(outside, `${path} asked another host`).toEqual([]);
}

const PAGES = everyPage();

test('the walk has the route tree to walk', () => {
  // A floor, so a change to the generated file's shape cannot empty the walk.
  expect(PAGES.length).toBeGreaterThan(50);
  for (const p of ['/', '/submit', '/file/confirm/$token', '/access/invitation/$token']) {
    expect(PAGES).toContain(p);
  }
});

test.describe('as a stranger', () => {
  for (const path of PAGES) {
    test(`${path} asks no third party for anything`, async ({ page }) => {
      await walk(page, path);
    });
  }

  test('the setup wizard asks no third party for anything', async ({ page }) => {
    const outside = outsideRequests(page);
    await page.route('**/api/setup/status', (route) =>
      route.fulfill({ json: { needed: true, hasOwner: false, minPassword: 8 } }),
    );
    await page.goto('/', { waitUntil: 'networkidle' });
    await expect(
      page.getByRole('heading', { level: 1, name: 'Who will own this deployment?' }),
    ).toBeVisible();
    expect(outside).toEqual([]);
  });
});

test.describe('as an administrator', () => {
  test.use({ storageState: ADMIN });
  for (const path of PAGES) {
    test(`${path} asks no third party for anything`, async ({ page }) => {
      await walk(page, path);
    });
  }
});

/**
 * The pages above that take a `$token` or `$threadId` were walked only in
 * their "names nothing" state. These open the same pages the way their real
 * visitor does, with a link the server emailed and a report the visitor
 * filed, so the screen that does the work (the confirm button, the
 * invitation's terms, the reporter's own report and declaration) is the one
 * listened to. One report per browser project: the per-client filing limit
 * is shared with the rest of the suite.
 */
test.describe('with a real token', () => {
  test('the confirmation page and every /mine/* page ask no third party for anything', async ({
    page,
  }) => {
    const outside = outsideRequests(page);
    const email = `third-party-${Date.now().toString(36)}${String(Math.floor(Math.random() * 1000))}@example.org`;
    const card = (await (await page.request.get('/api/publication-card')).json()) as {
      digest: string;
    };
    let before = countTo(email);
    const sent = await page.request.post('/api/reports', {
      data: {
        ...(await doorFields(page.request)),
        logbook: 'demo',
        email,
        consent: true,
        answers: { what: 'Asked of no third party.' },
        may_publish: false,
        may_publish_digest: card.digest,
      },
    });
    expect(sent.ok(), await sent.text()).toBe(true);
    const link = linkIn(await lastMessageTo(email, before));
    expect(link).toMatch(/\/file\/confirm\/[^/]+$/);

    // Unconfirmed, then filed: both states of the one page.
    await page.goto(link, { waitUntil: 'networkidle' });
    await expect(
      page.getByRole('heading', { level: 1, name: 'Confirm your report' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Confirm and file my report' }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Your report is filed' }),
    ).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(outside, '/file/confirm/$token asked another host').toEqual([]);

    // Signed in as the reporter, the way "My reports" is reached.
    before = countTo(email);
    await page.request.post('/api/auth/code', { data: { email } });
    const code = codeIn(await lastMessageTo(email, before));
    expect((await page.request.post('/api/auth/sign-in', { data: { email, code } })).ok()).toBe(
      true,
    );
    const mine = (await (await page.request.get('/api/mine/reports')).json()) as {
      reports: { thread_id: string; public_ref: string }[];
    };
    const [report] = mine.reports;
    if (!report) throw new Error('the reporter has no report to open');

    const pages = [
      { path: '/mine/', heading: 'My reports' },
      { path: `/mine/${report.thread_id}`, heading: `Report ${report.public_ref}` },
      { path: `/mine/declaration/${report.thread_id}`, heading: 'A signed declaration' },
    ];
    // Every /mine/* page in the route tree is here, so a new one is not
    // left to its "names nothing" state.
    expect(PAGES.filter((p) => p.startsWith('/mine/')).length).toBe(pages.length);
    for (const { path, heading } of pages) {
      await page.goto(path, { waitUntil: 'networkidle' });
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
      expect(outside, `${path} asked another host`).toEqual([]);
    }
  });

  test('an invitation, opened from its email by a stranger, asks no third party for anything', async ({
    browser,
  }) => {
    const staff = await browser.newContext({ storageState: ADMIN });
    const tag = `${Date.now().toString(36)}${String(Math.floor(Math.random() * 1000))}`;
    const org = `Third-party walk ${tag}`;
    const invited = `third-party-invited-${tag}@example.org`;
    // Making an organization and inviting are grants: a step-up first (plan E, E3).
    await stepUp(staff.request);
    const made = await staff.request.post('/api/orgs', {
      data: { name: org, managerEmails: [`third-party-manager-${tag}@example.org`] },
    });
    expect(made.ok(), await made.text()).toBe(true);
    const { organization } = (await made.json()) as { organization: { id: number } };
    const before = countTo(invited);
    const asked = await staff.request.post(`/api/orgs/${String(organization.id)}/invitations`, {
      data: { email: invited, role: 'coordinator' },
    });
    expect(asked.ok(), await asked.text()).toBe(true);
    await staff.close();
    const link = linkIn(await lastMessageTo(invited, before));
    expect(link).toMatch(/\/access\/invitation\/[a-f0-9]{64}$/);

    const stranger = await browser.newContext();
    const page = await stranger.newPage();
    const outside = outsideRequests(page);
    await page.goto(link, { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: `Join ${org} as coordinator` })).toBeVisible();
    expect(outside, '/access/invitation/$token asked another host').toEqual([]);
    await stranger.close();
  });
});
