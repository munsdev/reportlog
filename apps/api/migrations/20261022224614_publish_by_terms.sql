-- PUBLICATION AS A CONDITION OF FILING, per logbook.
--
-- Every report seals may_publish beside the digest of the wording its
-- reporter was shown. Until now that wording was always a question, with
-- "no" a real answer. For a logbook whose point is a public record, and that
-- asks for nothing personal, a report that may not be published is one the
-- archive can do nothing with.
--
-- With this on, the reporter is TOLD rather than asked, and the report seals
-- may_publish = true beside the digest of the terms sentence (variant
-- 'terms'). The sealed object has the same keys either way, so nothing about
-- how a report verifies changes; the digest says which promise each `true`
-- was given under.
--
-- Not part of the form and never sealed itself, so it stays changeable after
-- launch, like email_required. Off by default.
ALTER TABLE logbooks ADD COLUMN publish_by_terms boolean NOT NULL DEFAULT false;

ALTER TABLE consent_texts DROP CONSTRAINT consent_texts_variant_check;
ALTER TABLE consent_texts ADD CONSTRAINT consent_texts_variant_check
  CHECK (variant IN ('general', 'coordinator', 'terms'));
