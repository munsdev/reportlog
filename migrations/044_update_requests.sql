-- Who asked for an update, and when.
--
-- ADDITIVE, like every migration here. It adds one table and touches
-- nothing that hashes: no report's fingerprint depends on any of this, and
-- nothing in src/reportCore.js or src/verify.js may ever read it.
--
-- WHY A TABLE AND NOT JUST THE REQUEST FILE. The file in var/ is a queue —
-- the root worker consumes it and deletes it, so by the time anybody asks
-- "who updated this archive on the 9th", it is gone. On an archive whose
-- whole claim is that its history can be checked, "somebody caused new code
-- to run against it" is exactly the kind of thing that should leave a row.
--
-- APPEND-ONLY BY THE SAME RULE AS `reports`. A correction is a new row.
-- `applied_at` and `outcome` are the one exception, written once by the
-- application when it sees the worker's status change, and the CHECK below
-- stops an outcome being rewritten afterwards.

CREATE TABLE IF NOT EXISTS update_requests (
  id              bigserial PRIMARY KEY,
  requested_by    bigint      REFERENCES users(id) ON DELETE SET NULL,
  -- Kept as text as well as a reference, because the row has to stay
  -- readable after an account is deleted. It is an operator's address, not
  -- a reporter's, so it is not reporter data under erasure.
  requested_email text,
  requested_at    timestamptz NOT NULL DEFAULT now(),
  from_commit     text        NOT NULL,
  target_commit   text        NOT NULL,
  from_version    text,
  target_version  text,
  outcome         text,
  outcome_detail  text,
  applied_at      timestamptz,

  CONSTRAINT update_requests_commits_are_commits
    CHECK (from_commit ~ '^[0-9a-f]{40}$' AND target_commit ~ '^[0-9a-f]{40}$'),
  CONSTRAINT update_requests_outcome_known
    CHECK (outcome IS NULL OR outcome IN ('done', 'failed', 'expired'))
);

CREATE INDEX IF NOT EXISTS update_requests_requested_at_idx
  ON update_requests (requested_at DESC);

-- The same refusal the archive itself carries. A row recording that new code
-- was run is worth no more than the promise that it cannot be edited away.
CREATE OR REPLACE FUNCTION update_requests_no_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'update_requests is append-only: a correction is a new row';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_requests_refuse_delete ON update_requests;
CREATE TRIGGER update_requests_refuse_delete
  BEFORE DELETE ON update_requests
  FOR EACH ROW EXECUTE FUNCTION update_requests_no_delete();

-- An outcome may be written once, from NULL. Anything else is a rewrite.
CREATE OR REPLACE FUNCTION update_requests_outcome_once() RETURNS trigger AS $$
BEGIN
  IF OLD.outcome IS NOT NULL AND NEW.outcome IS DISTINCT FROM OLD.outcome THEN
    RAISE EXCEPTION 'update_requests.outcome is written once and never changed';
  END IF;
  IF NEW.requested_at IS DISTINCT FROM OLD.requested_at
     OR NEW.target_commit IS DISTINCT FROM OLD.target_commit
     OR NEW.from_commit IS DISTINCT FROM OLD.from_commit
     OR NEW.requested_by IS DISTINCT FROM OLD.requested_by THEN
    RAISE EXCEPTION 'update_requests: what was asked for cannot be edited afterwards';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_requests_outcome_write_once ON update_requests;
CREATE TRIGGER update_requests_outcome_write_once
  BEFORE UPDATE ON update_requests
  FOR EACH ROW EXECUTE FUNCTION update_requests_outcome_once();
