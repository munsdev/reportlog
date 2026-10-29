/**
 * The Updates screen in a real browser, against the real server. Root's half
 * (deploy/lib.sh) does not run here: the test writes what root would have
 * written into the server's state directory, and reads back the request file
 * the screen made the server write, which is all root ever sees.
 *
 *   - what is installed: version, commit, date and branch;
 *   - Check for update, then Install update, which asks first;
 *   - Roll back only while it can be used, asking first;
 *   - eight presses: the branch selector, and every kept release to go back to;
 *   - no request to another host.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { ADMIN } from './auth.ts';

const STATE = join(
  process.env.REPORTLOG_E2E_COPIES ?? join(tmpdir(), 'reportlog-e2e-copies-missing'),
  'state',
);
const RUNNING = '20261022T100000Z-bbbbbbbbbbbb';
const BEFORE = '20261021T100000Z-cccccccccccc';
const OLDEST = '20261020T100000Z-dddddddddddd';
const TIP = 'a'.repeat(40);

function write(dir: string, files: Record<string, string>) {
  mkdirSync(join(STATE, dir), { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(STATE, dir, name), text);
}

/** What root writes after a deploy and a check. `tip` other than the running commit offers it. */
function server({ tip = 'b'.repeat(40), previous = BEFORE } = {}) {
  for (const d of ['updates', 'installed', 'update-request', 'update-status'])
    rmSync(join(STATE, d), { recursive: true, force: true });
  write('update-request', {});
  write('updates', {
    checked_at: '2026-10-22T11:00:00Z\n',
    ref: 'main\n',
    current: `${'b'.repeat(40)}\n`,
    tip: `${tip}\n`,
    behind: tip === TIP ? '3\n' : '0\n',
    ahead: '0\n',
    'package-tip.json': `{"version":"${tip === TIP ? '0.3.0' : '0.2.0'}"}\n`,
    'package-current.json': '{"version":"0.2.0"}\n',
  });
  write('installed', {
    following: 'main\n',
    current: `${RUNNING}\n`,
    previous: `${previous}\n`,
    releases: [
      `${RUNNING} ${'b'.repeat(40)} main 0.2.0`,
      `${BEFORE} ${'c'.repeat(40)} main 0.1.1`,
      `${OLDEST} ${'d'.repeat(40)} beta 0.1.0`,
      '',
    ].join('\n'),
  });
}

const requested = () => readFileSync(join(STATE, 'update-request', 'request'), 'utf8');

async function open(page: Page) {
  const outside: string[] = [];
  page.on('request', (r) => {
    const host = new URL(r.url()).hostname;
    if (host !== '127.0.0.1' && host !== 'localhost') outside.push(r.url());
  });
  await page.goto('/updates');
  await expect(page.getByRole('heading', { level: 1, name: 'Updates' })).toBeVisible();
  return outside;
}

// One server state directory: these run one at a time, on one project.
test.describe.configure({ mode: 'serial' });
test.use({ storageState: ADMIN });
test.skip(({ isMobile }) => isMobile, 'one state directory, written by one project');

test('says what is installed, and checks with one button', async ({ page }) => {
  server();
  const outside = await open(page);
  await expect(page.getByRole('button', { name: 'v0.2.0' })).toBeVisible();
  await expect(page.getByText('bbbbbbbbbbbb')).toBeVisible();
  await expect(page.getByText('From branch')).toBeVisible();
  await expect(page.getByText('running the newest version on main')).toBeVisible();
  await expect(page.getByRole('combobox')).toHaveCount(0);
  await page.getByRole('button', { name: 'Check for update' }).click();
  await expect(page.getByText('Asked. The server picks it up')).toBeVisible();
  expect(requested()).toBe('action=check\n');
  expect(outside).toEqual([]);
});

test('installs only after the confirmation, naming what', async ({ page }) => {
  server({ tip: TIP });
  await open(page);
  await page.getByRole('button', { name: 'Install update' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('v0.3.0 (aaaaaaaaaaaa) from main');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  expect(() => requested()).toThrow();
  await page.getByRole('button', { name: 'Install update' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Install' }).click();
  await expect(page.getByText('Asked. The server picks it up')).toBeVisible();
  expect(requested()).toBe(`action=apply\nsha=${TIP}\n`);
});

test('rolls back one step, asking first, and hides the button once used', async ({ page }) => {
  server();
  await open(page);
  await page.getByRole('button', { name: 'Roll back to v0.1.1' }).click();
  await expect(page.getByRole('dialog')).toContainText('v0.1.1 (cccccccccccc) from main');
  await page.getByRole('dialog').getByRole('button', { name: 'Roll back' }).click();
  await expect(page.getByText('Asked. The server picks it up')).toBeVisible();
  expect(requested()).toBe('action=rollback\n');
  // Root rolled back: `previous` is now the newer release it left.
  server({ previous: '20261023T100000Z-eeeeeeeeeeee' });
  await page.reload();
  await expect(page.getByRole('button', { name: 'v0.2.0' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Roll back/ })).toHaveCount(0);
});

test('eight presses: a branch selector, and any kept release to go back to', async ({ page }) => {
  server();
  await open(page);
  const version = page.getByRole('button', { name: 'v0.2.0' });
  for (let i = 0; i < 8; i += 1) await version.click();
  await page.getByRole('combobox', { name: /Branch/ }).selectOption('beta');
  await page.getByRole('button', { name: 'Check for update' }).click();
  await expect(page.getByText('Asked. The server picks it up')).toBeVisible();
  expect(requested()).toBe('action=check\nbranch=beta\n');

  rmSync(join(STATE, 'update-request', 'request'));
  await page.reload();
  for (let i = 0; i < 8; i += 1) await page.getByRole('button', { name: 'v0.2.0' }).click();
  await page.getByRole('combobox', { name: /Release/ }).selectOption(OLDEST);
  await page.getByRole('button', { name: 'Roll back', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('v0.1.0 (dddddddddddd) from beta');
  await page.getByRole('dialog').getByRole('button', { name: 'Roll back' }).click();
  await expect(page.getByText('Asked. The server picks it up')).toBeVisible();
  expect(requested()).toBe(`action=rollback\nrelease=${OLDEST}\n`);
});
