/**
 * Sign an administrator in once, the way a person would (a code read from
 * the email the server wrote), and keep the session for the staff screens'
 * tests (`test.use({ storageState: ADMIN })`).
 */
import { test as setup } from '@playwright/test';
import { ADMIN } from './auth.ts';
import { codeIn, countTo, identityState, lastMessageTo } from './identity/mail.ts';

setup('sign in as an administrator', async ({ request }) => {
  const email = `e2e-admin-${Date.now().toString(36)}@example.org`;
  identityState('seat', email, 'admin');
  const before = countTo(email);
  const asked = await request.post('/api/auth/code', { data: { email } });
  if (!asked.ok()) throw new Error(`asking for a code failed: ${await asked.text()}`);
  const code = codeIn(await lastMessageTo(email, before));
  const signed = await request.post('/api/auth/sign-in', { data: { email, code } });
  if (!signed.ok()) throw new Error(`signing in failed: ${await signed.text()}`);
  await request.storageState({ path: ADMIN });
});
