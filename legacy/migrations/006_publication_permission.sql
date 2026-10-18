-- The reporter's answer to "should this report be published?", and the exact
-- sentence they answered.
--
-- Additive only. No backfill, and therefore NO dropping of the append-only
-- trigger on `reports` — backfilling is the only acceptable reason to touch
-- it, and this is not one. Every report that already exists carries neither
-- column, hashes exactly as it did before this ran, and continues to verify.
--
-- THE COLUMNS ARE NULLABLE AND HAVE NO DEFAULT, AND THAT IS THE WHOLE
-- DESIGN. `ongoing` is `boolean NOT NULL DEFAULT false` and can therefore
-- only ever say two things. This one has to say three:
--
--   true    asked, and permitted
--   false   asked, and not permitted
--   NULL    never asked
--
-- NULL must become an ABSENT KEY in the hashed object, never a `null` value
-- in it. The canonical serialization treats those differently, so a helper
-- that writes null instead of omitting the key changes the fingerprint of
-- every report it touches while looking correct. Migration 003 set the same
-- precedent for the same reason: a DEFAULT here would have made a statement
-- about every existing row that nobody ever made.
--
-- It is called `may_publish` and not `consent_public` deliberately. The
-- lawful basis for the archive is not Article 6(1)(a) consent, and the card
-- asks a question rather than soliciting a consent. Sealing the word consent
-- into a fingerprint that is displayed on the verify page would embed a
-- framing the design rejected, in the one place it can never be edited.

BEGIN;

ALTER TABLE reports
  ADD COLUMN may_publish        boolean,
  ADD COLUMN may_publish_digest text;

-- The digest travels with the answer or not at all: a permission with no
-- record of what was permitted is not interpretable, and a record with no
-- permission is noise.
ALTER TABLE reports
  ADD CONSTRAINT reports_may_publish_digest_together CHECK (
    (may_publish IS NULL AND may_publish_digest IS NULL)
    OR (may_publish IS NOT NULL AND may_publish_digest IS NOT NULL)
  );

-- The text each digest stands for.
--
-- This is the SOURCE of the card's wording, not a copy of it. The server
-- has to hold the text to be able to digest it honestly: the alternative is
-- the browser sending a digest, which lets a client seal a claim about a
-- sentence it never displayed. That is worse than having no digest at all,
-- because it is a false statement inside the fingerprint.
--
-- Append-only, like `reports`, and for the same reason. A stored digest is a
-- promise that the sentence it names can still be read. Editing a row here
-- would quietly change what an old report's `true` meant.
--
-- Changing the wording is an INSERT, not an UPDATE. The new text gets a new
-- digest, reports filed afterwards point at it, and reports filed before keep
-- pointing at the old one. Nothing is retroactive and nothing has to be
-- frozen at a go-live that does not exist.
CREATE TABLE consent_texts (
  digest       text PRIMARY KEY,
  variant      text NOT NULL,
  body         text NOT NULL,
  -- A role, not a person. This table publishes with the transparency log to
  -- repositories outside the operator's control, and an administrator's name
  -- in a public file is a cost with no matching benefit.
  introduced_by_role text NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT consent_texts_digest_check CHECK (digest ~ '^[a-f0-9]{64}$'),
  CONSTRAINT consent_texts_variant_check CHECK (variant = ANY (ARRAY['general', 'coordinator']))
);

CREATE TRIGGER consent_texts_append_only BEFORE DELETE OR UPDATE ON consent_texts
  FOR EACH ROW EXECUTE FUNCTION reject_modification();

COMMIT;
