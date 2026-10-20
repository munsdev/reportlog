/**
 * The browser suite: the real server against a real database, and the built
 * website in front of it. `e2e/global-setup.ts` files demo reports first.
 *
 * `pnpm --filter @reportlog/web e2e` runs it against a database made for the
 * run and dropped after (apps/api/src/dev/with-fresh-db.ts). Run
 * `playwright test` directly only against a database you mean to fill. Set CHROMIUM_PATH to use an
 * already-installed Chromium instead of the build Playwright downloads.
 */
import { defineConfig, devices } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUGSINK_PORT, BUGSINK_RECEIVED } from './e2e/bugsink.ts';

const chromium = process.env.CHROMIUM_PATH;
// Where the server writes the email it would have sent, so a test can read a
// sign-in code or follow an invitation link the way a person would
// (e2e/identity/mail.ts reads it).
const OUTBOX = fileURLToPath(new URL('./e2e/.outbox/', import.meta.url));
// Where the test server keeps files (files workstream).
const FILES = fileURLToPath(new URL('./e2e/.files/', import.meta.url));
// Where the owner's backups and exports are written (Q2). Outside the
// repository: the server refuses a backup folder inside its own code.
const COPIES = join(tmpdir(), `reportlog-e2e-copies-${String(process.pid)}`);
// Error tracking is ON for the whole run, against a stand-in for Bugsink
// (e2e/telemetry.spec.ts), so every page's no-third-party check runs with it on.

export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/global-setup.ts',
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      // Signs an administrator in for the staff screens' tests.
      name: 'staff-setup',
      testMatch: /staff\.setup\.ts$/,
    },
    {
      name: 'chromium',
      testIgnore:
        /(identity|behind-password|files-door|doors|board-locked|board-maps|owner|in-front)\//,
      dependencies: ['staff-setup'],
      use: {
        ...devices['Desktop Chrome'],
        ...(chromium ? { launchOptions: { executablePath: chromium } } : {}),
      },
    },
    {
      name: 'phone',
      testIgnore:
        /(identity|behind-password|files-door|doors|board-locked|board-maps|owner|in-front)\//,
      dependencies: ['staff-setup'],
      use: {
        ...devices['Pixel 7'],
        ...(chromium ? { launchOptions: { executablePath: chromium } } : {}),
      },
    },
    {
      // Turns the site password on and seats an owner: state the whole site
      // shares. So it runs alone, after the others, and puts it back after.
      name: 'identity',
      testMatch: /identity\/.*\.spec\.ts$/,
      dependencies: ['chromium', 'phone'],
      use: {
        ...devices['Desktop Chrome'],
        ...(chromium ? { launchOptions: { executablePath: chromium } } : {}),
      },
    },
    {
      // Filing behind the site password: it turns the password on too, so it
      // runs alone, after the identity tests have put the site back.
      name: 'behind-password',
      testMatch: /behind-password\/.*\.spec\.ts$/,
      dependencies: ['identity'],
      use: {
        ...devices['Desktop Chrome'],
        ...(chromium ? { launchOptions: { executablePath: chromium } } : {}),
      },
    },
    {
      // Attaching files behind the site password (files workstream). Its own
      // project after the last, for the same reason: the password is the
      // whole site's, and two files turning it on and off would collide.
      name: 'files-behind-password',
      testMatch: /files-door\/.*\.spec\.ts$/,
      dependencies: ['behind-password'],
      use: {
        ...devices['Desktop Chrome'],
        ...(chromium ? { launchOptions: { executablePath: chromium } } : {}),
      },
    },
    {
      // The list and logbook doors with the password on (C3). Alone, for
      // the same reason: the password is the whole site's.
      name: 'doors-behind-password',
      testMatch: /doors\/.*\.spec\.ts$/,
      dependencies: ['files-behind-password'],
      use: {
        ...devices['Desktop Chrome'],
        ...(chromium ? { launchOptions: { executablePath: chromium } } : {}),
      },
    },
    {
      // D3: severity on reports the other projects filed (so it files none,
      // and spends nothing of the per-address filing limit), then the board
      // with the site password on. After C3's doors, never beside them: two
      // projects turning the one password on and off would collide.
      name: 'board-behind-password',
      testMatch: /board-locked\/.*\.spec\.ts$/,
      dependencies: ['doors-behind-password'],
      use: {
        ...devices['Desktop Chrome'],
        ...(chromium ? { launchOptions: { executablePath: chromium } } : {}),
      },
    },
    {
      // P5: a map in each of the board's slots. Alone and last, because a map
      // placed above the report board changes the page the board's other
      // tests read. Files nothing through the filing route.
      name: 'board-maps',
      testMatch: /board-maps\/.*\.spec\.ts$/,
      dependencies: ['board-behind-password'],
      use: {
        ...devices['Desktop Chrome'],
        ...(chromium ? { launchOptions: { executablePath: chromium } } : {}),
      },
    },
    {
      // Q2: the owner's backups and exports. It hands the owner's seat to a
      // test address and back, which the whole site shares, so it runs
      // alone, after the board's projects and before Q1's last one.
      name: 'owner',
      testMatch: /owner\/.*\.spec\.ts$/,
      dependencies: ['board-maps'],
      use: {
        ...devices['Desktop Chrome'],
        ...(chromium ? { launchOptions: { executablePath: chromium } } : {}),
      },
    },
    {
      // Q1: the evidence link and the lock screen with the site password on.
      // Alone and last: it turns on the password, renames the site and shows
      // the development notice, all of which are the whole site's.
      name: 'in-front-of-password',
      testMatch: /in-front\/.*\.spec\.ts$/,
      dependencies: ['owner'],
      use: {
        ...devices['Desktop Chrome'],
        ...(chromium ? { launchOptions: { executablePath: chromium } } : {}),
      },
    },
  ],
  webServer: [
    {
      // A stand-in for Bugsink (apps/api/test/stand-in-bugsink.ts).
      command: `node ../api/test/stand-in-bugsink.ts ${BUGSINK_PORT} ${BUGSINK_RECEIVED}`,
      url: `http://127.0.0.1:${BUGSINK_PORT}/`,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'node --env-file-if-exists=../../.env ../api/src/server.ts',
      url: 'http://127.0.0.1:3000/api/health',
      reuseExistingServer: !process.env.CI,
      env: {
        PORT: '3000',
        LOG_LEVEL: 'warn',
        MAIL_OUTBOX: OUTBOX,
        SITE_ORIGIN: 'http://127.0.0.1:4173',
        // A fixed key for the test server only, so it can take reports.
        CONTACT_KEY: Buffer.alloc(32, 9).toString('base64'),
        // Every test files from 127.0.0.1, and the suite already sends about
        // as many reports as one client may in 15 minutes on a real site.
        FILING_SENDS_PER_CLIENT: '200',
        // Files: a fixed key, a directory of its own, and the media worker
        // inside the server, so an attached photo is really re-encoded.
        FILES_KEY: Buffer.alloc(32, 8).toString('base64'),
        FILES_STORAGE: 'disk',
        FILES_DIR: FILES,
        FILES_INLINE_WORKER: 'true',
        ERROR_TRACKING_DSN: `http://e2e@127.0.0.1:${BUGSINK_PORT}/1`,
        ERROR_TRACKING_ENVIRONMENT: 'e2e',
        BACKUP_DIR: join(COPIES, 'dumps'),
        STATE_DIR: join(COPIES, 'state'),
      },
    },
    {
      // The address the url below waits on. Left to itself, vite preview binds
      // "localhost", which resolves to ::1 alone on some machines (GitHub's
      // runners), and the wait on 127.0.0.1 then times out.
      command: 'pnpm exec vite build && pnpm exec vite preview --strictPort --host 127.0.0.1',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: !process.env.CI,
    },
  ],
});
