-- Every saved version of the site's page wording, so a standard written in
-- it (the moderation standard, `standards`) can say "Version 3, published
-- 28 October 2026" as the journalist standard does.
--
-- Filled by the database itself: a trigger on site_copy writes a row each
-- time a slot is written with words that differ from its newest version, so
-- no path that saves wording can forget. Going back to the shipped wording
-- deletes the slot's row in site_copy and writes nothing here; the history
-- stays.
--
-- Wording already written is version 1, dated when it was last changed.
-- APPEND-ONLY: a record of versions that could be edited would be a record
-- of nothing.
CREATE TABLE site_copy_versions (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  key        text NOT NULL,
  body       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX site_copy_versions_key_idx ON site_copy_versions (key, id DESC);

INSERT INTO site_copy_versions (key, body, created_at)
  SELECT key, body, updated_at FROM site_copy ORDER BY updated_at;

CREATE FUNCTION site_copy_record_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Only when the words differ from the newest version, so a bundle import
  -- or a starting point that writes the same words again is not a version.
  IF NEW.body IS DISTINCT FROM (
    SELECT v.body FROM site_copy_versions v WHERE v.key = NEW.key ORDER BY v.id DESC LIMIT 1
  ) THEN
    INSERT INTO site_copy_versions (key, body) VALUES (NEW.key, NEW.body);
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER site_copy_record_version AFTER INSERT OR UPDATE ON site_copy
  FOR EACH ROW EXECUTE FUNCTION site_copy_record_version();

CREATE FUNCTION site_copy_versions_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'site_copy_versions is append-only';
END;
$$;
CREATE TRIGGER site_copy_versions_append_only BEFORE UPDATE OR DELETE ON site_copy_versions
  FOR EACH ROW EXECUTE FUNCTION site_copy_versions_append_only();
