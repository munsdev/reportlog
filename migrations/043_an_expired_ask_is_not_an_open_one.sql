-- An evidence request that aged out must not block the next one.
--
-- THE BUG 041 SHIPPED WITH. Its partial unique index enforces "one live
-- request per thread" as:
--
--   WHERE used_at IS NULL AND cancelled_at IS NULL
--
-- which is every row that was neither spent nor withdrawn — INCLUDING ones
-- whose fourteen days ran out. So the first request to expire locked the
-- report forever: the next ask was refused as "there is already a live
-- request", and the moderator was told to withdraw a request that had
-- already stopped working. Found by the suite, not in production.
--
-- WHY THE INDEX CANNOT JUST SAY `AND expires_at > now()`. An index
-- predicate has to be immutable, and `now()` is not. A row's liveness
-- depends on the clock, and no index can be told about the clock.
--
-- SO EXPIRY BECOMES A FACT ON THE ROW rather than something inferred from
-- two columns and the time. `src/evidenceRequests.js` stamps `expired_at`
-- when it next looks at a stale row, and the index tests three columns that
-- are all simply there or not.
--
-- A SEPARATE COLUMN FROM cancelled_at, and not folded into it, because they
-- are different events and the record should say which happened. A withdrawn
-- request is somebody deciding; an expired one is nobody doing anything.
-- `cancelled_by` is an email and its CHECK requires one, so recording an
-- expiry there would have meant inventing a person.
--
-- Additive. One nullable column, one index replaced by a narrower one.

BEGIN;

ALTER TABLE evidence_requests ADD COLUMN IF NOT EXISTS expired_at timestamptz;

COMMENT ON COLUMN evidence_requests.expired_at IS
  'When this request was observed to have run out, stamped lazily by src/evidenceRequests.js. Exists because the one-live-request index cannot test expires_at against now() — an index predicate must be immutable. Distinct from cancelled_at: that is somebody deciding, this is nobody doing anything.';

-- Backfill what is already stale, so the index below is correct the moment
-- it exists rather than at the next request.
UPDATE evidence_requests
   SET expired_at = expires_at
 WHERE expired_at IS NULL AND used_at IS NULL AND cancelled_at IS NULL
   AND expires_at <= now();

DROP INDEX IF EXISTS evidence_requests_one_open_idx;

CREATE UNIQUE INDEX IF NOT EXISTS evidence_requests_one_open_idx
  ON evidence_requests (thread_id)
  WHERE used_at IS NULL AND cancelled_at IS NULL AND expired_at IS NULL;

COMMIT;
