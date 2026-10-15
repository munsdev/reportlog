-- Logbooks, and fields that are made rather than built in.
--
-- A logbook is one named intake with its own questionnaire. A deployment
-- runs many over its life; all of them write into ONE archive and ONE hash
-- chain. Nothing here touches `reports` rows or the seal: this migration
-- adds tables and two nullable columns, so every existing report verifies
-- exactly as before.
--
-- THE POINT OF THE DESIGN. There are no built-in questions beyond the
-- spine. When something happened, where, under what category, how somebody
-- came to know it — none of those are columns here, and none is a concept
-- the software knows. They are FIELDS an operator added, of a TYPE the
-- software offers. That is what lets one logbook ask for two locations
-- ("where it started", "where it ended") and another ask for none.
--
-- The spine stays real columns on `reports`, because the software genuinely
-- depends on it: the narrative, the contact behind it, permission to
-- publish, and the chain bookkeeping.

BEGIN;

CREATE TABLE logbooks (
  id            bigserial PRIMARY KEY,
  slug          text NOT NULL UNIQUE,
  title         text NOT NULL,
  blurb         text,

  -- DRAFT until launched. launched_at is the one-way door: it freezes the
  -- field set, and it is set once and never cleared.
  launched_at   timestamptz,

  -- When intake runs. Both are plain timestamps and the state is COMPUTED
  -- from them at request time rather than flipped by a timer: a timer is
  -- only as punctual as its last run, and this deployment's timers are
  -- daily. opens_at defaults to "now" for a logbook that starts on launch.
  opens_at      timestamptz,
  -- NULL means no scheduled end: it runs until somebody closes it.
  closes_at     timestamptz,
  -- A deliberate close, which overrides the schedule and is reversible.
  -- Closing only stops intake; reports already filed stay published and
  -- stay verifiable. A logbook closed by accident must be reopenable in one
  -- click by somebody holding a phone.
  closed_at     timestamptz,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT logbooks_slug_check  CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  CONSTRAINT logbooks_title_check CHECK (length(btrim(title)) BETWEEN 1 AND 120)
);

CREATE INDEX logbooks_open_idx ON logbooks (opens_at, closes_at) WHERE launched_at IS NOT NULL;

CREATE TABLE logbook_fields (
  id            bigserial PRIMARY KEY,
  logbook_id    bigint NOT NULL REFERENCES logbooks(id) ON DELETE CASCADE,

  -- THE KEY THIS FIELD'S ANSWER IS SEALED UNDER. Minted once when the field
  -- is created and never editable, because it ends up inside the hashed
  -- object of every report that answers it. The LABEL is what an operator
  -- edits; this is not.
  key           text NOT NULL,

  kind          text NOT NULL,
  label         text NOT NULL,
  help          text,
  required      boolean NOT NULL DEFAULT false,

  -- Whether this field appears as a filter on the board. Set in the form
  -- builder, per field. There is no built-in date or location filter and no
  -- notion of a "primary" anything — if an operator wants to filter by
  -- when something happened, they mark their date field filterable.
  filterable    boolean NOT NULL DEFAULT false,

  -- Everything type-specific: choice options, min/max, whether a place
  -- field offers the scope list, and so on. Shape is the field type's
  -- business, not this table's.
  settings      jsonb NOT NULL DEFAULT '{}'::jsonb,

  position      integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT logbook_fields_key_check CHECK (key ~ '^[a-z0-9][a-z0-9_]{0,38}$'),
  CONSTRAINT logbook_fields_label_check CHECK (length(btrim(label)) BETWEEN 1 AND 160),
  UNIQUE (logbook_id, key)
);

CREATE INDEX logbook_fields_order_idx ON logbook_fields (logbook_id, position, id);

-- Which logbook a report was filed to, and what it answered.
--
-- Both are nullable because every report filed before logbooks existed has
-- neither, and those reports are sealed. The absent-key rule covers them:
-- they carry no logbook key in the hashed object and verify untouched.
ALTER TABLE reports ADD COLUMN logbook_id bigint REFERENCES logbooks(id);
ALTER TABLE reports ADD COLUMN answers    jsonb;

CREATE INDEX reports_logbook_idx ON reports (logbook_id) WHERE logbook_id IS NOT NULL;

-- One general index over the answers rather than an expression index per
-- filterable field. jsonb_path_ops is the smaller, faster choice for the
-- containment queries a filter generates. Per-field indexes become possible
-- once a logbook is launched and its fields can no longer change — that is
-- a real dividend of the freeze — but building them before any volume asks
-- for them is the same mistake as a hardcoded field.
CREATE INDEX reports_answers_idx ON reports USING gin (answers jsonb_path_ops)
  WHERE answers IS NOT NULL;

COMMIT;
