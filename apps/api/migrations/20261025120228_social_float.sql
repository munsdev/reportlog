-- The floating "Follow us" button: whether it is on, and on which public
-- pages. {"on": boolean, "pages": [...]}; NULL means nobody has set it, which
-- is off. The server reads it through one function (resolveSocialFloat) that
-- drops a page it cannot place. Presentation only: never read into a sealed
-- object. Which pages MAY carry it is not a setting: it is never on a form or
-- a door, whatever is stored here.
ALTER TABLE site_settings
  ADD COLUMN social_float jsonb CHECK (social_float IS NULL OR jsonb_typeof(social_float) = 'object');
