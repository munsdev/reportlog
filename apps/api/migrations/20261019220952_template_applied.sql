-- Which deployment template this deployment was started from, and when.
--
-- FOR THE RECORD ONLY. Nothing reads these to decide anything. A template is
-- a bundle of ordinary settings applied once (apps/api/src/site/templates.ts):
-- it writes the rows an administrator could have written by hand, and then it
-- is over. These two columns let an operator answer "where did these defaults
-- come from" six months later. Delete the feature and no deployment behaves
-- differently, because there is no deployment type to branch on.
--
-- The CHECK keeps the pair together: a name with no time, or a time with no
-- name, is a record nobody can read. Neither is ever read into a sealed object.
ALTER TABLE site_settings
  ADD COLUMN template_applied    text CHECK (template_applied IS NULL OR template_applied ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  ADD COLUMN template_applied_at timestamptz,
  ADD CONSTRAINT site_settings_template_applied_pair
    CHECK ((template_applied IS NULL) = (template_applied_at IS NULL));
