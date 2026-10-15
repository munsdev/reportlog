-- First-run setup: a record that the deployment has been handed over.
--
-- Additive only. Nothing here touches `reports`, so no fingerprint changes
-- and no report needs re-verifying.
--
-- Why this exists: a fresh install comes up gated with no password set, and
-- /api/auth sits behind the gate. Nobody can sign in to set a password,
-- because signing in is behind the password. The installer now sets a
-- curtain password (scripts/set-curtain-password.js), and the operator uses
-- it to reach a setup wizard that mints their own admin account and forces
-- a decision about that password.
--
-- The column is a timestamp rather than a boolean because "when was this
-- handed over" is a question somebody will ask, and a boolean cannot answer
-- it. NULL means setup has not been completed.
--
-- It is deliberately NOT the only condition. src/setup.js also treats a
-- deployment that already has an admin as set up, so a database whose flag
-- is lost cannot reopen the wizard on a live archive.
BEGIN;

ALTER TABLE site_settings
  ADD COLUMN IF NOT EXISTS setup_completed_at timestamptz;

-- An existing deployment has an operator already. Marking those complete
-- here means this migration cannot open a setup wizard on a running site
-- with reports in it, which is the one dangerous thing it could do.
UPDATE site_settings
   SET setup_completed_at = now()
 WHERE setup_completed_at IS NULL
   AND EXISTS (SELECT 1 FROM users WHERE role = 'admin');

COMMIT;
