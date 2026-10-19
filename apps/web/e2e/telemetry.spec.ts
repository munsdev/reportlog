/**
 * Error tracking, end to end: an error in a visitor's browser reaches Bugsink
 * (a stand-in, apps/api/test/stand-in-bugsink.ts) through this site's relay
 * alone, and carries neither the page's address nor the visitor's.
 */
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { BUGSINK_RECEIVED } from './bugsink.ts';

const TOKEN = 'k3Jd9QwPz7XvB2nM8rT5yL1aF4hS6uE0';

interface Received {
  path: string;
  headers: Record<string, string>;
  body: string;
  items: unknown[];
}

function received(): Received[] {
  return readFileSync(BUGSINK_RECEIVED, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Received);
}

test('an error in the browser reaches Bugsink through this site alone, carrying no address', async ({
  page,
}, info) => {
  const outside: string[] = [];
  page.on('request', (r) => {
    const host = new URL(r.url()).hostname;
    if (host !== '127.0.0.1' && host !== 'localhost') outside.push(r.url());
  });
  // Words, not one long run of letters and digits, which would be scrubbed as a token.
  const marker = `boom on ${info.project.name} at ${String(Date.now() % 1_000_000)}`;

  await page.goto(`/verify/RL-NOT-REAL?token=${TOKEN}`);
  await expect(page.getByRole('alert')).toBeVisible();

  const relayed = page.waitForResponse((r) => r.url().endsWith('/api/telemetry/errors'));
  await page.evaluate((m) => {
    setTimeout(() => {
      throw new Error(`${m} on ${window.location.href}`);
    });
  }, marker);
  expect((await relayed).status()).toBe(200);

  let sent: Received | undefined;
  await expect
    .poll(() => (sent = received().find((r) => r.body.includes(marker))), { timeout: 10_000 })
    .toBeTruthy();
  const event = sent?.items[2] as Record<string, unknown>;
  expect(event).toMatchObject({
    platform: 'javascript',
    environment: 'e2e',
    tags: { side: 'website', route: '/verify/$ref' },
    exception: { values: [{ type: 'Error', value: `${marker} on [address]` }] },
  });
  expect(sent?.body).not.toContain(TOKEN);
  expect(sent?.body).not.toContain('4173');
  for (const key of ['request', 'user', 'breadcrumbs'])
    expect(Object.keys(event)).not.toContain(key);
  expect(Object.keys(sent?.headers ?? {})).not.toContain('x-forwarded-for');

  // The refusal the page showed (no such report) was not reported as an error.
  expect(received().filter((r) => r.body.includes('There is no report'))).toEqual([]);
  expect(outside).toEqual([]);
});
