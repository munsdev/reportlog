-- Close the hole in "append-only".
--
-- Eight tables carry a BEFORE DELETE OR UPDATE trigger and are described,
-- here and in CLAUDE.md, as append-only: "never UPDATE, never DELETE". That
-- description is true of DELETE and UPDATE and was never true of TRUNCATE.
--
-- PostgreSQL does not fire row-level triggers for TRUNCATE. So a single
-- statement emptied the entire archive, in one step, and the guard that
-- exists to prevent exactly that stayed silent. Found on 11 September while
-- writing a reset procedure for a test instance: the reset worked, with the
-- protection still switched on, which is what made it obvious.
--
-- What this does not claim. Somebody who owns this database can still DROP
-- the table, restore an older dump over it, or edit the files underneath.
-- This is not a defence against the operator, and nothing at this layer can
-- be. It closes the distance between what the invariant SAYS and what it
-- ENFORCES, so that the easiest way to destroy the archive is no longer the
-- one the system forgot to look at.
--
-- Statement-level, because that is the only form TRUNCATE has: there are no
-- rows to run once per. reject_modification() needs no change — TG_OP reads
-- 'TRUNCATE' and the message it already writes is the right one.
--
-- Additive. No column changes, no backfill, nothing touched in `reports`, so
-- no report's fingerprint moves and none needs re-verifying.
--
-- CONSEQUENCE FOR OPERATORS, worth knowing before you meet it: emptying a
-- test instance now requires disabling these deliberately, which is the point.
-- An append-only archive should be awkward to empty. The procedure is in
-- docs/runbook-test-instance.md.

BEGIN;

CREATE TRIGGER reports_no_truncate BEFORE TRUNCATE ON reports
  FOR EACH STATEMENT EXECUTE FUNCTION reject_modification();

CREATE TRIGGER reports_restricted_no_truncate BEFORE TRUNCATE ON reports_restricted
  FOR EACH STATEMENT EXECUTE FUNCTION reject_modification();

CREATE TRIGGER chain_anchors_no_truncate BEFORE TRUNCATE ON chain_anchors
  FOR EACH STATEMENT EXECUTE FUNCTION reject_modification();

CREATE TRIGGER attachments_no_truncate BEFORE TRUNCATE ON attachments
  FOR EACH STATEMENT EXECUTE FUNCTION reject_modification();

CREATE TRIGGER access_log_no_truncate BEFORE TRUNCATE ON access_log
  FOR EACH STATEMENT EXECUTE FUNCTION reject_modification();

CREATE TRIGGER self_service_log_no_truncate BEFORE TRUNCATE ON self_service_log
  FOR EACH STATEMENT EXECUTE FUNCTION reject_modification();

CREATE TRIGGER role_audit_no_truncate BEFORE TRUNCATE ON role_audit
  FOR EACH STATEMENT EXECUTE FUNCTION reject_modification();

CREATE TRIGGER consent_texts_no_truncate BEFORE TRUNCATE ON consent_texts
  FOR EACH STATEMENT EXECUTE FUNCTION reject_modification();

COMMIT;
