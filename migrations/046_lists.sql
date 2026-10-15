-- LISTS: the second format, beside logbooks.
--
-- A logbook is the secure record type. It seals, it chains, it is
-- append-only, it is permanent, and nothing in it is public until a
-- moderator approves it one by one. A LIST is the other format, for
-- everything that needs none of that: unsealed, unchained, never on the
-- transparency log, editable, deletable, swept without anybody asking, and
-- approved in bulk.
--
-- A FORM IS THE QUESTION SET. LOGBOOK OR LIST IS WHAT HAPPENS TO THE
-- ANSWERS. A logbook has a form; a list has a form. Same field types, same
-- card engine, same builder. The container is the whole decision.
--
-- NOTHING HERE IS HASHED. No fingerprint reads any of it, no chain links to
-- it, and `src/lists/` is forbidden from importing `reportCore.js` —
-- asserted by `npm test`, which walks the import graph transitively.
--
-- NONE OF THESE TABLES GETS AN APPEND-ONLY TRIGGER, and that is a decision
-- rather than an omission. The archive is append-only because the record
-- must be permanent; a tip is a lead and a check-in is a tally, and neither
-- is the record. Named here as excluded so a later session does not read
-- the missing triggers as an oversight and "fix" it.
--
-- NO `kind` COLUMN, AND NO RECORD OF WHICH TEMPLATE MADE A LIST. src/templates.js
-- states the rule this follows: nothing reads "which template is this" to
-- decide anything, because a convenience like that ends as a permanent fork
-- in every query. So the Tip List, check-ins and a contact form differ ONLY
-- by their fields. Link handling happens because a list HAS a url field,
-- not because it is "a tip list".
--
-- ADDITIVE AND SELF-CONTAINED apart from `users`, so this runs clean against
-- an empty database and an operator can run a deployment with lists only.

-- The daily secret for hashing addresses. NOT a salt in the password sense:
-- it is a per-day PEPPER and it is secret, because a plain salted hash of
-- an IPv4 address is not one-way in any useful sense — the whole space is
-- 2^32 and enumerable on a laptop. HMAC under a random secret that is then
-- DESTROYED is what makes "we never store the address" true afterwards as
-- well as at the time.
CREATE TABLE list_salts (
  day        date PRIMARY KEY,
  salt       bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT list_salts_length_check CHECK (octet_length(salt) = 32)
);

CREATE TABLE lists (
  id         bigserial PRIMARY KEY,
  slug       text NOT NULL UNIQUE,
  title      text NOT NULL,
  blurb      text,

  -- THE TWO SWITCH AXES (§5), which are separate because the useful
  -- combinations need them to be. Listed and accepting is live. Listed and
  -- closed has finished and stays readable. Password and closed is team
  -- review of something being built.
  --
  -- Visibility ENFORCEMENT is not built yet — these columns exist so the
  -- engine has one place to read the answer from, and so that nothing
  -- invents a second one. Hidden must answer 404 rather than 403, because
  -- 403 confirms the thing exists.
  visibility text NOT NULL DEFAULT 'hidden',

  -- Intake, computed from timestamps at request time rather than flipped by
  -- a timer: a timer is only as punctual as its last run, and this
  -- deployment's timers are daily. Same shape as `logbooks`, deliberately,
  -- so the two formats answer "is this open" the same way.
  opens_at   timestamptz,
  closes_at  timestamptz,
  closed_at  timestamptz,

  -- May counts over this list leave the building at all. Off by default:
  -- publishing is a decision somebody makes, never a default a list
  -- arrives with.
  aggregates_published boolean NOT NULL DEFAULT false,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT lists_slug_check CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  CONSTRAINT lists_title_check CHECK (length(btrim(title)) BETWEEN 1 AND 120),
  CONSTRAINT lists_visibility_check CHECK (visibility IN ('hidden', 'password', 'listed'))
);

CREATE INDEX lists_open_idx ON lists (opens_at, closes_at);

-- A list's form. One row per question.
--
-- THERE IS NO ONE-WAY DOOR HERE, and that is the difference from
-- `logbook_fields` rather than an oversight. A logbook freezes its field
-- set on launch because every report SEALS the questions it was answered
-- against, so rewording one would change what a filed report claims to
-- have been asked. A list seals nothing, so its form stays editable — which
-- is most of what makes it the lighter format.
--
-- The cost is that answers collected under an old wording sit beside
-- answers collected under a new one. That is why an aggregate snapshot
-- records the field definitions it was computed under: same reasoning as
-- `logbook_form`, applied to a number instead of to a report.
CREATE TABLE list_fields (
  id       bigserial PRIMARY KEY,
  list_id  bigint NOT NULL REFERENCES lists(id) ON DELETE CASCADE,

  key      text NOT NULL,
  -- A field type id from src/fieldTypes.js, shared with logbooks. Not a
  -- second vocabulary.
  kind     text NOT NULL,
  -- Each one needs a title. It is what an aggregate is
  -- labelled with when a tool asks, so it is NOT optional.
  label    text NOT NULL,
  help     text,
  required boolean NOT NULL DEFAULT false,
  position integer NOT NULL DEFAULT 0,
  -- For choice and place fields. Closed vocabularies only, where it matters.
  options  jsonb,
  -- One answer unless the form says otherwise — a tip takes up to three
  -- links. Generic rather than a links special case.
  max_values integer NOT NULL DEFAULT 1,

  -- THE CHECKBOX. Operator-set, OFF by default, and the only thing that
  -- lets a field's values be counted for anybody outside this deployment.
  -- A contact form checks none of them, so a tool that asks finds nothing
  -- there — which is the intended answer rather than an error.
  aggregatable boolean NOT NULL DEFAULT false,

  -- Which half of the entry this field's answer is stored in, and therefore
  -- how long it lives. See list_entries.
  --
  -- NOT NULL AND NO DEFAULT, deliberately. There is no safe blanket value:
  -- defaulting to 'transient' would put a state or a verdict in the
  -- erasable half, so its published count would shrink on its own months
  -- later with nobody connecting it to the sweep; defaulting to 'durable'
  -- would keep somebody's words forever because a writer forgot. So every
  -- writer states it, and one that forgets fails loudly here rather than
  -- quietly in a year. src/lists/fields.js has `defaultRetention(kind)` for
  -- callers that want the sensible answer for a kind.
  retention text NOT NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT list_fields_key_unique UNIQUE (list_id, key),
  CONSTRAINT list_fields_key_check CHECK (key ~ '^[a-z0-9][a-z0-9_]{0,62}$'),
  CONSTRAINT list_fields_label_check CHECK (length(btrim(label)) BETWEEN 1 AND 200),
  CONSTRAINT list_fields_max_values_check CHECK (max_values BETWEEN 1 AND 20),
  CONSTRAINT list_fields_retention_check CHECK (retention IN ('absent', 'transient', 'durable')),

  -- ONLY A CLOSED VOCABULARY CAN BE COUNTED. You cannot aggregate free
  -- text, and letting somebody tick the box beside a long-text question
  -- would publish what people wrote one count at a time.
  --
  -- src/lists/fields.js states the same list as AGGREGATABLE_KINDS and is
  -- STRICTER — it also requires an actual closed option set, which a CHECK
  -- cannot see. `npm test` asserts that this list and that one agree, so
  -- the two cannot drift.
  CONSTRAINT list_fields_aggregatable_check CHECK (
    NOT aggregatable
    OR kind IN ('choice_one', 'choice_many', 'yes_no', 'number',
                'date', 'time', 'datetime', 'place')
  ),

  -- A field that is not collected cannot be counted either.
  CONSTRAINT list_fields_absent_not_aggregatable CHECK (
    retention <> 'absent' OR NOT aggregatable
  )
);

CREATE INDEX list_fields_list_idx ON list_fields (list_id, position);
CREATE INDEX list_fields_aggregatable_idx ON list_fields (list_id) WHERE aggregatable;

-- One submission.
--
-- THE ANSWERS ARE SPLIT IN TWO BY LIFETIME, and this is the structural
-- heart of the format.
--
-- `answers` holds what is durable. `erasable_answers` holds what the sweep
-- blanks. The split is not a convention an aggregate has to remember — it
-- is two columns, so a query that counts `answers` CANNOT reach anything
-- erasable, in the same way that nothing computing a fingerprint can reach
-- a revocable permission. The guarantee is in the shape, not in the care of
-- whoever writes the next query.
--
-- THE ROW SURVIVES THE SWEEP AND THE PIECES DO NOT. The
-- links stay, the text and the contact details go. A tip survives as its
-- links, its state and its category, with the description, the address and
-- the email blanked. Which is why there is no `expires_at` here — see
-- `personal_expires_at` below.
CREATE TABLE list_entries (
  id       bigserial PRIMARY KEY,
  list_id  bigint NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),

  -- Durable. Keyed by field key, and A KEY IS PRESENT ONLY WHEN IT WAS
  -- ANSWERED — borrowed from the absent-key rule, though nothing here is
  -- hashed, because an aggregate has to tell "never asked" apart from
  -- "asked and skipped" and a null cannot.
  answers  jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Transient. NULL once swept or erased. Never aggregated, never published.
  erasable_answers jsonb,

  -- THE ONE BUILT-IN FIELD A LIST HAS, because the gate needs it and
  -- erasure depends on it: anything collecting free text must require an
  -- address, since there is otherwise no way to reach the person whose
  -- words are held and no way for them to take them back.
  email         text,
  email_consent boolean NOT NULL DEFAULT false,
  -- HMAC under the day's secret. The raw address is never written.
  ip_hash       text,

  -- NOTHING IS COUNTED PUBLICLY UNTIL A MODERATOR APPROVES IT. The
  -- difference from a logbook is the unit of review, not whether there is
  -- one: a logbook report is read one by one, a page of list entries is
  -- skimmed and approved together.
  review_state text NOT NULL DEFAULT 'received',
  reviewed_at  timestamptz,
  reviewed_by  bigint REFERENCES users(id) ON DELETE SET NULL,

  -- Editorial triage, which is a DIFFERENT question from review and is kept
  -- in a different column on purpose. Review asks "may this be counted".
  -- Triage asks "has an editor dealt with it". One column answering both
  -- would be the two-notions-of-approved mistake, and the failure is a
  -- published count that disagrees with the queue.
  triage_state text NOT NULL DEFAULT 'new',

  -- WHEN THE ERASABLE HALF EXPIRES — not when the row does. Named for what
  -- it governs: a column called `expires_at` on a row that never expires
  -- would be a lie, and `src/sweep.js` DELETEs whole rows from a
  -- hand-written list of tables keyed on exactly that name. A later session
  -- adding `list_entries` to that list would delete the links.
  --
  -- NULL means durable, which an operator may only choose for personal
  -- data together with a required email. Set on write from configuration,
  -- never defaulted to a literal here: a retention period applies forward
  -- only, so a row keeps the period it was collected under.
  personal_expires_at timestamptz,
  erased_at timestamptz,

  CONSTRAINT list_entries_review_check CHECK (
    review_state IN ('received', 'approved', 'rejected')),
  CONSTRAINT list_entries_triage_check CHECK (
    triage_state IN ('new', 'triaged', 'actioned', 'closed')),
  CONSTRAINT list_entries_reviewed_pair CHECK (
    (review_state = 'received') = (reviewed_at IS NULL)),

  -- THE DATABASE REFUSES A LIE. A row marked erased that still holds any of
  -- the erasable half is not an erased row, and the place this could go
  -- wrong is a sweep that marks before it clears.
  CONSTRAINT list_entries_erased_is_empty CHECK (
    erased_at IS NULL
    OR (erasable_answers IS NULL AND email IS NULL AND ip_hash IS NULL)
  )
);

CREATE INDEX list_entries_list_idx    ON list_entries (list_id, created_at DESC);
CREATE INDEX list_entries_review_idx  ON list_entries (list_id, review_state);
CREATE INDEX list_entries_triage_idx  ON list_entries (list_id, triage_state);
-- Only rows with something left to erase are ever swept.
CREATE INDEX list_entries_sweep_idx   ON list_entries (personal_expires_at) WHERE erased_at IS NULL;
-- The durable half, for counting. GIN so a group-by on an answer key is not
-- a sequential scan once there are a lot of them.
CREATE INDEX list_entries_answers_idx ON list_entries USING gin (answers);
-- Full-text over the erasable half is what makes a subject access request
-- answerable. It covers a column the sweep empties, which is intended:
-- what has been erased is not findable, because it is not there.
CREATE INDEX list_entries_text_idx ON list_entries
  USING gin (to_tsvector('english'::regconfig, coalesce(erasable_answers::text, '')));

-- Links, lifted out of a url field's answer into rows of their own.
--
-- WHY THEY ARE NOT JUST LEFT IN `answers`: the deduplicated count is the
-- useful fact, and counting needs a row per submitted link rather than an
-- array inside a document. They are durable either way.
CREATE TABLE list_entry_links (
  id       bigserial PRIMARY KEY,
  entry_id bigint NOT NULL REFERENCES list_entries(id) ON DELETE CASCADE,
  -- Which question it was answered against, so a form with two link
  -- questions does not merge them.
  field_key text NOT NULL,
  -- As submitted, for an editor who needs to see what was actually sent.
  url_raw  text NOT NULL,
  -- sha256 of the normalized form. The dedup key.
  url_key  text NOT NULL,
  host     text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT list_entry_links_key_check CHECK (url_key ~ '^[0-9a-f]{64}$'),
  CONSTRAINT list_entry_links_raw_check CHECK (length(url_raw) BETWEEN 1 AND 2048),
  CONSTRAINT list_entry_links_host_check CHECK (length(host) BETWEEN 1 AND 253)
);

CREATE INDEX list_entry_links_url_key_idx ON list_entry_links (url_key);
CREATE INDEX list_entry_links_entry_idx   ON list_entry_links (entry_id);
CREATE INDEX list_entry_links_host_idx    ON list_entry_links (host);

-- The durable layer. A deduplicated table of URLs with counts and dates, no
-- description and no submitter. Forty people sending the same clip is one
-- item with a count of forty, which is itself the useful fact.
--
-- It holds nothing personal, so it has no retention question and no
-- erasure: there is nobody in it.
CREATE TABLE link_index (
  url_key          text PRIMARY KEY,
  host             text NOT NULL,
  first_seen       timestamptz NOT NULL DEFAULT now(),
  last_seen        timestamptz NOT NULL DEFAULT now(),
  submission_count integer NOT NULL DEFAULT 0,

  CONSTRAINT link_index_key_check CHECK (url_key ~ '^[0-9a-f]{64}$'),
  CONSTRAINT link_index_count_check CHECK (submission_count >= 0)
);

CREATE INDEX link_index_host_idx  ON link_index (host);
CREATE INDEX link_index_count_idx ON link_index (submission_count DESC);

-- Erasure on request, for a format with no accounts.
--
-- The only thing that can prove somebody owns an entry is a secret mailed
-- to the address on it. Reports solve the same problem with per-report
-- contact keys (src/contactKeys.js); there is no report here to key to.
--
-- THE TOKEN IS STORED HASHED, which differs from report_submission_tokens
-- and is the better of the two: a copy of this table must not let whoever
-- holds it erase other people's submissions.
CREATE TABLE list_erasures (
  token_hash text PRIMARY KEY,
  entry_id   bigint NOT NULL REFERENCES list_entries(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,

  CONSTRAINT list_erasures_hash_check CHECK (token_hash ~ '^[0-9a-f]{64}$')
);

CREATE INDEX list_erasures_entry_idx ON list_erasures (entry_id);
