-- Every upload limit becomes something an operator sets.
--
-- WHAT WAS WRONG. An operator controlled exactly two things about uploads:
-- whether they were on at all, and which of the four kinds were accepted,
-- both site-wide (003). Every other limit was a constant in
-- `src/attachments.js` — 25 MB per photo, 150 MB and three minutes per
-- video, 60 MB of audio, 30 MB and forty pages of PDF, ten files, 400 MB in
-- total. Six of those read an environment variable, which means an operator
-- could change them by editing `.env` and restarting the service, and the
-- seventh could not be changed at all.
--
-- AN ENVIRONMENT VARIABLE IS NOT AN OPERATOR CONTROL. It needs shell access
-- to a production box, it is invisible from the interface that is supposed
-- to describe the deployment, nothing records who changed it or when, and on
-- this project there is no SSH from a session — so in practice the person
-- who runs the archive could not change them and the person who could was
-- not the operator.
--
-- THREE LAYERS, AND THE ORDER IS THE POINT:
--
--   the logbook   a column here, NULL unless somebody set it
--   the site      site_settings, NULL unless somebody set it
--   the shipped default, which is where the old constants went
--
-- Narrowest wins. A logbook that sets nothing behaves exactly as its site
-- does, and a site that sets nothing behaves exactly as this software did
-- before this migration — so nothing changes anywhere until an operator
-- decides something. That is what makes this additive in behaviour as well
-- as in schema.
--
-- WHY PER LOGBOOK AT ALL, and not only site-wide: the thing a logbook
-- collects decides what a sane limit is. An election logbook wants one
-- short clip from a phone. A workplace incident log might want a dozen
-- photographs and no video. A logbook that asks for a signed PDF wants
-- documents and nothing else. One site-wide number serves none of them, and
-- `docs/reference.md` §21.5 already refuses a `deployment_type` that would
-- let the code guess.
--
-- NOT IN logbook_fields.settings, which is where these look like they
-- belong. Those are inside the hashed form definition (src/formText.js) and
-- frozen at launch by `assertDraft`, so a limit stored there could never be
-- tuned — and a limit is exactly the thing an operator learns the right
-- value for from real traffic. These live beside `filterable`, which
-- formText.js deliberately excludes as "delivery, may change, and change no
-- answer". A limit changes no answer anybody gave.
--
-- Additive. Nine nullable columns across two tables, no backfill, nothing
-- rehashed, no report touched.

BEGIN;

-- ---------------------------------------------------------------------
-- THE SITE'S OWN LIMITS, where the environment variables used to be.
--
-- site_settings is a single row (`id boolean PRIMARY KEY DEFAULT true`), so
-- these are one row's columns rather than a table of key-value pairs.
ALTER TABLE site_settings
  ADD COLUMN IF NOT EXISTS max_image_bytes    bigint,
  ADD COLUMN IF NOT EXISTS max_video_bytes    bigint,
  ADD COLUMN IF NOT EXISTS max_audio_bytes    bigint,
  ADD COLUMN IF NOT EXISTS max_document_bytes bigint,
  ADD COLUMN IF NOT EXISTS max_video_seconds  integer,
  ADD COLUMN IF NOT EXISTS max_document_pages integer,
  ADD COLUMN IF NOT EXISTS max_files          integer,
  ADD COLUMN IF NOT EXISTS max_total_bytes    bigint;

COMMENT ON COLUMN site_settings.max_image_bytes IS
  'Largest photo this deployment accepts, or NULL for the shipped default. Replaces a constant in src/attachments.js. An operator sets this; MAX_* environment variables are still read as the shipped default so an existing deployment keeps its configured values, but they are no longer the control.';

-- ---------------------------------------------------------------------
-- AND THE LOGBOOK'S, which override the site's where they are set.
--
-- `max_files` and `max_total_bytes` arrived in 037; the rest join them so
-- the whole set lives in one place rather than two.
ALTER TABLE logbooks
  ADD COLUMN IF NOT EXISTS max_image_bytes    bigint,
  ADD COLUMN IF NOT EXISTS max_video_bytes    bigint,
  ADD COLUMN IF NOT EXISTS max_audio_bytes    bigint,
  ADD COLUMN IF NOT EXISTS max_document_bytes bigint,
  ADD COLUMN IF NOT EXISTS max_video_seconds  integer,
  ADD COLUMN IF NOT EXISTS max_document_pages integer,
  -- WHICH KINDS THIS LOGBOOK TAKES, narrowing the site's list and never
  -- widening it. A logbook cannot accept video on a deployment that has
  -- video switched off — the site switch is a ceiling, not a default, and
  -- src/attachments.js intersects rather than replaces. Otherwise turning a
  -- kind off site-wide would leave it on wherever a logbook had named it,
  -- which is the opposite of what pressing a site switch means.
  ADD COLUMN IF NOT EXISTS attachment_kinds   text[];

COMMENT ON COLUMN logbooks.attachment_kinds IS
  'Which attachment kinds this logbook takes, or NULL for whatever the site takes. INTERSECTED with the site list, never unioned: the site switch is a ceiling, so a logbook cannot accept a kind the deployment has turned off.';

-- ---------------------------------------------------------------------
-- RANGES, AT THE DATABASE, so a nonsense limit is refused once rather than
-- in whichever route forgot to check.
--
-- The upper bounds are not opinions about good practice — they are the
-- points past which something else breaks. A 2 GB single file exceeds what
-- the media worker can hold while re-encoding; an hour of video is not
-- evidence of an incident; a thousand-page PDF becomes a thousand page
-- images somebody has to store and a moderator has to look at.
--
-- No lower bound of zero anywhere: a limit of zero is an upload question
-- that can never be answered, which is a form refusing every report
-- forever. Turning uploads OFF is `attachments_enabled`, or not asking for
-- files at all.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['site_settings', 'logbooks'] LOOP
    EXECUTE format($f$
      ALTER TABLE %I
        ADD CONSTRAINT %I CHECK (max_image_bytes    IS NULL OR max_image_bytes    BETWEEN 65536 AND 2147483648),
        ADD CONSTRAINT %I CHECK (max_video_bytes    IS NULL OR max_video_bytes    BETWEEN 65536 AND 2147483648),
        ADD CONSTRAINT %I CHECK (max_audio_bytes    IS NULL OR max_audio_bytes    BETWEEN 65536 AND 2147483648),
        ADD CONSTRAINT %I CHECK (max_document_bytes IS NULL OR max_document_bytes BETWEEN 65536 AND 2147483648),
        ADD CONSTRAINT %I CHECK (max_video_seconds  IS NULL OR max_video_seconds  BETWEEN 5 AND 3600),
        ADD CONSTRAINT %I CHECK (max_document_pages IS NULL OR max_document_pages BETWEEN 1 AND 1000)
    $f$, t,
      t || '_max_image_bytes_check', t || '_max_video_bytes_check',
      t || '_max_audio_bytes_check', t || '_max_document_bytes_check',
      t || '_max_video_seconds_check', t || '_max_document_pages_check');
  END LOOP;
END $$;

-- 037 already constrained the logbook's count and total; the site's need the
-- same treatment, and the ranges are stated once here for both.
ALTER TABLE site_settings
  ADD CONSTRAINT site_settings_max_files_check
    CHECK (max_files IS NULL OR max_files BETWEEN 1 AND 50),
  ADD CONSTRAINT site_settings_max_total_bytes_check
    CHECK (max_total_bytes IS NULL OR max_total_bytes BETWEEN 1048576 AND 2147483648);

-- ---------------------------------------------------------------------
-- A KIND NAME HAS TO BE ONE OF THE FOUR, on both tables. The list is
-- ATTACHMENT_KINDS in src/attachments.js, and a fifth kind would mean new
-- decoding code — so a name here that the code does not know is a typo, not
-- a feature, and it would silently narrow a logbook to nothing.
--
-- site_settings.attachment_kinds predates this (003) and was unconstrained,
-- so this is added for both now.
ALTER TABLE site_settings ADD CONSTRAINT site_settings_attachment_kinds_check
  CHECK (attachment_kinds IS NULL OR attachment_kinds <@ ARRAY['photo', 'video', 'audio', 'document']);
ALTER TABLE logbooks ADD CONSTRAINT logbooks_attachment_kinds_check
  CHECK (attachment_kinds IS NULL OR attachment_kinds <@ ARRAY['photo', 'video', 'audio', 'document']);

COMMIT;
