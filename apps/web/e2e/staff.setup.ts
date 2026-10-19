/**
 * Sign staff in once, the way a person would (a code read from the email the
 * server wrote), and keep each session for the staff screens' tests
 * (`test.use({ storageState: ADMIN })`, or `MODERATOR`).
 */
import { test as setup } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { ADMIN, MODERATOR } from './auth.ts';
import { codeIn, countTo, identityState, lastMessageTo } from './identity/mail.ts';

async function signInAs(request: APIRequestContext, role: string, path: string) {
  const email = `e2e-${role}-${Date.now().toString(36)}@example.org`;
  identityState('seat', email, role);
  const before = countTo(email);
  const asked = await request.post('/api/auth/code', { data: { email } });
  if (!asked.ok()) throw new Error(`asking for a code failed: ${await asked.text()}`);
  const code = codeIn(await lastMessageTo(email, before));
  const signed = await request.post('/api/auth/sign-in', { data: { email, code } });
  if (!signed.ok()) throw new Error(`signing in failed: ${await signed.text()}`);
  await request.storageState({ path });
}

setup('sign in as an administrator', async ({ request }) => {
  await signInAs(request, 'admin', ADMIN);
});

setup('sign in as a moderator', async ({ request }) => {
  await signInAs(request, 'moderator', MODERATOR);
});
