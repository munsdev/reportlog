-- ════════════════════════════════════════════════════════════════════════
-- LISTS: the second format, beside logbooks (workstream E).
--
-- A FORM IS THE QUESTION SET. LOGBOOK OR LIST IS WHAT HAPPENS TO THE
-- ANSWERS. A logbook seals, chains, is append-only and permanent. A list
-- seals nothing, chains nothing, keeps an editable form, erases the personal
-- half of its entries on a timer, is approved in bulk, and publishes counts
-- rather than content.
--
-- NOTHING HERE IS SEALED. No fingerprint reads any of it, no chain links to
-- it, and apps/api/src/lists/ may not reach packages/seal or
-- apps/api/src/chain, even transitively (the boundary check).
--
-- NONE OF THESE TABLES IS APPEND-ONLY, and that is a decision rather than an
-- omission. The archive is append-only because the record must be permanent;
-- a tip is a lead and a check-in is a tally, and neither is the record. Named
-- here so a later session does not read the missing triggers as an oversight.
--
-- NO `kind` COLUMN ON A LIST, AND NO RECORD OF WHICH TEMPLATE MADE ONE. The
-- Tip List, check-ins and a contact form differ ONLY by their questions. Link
-- handling happens because a list HAS a url question, not because it is "a
-- tip list"; a column saying which template it came from would be a fork in
-- every query waiting to happen.
--
-- NO `expires_at` ON ANY LIST ROW. The other sweep DELETEs whole rows from a
-- named list of credential tables keyed on exactly that name, so a list table
-- carrying one would be one edit away from deleting the links. What expires
-- on a list is a FIELD's answer, and the column says so: `personal_expires_at`.
--
-- Ported from legacy migrations 046, 047 (the list half) and 048. The
-- volunteer list legacy 047 made from that deployment's volunteer roles is
-- not made here: there are no volunteer roles in this database to make it from.
-- ════════════════════════════════════════════════════════════════════════

-- The daily secret for hashing addresses. NOT a salt in the password sense:
-- a per-day PEPPER, random and secret, because a plain salted hash of an IPv4
-- address is not one-way in any useful sense (the space is 2^32). HMAC under
-- a random secret that the sweep then DESTROYS is what makes "we never store
-- the address" true afterwards as well as at the time.
CREATE TABLE list_salts (
  day        date PRIMARY KEY,
  salt       bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT list_salts_length_check CHECK (octet_length(salt) = 32)
);

CREATE TABLE lists (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug       text NOT NULL UNIQUE,
  title      text NOT NULL,
  blurb      text,

  -- hidden: administrators only, as a preview. password ("team only"):
  -- anybody signed in. listed: anybody past the site password, and on the
  -- front page while it takes entries. A NEW LIST STARTS HIDDEN: making a
  -- list is not publishing one.
  visibility text NOT NULL DEFAULT 'hidden',

  -- Whether somebody WITHOUT the site password can reach it: closed (behind
  -- it, like everything else), link (anybody with the address), door (also
  -- offered on the password page). Only a listed list may be open outside.
  outside_access text NOT NULL DEFAULT 'closed',

  -- Intake, computed from timestamps when somebody asks, never flipped by a
  -- timer. The same shape as a logbook's, so the two formats answer "is this
  -- open" the same way.
  opens_at   timestamptz,
  closes_at  timestamptz,
  closed_at  timestamptz,

  -- May counts over this list leave the building at all. Off by default:
  -- publishing is a decision somebody makes, never a default.
  aggregates_published boolean NOT NULL DEFAULT false,

  -- auto: an address is asked only of somebody who writes something (the
  -- gate, derived from the questions). required: of everybody, for a form
  -- people use to reach the site. 'required' only ADDS a requirement; there
  -- is no setting that turns the gate off.
  email_mode text NOT NULL DEFAULT 'auto',

  -- Each new entry emailed to `notify_email`, or to the deployment's admin
  -- address when that is NULL. A value in `notify_email` has been CONFIRMED
  -- by whoever owns it; one in `notify_pending_email` has not, and receives
  -- nothing until it is.
  notify               boolean NOT NULL DEFAULT false,
  notify_email         text,
  notify_pending_email text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT lists_slug_check CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  CONSTRAINT lists_title_check CHECK (length(btrim(title)) BETWEEN 1 AND 120),
  CONSTRAINT lists_blurb_check CHECK (blurb IS NULL OR length(blurb) <= 1000),
  CONSTRAINT lists_visibility_check CHECK (visibility IN ('hidden', 'password', 'listed')),
  CONSTRAINT lists_outside_access_check CHECK (outside_access IN ('closed', 'link', 'door')),
  -- A hidden list reachable by strangers without a password, or a team-only
  -- list reachable by people with no account, would be the wrong way round.
  CONSTRAINT lists_outside_needs_listed CHECK (outside_access = 'closed' OR visibility = 'listed'),
  CONSTRAINT lists_email_mode_check CHECK (email_mode IN ('auto', 'required')),
  CONSTRAINT lists_schedule_order CHECK (opens_at IS NULL OR closes_at IS NULL OR opens_at < closes_at),
  CONSTRAINT lists_notify_email_check
    CHECK (notify_email IS NULL OR notify_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  CONSTRAINT lists_notify_pending_check
    CHECK (notify_pending_email IS NULL OR notify_pending_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);

-- A list's questions. One row per question.
--
-- THERE IS NO ONE-WAY DOOR HERE, and that is the difference from
-- `logbook_fields` rather than an oversight: a list seals nothing, so its
-- questions may be reworded, removed and reordered after entries arrive. The
-- one thing fixed is a question's KEY (and its kind), because the key is what
-- every stored answer is filed under. See list_fields_guard below.
CREATE TABLE list_fields (
  id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  list_id  bigint NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  key      text NOT NULL,
  -- A kind from @reportlog/fields, shared with logbooks. Not a second vocabulary.
  kind     text NOT NULL,
  -- What a count is named by when a tool asks, so it is not optional.
  label    text NOT NULL,
  help     text,
  required boolean NOT NULL DEFAULT false,
  position integer NOT NULL DEFAULT 0,
  -- The same settings shape a logbook question has: options, allowOther,
  -- scope, maxLength, min, max. Read by @reportlog/fields.
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- One answer unless the form says otherwise: a tip takes up to three links.
  max_values integer NOT NULL DEFAULT 1,

  -- THE COUNTABLE BOX. An operator's deliberate tick, off by default, and the
  -- only thing that lets a question's answers be counted for anybody outside.
  aggregatable boolean NOT NULL DEFAULT false,

  -- Which half of the entry this question's answer is stored in, and so how
  -- long it lives. NOT NULL AND NO DEFAULT, deliberately: defaulting to
  -- 'transient' would put a state or a verdict in the erasable half, so its
  -- count would shrink on its own months later; defaulting to 'durable' would
  -- keep somebody's words forever because a writer forgot. Every writer
  -- states it, and one that forgets fails loudly here.
  retention text NOT NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT list_fields_key_unique UNIQUE (list_id, key),
  CONSTRAINT list_fields_key_check CHECK (key ~ '^[a-z0-9][a-z0-9_]{0,62}$'),
  CONSTRAINT list_fields_label_check CHECK (length(btrim(label)) BETWEEN 1 AND 200),
  CONSTRAINT list_fields_settings_check CHECK (jsonb_typeof(settings) = 'object'),
  CONSTRAINT list_fields_max_values_check CHECK (max_values BETWEEN 1 AND 20),
  CONSTRAINT list_fields_retention_check CHECK (retention IN ('absent', 'transient', 'durable')),
  -- Nothing about a logbook belongs here: no uploads, and there is no report
  -- to declare evidence for.
  CONSTRAINT list_fields_kind_check CHECK (kind NOT IN ('file', 'evidence_declaration')),

  -- ONLY A CLOSED VOCABULARY CAN BE COUNTED. A count over free text publishes
  -- what somebody wrote one cell at a time. MUST STAY IN STEP WITH
  -- AGGREGATABLE_KINDS in apps/api/src/lists/fields.ts; a unit test reads
  -- this file and fails if the two disagree. The module is stricter: it also
  -- requires a real closed option set, which a CHECK cannot see.
  CONSTRAINT list_fields_aggregatable_check CHECK (
    NOT aggregatable
    OR kind IN ('choice_one', 'choice_many', 'yes_no', 'number',
                'date', 'time', 'datetime', 'place')
  ),
  -- A question that is not collected cannot be counted either.
  CONSTRAINT list_fields_absent_not_aggregatable CHECK (retention <> 'absent' OR NOT aggregatable)
);

CREATE INDEX list_fields_list_idx ON list_fields (list_id, position);

-- A question's key and kind never change once it exists: every stored answer
-- is filed under the key and was normalized as that kind. Renaming one would
-- leave every earlier answer under a name the form no longer asks, and its
-- count would restart from nothing. A new key is a new question.
CREATE FUNCTION list_fields_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.key IS DISTINCT FROM OLD.key OR NEW.kind IS DISTINCT FROM OLD.kind THEN
    RAISE EXCEPTION 'a list question''s key and kind never change (%)', OLD.key;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER list_fields_guard BEFORE UPDATE ON list_fields
  FOR EACH ROW EXECUTE FUNCTION list_fields_guard();

-- One submission.
--
-- THE ANSWERS ARE SPLIT IN TWO BY LIFETIME, and this is the structural heart
-- of the format. `answers` holds what is durable; `erasable_answers` holds
-- what the sweep blanks. Two COLUMNS rather than one with a convention, so a
-- query that counts `answers` cannot reach anything erasable: the guarantee
-- is in the shape, not in the care of whoever writes the next query.
--
-- THE ROW SURVIVES THE SWEEP AND THE PIECES DO NOT. A tip survives as its
-- links, its state and its category; the description, the email and the
-- hashed address go.
CREATE TABLE list_entries (
  id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  list_id  bigint NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),

  -- Durable. A key is present only when it was answered: a count has to tell
  -- "never asked" from "asked and skipped", and a null cannot.
  answers  jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Erasable. NULL when there is nothing in it, never '{}', so the sweep and
  -- the CHECK below agree about what "nothing" looks like.
  erasable_answers jsonb,

  -- THE ONE BUILT-IN FIELD A LIST HAS, because the gate needs it and erasure
  -- depends on it. AN ENTRY IS NOT A REPORT: this is not the spine.
  email         text,
  email_consent boolean NOT NULL DEFAULT false,
  -- HMAC under the day's secret. The raw address is never written.
  ip_hash       text,

  -- May this be counted publicly. Nothing is, until a moderator approves it.
  review_state text NOT NULL DEFAULT 'received',
  reviewed_at  timestamptz,
  reviewed_by  bigint REFERENCES users(id) ON DELETE SET NULL,

  -- Has an editor dealt with it. A DIFFERENT question from review, kept in a
  -- different column: one column answering both is how a published count
  -- comes to disagree with the queue.
  triage_state text NOT NULL DEFAULT 'new',

  -- WHEN THE ERASABLE HALF EXPIRES, not when the row does. NULL means kept
  -- until its holder uses the erasure link. Set on write from configuration:
  -- a retention period applies forward only.
  personal_expires_at timestamptz,
  erased_at timestamptz,

  CONSTRAINT list_entries_answers_check CHECK (jsonb_typeof(answers) = 'object'),
  CONSTRAINT list_entries_erasable_check CHECK (
    erasable_answers IS NULL
    OR (jsonb_typeof(erasable_answers) = 'object' AND erasable_answers <> '{}'::jsonb)),
  CONSTRAINT list_entries_email_check CHECK (email IS NULL OR email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  CONSTRAINT list_entries_ip_hash_check CHECK (ip_hash IS NULL OR ip_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT list_entries_review_check CHECK (review_state IN ('received', 'approved', 'rejected')),
  CONSTRAINT list_entries_triage_check CHECK (triage_state IN ('new', 'triaged', 'actioned', 'closed')),
  CONSTRAINT list_entries_reviewed_pair CHECK ((review_state = 'received') = (reviewed_at IS NULL)),

  -- THE DATABASE REFUSES A LIE. A row marked erased that still holds any of
  -- the erasable half is not an erased row.
  CONSTRAINT list_entries_erased_is_empty CHECK (
    erased_at IS NULL
    OR (erasable_answers IS NULL AND email IS NULL AND ip_hash IS NULL))
);

CREATE INDEX list_entries_list_idx   ON list_entries (list_id, created_at DESC);
CREATE INDEX list_entries_review_idx ON list_entries (list_id, review_state);
-- Only rows with something left to erase are ever swept.
CREATE INDEX list_entries_sweep_idx  ON list_entries (personal_expires_at) WHERE erased_at IS NULL;

-- Links, lifted out of a url question's answer into rows of their own, so
-- the deduplicated count has a row per submitted link. Durable.
CREATE TABLE list_entry_links (
  id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entry_id  bigint NOT NULL REFERENCES list_entries(id) ON DELETE CASCADE,
  -- Which question it answered, so two link questions are not merged.
  field_key text NOT NULL,
  -- As submitted, for an editor who needs to see what was actually sent.
  url_raw   text NOT NULL,
  -- sha256 of the normalized form. The dedup key, not a fingerprint.
  url_key   text NOT NULL,
  host      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT list_entry_links_key_check CHECK (url_key ~ '^[0-9a-f]{64}$'),
  CONSTRAINT list_entry_links_raw_check CHECK (length(url_raw) BETWEEN 1 AND 2048),
  CONSTRAINT list_entry_links_host_check CHECK (length(host) BETWEEN 1 AND 253)
);

CREATE INDEX list_entry_links_entry_idx ON list_entry_links (entry_id);
CREATE INDEX list_entry_links_url_key_idx ON list_entry_links (url_key);

-- The durable layer: one row per distinct link, with a count and dates, no
-- description and no submitter. Forty people sending the same clip is one row
-- with a count of forty. There is nobody in it, so nothing here is erased.
CREATE TABLE link_index (
  url_key          text PRIMARY KEY,
  host             text NOT NULL,
  first_seen       timestamptz NOT NULL DEFAULT now(),
  last_seen        timestamptz NOT NULL DEFAULT now(),
  submission_count integer NOT NULL DEFAULT 0,

  CONSTRAINT link_index_key_check CHECK (url_key ~ '^[0-9a-f]{64}$'),
  CONSTRAINT link_index_count_check CHECK (submission_count >= 0)
);

-- Erasure on request, for a format with no accounts: a secret mailed to the
-- address on the entry. STORED HASHED, so a copy of this table lets nobody
-- erase other people's entries. `expires_at` here is a credential's, which is
-- what that name means; it is not on an entry.
CREATE TABLE list_erasures (
  token_hash text PRIMARY KEY,
  entry_id   bigint NOT NULL REFERENCES list_entries(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,

  CONSTRAINT list_erasures_hash_check CHECK (token_hash ~ '^[0-9a-f]{64}$')
);

CREATE INDEX list_erasures_entry_idx ON list_erasures (entry_id);

-- The link an address clicks to agree to receive a list's entries. Hashed
-- like an erasure token: a copy of this table must not redirect the mail.
CREATE TABLE list_notify_confirmations (
  token_hash text PRIMARY KEY,
  list_id    bigint NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  email      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,

  CONSTRAINT list_notify_confirmations_hash_check CHECK (token_hash ~ '^[0-9a-f]{64}$')
);

CREATE INDEX list_notify_confirmations_list_idx ON list_notify_confirmations (list_id);

-- A LIST THAT HAS TAKEN ENTRIES IS NEVER DELETED. Deleting would cascade to
-- its entries, its links and its erasure links, destroying the links the
-- format exists to keep and leaving every erasure email already sent pointing
-- at nothing. It is closed instead. The module refuses first, with a
-- sentence; this is the backstop for a path that forgets.
CREATE FUNCTION lists_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM list_entries WHERE list_id = OLD.id) THEN
    RAISE EXCEPTION 'a list that has taken entries is never deleted (%)', OLD.slug;
  END IF;
  RETURN OLD;
END $$;

CREATE TRIGGER lists_guard BEFORE DELETE ON lists
  FOR EACH ROW EXECUTE FUNCTION lists_guard();
