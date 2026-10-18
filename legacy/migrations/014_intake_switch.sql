-- Whether this deployment is accepting new reports.
--
-- Additive only. Nothing here touches `reports`, so no fingerprint changes
-- and no report needs re-verifying.
--
-- THE OTHER END OF THE SITE. Migration 009 gave an operator a switch over
-- what leaves the building; this is the switch over what comes in. They are
-- deliberately independent, because the arrangement this exists for needs
-- them independent: a deployment may collect reports while publishing
-- nothing, or stop collecting while everything already approved stays
-- readable. Neither implies the other, and neither is a substitute for a
-- moderator.
--
-- A DELIVERY-LAYER SETTING, NEVER HASHED. The chain must not know this
-- exists. Whether an operator had intake open in a given week is not a fact
-- about any report they hold, and a report must not verify differently
-- because the form was later closed. Same rule, and the same reason, as the
-- public-archive switch.
--
-- NULL MEANS NO OPINION, AND RESOLVES TO OPEN. That is what every existing
-- deployment does today, and a migration must not close a running intake on
-- the night it is applied. An operator closing intake is an operator
-- pressing the switch, never a schema change happening to them.
BEGIN;

ALTER TABLE site_settings
  ADD COLUMN IF NOT EXISTS intake_enabled boolean;

COMMENT ON COLUMN site_settings.intake_enabled IS
  'Whether this deployment accepts new reports. NULL = no opinion, which resolves to open, because that is what every deployment did before this column existed. Never hashed: it is delivery-layer, and a report must not verify differently because intake was later closed.';

COMMIT;
