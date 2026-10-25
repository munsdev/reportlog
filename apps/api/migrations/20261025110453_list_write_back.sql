-- "We'll write back": a list may say the team will use the address to reply.
--
-- An entry's email is encrypted and, until now, no member of staff could ever
-- read it, so a contact list could be filled in and never answered. Turning
-- this on does two things and nothing else: the public form says in plain
-- words that the team will use the address to reply, and a reviewer may open
-- one entry's address from the review page. Off, nothing changes.
--
-- Nothing here is sealed or chained: an entry is not a report.
ALTER TABLE lists ADD COLUMN write_back boolean NOT NULL DEFAULT false;

-- Every time a reviewer opens an address, and who. The address itself is NEVER
-- written here: a log that held what it guards would be a second copy of it.
-- The row is written BEFORE the address is decrypted, so an unlogged look is
-- not possible. APPEND-ONLY, like contact_access_log: a log of looks that
-- could be edited would be a log of nothing.
CREATE TABLE list_address_reveals (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  staff_email text NOT NULL CHECK (length(btrim(staff_email)) > 0),
  list_id     bigint NOT NULL REFERENCES lists (id),
  entry_id    bigint NOT NULL REFERENCES list_entries (id),
  accessed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX list_address_reveals_entry_idx ON list_address_reveals (entry_id, accessed_at DESC);
CREATE TRIGGER list_address_reveals_append_only BEFORE UPDATE OR DELETE ON list_address_reveals
  FOR EACH ROW EXECUTE FUNCTION reject_modification();
CREATE TRIGGER list_address_reveals_no_truncate BEFORE TRUNCATE ON list_address_reveals
  FOR EACH STATEMENT EXECUTE FUNCTION reject_modification();
