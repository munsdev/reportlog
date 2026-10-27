-- W1: text and links held outside the report, erasable, sealed as fingerprints.
--
-- ADDITIVE ONLY. Two nullable columns on `reports` and three new tables.
-- Nothing existing is read differently: a report with both new columns NULL
-- rebuilds exactly as before (packages/seal/src/report.ts), and every report
-- filed before this migration has them NULL. An older release ignores the
-- columns and the tables entirely (docs/status/FT-S1.md, "Rollback").
--
-- THE SHAPE, by hand (packages/seal/src/held.ts): a `private_text` or
-- `private_link` answer is NOT in `answers`. The value is encrypted under a
-- key of its own in `report_values`, beside a random nonce made for it; the
-- report seals SHA-256 of the RFC 8785 JSON {"nonce": …, "value": …} under
-- `text_fingerprints` or `link_fingerprints`. Erasing deletes the value, its
-- nonce and its key, and appends a tombstone. The fingerprint stays on the
-- report, so the report still verifies.

-- ── the fingerprints, on the report ──────────────────────────────────────

-- The same objects that were sealed under these keys, written from the sealed
-- object and never from the request, like `answers`. ABSENT IS NULL, NEVER
-- '{}': under RFC 8785 those are different values. `reports` stays
-- append-only; these are written once, at insert.
ALTER TABLE reports ADD COLUMN text_fingerprints jsonb
  CHECK (text_fingerprints IS NULL
         OR (jsonb_typeof(text_fingerprints) = 'object' AND text_fingerprints <> '{}'::jsonb));
ALTER TABLE reports ADD COLUMN link_fingerprints jsonb
  CHECK (link_fingerprints IS NULL
         OR (jsonb_typeof(link_fingerprints) = 'object' AND link_fingerprints <> '{}'::jsonb));

-- ── the values ──────────────────────────────────────────────────────────

-- One row per held value: a report's text for one question, or one of its
-- links. `value_enc` is AES-256-GCM, under a key of its own (`value_key`,
-- wrapped by the site's link secret, links/keys.ts), of the JSON
-- {"nonce": …, "value": …}: the nonce goes with the value, because a nonce
-- that outlived its value would let anybody holding the database test a
-- guessed value against the published fingerprint.
--
-- ERASING IS DELETING THE ROW (K9, X2): value, nonce and key go together,
-- and a backup holds a wrapped key only while the link secret it hangs from
-- is unchanged. NOT APPEND-ONLY, ON PURPOSE. `report_value_erasures` is the
-- record that it happened.
--
-- `group_id` joins a link to every copy of the same address, tips included
-- (K11), when the link store groups it (wave 2, W3). NULL for text, and for
-- a link not grouped yet.
CREATE TABLE report_values (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  report_id  bigint NOT NULL REFERENCES reports (id),
  field_key  text NOT NULL CHECK (field_key ~ '^[a-z0-9][a-z0-9_]{0,38}$'),
  kind       text NOT NULL CHECK (kind IN ('private_text', 'private_link')),
  -- Which link of the question, from 0, in the order sent. Always 0 for text.
  position   smallint NOT NULL DEFAULT 0 CHECK (position BETWEEN 0 AND 19),
  group_id   bigint REFERENCES link_groups (id),
  -- The fingerprint the report sealed for this value, as in its
  -- `*_fingerprints` column. Not secret: it is what the verify page shows.
  -- Kept here so a check, a clearance or an erasure can name the value the
  -- same way in every version that carries it (a version that only adds
  -- files carries the rows, nonce and all, so the fingerprint is the same).
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
  value_enc  bytea NOT NULL,
  value_key  bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (report_id, field_key, position),
  CHECK (kind = 'private_link' OR (position = 0 AND group_id IS NULL))
);
CREATE INDEX report_values_report_idx ON report_values (report_id);
CREATE INDEX report_values_fingerprint_idx ON report_values (fingerprint);
CREATE INDEX report_values_group_idx ON report_values (group_id) WHERE group_id IS NOT NULL;

-- ── the tombstones ───────────────────────────────────────────────────────

-- APPEND-ONLY, like the reports they speak about (X3). Which report and
-- which value (question and position), when, who, and a reason category.
-- Never what the value was: a written description of illegal material is a
-- copy of it, which is why the reason is a category and not a sentence.
-- `actor` is the staff member's address, or `reporter` when the reporter
-- erased their own words, or `system` for a named sweep.
CREATE TABLE report_value_erasures (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  report_id       bigint NOT NULL REFERENCES reports (id),
  field_key       text NOT NULL CHECK (field_key ~ '^[a-z0-9][a-z0-9_]{0,38}$'),
  kind            text NOT NULL CHECK (kind IN ('private_text', 'private_link')),
  position        smallint NOT NULL CHECK (position BETWEEN 0 AND 19),
  -- The sealed fingerprint of what was erased, so anybody can see which
  -- fingerprint on the report no longer has a value behind it.
  fingerprint     text NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
  reason_category text NOT NULL CHECK (reason_category ~ '^[a-z][a-z-]{1,62}$'),
  actor           text NOT NULL CHECK (length(btrim(actor)) > 0),
  created_at      timestamptz NOT NULL DEFAULT now(),
  -- A value is erased once. A second erasure of the same one is a mistake.
  UNIQUE (report_id, field_key, position)
);
CREATE INDEX report_value_erasures_report_idx ON report_value_erasures (report_id);
CREATE TRIGGER report_value_erasures_append_only BEFORE UPDATE OR DELETE ON report_value_erasures
  FOR EACH ROW EXECUTE FUNCTION reject_modification();
CREATE TRIGGER report_value_erasures_no_truncate BEFORE TRUNCATE ON report_value_erasures
  FOR EACH STATEMENT EXECUTE FUNCTION reject_modification();

-- ── held values waiting for a confirmation link ─────────────────────────

-- A report with text or a link asks for an address (fields/src/email.ts) and
-- waits in report_submissions until the link is followed. Its held values
-- wait HERE, encrypted the same way, never in the submission's `payload`
-- (which outlives confirmation). Deleted when the report is filed from it,
-- and with the submission when that is erased or swept (ON DELETE CASCADE).
CREATE TABLE report_submission_values (
  submission_id bigint PRIMARY KEY REFERENCES report_submissions (id) ON DELETE CASCADE,
  value_enc     bytea NOT NULL,
  value_key     bytea NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
