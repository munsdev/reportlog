-- The single site_settings row.
--
-- 001_init.sql creates the table with `access_enabled boolean NOT NULL
-- DEFAULT true`, which is the intended posture: a deployment is gated until
-- an operator decides otherwise. But no migration ever inserted the row, so
-- the default applied to nothing, and getSiteSettings() reads a missing row
-- as `access_enabled: false`.
--
-- The result was that a fresh install came up with the gate OFF — open to
-- the internet, before anyone had set a password. Every new install is a
-- fresh install, so this was the normal path rather than an edge case.
--
-- The reader in src/siteAccess.js now also defaults to gated when there is
-- no row. Both are deliberate: this migration fixes the install path, and
-- the reader makes the dangerous state unreachable by any future path that
-- drops or fails to create the row.
--
-- Additive, and touches nothing that is hashed.

BEGIN;

INSERT INTO site_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

COMMIT;
