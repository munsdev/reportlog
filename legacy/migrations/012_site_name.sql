-- What this deployment calls itself.
--
-- Additive only. Nothing here touches `reports`, so no fingerprint changes
-- and no report needs re-verifying.
--
-- Until now the name was the string 'ReportLog', written into the markup
-- about twenty times and into one JavaScript constant. That is fine for the
-- deployment that wrote it and wrong for everybody else: somebody installing
-- this on their own server got a site named after the software, with no way
-- to say whose it was.
--
-- The software keeps its name. A deployment gets its own, and the footer
-- says "Powered by ReportLog" — which is the ordinary arrangement for
-- self-hosted AGPL software and keeps attribution where it belongs.
--
-- NULL means "no opinion", the same way the attachment and publication
-- settings do it: the SITE_NAME environment variable answers, and failing
-- that the software's own name. A column with a DEFAULT would have renamed
-- every existing deployment the moment this migration ran.
BEGIN;

ALTER TABLE site_settings
  ADD COLUMN IF NOT EXISTS site_name text;

COMMENT ON COLUMN site_settings.site_name IS
  'What this deployment calls itself, shown wherever the brand appears. NULL = defer to SITE_NAME in the environment, and failing that to ReportLog. Never hashed: it is presentation, and a report must not verify differently because somebody renamed the site.';

COMMIT;
