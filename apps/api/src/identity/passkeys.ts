/**
 * Passkeys (WebAuthn), through @simplewebauthn/server: registering several,
 * and proving one. The library does the cryptography and the checks of
 * origin, relying party and challenge; this file keeps the challenge, the
 * credentials, and the rule that a passkey proves only its own person.
 *
 * THE RELYING PARTY IS SITE_ORIGIN: its host is the RP ID and the origin
 * itself is the only one accepted. A browser will not make a passkey for an
 * IP address, so a development SITE_ORIGIN on 127.0.0.1 is answered as
 * http://localhost on the same port (the browser suite opens that address
 * for its passkey test). No deployment has an address like that.
 */
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.gen.ts';
import { HttpError } from '../http/errors.ts';

export interface RelyingParty {
  id: string;
  origin: string;
  name: string;
}

export function relyingParty(siteOrigin: string): RelyingParty {
  const url = new URL(siteOrigin);
  if (url.hostname === '127.0.0.1' || url.hostname === '[::1]') {
    url.hostname = 'localhost';
  }
  return { id: url.hostname, origin: url.origin, name: url.hostname };
}

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

const passkeyRefused = () =>
  new HttpError(
    400,
    'passkey_refused',
    'That passkey was not accepted. Try again, or use another way to prove it is you.',
  );

async function keepChallenge(
  db: Kysely<DB>,
  sessionHash: string,
  purpose: 'register' | 'authenticate',
  challenge: string,
): Promise<void> {
  const expires = new Date(Date.now() + CHALLENGE_TTL_MS);
  await db
    .insertInto('two_factor_challenges')
    .values({ session_hash: sessionHash, purpose, challenge, expires_at: expires })
    .onConflict((oc) =>
      oc.column('session_hash').doUpdateSet({ purpose, challenge, expires_at: expires }),
    )
    .execute();
}

/** The challenge, spent: each answers one ceremony, right or wrong. */
async function takeChallenge(
  db: Kysely<DB>,
  sessionHash: string,
  purpose: 'register' | 'authenticate',
): Promise<string | null> {
  const row = await db
    .deleteFrom('two_factor_challenges')
    .where('session_hash', '=', sessionHash)
    .where('purpose', '=', purpose)
    .where('expires_at', '>', new Date())
    .returning('challenge')
    .executeTakeFirst();
  return row?.challenge ?? null;
}

async function credentialsOf(db: Kysely<DB>, userId: number) {
  return db
    .selectFrom('two_factor_passkeys')
    .select(['id', 'credential_id', 'public_key', 'counter', 'transports'])
    .where('user_id', '=', userId)
    .execute();
}

export async function registrationOptions(
  db: Kysely<DB>,
  rp: RelyingParty,
  user: { id: number; email: string },
  sessionHash: string,
) {
  const existing = await credentialsOf(db, user.id);
  const options = await generateRegistrationOptions({
    rpName: rp.name,
    rpID: rp.id,
    userName: user.email,
    // An opaque handle, not the address: it is stored on the authenticator.
    userID: new TextEncoder().encode(`reportlog-user-${String(user.id)}`),
    attestationType: 'none',
    excludeCredentials: existing.map((c) => ({ id: c.credential_id, transports: c.transports })),
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
  });
  await keepChallenge(db, sessionHash, 'register', options.challenge);
  return options;
}

export async function finishRegistration(
  db: Kysely<DB>,
  rp: RelyingParty,
  userId: number,
  sessionHash: string,
  response: unknown,
  name: string,
): Promise<void> {
  const challenge = await takeChallenge(db, sessionHash, 'register');
  if (!challenge) throw passkeyRefused();
  let verified;
  try {
    verified = await verifyRegistrationResponse({
      response: response as RegistrationResponseJSON,
      expectedChallenge: challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.id,
      // The passkey is the second factor: presence is needed, a PIN or a
      // fingerprint is welcome but not every security key has one.
      requireUserVerification: false,
    });
  } catch {
    throw passkeyRefused();
  }
  if (!verified.verified) throw passkeyRefused();
  const cred = verified.registrationInfo.credential;
  const inserted = await db
    .insertInto('two_factor_passkeys')
    .values({
      user_id: userId,
      credential_id: cred.id,
      public_key: Buffer.from(cred.publicKey),
      counter: cred.counter,
      transports: (cred.transports ?? []).slice(0, 10),
      name,
    })
    .onConflict((oc) => oc.column('credential_id').doNothing())
    .executeTakeFirst();
  if (inserted.numInsertedOrUpdatedRows !== 1n) throw passkeyRefused();
}

export async function authenticationOptions(
  db: Kysely<DB>,
  rp: RelyingParty,
  userId: number,
  sessionHash: string,
) {
  const existing = await credentialsOf(db, userId);
  if (!existing.length) {
    throw new HttpError(400, 'no_passkey', 'This account has no passkey. Use another way.');
  }
  const options = await generateAuthenticationOptions({
    rpID: rp.id,
    allowCredentials: existing.map((c) => ({ id: c.credential_id, transports: c.transports })),
    userVerification: 'preferred',
  });
  await keepChallenge(db, sessionHash, 'authenticate', options.challenge);
  return options;
}

/** True when the response proves one of THIS person's passkeys. */
export async function finishAuthentication(
  db: Kysely<DB>,
  rp: RelyingParty,
  userId: number,
  sessionHash: string,
  response: unknown,
): Promise<boolean> {
  const challenge = await takeChallenge(db, sessionHash, 'authenticate');
  if (!challenge) return false;
  const id = (response as { id?: unknown } | null)?.id;
  if (typeof id !== 'string') return false;
  // Looked up within the person's own: somebody else's passkey proves
  // nothing here, however valid its signature.
  const cred = (await credentialsOf(db, userId)).find((c) => c.credential_id === id);
  if (!cred) return false;
  let verified;
  try {
    verified = await verifyAuthenticationResponse({
      response: response as AuthenticationResponseJSON,
      expectedChallenge: challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.id,
      credential: {
        id: cred.credential_id,
        publicKey: new Uint8Array(cred.public_key),
        counter: cred.counter,
        transports: cred.transports,
      },
      requireUserVerification: false,
    });
  } catch {
    return false;
  }
  if (!verified.verified) return false;
  // The counter only moves forward (the library refuses one that went
  // back; many passkeys always send 0, which it allows).
  await db
    .updateTable('two_factor_passkeys')
    .set({ counter: verified.authenticationInfo.newCounter, last_used_at: new Date() })
    .where('id', '=', cred.id)
    .execute();
  return true;
}

export async function removePasskey(db: Kysely<DB>, userId: number, id: number): Promise<boolean> {
  const out = await db
    .deleteFrom('two_factor_passkeys')
    .where('id', '=', id)
    .where('user_id', '=', userId)
    .executeTakeFirst();
  return out.numDeletedRows === 1n;
}
