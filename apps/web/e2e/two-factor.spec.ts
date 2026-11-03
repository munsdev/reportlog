/**
 * Two-factor login in a real browser against the real server (plan E,
 * decision E3; session PE1).
 *
 *   - a moderator signs in with the emailed code, is sent to set a second
 *     factor up, sets up an authenticator app (its codes computed here from
 *     the key the page shows), keeps the recovery codes, and signs in again
 *     with a code from it;
 *   - an administrator meets the step-up dialog before granting a role;
 *   - a passkey, made and used with Chromium's virtual authenticator;
 *   - every screen of it passes axe, and asks no other host for anything.
 */
import { expect, test } from '@playwright/test';
import type { CDPSession, Page } from '@playwright/test';
import { axe, describeViolation } from './a11y.ts';
import { codeIn, countTo, identityState, lastMessageTo } from './identity/mail.ts';
import { signOut } from './menu.ts';
import { rememberSecret, totp } from './second-factor.ts';

const run = `${Date.now().toString(36)}${String(Math.floor(Math.random() * 1e4))}`;

async function noViolations(page: Page) {
  const found = await axe(page);
  expect(found.violations.map(describeViolation)).toEqual([]);
}

/** Every request a page makes, to anywhere but this site. */
function watchOutside(page: Page): string[] {
  const outside: string[] = [];
  page.on('request', (r) => {
    const host = new URL(r.url()).hostname;
    if (host !== '127.0.0.1' && host !== 'localhost') outside.push(r.url());
  });
  return outside;
}

async function emailCode(page: Page, email: string) {
  await page.goto('/access/sign-in');
  const before = countTo(email);
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByRole('button', { name: 'Send code' }).click();
  await page.getByLabel('The code from the email').fill(codeIn(await lastMessageTo(email, before)));
  await page.getByRole('button', { name: 'Sign in' }).click();
}

/** The authenticator app, set up as a person would: the key read off the page. */
async function setUpApp(page: Page, email: string): Promise<string> {
  await expect(page.getByRole('heading', { name: 'Set up a second way to sign in' })).toBeVisible();
  await page.getByRole('radio', { name: 'An authenticator app' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(
    page.getByRole('img', { name: 'QR code to add this site to your authenticator app' }),
  ).toBeVisible();
  const secret = ((await page.getByTestId('totp-secret').textContent()) ?? '').replace(/\s/g, '');
  rememberSecret(email, secret);
  await page.getByLabel('The six-digit code the app shows now').fill(totp(secret));
  await page.getByRole('button', { name: 'Turn it on' }).click();
  await expect(page.getByRole('heading', { name: 'Your recovery codes' })).toBeVisible();
  await page.getByRole('button', { name: 'I have kept them' }).click();
  return secret;
}

test('a moderator sets up an authenticator app, keeps the recovery codes, and signs in with it', async ({
  page,
}, info) => {
  const email = `2fa-mod-${info.project.name}-${run}@example.org`;
  identityState('seat', email, 'moderator');
  const outside = watchOutside(page);

  await emailCode(page, email);
  // The email code alone opens nothing behind the role.
  await expect(page.getByRole('heading', { name: 'Set up a second way to sign in' })).toBeVisible();
  await noViolations(page);
  const me = (await (await page.request.get('/api/auth/me')).json()) as Record<string, unknown>;
  expect(me).toMatchObject({ roles: [], heldRoles: ['moderator'], secondFactor: 'set-up' });
  expect((await page.request.get('/api/moderation/reports')).status()).toBe(403);

  await page.getByRole('radio', { name: 'An authenticator app' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  const qr = page.getByRole('img', { name: 'QR code to add this site to your authenticator app' });
  await expect(qr).toBeVisible();
  await noViolations(page);
  const secret = ((await page.getByTestId('totp-secret').textContent()) ?? '').replace(/\s/g, '');
  expect(secret).toMatch(/^[A-Z2-7]{32}$/);
  rememberSecret(email, secret);

  // A wrong code is refused, said, and tied to its field.
  const field = page.getByLabel('The six-digit code the app shows now');
  const right = totp(secret);
  await field.fill(right === '000000' ? '111111' : '000000');
  await page.getByRole('button', { name: 'Turn it on' }).click();
  await expect(page.getByRole('alert')).toContainText('That code does not match');
  await expect(field).toHaveAttribute('aria-invalid', 'true');

  await field.fill(right);
  await page.getByRole('button', { name: 'Turn it on' }).click();
  await expect(page.getByRole('heading', { name: 'Your recovery codes' })).toBeVisible();
  await expect(
    page.getByRole('listitem').filter({ hasText: /^[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$/ }),
  ).toHaveCount(10);
  await noViolations(page);
  await page.getByRole('button', { name: 'I have kept them' }).click();
  await expect(page.getByRole('heading', { name: 'Your recovery codes' })).toHaveCount(0);
  expect(await (await page.request.get('/api/auth/me')).json()).toMatchObject({
    roles: ['moderator'],
    secondFactor: 'done',
  });

  // Signing in again: the emailed code, then a code from the app.
  await signOut(page);
  await emailCode(page, email);
  await expect(page.getByRole('heading', { name: 'One more step' })).toBeVisible();
  await noViolations(page);
  // The code it was set up with is spent; the next step's is not.
  await page.getByLabel('Code from your authenticator app').fill(totp(secret, 30_000));
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'One more step' })).toHaveCount(0);
  expect(await (await page.request.get('/api/auth/me')).json()).toMatchObject({
    roles: ['moderator'],
    secondFactor: 'done',
  });

  // Their own page lists what they have.
  await page.goto('/access/security');
  await expect(page.getByRole('heading', { name: 'Signing in', level: 1 })).toBeVisible();
  await expect(page.getByText('10 recovery codes left.')).toBeVisible();
  await noViolations(page);
  expect(outside).toEqual([]);
});

test('an administrator is asked for the factor again before granting a role', async ({
  page,
}, info) => {
  const email = `2fa-admin-${info.project.name}-${run}@example.org`;
  const subject = `2fa-subject-${info.project.name}-${run}@example.org`;
  identityState('seat', email, 'admin');
  const outside = watchOutside(page);
  await emailCode(page, email);
  const secret = await setUpApp(page, email);

  // Five minutes later, as far as the server knows.
  identityState('stale-step-up', email);
  await page.goto('/access');
  await page.getByLabel('Their email address').fill(subject);
  // A choice tile: a label over a hidden tick box.
  await page
    .locator('label')
    .filter({ has: page.getByRole('checkbox', { name: 'Moderator', exact: true }) })
    .click();
  await page.getByRole('button', { name: 'Give the role' }).click();

  const dialog = page.getByRole('dialog', { name: 'Confirm it is you' });
  await expect(dialog).toBeVisible();
  await noViolations(page);
  // Closed without proving it: refused, and nothing granted.
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('alert')).toContainText('Confirm it is you first');

  await page.getByRole('button', { name: 'Give the role' }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Code from your authenticator app').fill(totp(secret, 30_000));
  await dialog.getByRole('button', { name: 'Confirm' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('status')).toHaveText(`${subject} now holds: Moderator.`);
  expect(outside).toEqual([]);
});

// ── passkeys ──────────────────────────────────────────────────────────────

// A browser makes no passkey for an IP address: the server answers its
// 127.0.0.1 origin as localhost for passkeys (identity/passkeys.ts), so this
// test opens the site there.
const LOCAL = 'http://localhost:4173';

async function virtualAuthenticator(page: Page): Promise<{ cdp: CDPSession; id: string }> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  return { cdp, id: await addAuthenticator(cdp) };
}

/** Another device: an authenticator that holds none of this person's passkeys. */
async function addAuthenticator(cdp: CDPSession): Promise<string> {
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return authenticatorId;
}

test('a passkey, made and then used to sign in', async ({ page }, info) => {
  const email = `2fa-passkey-${info.project.name}-${run}@example.org`;
  identityState('seat', email, 'moderator');
  const outside = watchOutside(page);
  const laptop = await virtualAuthenticator(page);

  const signIn = async () => {
    await page.goto(`${LOCAL}/access/sign-in`);
    const before = countTo(email);
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByRole('button', { name: 'Send code' }).click();
    await page
      .getByLabel('The code from the email')
      .fill(codeIn(await lastMessageTo(email, before)));
    await page.getByRole('button', { name: 'Sign in' }).click();
  };

  await signIn();
  await expect(page.getByRole('heading', { name: 'Set up a second way to sign in' })).toBeVisible();
  await page.getByRole('radio', { name: 'A passkey' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByLabel('A name for this passkey').fill('Test laptop');
  await noViolations(page);
  await page.getByRole('button', { name: 'Add the passkey' }).click();
  await expect(page.getByRole('heading', { name: 'Your recovery codes' })).toBeVisible();
  await page.getByRole('button', { name: 'I have kept them' }).click();
  expect(await (await page.request.get(`${LOCAL}/api/auth/me`)).json()).toMatchObject({
    roles: ['moderator'],
    secondFactor: 'done',
  });

  await signOut(page);
  await signIn();
  await expect(page.getByRole('heading', { name: 'One more step' })).toBeVisible();
  await page.getByRole('button', { name: 'Use a passkey' }).click();
  await expect(page.getByRole('heading', { name: 'One more step' })).toHaveCount(0);
  expect(await (await page.request.get(`${LOCAL}/api/auth/me`)).json()).toMatchObject({
    roles: ['moderator'],
    secondFactor: 'done',
  });

  await page.goto(`${LOCAL}/access/security`);
  // Closed, the panel says how many; open, it names each.
  await expect(page.getByRole('region', { name: 'Passkeys' })).toContainText('1 passkey');
  await page.getByRole('button', { name: 'Change Passkeys' }).click();
  await expect(page.getByText('Test laptop')).toBeVisible();
  // The only way to sign in says why it has no Remove.
  await expect(page.getByText(/This is your only way to sign in/)).toBeVisible();
  await noViolations(page);

  // On a device that does not hold the passkey (the phone, when it was made
  // on a laptop), the browser fails without a reason. The page says what to
  // do instead of "Something went wrong".
  await signOut(page);
  await laptop.cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId: laptop.id });
  await addAuthenticator(laptop.cdp);
  await signIn();
  await expect(page.getByRole('heading', { name: 'One more step' })).toBeVisible();
  await page.getByRole('button', { name: 'Use a passkey' }).click();
  await expect(page.getByRole('alert')).toContainText('This device could not use your passkey');
  await expect(page.getByRole('alert')).toContainText('recovery codes');
  expect(outside).toEqual([]);
});
