-- Two permissions a reporter can give and take back at any time.
--
-- NOTHING HERE TOUCHES THE HASHED OBJECT. It adds one table. No report
-- hashes differently, no existing row is read or rewritten, and no
-- append-only table is updated. A report filed before this migration is
-- byte-identical afterwards and verifies as it always did.
--
-- WHY A LOG AND NOT TWO COLUMNS. These values must be revocable, and a
-- revocable value belongs where changing it is recorded. The alternative —
-- a mutable boolean — is not merely worse here, it is impossible: the
-- natural home for it is reports_restricted, which carries
-- `BEFORE DELETE OR UPDATE ... reject_modification()` from 001 and refuses
-- the UPDATE. So the current value is a PROJECTION over this log: the
-- newest row for a thread and a permission wins.
--
-- WHY NOT IN THE FINGERPRINT. Permanence decides where a value lives. Hash
-- what must never change; put what may change where changing it is
-- recorded. The publication question the reporter answered at filing IS
-- hashed — `may_publish`, from 006 — and that is the one that must never
-- move. These two are ongoing permissions, not a sealed answer, and the
-- chain must not know they exist.
--
-- NO DEFAULT AND NO BACKFILL, for the same reason 003 gave: a default would
-- switch a behaviour on everywhere the moment this ran. No rows for a
-- thread means neither permission was ever given, which is the safe
-- reading and the one every existing thread gets.

BEGIN;

CREATE TABLE report_permissions_log (
  id          bigserial PRIMARY KEY,
  thread_id   uuid NOT NULL,
  permission  text NOT NULL,
  granted     boolean NOT NULL,
  -- Only the reporter may act on these. A moderator granting a permission
  -- on somebody's behalf would put the operator's decision in the
  -- reporter's name, which is the thing the log exists to make impossible.
  -- The column is here so that the log states it rather than relying on
  -- every route to have been written correctly.
  actor       text NOT NULL DEFAULT 'reporter',
  -- NULL on a thread whose contact details can be erased, exactly as
  -- self_service_log does it: this table is append-only, so an address
  -- written here would outlive the erasure it was meant to honour.
  actor_email text,
  reason      text,
  created_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT report_permissions_log_permission_check CHECK (permission = ANY (ARRAY[
    -- May a moderator pass this reporter's contact details to somebody
    -- asking to follow up. Ratified 29 September. NOT a moderator reading
    -- identity during review, which is operationally necessary, already
    -- gated by a written reason and a log the reporter sees, and so is not
    -- consentable; and NOT publishing identity, which is not on offer.
    'contact_passing',
    -- May the files attached to this report be published. A second layer on
    -- top of may_publish, which covers the report itself: the report is
    -- publishable first, its files separately. Consent is the ceiling and
    -- moderation is the floor — a moderator may publish the text and not
    -- the photograph, never the reverse.
    'attachment_publication'])),
  CONSTRAINT report_permissions_log_actor_check CHECK (actor = 'reporter')
);

-- The projection reads the newest row for one thread and one permission, so
-- that is what the index serves.
CREATE INDEX report_permissions_log_current
  ON report_permissions_log (thread_id, permission, id DESC);

COMMENT ON TABLE report_permissions_log IS
  'Append-only. One row per grant or revocation of a revocable reporter permission; the current value is the newest row per (thread_id, permission). Never hashed, never part of the chain.';

CREATE TRIGGER report_permissions_log_append_only
  BEFORE DELETE OR UPDATE ON report_permissions_log
  FOR EACH ROW EXECUTE FUNCTION reject_modification();

-- Statement-level, because that is the only form TRUNCATE has — see 007,
-- which closed exactly this hole on eight other tables.
CREATE TRIGGER report_permissions_log_no_truncate
  BEFORE TRUNCATE ON report_permissions_log
  FOR EACH STATEMENT EXECUTE FUNCTION reject_modification();

COMMIT;
