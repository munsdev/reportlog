-- Decision 78. A cover page for a logbook and for a list: the words and the
-- call to action on its first card. Nullable jsonb, validated by the API
-- (packages/contracts). NEVER sealed and never read into a sealed object.
ALTER TABLE logbooks ADD COLUMN cover jsonb;
ALTER TABLE lists ADD COLUMN cover jsonb;

-- Saving the site's call to action text empty now switches the box off, which
-- is stored as an empty row (no row still means "use what ships").
ALTER TABLE site_copy DROP CONSTRAINT site_copy_body_check;
ALTER TABLE site_copy ADD CONSTRAINT site_copy_body_check
  CHECK (length(body) <= 20000 AND (key = 'help_now' OR length(btrim(body)) > 0));
