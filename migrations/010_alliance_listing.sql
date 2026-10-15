-- The Alliance directory: an organization's own decision to be listed.
--
-- Additive only. Nothing here touches `reports`, so no fingerprint changes
-- and no report needs re-verifying.
--
-- DELIBERATELY NOT CHAINED, and this is the whole design rather than an
-- omission. Participation is mutable state about a living relationship. A
-- chained record of it would make an organization's membership permanently
-- unremovable, which is the wrong promise for something that can end. The
-- archive's job is to make what was reported permanent; who is currently
-- willing to stand beside the project is not that.
--
-- Opting out removes an organization from the directory. It does NOT remove
-- them from the reports they filed — that is `reports.organization_id` and
-- the public provenance on the report itself, which is sealed, permanent,
-- and a different thing entirely.
--
-- Default false. An organization that has not decided is not listed:
-- listing is a claim made on their behalf, and a migration must not make it
-- for them.
BEGIN;

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS listed    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS listed_at timestamptz;

COMMENT ON COLUMN organizations.listed IS
  'Has this organization opted in to the public Alliance directory. Set by its own manager, revocable at any time. Never chained: this is mutable state about a relationship, not archive material.';

COMMENT ON COLUMN organizations.listed_at IS
  'When they first opted in — the "joined" date the directory shows. Kept across an opt-out so re-listing does not reset it, because the date answers "since when have they been part of this", not "how long has this boolean been true".';

COMMIT;
