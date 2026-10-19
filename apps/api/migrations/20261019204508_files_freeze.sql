-- ════════════════════════════════════════════════════════════════════════
-- THE FILE FREEZE (workstream B2). Ported from legacy migration 032's
-- `files_frozen_at`.
--
-- A PROTECTIVE HANDLE, not the everyday control. Whether a logbook asks for
-- files is whether it has an upload question, and after launch a question
-- cannot be removed. This is for the case that rule leaves untended: a
-- running logbook that must stop taking files NOW, without touching the
-- form somebody is halfway through, and without switching files off for the
-- whole site.
--
-- A TIMESTAMP, NOT A BOOLEAN, because the useful fact about pulling a
-- handle is when somebody pulled it. NULL is the ordinary state.
--
-- NEVER SEALED. Nothing that rebuilds a sealed object reads it
-- (sealedReportRows selects named columns), and it is not on
-- `logbook_fields`, so the one-way door is untouched: freezing is allowed
-- before and after launch, both ways. A report's files live in its own
-- `attachments` key, present only when there were any, so freezing adds
-- nothing to reports already filed and unfreezing takes nothing from them.
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE logbooks ADD COLUMN files_frozen_at timestamptz;

COMMENT ON COLUMN logbooks.files_frozen_at IS
  'When somebody froze this logbook''s uploads, or NULL. A protective measure, not the everyday control: whether a logbook asks for files is whether it has a question of kind ''file''. Freezing stops NEW upload slots and hides nothing already filed or published. Never sealed.';

-- A FROZEN LOGBOOK TAKES NO NEW UPLOAD SLOT, whoever asks: a reporter
-- filing, or one answering an evidence request. slots.ts refuses first with
-- a sentence; this is what holds if a path forgets to. Slots already made
-- are left alone, so a freeze never deletes anything a reporter sent.
CREATE FUNCTION upload_slots_not_frozen() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM logbooks
              WHERE id = NEW.logbook_id AND files_frozen_at IS NOT NULL) THEN
    RAISE EXCEPTION 'uploads to this logbook are frozen (logbook %)', NEW.logbook_id;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER upload_slots_not_frozen BEFORE INSERT ON upload_slots
  FOR EACH ROW EXECUTE FUNCTION upload_slots_not_frozen();
