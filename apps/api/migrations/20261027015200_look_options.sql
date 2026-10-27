-- Zones, motion and the header background: three more choices that sit beside
-- the palette and the theme (packages/contracts/src/look/header.ts).
-- NOTHING HERE IS SEALED; presentation only.
--
-- One nullable column, written whole as JSON by the owner's Look screen and
-- read back through resolveLookOptions(), which reads anything that does not
-- parse (and null) as the defaults. A site that never touches the screen has
-- null and looks as before. The header image itself is a file in the site's
-- own storage (renditions bucket, key headers/<random>.jpg); the JSON holds
-- only its random file name.
--
-- Adds a column. Changes no existing column and no existing row.

ALTER TABLE site_settings ADD COLUMN look_options jsonb
  CHECK (look_options IS NULL OR jsonb_typeof(look_options) = 'object');
