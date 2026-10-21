/**
 * Sign staff in once, the way a person would (a code read from the email the
 * server wrote, then a code from an authenticator app set up on the way:
 * plan E, E3), and keep each session for the staff screens' tests
 * (`test.use({ storageState: ADMIN })`, or `MODERATOR`).
 */
import { test as setup } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { ADMIN, MODERATOR } from './auth.ts';
import { identityState } from './identity/mail.ts';
import { signInWithSecondFactor } from './second-factor.ts';

async function signInAs(request: APIRequestContext, role: string, path: string) {
  const email = `e2e-${role}-${Date.now().toString(36)}@example.org`;
  identityState('seat', email, role);
  await signInWithSecondFactor(request, email);
  await request.storageState({ path });
}

setup('sign in as an administrator', async ({ request }) => {
  await signInAs(request, 'admin', ADMIN);
});

setup('sign in as a moderator', async ({ request }) => {
  await signInAs(request, 'moderator', MODERATOR);
});
