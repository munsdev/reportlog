-- The review flag: a report whose own words say somebody more senior
-- should read it.
--
-- WHAT A FLAG IS AND IS NOT. It is a queue marker. It is not a severity,
-- not a finding, not a verdict, and says nothing whatever about anybody
-- named in the report. 035 withdrew the veracity verdict for exactly that
-- reason and nothing here brings it back: this says "read this one next",
-- and the only thing it can be wrong about is the order of a reading list.
--
-- WHY THE TERMS ARE STORED and not just a boolean. A reviewer who can see
-- that something fired but not WHAT fired has to repeat the triage from
-- scratch, which is most of the work the flag was supposed to save. It is
-- also the only way an operator can tell that a term is firing on half of
-- what arrives and should be cut — and `site_settings.review_keywords`
-- exists so they can cut it.
--
-- NOT HASHED, and nothing that computes a fingerprint may read this. The
-- list that produced a flag is editable, so a report whose flag was part of
-- its fingerprint would verify differently after somebody edited a word
-- list months later. 039 says the same about the list itself.
--
-- PER REPORT VERSION, not per thread. A correction is a new row in
-- `reports` with its own text, so it gets its own look: text that was
-- unremarkable in the original and alarming in the correction must not pass
-- because the thread had already been seen.
--
-- Additive. One new table, one boolean on the mutable head.

BEGIN;

CREATE TABLE IF NOT EXISTS report_review_flags (
  id          bigserial PRIMARY KEY,
  report_id   bigint NOT NULL REFERENCES reports(id),
  thread_id   uuid NOT NULL,
  -- WHICH TERMS FIRED. The terms themselves rather than a count, because
  -- the count tells a reviewer nothing they can act on.
  terms       text[] NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  -- WHEN SOMEBODY LOOKED, and who. Not a deletion: a flag that vanishes
  -- when it is dealt with leaves nothing to count, and the question an
  -- operator will eventually ask is "how many of these were worth it" —
  -- which needs the cleared ones as much as the open ones.
  cleared_at  timestamptz,
  cleared_by  text,
  CONSTRAINT report_review_flags_terms_check CHECK (array_length(terms, 1) > 0),
  -- A cleared flag has somebody's name against it. An anonymous clear is
  -- indistinguishable from a bug that cleared the queue.
  CONSTRAINT report_review_flags_cleared_check CHECK (
    (cleared_at IS NULL AND cleared_by IS NULL)
    OR (cleared_at IS NOT NULL AND cleared_by IS NOT NULL))
);

-- One flag per report version: a second pass over the same text is the
-- same answer, and a re-run must not stack duplicates on the queue.
CREATE UNIQUE INDEX IF NOT EXISTS report_review_flags_report_idx
  ON report_review_flags (report_id);

-- The queue, which is the only thing this is read for in bulk.
CREATE INDEX IF NOT EXISTS report_review_flags_open_idx
  ON report_review_flags (created_at) WHERE cleared_at IS NULL;

CREATE INDEX IF NOT EXISTS report_review_flags_thread_idx
  ON report_review_flags (thread_id);

-- ---------------------------------------------------------------------
-- THE PROJECTION, on the mutable head, so a board query does not need a
-- join to know whether to show a marker.
--
-- `report_heads` is where everything that may change already lives
-- (001 says so at the table), and this may change: a moderator clears it.
-- The flag table remains the record of what fired and who cleared it; this
-- is the one bit a list query needs.
ALTER TABLE report_heads ADD COLUMN IF NOT EXISTS needs_review boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN report_heads.needs_review IS
  'A projection of report_review_flags for the current version: true while an uncleared flag stands. A queue marker only — not a severity, not a finding, and nothing about anybody named in the report. Never hashed.';

CREATE INDEX IF NOT EXISTS report_heads_needs_review_idx
  ON report_heads (needs_review) WHERE needs_review;

COMMIT;
