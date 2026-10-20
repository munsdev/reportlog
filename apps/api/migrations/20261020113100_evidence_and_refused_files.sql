-- ════════════════════════════════════════════════════════════════════════
-- Two guards from the files workstream's last piece (docs/parity.md §7 R3).
--
-- 1. An evidence link is spent and names the report it was spent on,
--    together (legacy 041's CHECK, docs/parity.md §5).
--
--    markUsed sets both in one UPDATE, and markLanded only ever moves
--    used_report_id on a link already spent. A row with one and not the
--    other would be a link the door treats as spent that no report answers,
--    or a report that claims a link the door would still open. Neither is
--    possible through the code today; this keeps it so if the code forgets.
--
-- 2. A file that was sent and not accepted leaves a trace a moderator sees
--    (decision 32, as legacy's 'upload_rejected' entries did). An upload slot
--    is working state, swept when it expires, and nothing in it is tied to a
--    report; without this a refused, infected or unreadable file is told to
--    the reporter once and is then nowhere a person looks.
--
--    NOT SEALED, and nothing in the chain reads it: it is a note about an
--    attempt, not part of what the reporter filed. Keyed by thread with no
--    foreign key, because it is written in the same transaction that starts
--    the thread, before its head exists (as attachment_events is).
--    APPEND-ONLY, like every other log here.
-- ════════════════════════════════════════════════════════════════════════
ALTER TABLE evidence_requests
  ADD CONSTRAINT evidence_requests_used_together
  CHECK ((used_at IS NULL) = (used_report_id IS NULL));

CREATE TABLE refused_uploads (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  thread_id  uuid NOT NULL,
  -- The name the reporter's device gave it. Never a path: nothing reads it
  -- as one.
  name       text NOT NULL,
  status     text NOT NULL CHECK (status IN ('rejected', 'infected', 'unreadable')),
  -- The words the reporter was shown after the name.
  reason     text NOT NULL CHECK (length(btrim(reason)) > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refused_uploads_thread_idx ON refused_uploads (thread_id, id);
CREATE TRIGGER refused_uploads_append_only BEFORE UPDATE OR DELETE ON refused_uploads
  FOR EACH ROW EXECUTE FUNCTION reject_modification();
CREATE TRIGGER refused_uploads_no_truncate BEFORE TRUNCATE ON refused_uploads
  FOR EACH STATEMENT EXECUTE FUNCTION reject_modification();

COMMENT ON TABLE refused_uploads IS
  'Files sent with a report (or an intake account, or an evidence answer) and not accepted: refused, infected, unreadable, or dropped by a freeze. For moderators. Never sealed. Append-only.';
