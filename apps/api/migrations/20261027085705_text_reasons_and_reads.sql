-- N2: a reason on every decision about a written account or link, and a log
-- entry every time staff open one to read it.
--
-- ADDITIVE ONLY. Two nullable columns on append-only history tables, one
-- nullable column and a widened kind list on contact_access_log (the same
-- kind of change 20261027071500 made). No existing row is touched.
--
-- `reason` is INTERNAL: written with who and when in the history, shown to
-- moderators, administrators and the owner, and selected by no reporter or
-- journalist route. Old rows have none; the application asks for one on
-- every new decision (10 to 500 characters).
ALTER TABLE text_checks
  ADD COLUMN reason text CHECK (reason IS NULL OR length(btrim(reason)) BETWEEN 10 AND 500);
ALTER TABLE link_checks
  ADD COLUMN reason text CHECK (reason IS NULL OR length(btrim(reason)) BETWEEN 10 AND 500);

-- `text_read`: staff pressed "Show the written account" (or the link). It is
-- written BEFORE the value is decrypted. `read_ref` names what was opened
-- (report-12, tip-3-describe, link-9), and no typed reason is asked for. A
-- tip's reading has no thread and no report.
ALTER TABLE contact_access_log ADD COLUMN read_ref text
  CHECK (read_ref IS NULL OR read_ref ~ '^(report|tip|link)-[0-9]+(-[a-z0-9_]+)?$');

ALTER TABLE contact_access_log DROP CONSTRAINT contact_access_log_kind_check;
ALTER TABLE contact_access_log ADD CONSTRAINT contact_access_log_kind_check
  CHECK (kind IN ('contact', 'audit_log', 'contact_used', 'file_preview', 'chain_file',
                  'desk_link', 'desk_report', 'desk_text', 'desk_tip_text', 'text_read'));
ALTER TABLE contact_access_log DROP CONSTRAINT contact_access_log_thread_check;
ALTER TABLE contact_access_log ADD CONSTRAINT contact_access_log_thread_check
  CHECK (kind = 'text_read'
         OR (kind IN ('audit_log', 'chain_file', 'desk_link', 'desk_tip_text')) = (thread_id IS NULL));
ALTER TABLE contact_access_log DROP CONSTRAINT contact_access_log_report_check;
ALTER TABLE contact_access_log ADD CONSTRAINT contact_access_log_report_check
  CHECK (kind IN ('audit_log', 'chain_file', 'desk_link', 'desk_tip_text', 'text_read')
         OR report_id IS NOT NULL);
ALTER TABLE contact_access_log ADD CONSTRAINT contact_access_log_read_pair_check
  CHECK ((kind = 'text_read') = (read_ref IS NOT NULL));
