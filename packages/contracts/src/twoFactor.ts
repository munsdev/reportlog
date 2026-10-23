/**
 * Two-factor login (plan E, decision E3; session PE1): proving the second
 * factor after the emailed code, setting one up, the step-up before a
 * listed action, and the owner resetting somebody's.
 *
 * Passkey options and responses are WebAuthn's own JSON, passed between
 * @simplewebauthn/browser and @simplewebauthn/server untouched. They are
 * loose objects here on purpose: the library checks them, and a schema that
 * restated WebAuthn would only strip a field a browser added.
 */
import { z } from 'zod';
import { Me } from './identity.ts';
import { defineRoute } from './route.ts';

const Ok = z.object({ ok: z.literal(true) });
const Iso = z.string();

/** A code typed by a person: six digits from an app, or a recovery code. */
const Code = z.object({ code: z.string().max(40) });

const PasskeyOptions = z.looseObject({ challenge: z.string() });
const PasskeyResponse = z.looseObject({ id: z.string().max(1400), type: z.string().max(40) });

export const SecondFactorStatus = z.object({
  state: z.enum(['not-needed', 'optional', 'set-up', 'verify', 'done']),
  /** Whether this server can hold an authenticator app's secret (TWO_FACTOR_KEY). */
  totpAvailable: z.boolean(),
  totp: z.boolean(),
  passkeys: z.array(
    z.object({
      id: z.number().int(),
      name: z.string(),
      created_at: Iso,
      last_used_at: Iso.nullable(),
    }),
  ),
  recoveryLeft: z.number().int(),
  /** Too many wrong codes: codes are refused until then. A passkey still works. */
  lockedUntil: Iso.nullable(),
  stepUpUntil: Iso.nullable(),
});
export type SecondFactorStatus = z.infer<typeof SecondFactorStatus>;

/** Shown once, when the first factor is set up or when they are made again. */
const RecoveryCodes = z.object({ recoveryCodes: z.array(z.string()).nullable() });

export const getSecondFactor = defineRoute({
  method: 'GET',
  path: '/api/auth/second-factor',
  summary: 'What second factor this account has, and what this session has proved.',
  response: SecondFactorStatus,
});

// ── proving it ──────────────────────────────────────────────────────────

export const verifySecondFactor = defineRoute({
  method: 'POST',
  path: '/api/auth/second-factor/verify',
  summary:
    'An authenticator code or a recovery code. Finishes signing in, or, in a session that already has, is a step-up for five minutes.',
  body: Code,
  response: Me,
});

export const passkeyChallenge = defineRoute({
  method: 'POST',
  path: '/api/auth/second-factor/passkey/challenge',
  summary: "A challenge for one of this account's passkeys.",
  response: PasskeyOptions,
});

export const verifyPasskey = defineRoute({
  method: 'POST',
  path: '/api/auth/second-factor/passkey',
  summary: 'Answer the challenge with a passkey: finishes signing in, or is a step-up.',
  body: z.object({ response: PasskeyResponse }),
  response: Me,
});

// ── setting one up ──────────────────────────────────────────────────────

export const beginTotp = defineRoute({
  method: 'POST',
  path: '/api/auth/second-factor/totp/begin',
  summary:
    'A new authenticator-app secret, shown once. It is used only once a code from it is confirmed.',
  response: z.object({ secret: z.string(), uri: z.string() }),
});

export const confirmTotp = defineRoute({
  method: 'POST',
  path: '/api/auth/second-factor/totp/confirm',
  summary: 'A code from the new secret. The first factor set up also gives ten recovery codes.',
  body: Code,
  response: RecoveryCodes,
});

export const removeTotp = defineRoute({
  method: 'DELETE',
  path: '/api/auth/second-factor/totp',
  summary: 'Stop using the authenticator app. Refused if it is the only factor.',
  response: Ok,
});

export const passkeyRegistration = defineRoute({
  method: 'POST',
  path: '/api/auth/second-factor/passkeys/challenge',
  summary: 'Options for making a new passkey.',
  response: PasskeyOptions,
});

export const addPasskey = defineRoute({
  method: 'POST',
  path: '/api/auth/second-factor/passkeys',
  summary: 'Keep a new passkey. The first factor set up also gives ten recovery codes.',
  body: z.object({ name: z.string().max(60), response: PasskeyResponse }),
  response: RecoveryCodes,
});

export const removePasskey = defineRoute({
  method: 'DELETE',
  path: '/api/auth/second-factor/passkeys/:id',
  summary: 'Remove a passkey. Refused if it is the only factor.',
  params: z.object({ id: z.coerce.number().int() }),
  response: Ok,
});

export const newRecoveryCodes = defineRoute({
  method: 'POST',
  path: '/api/auth/second-factor/recovery-codes',
  summary: 'Ten new recovery codes, shown once. The old ones stop working.',
  response: z.object({ recoveryCodes: z.array(z.string()) }),
});

// ── the owner's reset ───────────────────────────────────────────────────

export const resetSecondFactor = defineRoute({
  method: 'POST',
  path: '/api/access/second-factor/reset',
  summary:
    "Clear somebody's second factor and sign them out, so they set one up again. The owner only, never their own (that is `reportlog reset-2fa` on the server).",
  body: z.object({ email: z.string().max(320) }),
  response: Ok,
});
