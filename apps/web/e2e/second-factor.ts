/**
 * The second factor for the browser suite (plan E, E3): every staff session
 * in it signs in the way a person does, with the emailed code and then a
 * code from an authenticator app, computed here from the secret the server
 * showed when the app was set up.
 *
 * A secret is kept in e2e/.auth/totp/ (ignored by git), keyed by address,
 * because a person is set up in one test file and signs in again in
 * another, in another worker.
 *
 * A code is accepted once, so a second sign-in in the same 30 seconds uses
 * the next step's code (the server accepts one step either side), and after
 * that waits for a step nobody has used.
 */
import { createHmac } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { codeIn, countTo, lastMessageTo } from './identity/mail.ts';

const SECRETS = fileURLToPath(new URL('./.auth/totp/', import.meta.url));

function base32(text: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of text.toUpperCase().replace(/[\s=]/g, '')) {
    value = (value << 5) | alphabet.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** RFC 6238: what an authenticator app shows for this secret, now (or `offsetMs` from now). */
export function totp(secret: string, offsetMs = 0): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor((Date.now() + offsetMs) / 30_000)));
  const mac = createHmac('sha1', base32(secret)).update(counter).digest();
  const at = (mac[mac.length - 1] ?? 0) & 0x0f;
  return String((mac.readUInt32BE(at) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

const file = (email: string) => join(SECRETS, `${email.toLowerCase()}.txt`);

export function rememberSecret(email: string, secret: string): void {
  mkdirSync(SECRETS, { recursive: true });
  writeFileSync(file(email), secret);
}

export function secretOf(email: string): string {
  if (!existsSync(file(email))) throw new Error(`no authenticator app was set up for ${email}`);
  return readFileSync(file(email), 'utf8').trim();
}

/** Prove the factor with a code nobody has used, waiting for the next step if need be. */
async function proveWithCode(request: APIRequestContext, email: string): Promise<void> {
  const secret = secretOf(email);
  let last = '';
  for (let round = 0; round < 3; round += 1) {
    for (const offset of [0, 30_000]) {
      const r = await request.post('/api/auth/second-factor/verify', {
        data: { code: totp(secret, offset) },
      });
      if (r.ok()) return;
      last = await r.text();
      if (r.status() !== 401) throw new Error(`the second factor was refused: ${last}`);
    }
    // Both used already (by another sign-in moments ago): the next step.
    await new Promise((r) => setTimeout(r, 30_000 - (Date.now() % 30_000) + 500));
  }
  throw new Error(`no code was accepted for ${email}: ${last}`);
}

/**
 * After the emailed code: set an authenticator app up if the account has no
 * factor, or prove the one it has. Does nothing for an account with no role.
 */
export async function passSecondFactor(request: APIRequestContext, email: string): Promise<void> {
  const me = (await (await request.get('/api/auth/me')).json()) as { secondFactor?: string };
  if (me.secondFactor === 'set-up') {
    const begun = await request.post('/api/auth/second-factor/totp/begin');
    expect(begun.ok(), await begun.text()).toBe(true);
    const { secret } = (await begun.json()) as { secret: string };
    const done = await request.post('/api/auth/second-factor/totp/confirm', {
      data: { code: totp(secret) },
    });
    expect(done.ok(), await done.text()).toBe(true);
    rememberSecret(email, secret);
  } else if (me.secondFactor === 'verify') {
    await proveWithCode(request, email);
  }
}

/** The emailed code, then the second factor: a staff member signed in as a person would be. */
export async function signInWithSecondFactor(
  request: APIRequestContext,
  email: string,
): Promise<void> {
  const before = countTo(email);
  const asked = await request.post('/api/auth/code', { data: { email } });
  expect(asked.ok(), await asked.text()).toBe(true);
  const code = codeIn(await lastMessageTo(email, before));
  const signed = await request.post('/api/auth/sign-in', { data: { email, code } });
  expect(signed.ok(), await signed.text()).toBe(true);
  await passSecondFactor(request, email);
}

/**
 * A step-up now, for the signed-in session behind `request` (a page's
 * `page.request` shares its cookies): before one of the actions plan E
 * lists, in a test that has no reason to show the dialog.
 */
export async function stepUp(request: APIRequestContext): Promise<void> {
  const me = (await (await request.get('/api/auth/me')).json()) as {
    email?: string;
    stepUpUntil?: string | null;
  };
  if (!me.email) throw new Error('nobody is signed in to step up');
  if (me.stepUpUntil && Date.parse(me.stepUpUntil) - Date.now() > 60_000) return;
  await proveWithCode(request, me.email);
}
