-- The operator's own Impressum and privacy policy.
--
-- Additive only. Nothing here touches `reports`, so no fingerprint changes
-- and no report needs re-verifying.
--
-- Both panes already said that an operator publishes their own text there
-- and gave them no way to do it. This is that way.
--
-- TWO TEXT COLUMNS AND NOTHING ELSE. A structured version was designed
-- first — a mode flag, a field list, include checkboxes, the whole notice
-- assembled from parts — and was reversed deliberately. What an Impressum
-- must contain is decided by the jurisdiction the deployment is run from,
-- and a field list is this software asserting it knows which fields those
-- are. It does not. The operator owns their legal notices; we store what
-- they wrote.
--
-- NULL MEANS "NOT WRITTEN YET", and it is not the same as an empty string.
-- While NULL, the public pane says plainly that this deployment has not
-- published its notice, and renders no placeholder. The starting skeleton
-- lives in the admin editor instead, so that an operator who opens the
-- editor and never finishes cannot accidentally publish our dummy text as
-- their own legal notice. A DEFAULT here would have done exactly that to
-- every deployment the moment this migration ran.
--
-- NEVER HASHED. These are presentation, like the site's name. Nothing in
-- reportCore.js or verify.js may ever read them: a report must not verify
-- differently because somebody corrected their privacy policy.
BEGIN;

ALTER TABLE site_settings
  ADD COLUMN IF NOT EXISTS impressum_text text,
  ADD COLUMN IF NOT EXISTS privacy_text   text;

COMMENT ON COLUMN site_settings.impressum_text IS
  'The operator''s own imprint, as free text exactly as they wrote it. NULL = not written yet, and the public pane says so rather than showing a placeholder. Never hashed.';

COMMENT ON COLUMN site_settings.privacy_text IS
  'The operator''s own privacy policy, as free text exactly as they wrote it. NULL = not written yet, and the public pane says so rather than showing a placeholder. Never hashed.';

COMMIT;
