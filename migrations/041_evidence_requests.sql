-- Asking a reporter for the evidence they said they had.
--
-- THE DECLARATION AND THE PERMISSION ARE ALREADY SEPARATE (037, and
-- src/evidence.js). This is the third piece: the act of asking, and the
-- scoped one-time door the reporter walks through to answer.
--
-- WHY A TABLE AND NOT AN EMAIL. An email asking somebody to reply with
-- attachments puts evidence in a mailbox, strips nothing, scans nothing,
-- and lands it somewhere this archive cannot seal, hash or shred. The
-- reporter needs a link back into the same upload path everybody else
-- uses, and that link needs to be scoped to one report, usable once, and
-- to stop working — which is a row.
--
-- WHAT THE LINK MAY DO IS DELIBERATELY NARROW. It authorises uploading
-- files to ONE thread and nothing else. It cannot change an answer, cannot
-- withdraw a report, cannot read anybody's details, and cannot be pointed
-- at another thread. A reporter who has lost their sign-in still needs to
-- be able to answer, so it stands on its own — which is exactly why it has
-- to be narrow.
--
-- THE PERMISSION IS THE CEILING, READ AT USE AND NOT AT ISSUE. A link
-- minted while the permission stood must stop working the moment it is
-- taken back. That is the same rule src/renditions.js follows for
-- publication: the grant is read at the moment it is acted on, never
-- trusted from earlier. Enforced in src/evidenceRequests.js, not here,
-- because the log it has to consult is a projection.
--
-- NOTHING HERE IS HASHED. The request is correspondence about a report,
-- not part of it. What the reporter eventually sends IS hashed — it
-- arrives as a new version of the report, through the same append-only
-- path a correction takes, with the files in its manifest.
--
-- Additive. One new table.

BEGIN;

CREATE TABLE IF NOT EXISTS evidence_requests (
  id            bigserial PRIMARY KEY,
  thread_id     uuid NOT NULL,

  -- WHO ASKED, by email. Named rather than anonymous because a reporter
  -- receiving an unexpected request for photographs is entitled to know a
  -- person asked, and because an archive that cannot say who asked cannot
  -- answer for having asked.
  asked_by      text NOT NULL,
  asked_at      timestamptz NOT NULL DEFAULT now(),

  -- WHAT WAS ASKED FOR, in the moderator's own words, shown to the
  -- reporter verbatim. Plain text and escaped on the way out: the same
  -- reasoning as the editorial note, where an HTML sanitiser was judged a
  -- dependency this application should not take on.
  message       text NOT NULL,

  -- THE DOOR. Hashed, never stored in the clear, so a reader of this table
  -- holds no working links — only the reporter's mail has the token.
  --
  -- THIS IS A DEPARTURE, AND IT IS WORTH SAYING SO RATHER THAN IMPLYING
  -- IT IS HOUSE STYLE. Nothing else here does this:
  -- `report_submission_tokens.token` and `attachment_view_grants.token`
  -- are both stored in the clear. Those two are defensible on their own
  -- terms — a submission token confirms an unfiled draft, and a view grant
  -- is spent by deletion within minutes — but neither reasoning covers a
  -- link that authorises uploading evidence to somebody's report and sits
  -- in a row for days. Starting the better habit on the row that most
  -- needs it beats matching the older ones for consistency's sake.
  token_hash    text NOT NULL,
  expires_at    timestamptz NOT NULL,

  -- USED ONCE. Set when a version of the report is created from it, in the
  -- same transaction, so a link cannot be spent twice by two clicks
  -- arriving together.
  used_at       timestamptz,
  used_report_id bigint REFERENCES reports(id),

  -- WITHDRAWN BY THE PERSON WHO ASKED, which is not the same as expiring
  -- and not the same as the reporter revoking. A moderator who asked by
  -- mistake needs the link to stop working without waiting it out.
  cancelled_at  timestamptz,
  cancelled_by  text,

  CONSTRAINT evidence_requests_message_check CHECK (length(btrim(message)) BETWEEN 10 AND 2000),
  CONSTRAINT evidence_requests_used_check CHECK (
    (used_at IS NULL AND used_report_id IS NULL)
    OR (used_at IS NOT NULL AND used_report_id IS NOT NULL)),
  CONSTRAINT evidence_requests_cancelled_check CHECK (
    (cancelled_at IS NULL AND cancelled_by IS NULL)
    OR (cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS evidence_requests_token_idx
  ON evidence_requests (token_hash);

CREATE INDEX IF NOT EXISTS evidence_requests_thread_idx
  ON evidence_requests (thread_id, asked_at DESC);

-- ONE LIVE REQUEST PER THREAD. Two open links for the same report is two
-- ways to spend one ask, and a reporter who received two mails cannot tell
-- which is current. A moderator wanting to ask again cancels and asks
-- again, which leaves both facts on the record.
--
-- A partial unique index rather than a CHECK, for the same reason the
-- single owner is one (src/roles.js): a CHECK cannot see other rows.
CREATE UNIQUE INDEX IF NOT EXISTS evidence_requests_one_open_idx
  ON evidence_requests (thread_id)
  WHERE used_at IS NULL AND cancelled_at IS NULL;

-- ---------------------------------------------------------------------
-- WHICH REQUEST A STAGED UPLOAD IS ANSWERING.
--
-- The upload path authorises a slot by draft token and reads the
-- per-logbook cap from `upload_slots.logbook_id`, decided by the server
-- from the first slot in the draft (037). A request-answering upload is the
-- same path with a different door, so it needs the same treatment: the
-- request is recorded on the slot, by the server, and the cap that applies
-- is the one belonging to the logbook the thread actually belongs to.
--
-- NULLABLE, because every slot that exists today is an ordinary one.
ALTER TABLE upload_slots ADD COLUMN IF NOT EXISTS evidence_request_id bigint
  REFERENCES evidence_requests(id);

COMMENT ON COLUMN upload_slots.evidence_request_id IS
  'Which evidence request this staged upload is answering, or NULL for an ordinary one during filing. Set by the server from the request token, never from the client, so a slot cannot be moved onto another request.';

CREATE INDEX IF NOT EXISTS upload_slots_evidence_request_idx
  ON upload_slots (evidence_request_id) WHERE evidence_request_id IS NOT NULL;

COMMIT;
