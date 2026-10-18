-- A correction used to silently orphan every file on a report.
--
-- WHAT WAS WRONG, precisely. `attachments.report_id` names ONE version of a
-- report, and every read of a report's files joined it against
-- `report_heads.current_report_id`. A correction mints a new `reports` row
-- and moves the head to it, so from that instant:
--
--   * the public board's file endpoints joined on the new report id, found
--     nothing, and the published photographs vanished from the report;
--   * `manifestFor(newReportId)` returned null, so the new version's hashed
--     object carried no `attachments` key at all — and therefore VERIFIED
--     CLEANLY. Nothing went red. That is why no suite caught it;
--   * the rows and the storage objects survived, keyed to a superseded
--     report id, reachable by nothing.
--
-- A reporter fixing a typo in their own account lost their video, with no
-- warning and no way back, on a deployment whose whole promise is that
-- nothing disappears quietly. `scripts/chain-selftest.mjs` exercised
-- corrections, always on reports with no files.
--
-- WHY A LINK TABLE RATHER THAN COPIED ROWS. The obvious fix is to copy the
-- `attachments` rows for the new version, sharing the storage key so no
-- bytes move. That breaks erasure: crypto-shredding destroys the one data
-- key and deletes the object for ONE attachment row, and a second row
-- sharing that key and object would be left pointing at a deleted file with
-- a live key — an erasure that only half happened, which is the one
-- outcome this archive may never produce.
--
-- So a file stays exactly one row, and which VERSIONS commit to it becomes
-- its own fact. Erasing a file still erases it from every version that ever
-- carried it, which is what erasure has to mean.
--
-- NOTHING HERE CHANGES HOW AN EXISTING REPORT HASHES. The backfill writes
-- one link per existing attachment row, against the version it was already
-- attached to, with the same ordinal. So `manifestFor` returns byte-identical
-- output for every report ever filed, and src/verify.js keeps agreeing with
-- src/reportCore.js. Additive: one new table, one backfill, one column
-- superseded and left in place.

BEGIN;

-- WHICH VERSIONS OF A REPORT COMMIT TO WHICH FILES.
--
-- A correction carries a file forward by writing another row here, pointing
-- the new version at the same attachment. Nothing is copied and nothing
-- moves in storage.
CREATE TABLE report_attachments (
  report_id     bigint NOT NULL REFERENCES reports(id),
  attachment_id bigint NOT NULL REFERENCES attachments(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (report_id, attachment_id)
);

COMMENT ON TABLE report_attachments IS
  'Which versions of a report commit to which files. A correction carries a file forward with another row here rather than a copy of the attachment, so erasing a file erases it from every version. Append-only. Order comes from attachments.ordinal, which is unique within a thread.';

-- Reading a version's files, which is the hot path on the public board.
CREATE INDEX report_attachments_report_idx ON report_attachments (report_id);
-- And the other direction: which versions carry this file. Used by erasure
-- and by anything asking what a correction inherited.
CREATE INDEX report_attachments_attachment_idx ON report_attachments (attachment_id);

-- APPEND-ONLY, like everything else that records what a version said. A
-- version's file list is part of what it committed to and is sealed into its
-- hash; a row that could be edited afterwards would let the manifest and the
-- fingerprint drift apart with nothing to show it.
--
-- Removing a file from a report is therefore a NEW version that does not
-- link it, exactly as removing a sentence is. Taking a published file down
-- is a different act entirely and lives in attachment_heads.publication.
CREATE TRIGGER report_attachments_append_only BEFORE DELETE OR UPDATE ON report_attachments
  FOR EACH ROW EXECUTE FUNCTION reject_modification();

CREATE TRIGGER report_attachments_no_truncate BEFORE TRUNCATE ON report_attachments
  FOR EACH STATEMENT EXECUTE FUNCTION reject_modification();

-- THE BACKFILL. One link per existing attachment, to the version it was
-- already attached to. After this, every read through the link table returns
-- what the old join returned, for every report that already exists.
INSERT INTO report_attachments (report_id, attachment_id)
SELECT a.report_id, a.id FROM attachments a
ON CONFLICT (report_id, attachment_id) DO NOTHING;

-- ORDINALS ARE PER THREAD, NOT PER VERSION, and the index says so now.
-- `promoteSlots` numbered from zero within one report, which was the same
-- thing while a file could only arrive at confirmation. Once a correction
-- can bring files, a second batch starting at zero again would collide with
-- the first inside the same thread and two files would claim one position in
-- the manifest.
--
-- NOT UNIQUE, deliberately. Every deployment today satisfies it, but a
-- UNIQUE index here would turn a future ordering bug into a failed
-- correction — a reporter unable to fix their own account — rather than into
-- a wrong order somebody can see and repair. The code computes the next
-- ordinal from this index; the suite asserts it does.
CREATE INDEX attachments_thread_ordinal_idx ON attachments (thread_id, ordinal);

-- SUPERSEDED, KEPT, AND STILL WRITTEN. It records which version a file first
-- arrived with, which is real information and is what the backfill above
-- read FROM. It is no longer how a version's files are found.
COMMENT ON COLUMN attachments.report_id IS
  'The version this file FIRST arrived with. Not the set of versions that carry it — that is report_attachments, since migration 033. Do not join this against report_heads.current_report_id: a corrected report would appear to have no files.';

COMMIT;
