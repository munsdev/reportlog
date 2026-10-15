-- A reporter sending evidence they were asked for is a self-service action,
-- so it needs a name in `self_service_log`.
--
-- UNIONED WITH WHAT IS ALREADY THERE, never restated. This is the lesson
-- 036 paid for twice: its first version rebuilt this very CHECK from the
-- 001 list and silently dropped 'erase', which 028 had added — so erasing a
-- reporter's contact details started failing with "Something went wrong".
-- Its second attempt parsed `pg_get_constraintdef` and managed to allow the
-- literal string `correct'::text`.
--
-- The union with what the table actually holds means a migration cannot
-- narrow this constraint under its own history by forgetting an entry, and
-- the explicit list means a value nothing has used yet is still allowed.
--
-- 'evidence' rather than 'upload': the log is read by a person, and "sent
-- evidence they were asked for" is a different event from "attached a file
-- while filing", which never appears here at all.

BEGIN;

DO $$
DECLARE
  allowed text[];
BEGIN
  SELECT array_agg(DISTINCT a ORDER BY a) INTO allowed
    FROM unnest(
      ARRAY[
        -- 001
        'correct', 'incident', 'media', 'restore', 'review', 'severity',
        'upload_rejected', 'veracity', 'withdraw',
        -- 028
        'erase',
        -- 036
        'note', 'note_link', 'note_revised', 'note_state',
        -- 042: the reporter answered a request for evidence.
        'evidence'
      ]
      || coalesce((SELECT array_agg(DISTINCT action) FROM self_service_log), ARRAY[]::text[])
    ) AS a;

  EXECUTE format(
    'ALTER TABLE self_service_log DROP CONSTRAINT self_service_log_action_check,
       ADD CONSTRAINT self_service_log_action_check CHECK (action = ANY (%L::text[]))',
    allowed);
END $$;

COMMIT;
