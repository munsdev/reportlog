-- A record of which template a deployment was started from.
--
-- Additive only. Nothing here touches `reports`.
--
-- READ THIS BEFORE ASSUMING WHAT THIS TABLE IS FOR. It does NOT govern
-- behaviour and nothing consults it at request time. A template is a bundle
-- of settings APPLIED ONCE: applying it writes the ordinary settings rows an
-- administrator could have typed by hand, and then it is over. Afterwards
-- this deployment is a deployment with those settings, every one of which
-- stays individually editable forever.
--
-- This table exists so an operator can answer "where did these defaults come
-- from" six months later, and so the wizard knows whether it has already
-- asked. That is all. If templates turn out to be the wrong idea, this table
-- and the code around it can be deleted and NO deployment changes behaviour,
-- because all any template ever did was write settings that already existed.
--
-- The alternative design — a `deployment_type` that the code branches on —
-- was rejected for exactly that reason: it starts as a convenience and ends
-- as a permanent fork in every query, every view and every migration.
BEGIN;

ALTER TABLE site_settings
  ADD COLUMN IF NOT EXISTS template_applied    text,
  ADD COLUMN IF NOT EXISTS template_applied_at timestamptz;

COMMENT ON COLUMN site_settings.template_applied IS
  'Which template this deployment was started from, for the record only. Nothing reads this to decide behaviour: a template writes ordinary settings and then has no further effect. NULL = none was applied.';

COMMIT;
