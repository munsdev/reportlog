-- Plan D, moderation (session 4b): the moderator agreement (M8, generic so
-- journalists reuse it), the rejection notice record (M1, I4), the public
-- form to report illegal content (D1) and the threat-to-life flag (D5).
--
-- Every table here that holds a log is APPEND-ONLY with the trigger pair, as
-- the I4 sweep in invariants.test.ts finds them from the catalogue.

-- ── M8: the agreement a person accepts before they act ──────────────────
-- The wording of an agreement, one row per version, per audience
-- ('moderator' now, 'journalist' in session 5). A new version is a new row;
-- nobody edits the words people already accepted.
-- APPEND-ONLY: the texts are never rewritten or deleted.
CREATE TABLE agreement_texts (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  audience   text NOT NULL CHECK (audience ~ '^[a-z_]{3,32}$'),
  version    integer NOT NULL CHECK (version >= 1),
  body       text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 20000),
  -- What the person accepted, as a fingerprint of the exact words.
  digest     text NOT NULL CHECK (digest ~ '^[0-9a-f]{64}$'),
  created_by text NOT NULL CHECK (length(btrim(created_by)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (audience, version)
);
CREATE TRIGGER agreement_texts_append_only BEFORE UPDATE OR DELETE ON agreement_texts
  FOR EACH ROW EXECUTE FUNCTION reject_modification();
CREATE TRIGGER agreement_texts_no_truncate BEFORE TRUNCATE ON agreement_texts
  FOR EACH STATEMENT EXECUTE FUNCTION reject_modification();

-- Who accepted which text, and when. Whether somebody may act now is a read
-- of this log against the newest text, never a flag that could be left on.
-- APPEND-ONLY: an acceptance is a fact; a new version is accepted again.
CREATE TABLE agreement_acceptances (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  text_id     bigint NOT NULL REFERENCES agreement_texts (id),
  user_email  text NOT NULL CHECK (length(btrim(user_email)) > 0),
  accepted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agreement_acceptances_user_idx ON agreement_acceptances (user_email, text_id);
CREATE TRIGGER agreement_acceptances_append_only BEFORE UPDATE OR DELETE ON agreement_acceptances
  FOR EACH ROW EXECUTE FUNCTION reject_modification();
CREATE TRIGGER agreement_acceptances_no_truncate BEFORE TRUNCATE ON agreement_acceptances
  FOR EACH STATEMENT EXECUTE FUNCTION reject_modification();

-- ── M1, I4: what a decision email did ───────────────────────────────────
-- One row per rejection, saying what happened to the email. 'sent' means the
-- SERVER opened the address to send and nobody read it: it is a different
-- fact from a person opening contact details (contact_access_log), and is
-- kept apart so the two are never mistaken for each other. 'no_key' is a
-- report whose email key was destroyed: nobody can be told, and that is
-- recorded rather than hidden.
-- APPEND-ONLY: a notice is not rewritten.
CREATE TABLE decision_notices (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  thread_id   uuid NOT NULL REFERENCES report_heads (thread_id),
  report_id   bigint NOT NULL REFERENCES reports (id),
  reason_code text NOT NULL CHECK (reason_code ~ '^[a-z_]{3,40}$'),
  outcome     text NOT NULL CHECK (outcome IN ('sent', 'no_key', 'failed', 'not_configured')),
  actor_email text NOT NULL CHECK (length(btrim(actor_email)) > 0),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX decision_notices_thread_idx ON decision_notices (thread_id, id);
CREATE TRIGGER decision_notices_append_only BEFORE UPDATE OR DELETE ON decision_notices
  FOR EACH ROW EXECUTE FUNCTION reject_modification();
CREATE TRIGGER decision_notices_no_truncate BEFORE TRUNCATE ON decision_notices
  FOR EACH STATEMENT EXECUTE FUNCTION reject_modification();

-- ── D1: a public form to report illegal content ─────────────────────────
-- NOT APPEND-ONLY: this row is the notice and its current state, a
-- projection of content_notice_events below, which is the record. The
-- sender's address lives here only until the decision email has gone, then
-- it is blanked: nothing needs it after that.
CREATE TABLE content_notices (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- What the sender is shown and quotes back: a code, not the row number.
  receipt      text NOT NULL UNIQUE CHECK (receipt ~ '^IC-[A-Z2-9]{8}$'),
  -- Secret half of the status link emailed to the sender (hashed).
  token_hash   text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  where_found  text NOT NULL CHECK (length(btrim(where_found)) BETWEEN 1 AND 2000),
  explanation  text NOT NULL CHECK (length(btrim(explanation)) BETWEEN 1 AND 5000),
  good_faith   boolean NOT NULL CHECK (good_faith),
  sender_name  text CHECK (sender_name IS NULL OR length(sender_name) <= 200),
  sender_email text CHECK (sender_email IS NULL OR length(sender_email) <= 320),
  status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'decided')),
  decision     text CHECK (decision IN ('removed', 'restricted', 'no_action')),
  decision_reason text CHECK (decision_reason IS NULL OR length(decision_reason) <= 2000),
  decided_by   text,
  decided_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'decided') = (decision IS NOT NULL)),
  CHECK ((status = 'decided') = (decided_at IS NOT NULL))
);
CREATE INDEX content_notices_open_idx ON content_notices (id) WHERE status = 'open';

-- What happened to a notice, in order. The notice row above is only the
-- latest of this.
-- APPEND-ONLY: a decision is changed by making another one.
CREATE TABLE content_notice_events (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  notice_id  bigint NOT NULL REFERENCES content_notices (id),
  action     text NOT NULL CHECK (action IN ('received', 'receipt_sent', 'decided', 'decision_sent', 'email_failed')),
  actor      text NOT NULL CHECK (length(btrim(actor)) > 0),
  detail     text CHECK (detail IS NULL OR length(detail) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX content_notice_events_notice_idx ON content_notice_events (notice_id, id);
CREATE TRIGGER content_notice_events_append_only BEFORE UPDATE OR DELETE ON content_notice_events
  FOR EACH ROW EXECUTE FUNCTION reject_modification();
CREATE TRIGGER content_notice_events_no_truncate BEFORE TRUNCATE ON content_notice_events
  FOR EACH STATEMENT EXECUTE FUNCTION reject_modification();

-- ── D5: a threat to life or safety ──────────────────────────────────────
-- Raised by a moderator on a report or a tip; the owner is emailed at once.
-- Its own flag, NOT the moderator severity: severity is never sealed and any
-- moderator sets it quietly, while this one wakes the owner and is a record.
-- A flag is cleared by a later row, never by editing this one.
-- APPEND-ONLY: raising, clearing and the email's outcome are all rows.
CREATE TABLE threat_events (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  subject_kind text NOT NULL CHECK (subject_kind IN ('report', 'tip')),
  -- A report's thread id, or a tip's entry id, as text.
  subject_ref  text NOT NULL CHECK (length(btrim(subject_ref)) BETWEEN 1 AND 64),
  action       text NOT NULL CHECK (action IN ('raise', 'clear', 'owner_emailed', 'owner_email_failed')),
  actor_email  text NOT NULL CHECK (length(btrim(actor_email)) > 0),
  note         text CHECK (note IS NULL OR length(note) <= 1000),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (action NOT IN ('raise', 'clear') OR note IS NOT NULL)
);
CREATE INDEX threat_events_subject_idx ON threat_events (subject_kind, subject_ref, id);
CREATE TRIGGER threat_events_append_only BEFORE UPDATE OR DELETE ON threat_events
  FOR EACH ROW EXECUTE FUNCTION reject_modification();
CREATE TRIGGER threat_events_no_truncate BEFORE TRUNCATE ON threat_events
  FOR EACH STATEMENT EXECUTE FUNCTION reject_modification();
