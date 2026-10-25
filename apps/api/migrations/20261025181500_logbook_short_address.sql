-- A logbook's short web address (electionlog.org/volunteer).
--
-- The slug is sealed into every report and a trigger keeps it fixed, so a
-- name an operator can change cannot be the slug. This is a second name that
-- points at the logbook: the site resolves it to the real slug and the form
-- files under the real one. It is never sealed, never read into a sealed
-- object, and may be set, changed or cleared at any time.
--
-- It shares one address space with logbook and list slugs; the application
-- checks that (apps/api/src/site/slugs.ts), the index below only stops two
-- logbooks taking the same one.
ALTER TABLE logbooks ADD COLUMN short_slug text;
ALTER TABLE logbooks ADD CONSTRAINT logbooks_short_slug_check
  CHECK (short_slug IS NULL OR short_slug ~ '^[a-z0-9][a-z0-9-]{0,62}$');
CREATE UNIQUE INDEX logbooks_short_slug_key ON logbooks (short_slug) WHERE short_slug IS NOT NULL;
