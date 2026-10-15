-- Two delivery-layer switches: does this deployment publish an archive at
-- all, and may anything be distributed onward from it.
--
-- Additive only. Nothing here touches `reports`, so no fingerprint changes
-- and no report needs re-verifying.
--
-- THESE MUST NEVER ENTER THE HASHED OBJECT, and the chain must not know
-- they exist. A report's fingerprint says what was reported and what the
-- reporter permitted. Whether a given deployment chose to put an approved
-- report on a web page is a fact about the deployment on a Tuesday, not
-- about the report — and a report whose seal recorded the operator's
-- settings would verify differently after somebody flipped a switch that
-- has nothing to do with its contents.
--
-- `may_publish` is the reporter's answer and IS hashed. This is the other
-- half: the reporter permitting publication does not oblige a deployment to
-- publish, and a deployment willing to publish cannot publish what the
-- reporter did not permit. Both must be true. Neither substitutes.
--
-- NULL means "no opinion", the same way migration 003 did it for
-- attachments, and for the same reason: a column with a DEFAULT would make
-- this migration itself a decision on every existing deployment. What NULL
-- RESOLVES to differs between the two, deliberately, and each direction is
-- the one that cannot surprise anybody:
--
--   public_archive_enabled NULL -> ON. It is what the software does today.
--     Turning it off by migration would empty a running board with nothing
--     on screen to say why.
--
--   distribution_enabled NULL -> OFF. Nothing distributes today, and a
--     deployment must never start distributing because a migration ran.
--     An operator saying yes is the only thing that may turn it on.
BEGIN;

ALTER TABLE site_settings
  ADD COLUMN IF NOT EXISTS public_archive_enabled boolean,
  ADD COLUMN IF NOT EXISTS distribution_enabled   boolean;

COMMENT ON COLUMN site_settings.public_archive_enabled IS
  'Does this deployment publish an archive at all. NULL = no opinion, which resolves to ON because that is what the software already does. Never hashed. A report still needs may_publish and a moderator; this can only withhold, never publish something unapproved.';

COMMENT ON COLUMN site_settings.distribution_enabled IS
  'May anything be distributed onward from this deployment. NULL = no opinion, which resolves to OFF. Never hashed. Nothing reads this to distribute yet; it exists so that when something does, no deployment is distributing by default.';

COMMIT;
