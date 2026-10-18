-- The look, as three orthogonal axes instead of one name.
--
-- Additive only. Nothing here touches `reports`.
--
-- Migration 016 gave a deployment one `theme` column holding one name that
-- meant everything at once. That was the stub, and it said so. This is the
-- shape it was a stub for, taken from the design preview:
--
--   palette  every colour
--   theme    type, borders, shadows, radii, spacing — and NO colour
--   layout   how wide the page is
--
-- They are orthogonal on purpose: any theme works with any palette, so an
-- operator who wants the typewritten look in their own colours gets it
-- without anybody having authored that combination.
--
-- THE OLD VALUES BECOME PALETTES, because that is what they were. `slate`
-- and `moss` set colour and nothing else. They are mapped to the nearest
-- palette in the ported set rather than kept as one-offs, so there is one
-- list of colours rather than two. `default` was the shipped look, which is
-- the original palette, renamed `flint` in migration 024.
--
-- NEVER HASHED. Presentation. Nothing in reportCore.js or verify.js reads
-- any of it.
--
-- NULL means no opinion everywhere, resolving to the shipped look.
BEGIN;

ALTER TABLE site_settings
  ADD COLUMN IF NOT EXISTS palette text,
  ADD COLUMN IF NOT EXISTS layout  text;

-- Carry 016's choices across rather than stranding them. A deployment that
-- picked `slate` chose a cool blue-grey; `harbour` is that, in the ported
-- set. `moss` chose a warm green ground; `sage` is that.
UPDATE site_settings SET palette = 'harbour', theme = NULL WHERE theme = 'slate';
UPDATE site_settings SET palette = 'sage',    theme = NULL WHERE theme = 'moss';
UPDATE site_settings SET theme = NULL WHERE theme = 'default';

COMMENT ON COLUMN site_settings.palette IS
  'Every colour on the site. NULL = the shipped palette. Never hashed.';
COMMENT ON COLUMN site_settings.theme IS
  'Type, borders, shadows, radii and spacing. Sets no colour at all. NULL = the shipped theme. Never hashed.';
COMMENT ON COLUMN site_settings.layout IS
  'How wide the page is. NULL = the shipped width. Never hashed.';

COMMIT;
