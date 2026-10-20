-- Decision 34: downloading a logbook's COMPLETE chain file is recorded in the
-- access log. The file holds every version's sealed answers, published or
-- not, so a download is a look at unpublished material in bulk.
--
-- A download is of a logbook, not of one report, so it names the logbook and
-- no thread or report. Every other kind keeps exactly the guards it had: the
-- thread and report checks are widened by this one kind and nothing else.
-- Still APPEND-ONLY: the triggers from 20261019180411 are untouched.
ALTER TABLE contact_access_log ADD COLUMN logbook_id bigint REFERENCES logbooks (id);

ALTER TABLE contact_access_log DROP CONSTRAINT contact_access_log_kind_check;
ALTER TABLE contact_access_log ADD CONSTRAINT contact_access_log_kind_check
  CHECK (kind IN ('contact', 'audit_log', 'contact_used', 'file_preview', 'chain_file'));

ALTER TABLE contact_access_log DROP CONSTRAINT contact_access_log_thread_check;
ALTER TABLE contact_access_log ADD CONSTRAINT contact_access_log_thread_check
  CHECK ((kind IN ('audit_log', 'chain_file')) = (thread_id IS NULL));
ALTER TABLE contact_access_log DROP CONSTRAINT contact_access_log_report_check;
ALTER TABLE contact_access_log ADD CONSTRAINT contact_access_log_report_check
  CHECK (kind IN ('audit_log', 'chain_file') OR report_id IS NOT NULL);
-- A chain-file download names its logbook, and nothing else names one.
ALTER TABLE contact_access_log ADD CONSTRAINT contact_access_log_logbook_check
  CHECK ((kind = 'chain_file') = (logbook_id IS NOT NULL));
