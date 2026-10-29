-- site_copy_versions is append-only (20261028132345), but its guard covered
-- UPDATE and DELETE and not TRUNCATE, so one statement could still empty the
-- record of every wording the site has shown. Every other append-only table
-- refuses TRUNCATE too (invariants.test.ts, I4). Only adds a trigger: no row
-- is touched. reject_modification() names the table, as on the others.
CREATE TRIGGER site_copy_versions_no_truncate BEFORE TRUNCATE ON site_copy_versions
  FOR EACH STATEMENT EXECUTE FUNCTION reject_modification();
