-- LOGBOOKS ARE THE ONLY FORMS, AND EACH ONE IS ITS OWN CHAIN.
--
-- Until this migration a report was the software's own questionnaire —
-- where, when, which category, whether the reporter saw it — with a
-- logbook as an optional second way in. Now a report is a logbook's
-- answers and nothing else. What every report carries, however it was
-- filed, is small and fixed: which logbook asked, the answers, whether the
-- reporter permitted publication, and (for a coordinator) where it came
-- from. Everything else is a question some logbook chose to ask.
--
-- THIS IS THE ONE MIGRATION THAT IS NOT ADDITIVE, and it knows it. It drops
-- the questionnaire's columns from `reports`, which changes what a report
-- is. That is safe for exactly one archive: an empty one. So it refuses to
-- run on anything else, before it touches a single table. Nothing already
-- sealed can be reshaped by it.
--
-- Every migration after this one is additive again.

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM reports) THEN
    RAISE EXCEPTION 'Migration 029 changes what a report is, so it only runs on an empty archive. '
      'This one holds reports. If they are test data, reset to a fresh install first '
      '(contrib/reset-to-fresh.sh). If they are real, stop: do not run this.';
  END IF;
END $$;

-- Nothing staged under the old shape may be confirmed into the new one.
DELETE FROM report_submission_tokens;
DELETE FROM intake_drafts;
DELETE FROM intake_batches;

-- THE QUESTIONNAIRE'S COLUMNS. Their checks and indexes go with them.
DROP INDEX IF EXISTS reports_fts_idx;
ALTER TABLE reports
  DROP COLUMN incident_date,
  DROP COLUMN incident_time,
  DROP COLUMN ongoing,
  DROP COLUMN date_approximate,
  DROP COLUMN states,
  DROP COLUMN site_text,
  DROP COLUMN categories,
  DROP COLUMN observer_status,
  DROP COLUMN is_credentialed_observer,
  DROP COLUMN direct_or_secondhand,
  DROP COLUMN source_kind,
  DROP COLUMN source_url,
  DROP COLUMN narrative,
  DROP COLUMN severity;

-- EVERY REPORT IS IN A LOGBOOK, and its chain is that logbook's.
ALTER TABLE reports ALTER COLUMN logbook_id SET NOT NULL;

-- EVERY REPORT WAS ASKED WHETHER IT MAY BE PUBLISHED. "Never asked" existed
-- for reports filed before the question did; there are none now.
ALTER TABLE reports ALTER COLUMN may_publish SET NOT NULL;
ALTER TABLE reports ALTER COLUMN may_publish_digest SET NOT NULL;

-- The head of one logbook's chain is the newest row in that logbook.
CREATE INDEX reports_chain_idx ON reports (logbook_id, id);

-- Searching reads the answers now, every string in them.
CREATE INDEX reports_fts_idx ON reports USING gin (
  (jsonb_to_tsvector('english'::regconfig, coalesce(answers, '{}'::jsonb), '["string"]')
   || to_tsvector('english'::regconfig, public_ref)));

-- THE DAILY TIMESTAMP COVERS EVERY CHAIN AT ONCE.
--
-- One chain used to mean one head, and chain_anchors.root_chain_hash was
-- it. Now each logbook has a head. Each day scripts/anchor.js writes the
-- list of every logbook's head, timestamps the digest of that list (which
-- is what root_chain_hash now holds), and records the list here, one row
-- per logbook. A logbook is checked against its own row; nobody needs the
-- other logbooks to do it.
--
-- ONCE LISTED, ALWAYS LISTED. With separate chains, deleting a whole
-- logbook would leave every other chain intact, and nothing inside them
-- would notice. What notices is this list: a logbook that appeared in a
-- published anchor must appear in every later one. The anchor script
-- refuses to write a list that drops one, and the checker says so.
CREATE TABLE chain_anchor_heads (
  anchor_id       integer NOT NULL REFERENCES chain_anchors(id),
  logbook_slug    text NOT NULL,
  head_chain_hash text NOT NULL,
  report_count    integer NOT NULL CHECK (report_count >= 0),
  PRIMARY KEY (anchor_id, logbook_slug)
);
CREATE INDEX chain_anchor_heads_head_idx ON chain_anchor_heads (head_chain_hash);
CREATE TRIGGER chain_anchor_heads_append_only BEFORE DELETE OR UPDATE ON chain_anchor_heads
  FOR EACH ROW EXECUTE FUNCTION reject_modification();
CREATE TRIGGER chain_anchor_heads_no_truncate BEFORE TRUNCATE ON chain_anchor_heads
  FOR EACH STATEMENT EXECUTE FUNCTION reject_modification();

-- The category list was the old questionnaire's. A logbook's choices are
-- its own questions.
DROP TABLE report_categories;

-- WHETHER A LOGBOOK TAKES FILES. Off unless its maker turns it on, and only
-- ever in effect while this site's file storage is on as well.
ALTER TABLE logbooks ADD COLUMN accepts_files boolean NOT NULL DEFAULT false;

-- PEOPLE FOLLOW LOGBOOKS, NOT STATES. States were a question in the old
-- questionnaire. So were severities, which is what the instant alerts for
-- serious reports keyed on; they go with it.
ALTER TABLE users ADD COLUMN notify_logbooks text[];
ALTER TABLE users
  DROP COLUMN notify_states,
  DROP COLUMN notify_instant_serious,
  DROP COLUMN last_serious_notified_at;

COMMIT;
