-- Two-factor login (plan E, decision E3; session PE1).
--
-- Every role holder (owner, administrator, access manager, moderator,
-- journalist, and anybody in an organization) proves a second factor after
-- the emailed code: an authenticator app (TOTP) or a passkey (WebAuthn).
-- Plain users and alert subscribers are untouched.
--
-- WHAT IS STORED, AND HOW. A TOTP secret must be read back to check a code,
-- so it is encrypted under TWO_FACTOR_KEY (identity/twoFactorKey.ts), never
-- stored plain. A recovery code only has to be recognised, so it is kept as
-- a hash. A passkey is a public key: nothing here signs anybody in.

-- ── the session's own proof ─────────────────────────────────────────────
-- When this session last proved a second factor, and when it last did so
-- for a step-up (the factor again, good for five minutes, before the few
-- actions on plan-e.md's list). NULL on every existing row: a role holder
-- signed in before this migration is sent to prove one.
ALTER TABLE sessions ADD COLUMN second_factor_at timestamptz;
ALTER TABLE sessions ADD COLUMN step_up_at timestamptz;

-- ── the authenticator app ───────────────────────────────────────────────
-- One per person. `pending_secret_enc` is one being set up: it replaces the
-- confirmed one only when a code from it has been typed, so a person whose
-- new phone never got the secret keeps the old one working.
CREATE TABLE two_factor_totp (
  user_id            bigint PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  secret_enc         bytea CHECK (secret_enc IS NULL OR length(secret_enc) > 28),
  confirmed_at       timestamptz,
  pending_secret_enc bytea CHECK (pending_secret_enc IS NULL OR length(pending_secret_enc) > 28),
  pending_at         timestamptz,
  -- A CODE IS ACCEPTED ONCE: the newest step accepted, and nothing at or
  -- before it is accepted again. Reset when a new secret is confirmed.
  last_step          bigint CHECK (last_step IS NULL OR last_step >= 0),
  CHECK ((secret_enc IS NULL) = (confirmed_at IS NULL)),
  CHECK ((pending_secret_enc IS NULL) = (pending_at IS NULL))
);

-- ── passkeys ────────────────────────────────────────────────────────────
CREATE TABLE two_factor_passkeys (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id       bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- base64url, as the browser and @simplewebauthn name it.
  credential_id text NOT NULL UNIQUE
                  CHECK (credential_id ~ '^[A-Za-z0-9_-]+$' AND length(credential_id) BETWEEN 16 AND 1400),
  public_key    bytea NOT NULL,
  counter       bigint NOT NULL DEFAULT 0 CHECK (counter >= 0),
  transports    text[] NOT NULL DEFAULT '{}' CHECK (cardinality(transports) <= 10),
  name          text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz
);
CREATE INDEX two_factor_passkeys_user_idx ON two_factor_passkeys (user_id);

-- ── recovery codes ──────────────────────────────────────────────────────
-- Ten, shown once, each good once. sha256 of an 80-bit random code: long
-- enough that a copy of this table cannot be searched for them.
CREATE TABLE two_factor_recovery_codes (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  code_hash  text NOT NULL CHECK (code_hash ~ '^[a-f0-9]{64}$'),
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, code_hash)
);

-- ── wrong codes ─────────────────────────────────────────────────────────
-- Per PERSON, not per session: a session costs one emailed code, so a limit
-- per session would be a limit per inbox, and that is no limit. A few wrong
-- codes (an app code or a recovery code) lock the second factor for a
-- while. A passkey is not guessed, so it is not counted.
CREATE TABLE two_factor_attempts (
  user_id      bigint PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  failures     integer NOT NULL DEFAULT 0 CHECK (failures >= 0),
  locked_until timestamptz
);

-- ── passkey ceremonies in flight ────────────────────────────────────────
-- The challenge the server issued to this session, for registering or for
-- signing in with a passkey. One at a time; spent when it is answered.
CREATE TABLE two_factor_challenges (
  session_hash text PRIMARY KEY REFERENCES sessions (token_hash) ON DELETE CASCADE,
  purpose      text NOT NULL CHECK (purpose IN ('register', 'authenticate')),
  challenge    text NOT NULL CHECK (challenge ~ '^[A-Za-z0-9_-]{16,200}$'),
  expires_at   timestamptz NOT NULL
);

-- ── the record ──────────────────────────────────────────────────────────
-- The owner resetting somebody's second factor, and `reportlog reset-2fa`,
-- are recorded in role_audit (append-only already) on an axis of their own.
ALTER TABLE role_audit DROP CONSTRAINT role_audit_axis_check;
ALTER TABLE role_audit ADD CONSTRAINT role_audit_axis_check
  CHECK (axis IN ('system', 'owner', 'organization', 'site', 'flag', 'archive', 'second_factor'));
