-- The spine shrinks: what happened, an email, and permission to publish.
--
-- Logbooks are coming, and each one carries its own frozen questionnaire.
-- A logbook may simply not ask when something happened, or where, or
-- whether the person saw it themselves, or under which category. Those four
-- were NOT NULL, so a report that was never asked could not be stored at
-- all. This relaxes exactly that, and nothing else.
--
-- NOTHING HERE REWRITES A REPORT. Dropping NOT NULL is a catalog-only change
-- in Postgres: no table rewrite, no row touched, no trigger fired, and no
-- fingerprint altered. Every report already in the archive keeps its values
-- and verifies exactly as before. The append-only trigger is not in play
-- because no row is updated.
--
-- WHAT IS DELIBERATELY NOT CHANGED, and both are load-bearing:
--
-- reports_states_check stays exactly as it is. `cardinality(states) >= 1`
-- evaluates to NULL for a NULL array, and a CHECK constraint only rejects
-- FALSE — so NULL passes and an empty array still does not. That is the
-- distinction this design needs: NULL means "this logbook did not ask",
-- `{}` means "asked and answered with nothing", and the second remains
-- illegal. Same reasoning for reports_categories_check and
-- reports_direct_or_secondhand_check.

BEGIN;

ALTER TABLE reports ALTER COLUMN incident_date        DROP NOT NULL;
ALTER TABLE reports ALTER COLUMN states               DROP NOT NULL;
ALTER TABLE reports ALTER COLUMN categories           DROP NOT NULL;
ALTER TABLE reports ALTER COLUMN direct_or_secondhand DROP NOT NULL;

-- The rest of the same question. "Were you a credentialed observer inside
-- the polling place" is the most election-specific field in the schema, and
-- it travels with direct_or_secondhand on one card — so it relaxes with it
-- rather than leaving a logbook unable to omit half a question.
ALTER TABLE reports ALTER COLUMN observer_status          DROP NOT NULL;
ALTER TABLE reports ALTER COLUMN is_credentialed_observer DROP NOT NULL;

-- text_of() was declared STRICT, which makes text_of(NULL) return NULL
-- rather than the empty string its own body would have produced. The
-- full-text index concatenates its result, and one NULL in a `||` chain
-- makes the WHOLE expression NULL — so a report with no location would
-- have been indexed as nothing at all and become permanently unfindable by
-- search. Silently: no error, no empty result, just a report that exists,
-- verifies, and cannot be looked up.
--
-- The body already coalesces. Only the STRICT modifier was wrong.
--
-- No REINDEX is needed. The index is only wrong for rows whose states or
-- categories are NULL, and no such row exists yet — this migration creates
-- the possibility, not the data.
ALTER FUNCTION text_of(text[]) CALLED ON NULL INPUT;

COMMIT;
