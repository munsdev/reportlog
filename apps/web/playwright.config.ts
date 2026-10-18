/**
 * The browser suite: the real server against a real database, and the built
 * website in front of it. `e2e/global-setup.ts` files demo reports first.
 *
 * Expects DATABASE_URL to name a migrated database (CI creates one; locally,
 * `pnpm --filter @reportlog/api db:migrate`). Set CHROMIUM_PATH to use an
 * already-installed Chromium instead of the build Playwright downloads.
 */
import { defineConfig, devices } from '@playwright/test';

const chromium = process.env.CHROMIUM_PATH;

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
      use: {
        ...devices['Desktop Chrome'],
        ...(chromium ? { launchOptions: { executablePath: chromium } } : {}),
      },
    },
    {
      name: 'phone',
      use: {
        ...devices['Pixel 7'],
        ...(chromium ? { launchOptions: { executablePath: chromium } } : {}),
      },
    },
  ],
  webServer: [
    {
      command: 'node --env-file-if-exists=../../.env ../api/src/server.ts',
      url: 'http://127.0.0.1:3000/api/health',
      reuseExistingServer: !process.env.CI,
      env: { PORT: '3000', LOG_LEVEL: 'warn' },
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
