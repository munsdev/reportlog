-- ════════════════════════════════════════════════════════════════════════
-- The distribution switch (docs/decisions.md, decision 11), legacy 009's
-- second half.
--
-- The public-archive switch decides whether the site shows its archive at
-- all. This one decides whether the archive may also be taken away in bulk,
-- as machine-readable copies: the board's spreadsheet and the published
-- chain file. Reading the board is not distribution; carrying it off whole
-- is.
--
-- NULL IS OFF, the opposite of the archive switch and for the same reason
-- turned around: nothing distributed before this migration, and a deployment
-- must never start distributing because a migration ran. An administrator
-- saying yes is the only thing that turns it on.
--
-- NEVER SEALED, and nothing in the chain reads it. Whether a deployment lets
-- its archive be downloaded this week is a fact about the deployment, not
-- about any report.
-- ════════════════════════════════════════════════════════════════════════
ALTER TABLE moderation_settings
  ADD COLUMN distribution_enabled boolean,
  ADD COLUMN distribution_set_by  text;

COMMENT ON COLUMN moderation_settings.distribution_enabled IS
  'May the archive be copied in bulk (the spreadsheet, the published chain file). NULL = nobody chose, which is OFF. Never sealed. Asked after the public-archive switch, never instead of it.';
