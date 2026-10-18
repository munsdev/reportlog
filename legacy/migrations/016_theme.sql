-- Which look this deployment wears.
--
-- Additive only. Nothing here touches `reports`, so no fingerprint changes
-- and no report needs re-verifying.
--
-- A STUB, DELIBERATELY, and the column is the honest part of it. What
-- exists is the mechanism — a stored choice, a way to pick it at setup, a
-- way to change it afterwards, and a handful of themes to prove it works.
-- What does not exist is a theme editor, custom colours, or an uploaded
-- logo. Those are a later decision and this does not foreclose any of them:
-- the column holds a name, and a name can later mean "the row in a themes
-- table with this id" without anything stored today becoming wrong.
--
-- NEVER HASHED. Presentation, like the site's name. Nothing in
-- reportCore.js or verify.js may read it: a report must not verify
-- differently because somebody changed the colours.
--
-- NULL MEANS NO OPINION and resolves to the shipped look, which is what
-- every deployment has today. A DEFAULT here would be a decision made on
-- an operator's behalf by a migration.
BEGIN;

ALTER TABLE site_settings
  ADD COLUMN IF NOT EXISTS theme text;

COMMENT ON COLUMN site_settings.theme IS
  'The name of this deployment''s theme. NULL = no opinion, resolving to the shipped look. Never hashed: presentation only.';

COMMIT;
