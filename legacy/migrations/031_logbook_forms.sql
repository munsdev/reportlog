-- Which questions a report was answered against, sealed.
--
-- A report seals its answers under the logbook's question keys. Until now
-- nothing sealed the QUESTIONS, so a reader could check that an answer had
-- not changed and could not check what it had been an answer to. The seal
-- over the answer is worth exactly as much as the fixity of the question.
--
-- THE HASHED OBJECT GAINS ONE KEY, `logbook_form`, written only when the
-- report has a form version: the SHA-256 of the form's definition exactly as
-- stored here. It is conditional, like every optional key, so no report
-- filed before this migration hashes differently and none needs re-verifying.
-- Reports filed before it have no `form_id` and no key.
--
-- FORMS HAVE VERSIONS. Launching freezes a logbook's questions, but a new
-- OPTIONAL question may still be added afterwards. So the definition changes
-- over a logbook's life, and each report seals the version its reporter was
-- actually asked. A version is written the first time a report is filed
-- against a question set that has no version yet; the set only ever grows,
-- so a hash never comes back after a different one.
--
-- THE DEFINITION IS text, NOT jsonb. Its bytes are hashed and are meant to
-- be published, and jsonb would store something that hashes differently from
-- what was written. The CHECK below makes the database itself refuse a hash
-- that is not the SHA-256 of the text beside it.
--
-- Append-only, and not truncatable, like the reports that point at it.

BEGIN;

CREATE TABLE logbook_forms (
  id          bigserial PRIMARY KEY,
  logbook_id  bigint NOT NULL REFERENCES logbooks(id),
  form_hash   text NOT NULL,
  definition  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT logbook_forms_hash_check
    CHECK (form_hash = encode(sha256(convert_to(definition, 'UTF8')), 'hex')),
  UNIQUE (logbook_id, form_hash)
);

CREATE TRIGGER logbook_forms_append_only BEFORE DELETE OR UPDATE ON logbook_forms
  FOR EACH ROW EXECUTE FUNCTION reject_modification();
CREATE TRIGGER logbook_forms_no_truncate BEFORE TRUNCATE ON logbook_forms
  FOR EACH STATEMENT EXECUTE FUNCTION reject_modification();

-- Nullable, no default, no backfill: a report without one was filed before
-- forms were sealed, and the absence is what says so.
ALTER TABLE reports ADD COLUMN form_id bigint REFERENCES logbook_forms(id);

COMMIT;
