-- Attachment controls move from the environment into the database.
--
-- Additive only. Nothing here touches `reports`, so no fingerprint
-- changes and no report needs re-verifying.
--
-- Why this exists: whether attachments are accepted, and which kinds,
-- were both environment variables. Changing either meant editing a file
-- on the server and restarting the service — which is a deploy, not a
-- setting, and not something to be doing on election day with one hand
-- while answering the phone with the other.
--
-- The environment variable stays as the fallback. A NULL here means "no
-- opinion, use the environment", which is what every existing install
-- has until an admin actually presses something. That is deliberate:
-- adding a column with a DEFAULT true would have switched attachments on
-- everywhere the moment this migration ran, including anywhere storage
-- is not configured.
BEGIN;

ALTER TABLE site_settings
  ADD COLUMN attachments_enabled boolean,
  ADD COLUMN attachment_kinds    text[];

COMMENT ON COLUMN site_settings.attachments_enabled IS
  'NULL = defer to ATTACHMENTS_ENABLED in the environment. Storage still has to be configured either way; this can only turn the feature off, never conjure a place to put files.';

-- Families rather than media types. An admin choosing what may be
-- uploaded is answering "photos, video, audio, documents?" — not
-- picking between image/heic and image/heif, which is a question with no
-- good answer and several bad ones (the obvious mistake being to permit
-- JPEG and forget that half of all iPhone photos are not JPEG).
--
-- The exact media types each family covers stay in src/attachments.js,
-- where they sit next to the code that sniffs and rebuilds them. A
-- family added there is available here without a migration.
COMMENT ON COLUMN site_settings.attachment_kinds IS
  'Which families of file may be uploaded: photo, video, audio, document. NULL = every family the code supports. An empty array means none, which is a real answer and not the same as NULL.';

-- A rendered document has more than one published file, which nothing in
-- the schema could previously say. Page 1 is the rendition, so an existing
-- single-file attachment is page_count 1 or NULL and nothing has to be
-- backfilled.
ALTER TABLE upload_slots ADD COLUMN page_count integer;

COMMENT ON COLUMN upload_slots.page_count IS
  'Pages in the published rendition. NULL or 1 for everything that is not a rendered document. Page 1 is stored as the rendition itself; pages 2..n sit beside it under .page.N.';

-- Where a secondhand account can be found, when it came from something
-- with an address. Additive and conditional: no report in the archive has
-- one, so the key is absent from every existing fingerprint and nothing
-- rehashes. See the note on the optional-key rule in reportCore.js — this
-- column is only ever written when it applies, never as an empty string.
ALTER TABLE reports ADD COLUMN source_url text;

COMMENT ON COLUMN reports.source_url IS
  'Public web address the secondhand account came from. Part of the hashed content when present. Only set for source_kind in (video, social, news), http/https only, normalized through a URL parser so the same link typed two ways hashes identically.';

COMMIT;
