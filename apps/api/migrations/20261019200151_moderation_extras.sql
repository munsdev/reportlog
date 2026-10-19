-- ════════════════════════════════════════════════════════════════════════
-- Moderation extras (workstream D3): severity, incidents, and the rest of
-- the access log.
--
-- NOTHING HERE IS READ INTO A SEALED OBJECT. A report's fingerprint covers
-- what its reporter said, never what a moderator later concluded about it,
-- so severity and incident links live beside the record, not in it, and the
-- seal and chain code can never reach apps/api/src/moderation (a boundary
-- rule says so).
-- ════════════════════════════════════════════════════════════════════════

-- ── a moderator's assessment of a report ────────────────────────────────
-- Two judgements by the people handling a report, both changeable, both
-- recorded in moderation_log (with a reason) in the same transaction as the
-- change:
--
--   severity     how serious a moderator judges it to be. NULL is "nobody
--                has rated it", which is the queue's real backlog, and is
--                different from any rating.
--   incident_id  reports a moderator linked as describing the same
--                real-world incident. Deliberately a moderator's act and
--                never inferred: an automatic clustering mistake would
--                silently overstate corroboration, the number press is most
--                likely to quote.
--
-- Its own table rather than columns on report_heads, so the core table is
-- untouched. No row means neither has been set.
CREATE TABLE report_assessments (
  thread_id   uuid PRIMARY KEY REFERENCES report_heads (thread_id),
  severity    text CHECK (severity IN ('note', 'irregularity', 'serious', 'systemic')),
  incident_id uuid,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX report_assessments_incident_idx ON report_assessments (incident_id)
  WHERE incident_id IS NOT NULL;
-- Cleared by setting NULL, never by deleting: the history is in
-- moderation_log, and a row that vanished would look like one never set.
CREATE TRIGGER report_assessments_no_delete BEFORE DELETE ON report_assessments
  FOR EACH ROW EXECUTE FUNCTION reject_modification();
CREATE TRIGGER report_assessments_no_truncate BEFORE TRUNCATE ON report_assessments
  FOR EACH STATEMENT EXECUTE FUNCTION reject_modification();

ALTER TABLE moderation_log DROP CONSTRAINT moderation_log_action_check;
ALTER TABLE moderation_log ADD CONSTRAINT moderation_log_action_check CHECK (action IN (
  'review', 'withdraw', 'restore', 'reviewed',
  'note', 'note_revised', 'note_state', 'note_link', 'files',
  'severity', 'incident'));

-- ── the rest of what is opened ──────────────────────────────────────────
-- contact_access_log (D1) recorded contact details being opened. Two more
-- looks belong in it, as they did in legacy's access_log:
--
--   contact_used  the server opened a reporter's contact details because a
--                 member of staff asked the reporter for files (the evidence
--                 ask). Nobody on staff saw the address, but it was opened
--                 on their say-so, so the reporter is shown it.
--   file_preview  a member of staff viewed the re-encoded copy of a file
--                 (or a still or page of it). Not a disclosure of anything
--                 the stripped copy no longer carries, but a look at
--                 material that may never be published, so it is recorded
--                 for oversight. The reporter is not shown these: they
--                 would bury the entries that matter.
--
-- Opening a file's ORIGINAL stays where workstream F records it
-- (attachment_events, 'viewed_original'); both views read it from there.
-- Still APPEND-ONLY: the triggers from 20261019180411 are untouched.
ALTER TABLE contact_access_log ADD COLUMN attachment_id bigint REFERENCES attachments (id);

ALTER TABLE contact_access_log DROP CONSTRAINT contact_access_log_kind_check;
ALTER TABLE contact_access_log ADD CONSTRAINT contact_access_log_kind_check
  CHECK (kind IN ('contact', 'audit_log', 'contact_used', 'file_preview'));

-- Every look is at one report; only a read of the log itself is not.
ALTER TABLE contact_access_log DROP CONSTRAINT contact_access_log_check;
ALTER TABLE contact_access_log ADD CONSTRAINT contact_access_log_thread_check
  CHECK ((kind = 'audit_log') = (thread_id IS NULL));
ALTER TABLE contact_access_log ADD CONSTRAINT contact_access_log_report_check
  CHECK (kind = 'audit_log' OR report_id IS NOT NULL);
-- A preview names its file, and nothing else names one.
ALTER TABLE contact_access_log ADD CONSTRAINT contact_access_log_attachment_check
  CHECK ((kind = 'file_preview') = (attachment_id IS NOT NULL));
-- contact_access_log_check1 (a contact opening carries a reason) stays.

CREATE INDEX contact_access_log_preview_idx ON contact_access_log (attachment_id, staff_email, accessed_at DESC)
  WHERE kind = 'file_preview';
