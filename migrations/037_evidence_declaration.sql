-- Evidence a reporter has and has not uploaded, and permission to be asked
-- for it.
--
-- THE TWO ARE DELIBERATELY SEPARATE, and the design session was explicit
-- about it:
--
--   THE DECLARATION is a sealed answer about what exists. "I have thirty
--   seconds of video of the line outside." It is a question a logbook asks,
--   so it is an ordinary field, it is hashed with every other answer, and it
--   can never change — because what somebody said they had at the moment
--   they filed is a fact about the filing.
--
--   THE PERMISSION is an ongoing grant to be contacted about it, and it
--   exists to be taken back. So it belongs in the append-only log where
--   changing it is recorded, as the third key beside the two from 030.
--
-- Folding them together — one checkbox meaning both "I have footage" and
-- "ask me about it" — would put a revocable value inside the fingerprint. A
-- report would then verify differently because somebody changed their mind
-- about being contacted, which is exactly what `may_publish` versus
-- `report_permissions_log` already settles one layer down.
--
-- NOTHING HERE TOUCHES THE HASHED OBJECT. The declaration is a field of an
-- existing type on a logbook that chooses to ask it — no new column, no new
-- shape, nothing rehashed. The permission adds one allowed value to a CHECK
-- on a table that is not hashed and that `reportCore.js` may not import.
--
-- Additive. One widened CHECK, two new columns on `logbooks`, no backfill.

BEGIN;

-- ---------------------------------------------------------------------
-- THE THIRD REVOCABLE PERMISSION.
--
-- ADDED TO WHATEVER IS THERE rather than restated, which is the lesson 036
-- paid for: its first version rebuilt self_service_log's CHECK from the 001
-- list and silently dropped 'erase' from 028, so erasing a reporter's
-- contact details started failing. The union with what is already in the
-- table means a migration cannot narrow a constraint under its own history
-- by forgetting something.
DO $$
DECLARE
  allowed text[];
BEGIN
  SELECT array_agg(DISTINCT a ORDER BY a) INTO allowed
    FROM unnest(
      ARRAY[
        -- 030
        'contact_passing', 'attachment_publication',
        -- 037: may an editor come back and ask for the evidence this
        -- reporter said they had. NOT the declaration, which is sealed.
        'evidence_request'
      ]
      || coalesce((SELECT array_agg(DISTINCT permission) FROM report_permissions_log), ARRAY[]::text[])
    ) AS a;

  EXECUTE format(
    'ALTER TABLE report_permissions_log DROP CONSTRAINT report_permissions_log_permission_check,
       ADD CONSTRAINT report_permissions_log_permission_check CHECK (permission = ANY (%L::text[]))',
    allowed);
END $$;

-- ---------------------------------------------------------------------
-- PER-LOGBOOK FILE CAPS.
--
-- WHY NOT IN THE FIELD'S SETTINGS, which is where they look like they
-- belong: `logbook_fields.settings` is inside the hashed form definition
-- (src/formText.js) and `updateField` is gated by `assertDraft`. A cap
-- stored there would be frozen the moment the logbook launched and could
-- never be tuned — and a cap is exactly the thing an operator learns the
-- right value for from real traffic.
--
-- So they live beside `filterable`, which `formText.js` deliberately
-- excludes from the definition as "delivery, may change, and change no
-- answer". A cap changes no answer anybody gave.
--
-- NULL MEANS "USE THE SITE'S OWN LIMIT", so this migration changes no
-- behaviour on any existing logbook. src/attachments.js holds the defaults.
--
-- THE NUMBERS THE FIRST DEPLOYMENT WILL USE ARE 1 FILE AND 300 MB, and the
-- second one is a RISE from the current 150 MB ceiling rather than a cut.
-- The requirement was "one file enough for a modern 30 second clip", and a
-- default-settings iPhone shooting 4K produces roughly 190 MB for thirty
-- seconds — so the old cap rejected the ordinary case. One file at 300 MB
-- covers 4K/30 comfortably and most 4K/60, while cutting what one abandoned
-- draft can park in staging from 400 MB to 300 MB.
ALTER TABLE logbooks ADD COLUMN IF NOT EXISTS max_files integer;
ALTER TABLE logbooks ADD COLUMN IF NOT EXISTS max_total_bytes bigint;

COMMENT ON COLUMN logbooks.max_files IS
  'How many files one report in this logbook may carry, or NULL for the site default (src/attachments.js). Never hashed: it is delivery and changes no answer. Not in logbook_fields.settings on purpose — those are inside the sealed form definition and frozen at launch, and a cap is the thing an operator tunes from real traffic.';

COMMENT ON COLUMN logbooks.max_total_bytes IS
  'Total upload bytes one report in this logbook may carry, or NULL for the site default. See max_files.';

ALTER TABLE logbooks ADD CONSTRAINT logbooks_max_files_check
  CHECK (max_files IS NULL OR max_files BETWEEN 1 AND 50);
ALTER TABLE logbooks ADD CONSTRAINT logbooks_max_total_bytes_check
  CHECK (max_total_bytes IS NULL OR max_total_bytes BETWEEN 1048576 AND 2147483648);

-- ---------------------------------------------------------------------
-- WHICH LOGBOOK AN UPLOAD IS FOR.
--
-- The caps above are per logbook, and the upload endpoint did not know which
-- logbook it was serving: a slot is authorised by a draft token, which is
-- minted before anything has been chosen. So the cap could only have been
-- read from whatever the client claimed, per request — and a client that
-- names the logbook with the loosest cap gets it.
--
-- Recorded on the slot instead, from the first upload in a draft, and every
-- later slot in that draft has to agree. The cap a reporter is held to is
-- then the one belonging to the logbook they are actually filing to, decided
-- once, by the server.
--
-- NULLABLE, because a slot created before this migration has no logbook and
-- there is no honest way to guess one. src/attachments.js falls back to the
-- site-wide limits for those, which is what they were created under.
ALTER TABLE upload_slots ADD COLUMN IF NOT EXISTS logbook_id bigint REFERENCES logbooks(id);

COMMENT ON COLUMN upload_slots.logbook_id IS
  'Which logbook this upload is for, from the first slot in its draft; later slots in the same draft must match. Decides which per-logbook cap applies, so the cap cannot be chosen by the client. NULL on slots created before migration 037, which fall back to the site-wide limits.';

CREATE INDEX upload_slots_draft_logbook_idx ON upload_slots (draft_token, logbook_id);

COMMIT;
