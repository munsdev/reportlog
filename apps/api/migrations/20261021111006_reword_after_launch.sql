-- A LAUNCHED LOGBOOK MAY BE REWORDED, NEVER RE-CODED (ruling 48, the
-- ElectionLog questionnaires §01 and §05).
--
-- Launching stays a one-way door. Afterwards a question's WORDS may change:
-- its label, its help, the label of an option that has a code, the help shown
-- for an answer, a card's own question. Nothing that is sealed under an answer
-- may: the key, the kind, the order, whether it is required, its "only if",
-- and every code (an option's code, a set's condition, a location's code
-- setting). A plain string option is its own code, so rewording one is
-- changing a code and stays refused.
--
-- A REPORT KEEPS SEALING THE FORM IT WAS ASKED. Rewording makes a new form
-- version (logbook_forms, append-only), exactly as adding an optional question
-- does; every report already filed keeps the hash of the version it answered.
--
-- `form_settings_without_wording` MUST STAY IN STEP WITH `withoutWording` in
-- packages/fields/src/options.ts. The application checks first and says why;
-- this is what holds if a path forgets to.
--
-- The core migration's guard is replaced here, never edited there.

CREATE FUNCTION form_option_codes(list jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN jsonb_typeof(list) = 'array' THEN (
    SELECT coalesce(jsonb_agg(
             CASE WHEN jsonb_typeof(o) = 'object'
                       AND jsonb_typeof(o -> 'code') = 'string'
                       AND jsonb_typeof(o -> 'label') = 'string'
                  THEN o -> 'code' ELSE o END
             ORDER BY ord), '[]'::jsonb)
      FROM jsonb_array_elements(list) WITH ORDINALITY AS t(o, ord))
  ELSE list END
$$;

CREATE FUNCTION form_settings_without_wording(s jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT (s - 'card_question')
    || CASE WHEN s ? 'options'
            THEN jsonb_build_object('options', form_option_codes(s -> 'options'))
            ELSE '{}'::jsonb END
    || CASE WHEN jsonb_typeof(s -> 'option_sets') = 'array' THEN jsonb_build_object('option_sets', (
         SELECT coalesce(jsonb_agg(
                  CASE WHEN jsonb_typeof(e) = 'object' AND e ? 'options'
                       THEN e || jsonb_build_object('options', form_option_codes(e -> 'options'))
                       ELSE e END
                  ORDER BY ord), '[]'::jsonb)
           FROM jsonb_array_elements(s -> 'option_sets') WITH ORDINALITY AS t(e, ord)))
            ELSE '{}'::jsonb END
    || CASE WHEN jsonb_typeof(s -> 'help_when') = 'array' THEN jsonb_build_object('help_when', (
         SELECT coalesce(jsonb_agg(
                  CASE WHEN jsonb_typeof(h) = 'object' THEN h - 'help' ELSE h END
                  ORDER BY ord), '[]'::jsonb)
           FROM jsonb_array_elements(s -> 'help_when') WITH ORDINALITY AS t(h, ord)))
            ELSE '{}'::jsonb END
$$;

CREATE OR REPLACE FUNCTION logbook_fields_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  launched timestamptz;
BEGIN
  SELECT launched_at INTO launched FROM logbooks
   WHERE id = COALESCE(NEW.logbook_id, OLD.logbook_id);
  IF launched IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.required THEN
      RAISE EXCEPTION 'a launched logbook may only gain an optional question';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'a launched logbook''s questions are never removed';
  END IF;
  -- label and help are left out on purpose: they are wording.
  IF (NEW.logbook_id, NEW.key, NEW.kind, NEW.required, NEW.shown_when,
      form_settings_without_wording(NEW.settings), NEW.position)
     IS DISTINCT FROM
     (OLD.logbook_id, OLD.key, OLD.kind, OLD.required, OLD.shown_when,
      form_settings_without_wording(OLD.settings), OLD.position) THEN
    RAISE EXCEPTION 'a launched logbook''s questions are never changed, only reworded';
  END IF;
  RETURN NEW;
END;
$$;
