-- Where the site's social accounts are shown: {"on": [placement, ...]}. NULL
-- means nobody has chosen, which is every placement (the server reads it
-- through resolveSocialPlacements, which drops a name it cannot place).
-- Presentation only: never read into a sealed object. The accounts
-- themselves, and the floating button, are in their own columns.
ALTER TABLE site_settings
  ADD COLUMN social_placements jsonb CHECK (social_placements IS NULL OR jsonb_typeof(social_placements) = 'object');
