-- Two gaps the invariant sweep found (P1, apps/api/test/db/invariants.test.ts).
--
-- 1. The feedback tables refused UPDATE and DELETE but not TRUNCATE, which
--    emptied them in one statement. Every other append-only table refuses it.
CREATE TRIGGER feedback_events_no_truncate BEFORE TRUNCATE ON feedback_events
  FOR EACH STATEMENT EXECUTE FUNCTION reject_modification();
CREATE TRIGGER feedback_comments_no_truncate BEFORE TRUNCATE ON feedback_comments
  FOR EACH STATEMENT EXECUTE FUNCTION reject_modification();

-- 2. The core CHECK on a report's third-party provenance is NULL, and so
--    passes, when third_party is NULL and the rest of the block is filled in:
--    "third_party AND ..." is NULL, not false. Such a row would carry a
--    coordinator's provenance that rebuildSealedObject leaves out of the seal,
--    since it adds the block only when third_party is true. normalizeReportFields
--    already refuses it; now the database does too. Added beside the old CHECK
--    rather than replacing it: the migration that made it is never edited.
ALTER TABLE reports ADD CONSTRAINT reports_provenance_needs_flag CHECK (
  third_party IS NOT NULL
  OR (filed_via IS NULL AND intake_method IS NULL AND attested_at IS NULL AND collected_on IS NULL)
);
