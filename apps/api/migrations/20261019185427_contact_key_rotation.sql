-- ════════════════════════════════════════════════════════════════════════
-- Rotating CONTACT_KEY (workstream C2; the design is in
-- docs/status/C2-filing.md).
--
-- A rotation re-wraps every thread's own key under a new CONTACT_KEY and
-- re-computes the address digests, in one transaction
-- (apps/api/src/filing/rotateContactKey.ts). That is an UPDATE of
-- contact_keys, which filing's migration forbade outright. THIS NARROWS
-- THAT GUARD; IT DOES NOT DROP IT, and it is said here rather than hidden:
-- an UPDATE is still refused unless the same transaction recorded a
-- rotation below, and even then it may change only the wrapped key and the
-- digest's value, never which thread a key belongs to, and never whether a
-- thread has a digest at all. So a coordinator's filing can never gain a
-- digest and come to sit under somebody's "My reports", and a reporter's
-- never loses one.
--
-- What the database cannot check is that the new wrapping holds the same
-- thread key. The rotation checks that itself, row by row, before it
-- commits.
--
-- An erased thread has no row, and a rotation never inserts, so an erased
-- thread stays erased.
-- ════════════════════════════════════════════════════════════════════════

-- Every rotation, on the record. Fingerprints only (SHA-256 of the key's
-- bytes, as the deploy records): they say "same" or "different" and
-- nothing usable about a key. APPEND-ONLY.
CREATE TABLE contact_key_rotations (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  from_fingerprint text NOT NULL CHECK (from_fingerprint ~ '^[a-f0-9]{64}$'),
  to_fingerprint   text NOT NULL CHECK (to_fingerprint ~ '^[a-f0-9]{64}$'),
  rewrapped        integer NOT NULL DEFAULT 0 CHECK (rewrapped >= 0),
  -- The transaction that did it: what lets that transaction, and only it,
  -- update contact_keys.
  xact             xid8 NOT NULL DEFAULT pg_current_xact_id(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (from_fingerprint <> to_fingerprint)
);
-- The count is written once the rows are done, in the same transaction, so
-- the row may be updated exactly there and nowhere else.
CREATE FUNCTION contact_key_rotations_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.xact = pg_current_xact_id()
     AND NEW.xact = OLD.xact
     AND NEW.id = OLD.id
     AND NEW.from_fingerprint = OLD.from_fingerprint
     AND NEW.to_fingerprint = OLD.to_fingerprint
     AND NEW.created_at = OLD.created_at THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'contact_key_rotations is append-only';
END;
$$;
CREATE TRIGGER contact_key_rotations_append_only BEFORE UPDATE OR DELETE ON contact_key_rotations
  FOR EACH ROW EXECUTE FUNCTION contact_key_rotations_guard();
CREATE TRIGGER contact_key_rotations_no_truncate BEFORE TRUNCATE ON contact_key_rotations
  FOR EACH STATEMENT EXECUTE FUNCTION reject_modification();

-- The guard on contact_keys, narrowed as described above. The function name
-- and its trigger are filing's; only the body changes.
CREATE OR REPLACE FUNCTION contact_keys_no_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM contact_key_rotations WHERE xact = pg_current_xact_id())
     AND NEW.thread_id = OLD.thread_id
     AND NEW.created_at = OLD.created_at
     AND (NEW.email_hmac IS NULL) = (OLD.email_hmac IS NULL) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'a contact key is never changed, only destroyed (or re-wrapped by a recorded rotation)';
END;
$$;
