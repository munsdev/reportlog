-- ════════════════════════════════════════════════════════════════════════
-- Files are published per file, by workstream F (attachment_heads).
--
-- D1 first built a per-version "publish this report's files" decision
-- (file_publication_log, 20261019180411_moderation.sql) while F's files did
-- not exist yet. F's per-file publication is the real one: it holds the
-- re-encoded copy, the alt text, and the same ceiling (the reporter's
-- permission, read at the moment of publishing, attachment_heads_guard).
-- Two decisions about the same files could disagree, so D1's goes.
--
-- Nothing here was ever sealed, and the table never left a development
-- database: this branch had not been merged when it was retired.
-- ════════════════════════════════════════════════════════════════════════

DROP TABLE file_publication_log;
DROP FUNCTION file_publication_ceiling();
