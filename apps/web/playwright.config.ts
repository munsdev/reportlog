/**
 * The browser suite: the real server against a real database, and the built
 * website in front of it. `e2e/global-setup.ts` files demo reports first.
 *
 * Expects DATABASE_URL to name a migrated database (CI creates one; locally,
 * `pnpm --filter @reportlog/api db:migrate`). Set CHROMIUM_PATH to use an
 * already-installed Chromium instead of the build Playwright downloads.
 */
import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const chromium = process.env.CHROMIUM_PATH;
// Where the server writes the email it would have sent, so a test can read a
// sign-in code or follow an invitation link the way a person would
// (e2e/identity/mail.ts reads it).
const OUTBOX = fileURLToPath(new URL('./e2e/.outbox/', import.meta.url));

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
      name: 'chromium',
      testIgnore: /identity\//,
      use: {
        ...devices['Desktop Chrome'],
        ...(chromium ? { launchOptions: { executablePath: chromium } } : {}),
      },
    },
    {
      name: 'phone',
      testIgnore: /identity\//,
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
  ],
  webServer: [
    {
      command: 'node --env-file-if-exists=../../.env ../api/src/server.ts',
      url: 'http://127.0.0.1:3000/api/health',
      reuseExistingServer: !process.env.CI,
      env: {
        PORT: '3000',
        LOG_LEVEL: 'warn',
        MAIL_OUTBOX: OUTBOX,
        SITE_ORIGIN: 'http://127.0.0.1:4173',
      },
    },
    {
      command: 'pnpm exec vite build && pnpm exec vite preview --strictPort',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: !process.env.CI,
    },
  ],
});
