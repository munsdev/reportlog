-- An upload is a question, and freezing uploads is a separate, protective act.
--
-- WHAT WAS WRONG. Whether a logbook took files was a stored boolean,
-- `logbooks.accepts_files`, sitting beside the questions rather than among
-- them — and there was a second switch for the same decision on the site's
-- own settings. So one thing ("does this form ask for a photo") had two
-- controls in two places, neither of them where the operator was building the
-- form. A logbook now takes files if, and only if, it asks for them: it has a
-- field of kind 'file'.
--
-- NOTHING HERE TOUCHES A REPORT, AND NO FINGERPRINT MOVES. A report's files
-- are sealed in a top-level `attachments` key computed from the manifest of
-- what was actually stored, present only when there were any. That was true
-- before this migration and is untouched by it. An upload field seals no
-- answer of its own — src/answers.js returns null for the type on purpose and
-- src/fieldTypes.js says why at length. Sealing a file answer inside `answers`
-- as well would record the same fact twice and change the fingerprint of every
-- report ever filed.
--
-- WHAT DOES MOVE, and it is worth being plain about it: a launched logbook
-- that took files GAINS A QUESTION here. That is the one change a launched
-- logbook is allowed (an added optional question, src/logbooks.js), and it
-- produces a new form version the next time a report is filed. Reports already
-- filed keep the form version they were actually asked, because that is what
-- they sealed — so they verify exactly as before. The backfill is written
-- below rather than left to an operator because the alternative is a
-- deployment whose logbooks silently stop offering uploads on deploy.
--
-- Additive. One new column, one backfilled row per affected logbook, and the
-- old column kept and left unread.

BEGIN;

-- The protective handle. NOT "does this logbook ask for files" — that is the
-- questions' business, and after launch a question cannot be removed. This is
-- for the case that leaves untended: a running logbook that must stop taking
-- files now, without touching a form somebody is halfway through and without
-- a decision about the whole site.
--
-- A TIMESTAMP, NOT A BOOLEAN, because the useful fact about pulling a handle
-- is when somebody pulled it. NULL is the ordinary state.
ALTER TABLE logbooks ADD COLUMN IF NOT EXISTS files_frozen_at timestamptz;

COMMENT ON COLUMN logbooks.files_frozen_at IS
  'When somebody froze this logbook''s uploads, or NULL. A protective measure, not the everyday control: whether a logbook asks for files is whether it has a field of kind ''file''. Freezing stops NEW uploads and hides nothing already filed or published. Never hashed.';

-- The backfill. Every logbook that took files gains one upload question, at
-- the end of its questions, optional, so that it goes on offering uploads.
--
-- `position` is max + 1 within the logbook, computed per row rather than
-- globally: positions are per logbook and a shared sequence would interleave
-- them. The key is fixed rather than derived from a label so that two
-- deployments backfill to the same key and a logbook file moved between them
-- still lines up; 'attachments' is refused as a key nowhere and cannot
-- collide with a sealed answer, because an upload question seals none.
--
-- ON CONFLICT DO NOTHING covers the deployment that already has a field with
-- that key: better to leave its questions alone and have an operator add the
-- upload where they want it than to fail the migration or rename somebody's
-- field out from under a sealed answer.
INSERT INTO logbook_fields (logbook_id, key, kind, label, help, required, filterable, settings, position)
SELECT l.id,
       'attachments',
       'file',
       'Photos, video or documents',
       'Anything that shows what happened. Everything is re-encoded, so camera metadata and location do not survive.',
       false,
       false,
       '{}'::jsonb,
       coalesce((SELECT max(f.position) + 1 FROM logbook_fields f WHERE f.logbook_id = l.id), 0)
  FROM logbooks l
 WHERE l.accepts_files = true
   AND NOT EXISTS (SELECT 1 FROM logbook_fields f WHERE f.logbook_id = l.id AND f.kind = 'file')
ON CONFLICT (logbook_id, key) DO NOTHING;

-- KEPT, AND DELIBERATELY LEFT UNREAD. It is the thing the backfill above read
-- FROM, so dropping it would destroy the only record of what each logbook used
-- to say — and a migration that drops a column an older process may still be
-- selecting turns a rolling deploy into an outage. Nothing but this file names
-- it again; src/logbooks.js computes `accepts_files` from the questions.
COMMENT ON COLUMN logbooks.accepts_files IS
  'SUPERSEDED by an upload question (logbook_fields.kind = ''file'') in migration 032, which backfilled from this column. Left in place and read by nothing. Do not read it: a logbook that has gained or been built with an upload question since will disagree with it.';

COMMIT;
