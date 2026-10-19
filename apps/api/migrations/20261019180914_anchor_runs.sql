-- ════════════════════════════════════════════════════════════════════════
-- The daily anchor (workstream D2): what each run did.
--
-- `chain_anchors` says that a day was timestamped. It cannot say that the
-- day reached the public log, or that a run refused because a logbook had
-- gone missing from the list, and both of those look exactly like a working
-- anchor from every angle except this table. The doctor reads the newest row.
--
-- Append-only, like everything else about the anchor: a run that refused
-- stays on the record after somebody has dealt with it.
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE anchor_runs (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  started_at  timestamptz NOT NULL,
  finished_at timestamptz NOT NULL DEFAULT now(),
  -- The day the run was for. Null only when it failed before knowing.
  anchor_date date,
  outcome     text NOT NULL CHECK (outcome IN (
                'published',          -- every remote has the day
                'partly_published',   -- some remotes have it; the rest catch up next run
                'not_published',      -- anchored here, reached no remote
                'refused',            -- the list contradicted the last published one
                'failed'              -- something broke before anything was anchored
              )),
  -- One line for the operator. Never an address or a token: remotes are
  -- named by position and host.
  detail      text NOT NULL CHECK (length(detail) <= 2000)
);
CREATE INDEX anchor_runs_newest_idx ON anchor_runs (id DESC);
CREATE TRIGGER anchor_runs_append_only BEFORE UPDATE OR DELETE ON anchor_runs
  FOR EACH ROW EXECUTE FUNCTION reject_modification();
CREATE TRIGGER anchor_runs_no_truncate BEFORE TRUNCATE ON anchor_runs
  FOR EACH STATEMENT EXECUTE FUNCTION reject_modification();

-- One anchor per day. The day's file in the log is written once and never
-- replaced, so a second row for the same day would be a timestamp nobody can
-- find. The anchor job also checks first, under a lock; this is what holds if
-- something forgets to.
CREATE UNIQUE INDEX chain_anchors_one_per_day ON chain_anchors (anchor_date);
