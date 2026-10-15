-- A reporter can have their contact details erased.
--
-- NOTHING HERE REWRITES A ROW. Every statement adds a column with no
-- default, adds a table, or widens a constraint. No report hashes
-- differently, and no append-only table is updated.

BEGIN;

-- A REPORTER'S CONTACT DETAILS CAN BE ERASED.
--
-- reports_restricted is append-only by trigger, and stays that way. What
-- changes is what its encrypted columns are encrypted UNDER. A new report's
-- details are sealed under a key of their own, wrapped by the master key and
-- kept in this table, which may delete. Erasing is deleting the row: the
-- ciphertext in reports_restricted is untouched and can never be read again.
--
-- The email's keyed digest — how "My Reports" finds a person's reports —
-- lives here too for the same reason, and reports_restricted.contact_email_hmac
-- is left NULL on these rows. After an erasure nothing links the report to
-- an address.
--
-- Reports filed before this migration keep their details under the master
-- key, which cannot be erased without breaking the append-only rule. They
-- can still be withdrawn. key_scheme says which kind a row is.
CREATE TABLE contact_keys (
  thread_id          uuid PRIMARY KEY REFERENCES report_heads(thread_id),
  dek_wrapped        bytea NOT NULL,
  contact_email_hmac text,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX contact_keys_hmac_idx ON contact_keys (contact_email_hmac);

ALTER TABLE reports_restricted ADD COLUMN key_scheme text;
ALTER TABLE reports_restricted ADD CONSTRAINT reports_restricted_key_scheme_check CHECK (
  key_scheme = ANY (ARRAY['thread']));

ALTER TABLE self_service_log DROP CONSTRAINT self_service_log_action_check;
ALTER TABLE self_service_log ADD CONSTRAINT self_service_log_action_check CHECK (action = ANY (ARRAY[
  'correct', 'withdraw', 'restore', 'review', 'veracity',
  'incident', 'media', 'upload_rejected', 'severity', 'erase']));

COMMIT;
