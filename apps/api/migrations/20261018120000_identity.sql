-- ════════════════════════════════════════════════════════════════════════
-- Identity and access: who somebody is, what they may do, the record of
-- every time that changed, and the site password in front of all of it.
--
-- The role ceiling itself is decided in @reportlog/access. What is here is
-- what holds even if a path forgets to ask it: exactly one owner, an audit
-- trail that cannot be edited, and a credential that is stored as a hash.
-- ════════════════════════════════════════════════════════════════════════

-- ── people ──────────────────────────────────────────────────────────────
-- Keyed on the address, because that is what a role is granted to: somebody
-- can be made a moderator before they have ever signed in.
CREATE TABLE users (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email      text NOT NULL UNIQUE
               CHECK (email = lower(btrim(email)) AND email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role       text NOT NULL DEFAULT 'user'
               CHECK (role IN ('user', 'moderator', 'access_manager', 'admin', 'owner')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- THERE IS EXACTLY ONE OWNER. A partial unique index rather than a CHECK,
-- because the rule is about the table and not about a row. It enforces
-- "never two"; "never none" is the application's (the seat moves only by a
-- handover that steps the old owner down in the same transaction).
CREATE UNIQUE INDEX users_single_owner_idx ON users ((true)) WHERE role = 'owner';

-- ── one-time codes ──────────────────────────────────────────────────────
-- A code is bound to what it was asked for. `subject_hash` is the sha256 of
-- a purpose-prefixed subject (sign-in, setup, or an owner handover to one
-- named address), so a code minted for one thing never verifies for another.
CREATE TABLE otp_codes (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  subject_hash text NOT NULL CHECK (subject_hash ~ '^[a-f0-9]{64}$'),
  code_hash    text NOT NULL CHECK (code_hash ~ '^[a-f0-9]{64}$'),
  -- Wrong guesses against this subject while the code was live. Six digits
  -- are a million guesses; a handful of tries is all a person needs.
  attempts     integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  expires_at   timestamptz NOT NULL,
  used_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX otp_codes_subject_idx ON otp_codes (subject_hash, created_at DESC);

-- ── sessions ────────────────────────────────────────────────────────────
-- The cookie carries the token; the database keeps only its hash, so a copy
-- of this table signs nobody in.
CREATE TABLE sessions (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  user_id    bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

-- ── organizations ───────────────────────────────────────────────────────
CREATE TABLE organizations (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        text NOT NULL UNIQUE CHECK (length(btrim(name)) BETWEEN 1 AND 160),
  details     text,
  verified_by text NOT NULL,
  verified_at timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE organization_memberships (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id bigint NOT NULL REFERENCES organizations (id),
  user_id         bigint NOT NULL REFERENCES users (id),
  role            text NOT NULL CHECK (role IN ('manager', 'coordinator')),
  joined_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id)
);
CREATE INDEX organization_memberships_user_idx ON organization_memberships (user_id);

-- An invitation is one of three things:
--   awaiting_approval  a manager invited another manager; nobody is emailed
--                      and there is no link until an administrator approves
--   pending            a link is out; it works once, for the named address
--   joins_on_sign_in   an administrator added an address that has no
--                      account yet; it becomes a membership at first sign-in
-- The token is stored as a hash: it is a credential.
CREATE TABLE organization_invites (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id bigint NOT NULL REFERENCES organizations (id),
  email           text NOT NULL CHECK (email = lower(btrim(email))),
  role            text NOT NULL CHECK (role IN ('manager', 'coordinator')),
  status          text NOT NULL CHECK (status IN ('awaiting_approval', 'pending', 'joins_on_sign_in')),
  invited_by      text NOT NULL,
  token_hash      text UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  expires_at      timestamptz,
  last_sent_at    timestamptz,
  approved_by     text,
  approved_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, email),
  -- A link exists exactly when the invitation is pending.
  CHECK ((status = 'pending') = (token_hash IS NOT NULL AND expires_at IS NOT NULL))
);
CREATE INDEX organization_invites_email_idx ON organization_invites (email);

-- Only exists to answer "how many invitations went to this address today".
CREATE TABLE organization_invite_sends (
  id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email   text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX organization_invite_sends_idx ON organization_invite_sends (email, sent_at);

-- ── the audit trail ─────────────────────────────────────────────────────
-- Every change to who may do what. Written in the same transaction as the
-- change itself, by the only module that makes changes. APPEND-ONLY: a trail
-- that can be edited is not evidence of anything.
CREATE TABLE role_audit (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_email     text NOT NULL,
  subject_email   text NOT NULL,
  axis            text NOT NULL CHECK (axis IN ('system', 'owner', 'organization', 'site')),
  action          text NOT NULL CHECK (action IN ('grant', 'revoke', 'change')),
  detail          text NOT NULL,
  organization_id bigint REFERENCES organizations (id),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX role_audit_created_idx ON role_audit (created_at DESC);
CREATE TRIGGER role_audit_append_only BEFORE UPDATE OR DELETE ON role_audit
  FOR EACH ROW EXECUTE FUNCTION reject_modification();
CREATE TRIGGER role_audit_no_truncate BEFORE TRUNCATE ON role_audit
  FOR EACH STATEMENT EXECUTE FUNCTION reject_modification();

-- ── handing the owner's seat on ─────────────────────────────────────────
-- At most one proposal, so the row is keyed on `true`.
CREATE TABLE ownership_transfers (
  id         boolean PRIMARY KEY DEFAULT true CHECK (id),
  from_email text NOT NULL,
  to_email   text NOT NULL CHECK (to_email = lower(btrim(to_email))),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

-- ── the site password ───────────────────────────────────────────────────
-- One row. A MISSING ROW IS READ AS LOCKED by the application, because a
-- missing row once read as "gate off" and ungated a whole deployment with
-- nothing on screen saying so. "Enabled with no password" is open: a gate
-- nobody was given a key to is a locked door, and a fresh install starts
-- there.
CREATE TABLE site_access (
  id                 boolean PRIMARY KEY DEFAULT true CHECK (id),
  enabled            boolean NOT NULL DEFAULT true,
  -- scrypt, as "scrypt$<salt hex>$<hash hex>".
  password_hash      text,
  -- First-run setup is finished when this is set, and only then.
  setup_completed_at timestamptz,
  updated_at         timestamptz NOT NULL DEFAULT now()
);
INSERT INTO site_access (id) VALUES (true);

CREATE TABLE site_access_tokens (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ── doors: a logbook opened for filing without the password ─────────────
-- closed  behind the password like everything else (the default)
-- link    fileable by anybody holding its address
-- door    the same, and offered on the password page
-- Delivery, not meaning: never sealed, so it may change at any time.
ALTER TABLE logbooks
  ADD COLUMN outside_access text NOT NULL DEFAULT 'closed'
    CHECK (outside_access IN ('closed', 'link', 'door'));
