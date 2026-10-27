-- W4 and W5: checking written accounts, redacting a copy for journalists, and
-- the access log entries the desk writes for them.
--
-- ADDITIVE ONLY. New tables, one new nullable column on `contact_access_log`
-- and a widened kind list (the same kind of change 20261020182835 made for
-- `desk_link`). No existing row is touched.
--
-- WHAT A TEXT IS HERE. Either a report's `private_text` value (report_values,
-- S1), named by its sealed FINGERPRINT, so a clearance follows the words and
-- not the row: a version that only adds files carries the value with the same
-- fingerprint and keeps the clearance, a correction that re-sends the words
-- makes a new fingerprint and starts again unchecked (D2). Or a tip's
-- long-text answer (list_entries.erasable_answers), named by entry and
-- question.

-- ── the current check of a text: a projection, not append-only ───────────

CREATE TABLE text_items (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source      text NOT NULL CHECK (source IN ('report', 'tip')),
  -- A report text's sealed fingerprint (report_values.fingerprint).
  fingerprint text CHECK (fingerprint IS NULL OR fingerprint ~ '^[a-f0-9]{64}$'),
  -- A tip text: the entry and the question it answered. Not a foreign key: an
  -- item must outlive whatever later happens to the entry.
  entry_id    bigint,
  field_key   text CHECK (field_key IS NULL OR field_key ~ '^[a-z0-9][a-z0-9_]{0,38}$'),
  -- NULL is "waiting". `redacted` is "checked with redaction": journalists
  -- read the separate copy (text_redactions), never the original.
  outcome     text CHECK (outcome IS NULL OR outcome IN ('checked', 'redacted', 'withheld', 'illegal')),
  checked_at  timestamptz,
  checked_by  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT text_items_subject_check CHECK (
    (source = 'report' AND fingerprint IS NOT NULL AND entry_id IS NULL AND field_key IS NULL)
    OR (source = 'tip' AND fingerprint IS NULL AND entry_id IS NOT NULL AND field_key IS NOT NULL)),
  CONSTRAINT text_items_checked_pair CHECK ((outcome IS NULL) = (checked_at IS NULL))
);
CREATE UNIQUE INDEX text_items_fingerprint_key ON text_items (fingerprint) WHERE fingerprint IS NOT NULL;
CREATE UNIQUE INDEX text_items_entry_key ON text_items (entry_id, field_key) WHERE entry_id IS NOT NULL;

-- ── the history behind the projection: append-only ───────────────────────

-- Every check, every saved redaction and every review, with who and when. A
-- re-check is another row. Never the words, and `reason_category` is a
-- category (as in the link store), never a description of the content.
CREATE TABLE text_checks (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  item_id         bigint NOT NULL REFERENCES text_items (id),
  outcome         text NOT NULL CHECK (outcome IN
    ('checked', 'redacted', 'withheld', 'illegal', 'review_approved', 'review_returned')),
  reason_category text CHECK (reason_category IS NULL OR reason_category ~ '^[a-z][a-z-]{1,62}$'),
  actor_email     text NOT NULL CHECK (length(btrim(actor_email)) > 0),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX text_checks_item_idx ON text_checks (item_id, id);
CREATE TRIGGER text_checks_append_only BEFORE UPDATE OR DELETE ON text_checks
  FOR EACH ROW EXECUTE FUNCTION reject_modification();
CREATE TRIGGER text_checks_no_truncate BEFORE TRUNCATE ON text_checks
  FOR EACH STATEMENT EXECUTE FUNCTION reject_modification();

-- ── the redacted copy for journalists ────────────────────────────────────

-- ONE CURRENT COPY PER ITEM, kept apart from the original and encrypted under
-- a key of its own (the same wrapping as report_values). ERASABLE: deleting
-- the row destroys copy and key, and it is deleted whenever the original is
-- erased (reportValues/erase.ts) or the item is found illegal. Who made it and
-- when stay here; the reason is for the record and is never shown to a
-- journalist. A different moderator, or the owner, reviews it
-- (reviewed_by/reviewed_at/review_verdict); every save and review is also a
-- row in text_checks.
CREATE TABLE text_redactions (
  item_id        bigint PRIMARY KEY REFERENCES text_items (id),
  body_enc       bytea NOT NULL,
  body_key       bytea NOT NULL,
  reason         text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
  redacted_by    text NOT NULL CHECK (length(btrim(redacted_by)) > 0),
  redacted_at    timestamptz NOT NULL DEFAULT now(),
  reviewed_by    text,
  reviewed_at    timestamptz,
  review_verdict text CHECK (review_verdict IS NULL OR review_verdict IN ('approved', 'returned')),
  CONSTRAINT text_redactions_review_whole CHECK (
    (reviewed_by IS NULL) = (reviewed_at IS NULL) AND (reviewed_by IS NULL) = (review_verdict IS NULL))
);

-- ── the desk's access log ────────────────────────────────────────────────

-- A text shown on the desk is logged BEFORE it is decrypted, like a link.
-- `desk_text`: a report's text (thread and report set). `desk_tip_text`: a
-- tip's text (neither set; the item is named). Not a foreign key, as with
-- link_group_id.
ALTER TABLE contact_access_log ADD COLUMN text_item_id bigint;

ALTER TABLE contact_access_log DROP CONSTRAINT contact_access_log_kind_check;
ALTER TABLE contact_access_log ADD CONSTRAINT contact_access_log_kind_check
  CHECK (kind IN ('contact', 'audit_log', 'contact_used', 'file_preview', 'chain_file',
                  'desk_link', 'desk_report', 'desk_text', 'desk_tip_text'));
ALTER TABLE contact_access_log DROP CONSTRAINT contact_access_log_thread_check;
ALTER TABLE contact_access_log ADD CONSTRAINT contact_access_log_thread_check
  CHECK ((kind IN ('audit_log', 'chain_file', 'desk_link', 'desk_tip_text')) = (thread_id IS NULL));
ALTER TABLE contact_access_log DROP CONSTRAINT contact_access_log_report_check;
ALTER TABLE contact_access_log ADD CONSTRAINT contact_access_log_report_check
  CHECK (kind IN ('audit_log', 'chain_file', 'desk_link', 'desk_tip_text') OR report_id IS NOT NULL);
ALTER TABLE contact_access_log ADD CONSTRAINT contact_access_log_text_item_check
  CHECK ((kind IN ('desk_text', 'desk_tip_text')) = (text_item_id IS NOT NULL));
