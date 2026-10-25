-- The site's accounts on social media: an address and an on/off switch per
-- platform (Facebook, Instagram, Threads, Bluesky, TikTok, YouTube and the
-- rest in SOCIAL_PLATFORMS), drawn as icons in the footer and on the front
-- page.
--
-- NULL means nobody has set any, which is every platform off. A list of
-- {id, url, shown} otherwise; the server reads it through one function that
-- drops an entry it cannot read and adds, switched off, a platform the list
-- does not name, so a platform added in a later release starts off.
-- Presentation only: never read into a sealed object.
ALTER TABLE site_settings
  ADD COLUMN social_links jsonb CHECK (social_links IS NULL OR jsonb_typeof(social_links) = 'array');
