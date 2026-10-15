-- The words on this deployment's own pages.
--
-- Additive only. Nothing here touches `reports`, so no fingerprint changes
-- and no report needs re-verifying.
--
-- A KEY/VALUE TABLE, NOT A COLUMN PER PAGE, and that is the whole design
-- decision. A column per slot means a migration every time somebody wants
-- another editable paragraph, which means it does not happen, which means
-- the copy stays in the source where only a deploy can change it. A row per
-- slot means adding one is a line in src/siteCopy.js.
--
-- The set of VALID keys lives in the code rather than in a constraint here,
-- for the same reason: a CHECK listing them would put the list in two
-- places and make adding one a migration again. An unknown key in this
-- table is ignored by the reader rather than being an error — a row left
-- behind by a slot that was renamed should not break a page.
--
-- NULL AND ABSENT BOTH MEAN "use what the software ships", which is NOT
-- what migration 013 chose for the legal text. The difference is deliberate
-- and it is the difference between the two kinds of text. A missing privacy
-- policy must say it is missing, because a placeholder that reads like a
-- policy is dangerous. A missing front page has a safe, honest default that
-- already ships and already says the operator has not written one yet.
--
-- NEVER HASHED. Presentation. Nothing in reportCore.js or verify.js may
-- read it: a report must not verify differently because somebody rewrote
-- the front page.
BEGIN;

CREATE TABLE IF NOT EXISTS site_copy (
  key        text PRIMARY KEY,
  body       text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT site_copy_key_check CHECK (key ~ '^[a-z0-9_]{1,60}$')
);

-- Not append-only, deliberately, unlike the archive. This is what a
-- deployment currently says about itself, not a record of anything that
-- happened. Nothing points at a row here and no digest names one.

COMMIT;
