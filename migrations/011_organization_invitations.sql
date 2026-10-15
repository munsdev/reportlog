-- Invitations become something a person accepts, rather than something done
-- to them.
--
-- Additive only. Nothing here touches `reports`, so no fingerprint changes
-- and no report needs re-verifying.
--
-- WHAT THIS CHANGES. Until now, adding an address that already had an
-- account attached the membership immediately: the person was in the
-- organization before they knew they had been asked. An address with no
-- account got a row that attached silently the first time they signed in.
-- Neither involved the person agreeing to anything.
--
-- Now every invitation is a single-use link with an expiry, and a
-- membership exists only once somebody has clicked it.
--
-- Rows created the OLD way have a NULL token, and they keep the old
-- behaviour — they still attach on sign-in. There are live invitations in
-- inboxes and in databases, and changing what happens to them retroactively
-- would strand people who were invited under the old rules. New rows carry
-- a token and are never claimed without it.
--
-- `status` exists for one reason: a manager may invite coordinators freely,
-- but inviting another MANAGER is a leadership grant and waits for an admin.
-- Such an invitation is created `awaiting_approval` and NO EMAIL IS SENT
-- until an admin approves it — otherwise the approval would arrive after the
-- person had already been told they were invited.
BEGIN;

ALTER TABLE organization_invites
  ADD COLUMN IF NOT EXISTS token        text,
  ADD COLUMN IF NOT EXISTS expires_at   timestamptz,
  ADD COLUMN IF NOT EXISTS status       text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS last_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by  text,
  ADD COLUMN IF NOT EXISTS approved_at  timestamptz;

-- Partial, because every legacy row has a NULL token and NULL is not
-- unique-constrained the way a value is. The link is the credential; two
-- invitations must never share one.
CREATE UNIQUE INDEX IF NOT EXISTS organization_invites_token_idx
  ON organization_invites (token) WHERE token IS NOT NULL;

CREATE INDEX IF NOT EXISTS organization_invites_expiry_idx
  ON organization_invites (expires_at);

ALTER TABLE organization_invites
  DROP CONSTRAINT IF EXISTS organization_invites_status_check;
ALTER TABLE organization_invites
  ADD CONSTRAINT organization_invites_status_check
  CHECK (status = ANY (ARRAY['pending', 'awaiting_approval']));

COMMENT ON COLUMN organization_invites.token IS
  'Single-use credential in the emailed link. NULL means a row created before invitations were links, which still attaches on sign-in.';
COMMENT ON COLUMN organization_invites.status IS
  'pending = emailed, waiting on the invitee. awaiting_approval = a manager invited another manager; no email has been sent and an admin must approve first.';

-- How many invitations have been sent to an address, so "no more than two a
-- day" can be enforced across organizations rather than within one. Without
-- a decline button and with free-text addresses, an invitation is an
-- unsolicited-mail vector: one manager typing a hundred addresses is a
-- hundred emails to people who never asked, and that is how a sending
-- domain earns a bad reputation.
--
-- Deliberately NOT append-only. It is a rate-limiting ledger, not a record
-- of anything, and it is swept.
CREATE TABLE IF NOT EXISTS organization_invite_sends (
  id      bigserial PRIMARY KEY,
  email   text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS organization_invite_sends_email_idx
  ON organization_invite_sends (email, sent_at);

COMMIT;
