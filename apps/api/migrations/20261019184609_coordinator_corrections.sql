-- ════════════════════════════════════════════════════════════════════════
-- Correcting a coordinator-filed report, as the coordinator's own act
-- (workstream C2; the design is in docs/status/C2-filing.md).
--
-- The correction itself is a new row in `reports`, sealed like any other.
-- This table is the bookkeeping OUTSIDE the seal: who corrected it, for
-- which organization, and why. It is not `reporter_actions`, on purpose:
-- that table is what the reporter did, and a coordinator's correction
-- written there would read as theirs.
--
-- APPEND-ONLY. Nothing here is read into a sealed object.
-- ════════════════════════════════════════════════════════════════════════
CREATE TABLE coordinator_actions (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  thread_id       uuid NOT NULL REFERENCES report_heads (thread_id),
  action          text NOT NULL CHECK (action IN ('correct')),
  report_id       bigint NOT NULL UNIQUE REFERENCES reports (id),
  coordinator_id  bigint NOT NULL REFERENCES users (id),
  organization_id bigint NOT NULL REFERENCES organizations (id),
  comment         text NOT NULL CHECK (length(btrim(comment)) > 0),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX coordinator_actions_thread_idx ON coordinator_actions (thread_id, id);
CREATE TRIGGER coordinator_actions_append_only BEFORE UPDATE OR DELETE ON coordinator_actions
  FOR EACH ROW EXECUTE FUNCTION reject_modification();
CREATE TRIGGER coordinator_actions_no_truncate BEFORE TRUNCATE ON coordinator_actions
  FOR EACH STATEMENT EXECUTE FUNCTION reject_modification();
