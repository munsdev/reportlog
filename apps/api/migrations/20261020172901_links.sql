-- Plan D §5 and §8: tip links, replacing the plaintext link store.
--
-- WHAT GOES. `list_entry_links` held each link in plain text (`url_raw`) with
-- an UNKEYED sha256 (`url_key`): anybody holding the database could test a
-- guessed link. `link_index` kept one row per distinct link forever, so a
-- link outlived the erasure of every tip that carried it. Both are dropped,
-- and so is the copy of each link in the entry's own answers. NOTHING IS
-- CARRIED ACROSS: the plain values cannot be encrypted from SQL, and no site
-- has taken real tips yet. (A real deployment would need its links re-sent.)
--
-- Owner ruling 40 (docs/decisions.md): an entry's email is encrypted under a
-- key of its own, like a report's contact details, and the hashed network
-- address (`ip_hash`) and its daily secrets (`list_salts`) go.

DROP TABLE link_index;
DROP TABLE list_entry_links;

UPDATE list_entries e
   SET answers = e.answers - f.key
  FROM list_fields f
 WHERE f.list_id = e.list_id AND f.kind = 'url' AND e.answers ? f.key;
UPDATE list_entries e
   SET erasable_answers = NULLIF(e.erasable_answers - f.key, '{}'::jsonb)
  FROM list_fields f
 WHERE f.list_id = e.list_id AND f.kind = 'url' AND e.erasable_answers ? f.key;

-- ── the entry's email, encrypted (ruling 40) ─────────────────────────────

-- The index reads `email`, so it goes first and comes back without it. The
-- expression must match DOCUMENT in lists/search.ts character for character.
DROP INDEX list_entries_text_idx;
ALTER TABLE list_entries DROP CONSTRAINT list_entries_erased_is_empty;
ALTER TABLE list_entries DROP CONSTRAINT list_entries_email_check;
ALTER TABLE list_entries DROP CONSTRAINT list_entries_ip_hash_check;
ALTER TABLE list_entries DROP COLUMN email;
ALTER TABLE list_entries DROP COLUMN ip_hash;
DROP TABLE list_salts;

-- The address under the entry's own key (AES-256-GCM), the key wrapped by
-- the site's link secret (links/keys.ts), and a KEYED digest, so an
-- administrator answering "what do you hold about me" can find an address
-- without anybody being able to read every address. All three or none.
ALTER TABLE list_entries ADD COLUMN email_enc  bytea;
ALTER TABLE list_entries ADD COLUMN email_key  bytea;
ALTER TABLE list_entries ADD COLUMN email_hmac text;
ALTER TABLE list_entries ADD CONSTRAINT list_entries_email_whole CHECK (
  (email_enc IS NULL) = (email_key IS NULL) AND (email_enc IS NULL) = (email_hmac IS NULL));
ALTER TABLE list_entries ADD CONSTRAINT list_entries_email_hmac_check CHECK (
  email_hmac IS NULL OR email_hmac ~ '^[0-9a-f]{64}$');
ALTER TABLE list_entries ADD CONSTRAINT list_entries_erased_is_empty CHECK (
  erased_at IS NULL OR (erasable_answers IS NULL AND email_enc IS NULL));
CREATE INDEX list_entries_email_hmac_idx ON list_entries (email_hmac) WHERE email_hmac IS NOT NULL;

CREATE INDEX list_entries_text_idx ON list_entries USING gin ((
  jsonb_to_tsvector('simple'::regconfig, coalesce(erasable_answers, '{}'::jsonb), '["string"]'::jsonb)
));

-- ── the secret every link key hangs from ─────────────────────────────────

-- One random secret, wrapped by a key derived from CONTACT_KEY. Every link's
-- own key, every matching key and every blocklist hash comes from it, so
-- rotating CONTACT_KEY re-wraps this one row and nothing else: a keyed hash
-- cannot be recomputed without the address, and the blocklist never has one.
-- Not append-only: re-wrapping is an UPDATE.
CREATE TABLE link_secrets (
  id             smallint PRIMARY KEY CHECK (id = 1),
  secret_wrapped bytea NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- ── groups: one per distinct link ────────────────────────────────────────

-- The current check and comment are a projection of link_checks and
-- link_comments, written in the same transaction. NOT APPEND-ONLY.
CREATE TABLE link_groups (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- HMAC of the normalized address under the link secret (K11). NULL once
  -- the group was found illegal: its key is destroyed with its links, and a
  -- later copy starts a new, unchecked group (K12). Only the blocklist stops
  -- later copies, and it holds its own hash.
  match_key  text UNIQUE,
  outcome    text,
  checked_at timestamptz,
  checked_by text,
  comment    text,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT link_groups_key_check CHECK (match_key IS NULL OR match_key ~ '^[0-9a-f]{64}$'),
  CONSTRAINT link_groups_outcome_check CHECK (outcome IS NULL OR outcome IN ('checked', 'withheld', 'illegal')),
  CONSTRAINT link_groups_checked_pair CHECK ((outcome IS NULL) = (checked_at IS NULL)),
  CONSTRAINT link_groups_illegal_has_no_key CHECK (outcome IS DISTINCT FROM 'illegal' OR match_key IS NULL),
  CONSTRAINT link_groups_comment_check CHECK (comment IS NULL OR length(comment) BETWEEN 1 AND 500)
);

-- ── links: one per link a tip carried ────────────────────────────────────

-- The value under its OWN key (K9), the key wrapped under the link secret.
-- ERASING IS DELETING THE ROW: value and key go together (X2). The host is
-- not stored: a column of hosts is a readable list of where tips point.
-- NOT APPEND-ONLY.
CREATE TABLE links (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entry_id   bigint NOT NULL REFERENCES list_entries(id) ON DELETE CASCADE,
  -- Which question it answered.
  field_key  text NOT NULL,
  group_id   bigint NOT NULL REFERENCES link_groups(id),
  value_enc  bytea NOT NULL,
  value_key  bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX links_entry_idx ON links (entry_id);
CREATE INDEX links_group_idx ON links (group_id);

-- ── the history behind the projection ────────────────────────────────────

-- Append-only. Every check of a group (M3, M6), with who and when. A re-check
-- is another row.
CREATE TABLE link_checks (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  group_id    bigint NOT NULL REFERENCES link_groups(id),
  outcome     text NOT NULL CHECK (outcome IN ('checked', 'withheld', 'illegal')),
  actor_email text NOT NULL CHECK (length(btrim(actor_email)) > 0),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX link_checks_group_idx ON link_checks (group_id, id);
CREATE TRIGGER link_checks_append_only BEFORE UPDATE OR DELETE ON link_checks
  FOR EACH ROW EXECUTE FUNCTION reject_modification();
CREATE TRIGGER link_checks_no_truncate BEFORE TRUNCATE ON link_checks
  FOR EACH STATEMENT EXECUTE FUNCTION reject_modification();

-- Append-only. Every edit of a group's comment for journalists (M4). An
-- empty body clears it, and is recorded like any other edit.
CREATE TABLE link_comments (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  group_id    bigint NOT NULL REFERENCES link_groups(id),
  body        text NOT NULL CHECK (length(body) <= 500),
  actor_email text NOT NULL CHECK (length(btrim(actor_email)) > 0),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX link_comments_group_idx ON link_comments (group_id, id);
CREATE TRIGGER link_comments_append_only BEFORE UPDATE OR DELETE ON link_comments
  FOR EACH ROW EXECUTE FUNCTION reject_modification();
CREATE TRIGGER link_comments_no_truncate BEFORE TRUNCATE ON link_comments
  FOR EACH STATEMENT EXECUTE FUNCTION reject_modification();

-- Append-only. The erasure of an illegal group's links (X4): who, when, the
-- reason category, and how many copies went. Nothing that says what the link was.
CREATE TABLE link_erasures (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  group_id        bigint NOT NULL REFERENCES link_groups(id),
  reason_category text NOT NULL,
  erased_count    integer NOT NULL CHECK (erased_count >= 0),
  actor_email     text NOT NULL CHECK (length(btrim(actor_email)) > 0),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER link_erasures_append_only BEFORE UPDATE OR DELETE ON link_erasures
  FOR EACH ROW EXECUTE FUNCTION reject_modification();
CREATE TRIGGER link_erasures_no_truncate BEFORE TRUNCATE ON link_erasures
  FOR EACH STATEMENT EXECUTE FUNCTION reject_modification();

-- ── the blocklist (K13) ──────────────────────────────────────────────────

-- The live list: KEYED HASHES, NEVER ADDRESSES, so neither the database nor a
-- backup holds a readable list of illegal links. An exact entry is the
-- matching key; a domain entry is the hash of the domain, and an arriving
-- host is checked with each of its parent domains. NOT APPEND-ONLY: removing
-- an entry deletes its row here, and link_block_log keeps the record.
CREATE TABLE link_blocklist (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind            text NOT NULL CHECK (kind IN ('address', 'domain')),
  hash            text NOT NULL UNIQUE CHECK (hash ~ '^[0-9a-f]{64}$'),
  reason_category text NOT NULL,
  added_by        text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Append-only. Every addition and removal, with who, when and a reason
-- category. The entry it names is by id, and by kind, never by address.
CREATE TABLE link_block_log (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entry_id        bigint NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('address', 'domain')),
  action          text NOT NULL CHECK (action IN ('add', 'remove')),
  reason_category text NOT NULL,
  actor_email     text NOT NULL CHECK (length(btrim(actor_email)) > 0),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER link_block_log_append_only BEFORE UPDATE OR DELETE ON link_block_log
  FOR EACH ROW EXECUTE FUNCTION reject_modification();
CREATE TRIGGER link_block_log_no_truncate BEFORE TRUNCATE ON link_block_log
  FOR EACH STATEMENT EXECUTE FUNCTION reject_modification();
