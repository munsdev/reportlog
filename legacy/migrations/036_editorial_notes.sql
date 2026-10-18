-- An editorial note: the archive's own statement about a report it published.
--
-- WHAT IT REPLACES. The veracity verdict, withdrawn in 035. A one-word
-- judgement about a named third party was the hardest kind of assertion to
-- defend; a written note, signed by the moderator who made the publication
-- decision, is a considered statement somebody can stand behind. The
-- exposure does not disappear — it moves from a verdict nobody can defend to
-- a statement somebody can.
--
-- NOTHING HERE TOUCHES THE HASHED OBJECT. It adds two tables and one column.
-- No report hashes differently, no existing row is read or rewritten, no
-- append-only table is updated, and `reportCore.js`, `verify.js`,
-- `chainFile.js` and `snapshot.js` never import the module that reads these.
-- A report filed before this migration is byte-identical afterwards.
--
-- WHY THE NOTE IS NOT HASHED, which is the decision this file turns on.
-- Permanence decides where a value lives: hash what must never change, and
-- put what may change where changing it is recorded. **Journalistic care
-- includes correcting things.** A note frozen at publication is a mistake
-- nobody can fix — and the first time the archive had to correct its own
-- published statement it would have to choose between leaving an error up
-- and breaking a seal. So the note is mutable in the only sense that
-- matters: a new version can be written. What is NOT mutable is the record
-- of what it said before.
--
-- VERSIONS ARE APPEND-ONLY AND EVERY ONE IS PUBLISHED, so a change shows as
-- a change. The current note is a PROJECTION over the versions — the newest
-- row for a note wins — exactly as `report_permissions_log` works. An
-- archive whose own statements could be edited silently would be asking for
-- the trust it exists to make unnecessary.
--
-- THE AUTHOR IS RECORDED AND THE BYLINE IS WHAT PUBLISHES. Decided
-- 4 October: a house byline, not initials and not names. Moderator identity
-- is protected everywhere else in this system, and a published note carrying
-- somebody's name would make the one place it is not. So `author_email` is
-- stored — the editorial record has to say who decided — and nothing serves
-- it to the public. Two visibilities, one stored author. The route that
-- reads a note for the public does not select the column; the suite asserts
-- that.
--
-- Additive. Two new tables, one nullable column on `logbooks`, no backfill.

BEGIN;

-- ---------------------------------------------------------------------
-- WHETHER A LOGBOOK USES NOTES AT ALL.
--
-- Per logbook rather than per deployment, because the thing a note is FOR
-- varies: an election logbook publishing accounts that name officials needs
-- one; an internal safety log that publishes nothing has no use for the
-- feature and should not have the control in front of its moderators.
--
-- A COLUMN RATHER THAN A SETTINGS BAG, following 032's `files_frozen_at`:
-- this table has no jsonb and adding one for a single boolean would make the
-- next three settings invisible to a reader of the schema.
--
-- NULL/false is the default and there is no backfill, for the reason 003 and
-- 030 both gave: a default of true would switch a behaviour on everywhere
-- the moment this ran.
ALTER TABLE logbooks ADD COLUMN IF NOT EXISTS editorial_notes_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN logbooks.editorial_notes_enabled IS
  'Whether a moderator may attach an editorial note to a report in this logbook. Off by default. Never hashed — it is delivery, and turning it on or off changes no answer any reporter gave.';

-- ---------------------------------------------------------------------
-- THE NOTE. One per report at most, for now.
--
-- A row here is the note's IDENTITY and its lifecycle state. What it SAYS
-- lives in the versions table, so that saying something different is an
-- append rather than an edit.
CREATE TABLE editorial_notes (
  id         bigserial PRIMARY KEY,
  thread_id  uuid NOT NULL UNIQUE,

  -- UNDER EDITORIAL REVIEW is a real state and not a deletion. It is for a
  -- note whose author was removed for breaching the charter: the note stays
  -- visible, marked as such, because silent removal is the thing this
  -- archive exists to prevent and that applies to our own material too.
  --
  -- WITHDRAWN is the chief editor's decision to take a note down, which is
  -- NOT an automatic consequence of the reporter withdrawing their report.
  -- If a note followed its report automatically, pressuring a reporter would
  -- become a way to erase the editorial record — the suppression route the
  -- whole chain design exists to close. A note restating an allegation
  -- protects nobody by surviving, which is why this is a decision somebody
  -- records rather than a rule.
  state      text NOT NULL DEFAULT 'published',

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT editorial_notes_state_check
    CHECK (state = ANY (ARRAY['published', 'under_review', 'withdrawn']))
);

COMMENT ON TABLE editorial_notes IS
  'The archive''s own statement about a report. One per report. What it says is in editorial_note_versions; this row is its identity and state. Never hashed.';

CREATE INDEX editorial_notes_state_idx ON editorial_notes (state);

-- NOT append-only, deliberately, and this is the only part of the feature
-- that is mutable. `state` has to move: a note goes under review when its
-- author is removed, and comes back when that is resolved. Every move is
-- recorded in self_service_log by the route, and what the note SAID is
-- immutable regardless, which is the part that matters.

-- ---------------------------------------------------------------------
-- WHAT IT SAYS, EVERY VERSION OF IT.
CREATE TABLE editorial_note_versions (
  id        bigserial PRIMARY KEY,
  note_id   bigint NOT NULL REFERENCES editorial_notes(id),

  -- PLAIN TEXT. Paragraph breaks and nothing else.
  --
  -- The design called for "restricted rich text or markdown, sanitised on
  -- render". Rendering either needs a markdown parser and an HTML sanitiser,
  -- and this application has seven dependencies in total — an HTML
  -- sanitiser is exactly the kind that earns CVEs, on a surface where the
  -- input is staff-authored and the output is public. Escaping the text and
  -- turning blank lines into paragraphs gets the formatting an editorial
  -- note actually needs at none of that cost.
  --
  -- Stored as the author typed it, so what the archive holds is what the
  -- editor wrote: a renderer changed later must not have silently rewritten
  -- the record of an earlier statement.
  --
  -- Revisit this when a note genuinely needs a link inside a sentence. The
  -- citations table below is the answer until then, and it is a better one:
  -- a source listed beside a note is checkable, where a link buried in prose
  -- is decoration.
  body      text NOT NULL,

  -- WHO DECIDED. Recorded, never published. The byline is a house one, so
  -- nothing serves this column to the public — the public note route does
  -- not select it, and the suite asserts that it does not.
  --
  -- Not nullable: an editorial record that cannot say who wrote a statement
  -- is not an editorial record. This is staff, not a reporter, so the
  -- erasure reasoning that makes self_service_log.actor_email nullable does
  -- not apply — a moderator's address is not Tier B.
  author_email text NOT NULL,

  -- Why this revision exists. Shown to nobody outside the staff log; it is
  -- the editorial equivalent of a commit message, and a note that changed
  -- for no stated reason is one nobody can audit.
  revision_reason text,

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT editorial_note_versions_body_check CHECK (length(btrim(body)) BETWEEN 1 AND 20000)
);

COMMENT ON TABLE editorial_note_versions IS
  'Every version of every editorial note, append-only. The current note is the newest row for a note_id — a projection, like report_permissions_log. Each version is published, so a change to the archive''s own statement shows as a change. author_email is recorded and never served to the public: the byline is a house one.';

-- The projection's index: newest version for a note, in one scan.
CREATE INDEX editorial_note_versions_note_idx ON editorial_note_versions (note_id, id DESC);

-- APPEND-ONLY. The whole promise of the feature. A published statement whose
-- history could be rewritten would need exactly the trust this archive is
-- built to make unnecessary.
CREATE TRIGGER editorial_note_versions_append_only
  BEFORE DELETE OR UPDATE ON editorial_note_versions
  FOR EACH ROW EXECUTE FUNCTION reject_modification();

CREATE TRIGGER editorial_note_versions_no_truncate
  BEFORE TRUNCATE ON editorial_note_versions
  FOR EACH STATEMENT EXECUTE FUNCTION reject_modification();

-- ---------------------------------------------------------------------
-- EXTERNAL LINKS, alongside the note.
--
-- For coverage carrying detail the archive does not have. Append-only like
-- the versions: a link that was cited and then quietly removed would leave a
-- published note resting on a source nobody can check.
--
-- `removed_at` rather than a DELETE, so withdrawing a link is itself on the
-- record. The charter says what qualifies as a linkable source, because a
-- link to a partisan outlet does more damage to the non-partisan claim than
-- the note does good — that is editorial policy and deliberately not a
-- constraint here.
CREATE TABLE editorial_note_links (
  id         bigserial PRIMARY KEY,
  note_id    bigint NOT NULL REFERENCES editorial_notes(id),
  title      text NOT NULL,
  publisher  text,
  published_on date,
  url        text NOT NULL,
  added_by   text NOT NULL,
  removed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT editorial_note_links_title_check CHECK (length(btrim(title)) BETWEEN 1 AND 300),
  -- http and https only. A javascript: or data: URL in an archive that
  -- renders links is an attack, not an address — the same rule
  -- src/answers.js applies to the `url` field type, stated here as well so
  -- the database refuses it whatever a route forgets.
  CONSTRAINT editorial_note_links_url_check CHECK (url ~* '^https?://')
);

COMMENT ON TABLE editorial_note_links IS
  'External coverage cited beside an editorial note. removed_at rather than DELETE, so withdrawing a citation is on the record. What qualifies as a linkable source is editorial policy in the charter, not a constraint here.';

CREATE INDEX editorial_note_links_note_idx ON editorial_note_links (note_id) WHERE removed_at IS NULL;

-- ---------------------------------------------------------------------
-- The staff log learns four more actions, so that writing, revising,
-- withdrawing or reviewing a note is recorded where every other moderator
-- action already is.
--
-- RESTATING THE WHOLE LIST IS HOW ONE GOES MISSING, and this file did it
-- the wrong way first. The list was copied out of 001 and four names added
-- — which silently dropped 'erase', added by 028 in between. Erasing a
-- reporter's contact details then failed with "Something went wrong",
-- because the log insert in the same transaction violated a constraint this
-- migration had narrowed. The database suite caught it; nothing in the
-- wording of the migration would have.
--
-- So the new names are ADDED TO WHATEVER IS THERE rather than replacing it.
-- The existing allowed values are read out of the live constraint, the four
-- are appended, and the result is written back. A migration after this one
-- that adds an action does not have to know what came before, and cannot
-- delete it by not knowing.
--
-- 'veracity' survives this for a reason worth stating: the action is
-- withdrawn (035) but rows written before it are still in an append-only
-- table, and a CHECK that stopped admitting its own history would refuse to
-- be read back by anything that re-inserts it — the archive replay, for one.
-- The explicit list is 001's plus 'erase' from 028 plus the four new ones.
-- Stated rather than parsed: an earlier attempt read the values back out of
-- `pg_get_constraintdef` and mangled them — the elements come back as
-- `'correct'::text`, and stripping quotes left `correct'::text` as the
-- allowed string, which is worse than the bug it was fixing. A constraint
-- definition is for people to read, not to parse.
--
-- AND THE UNION WITH WHAT IS ACTUALLY IN THE TABLE is what makes the
-- explicit list safe. Any action already recorded stays allowed even if it
-- is not named here, so a migration cannot narrow the constraint under its
-- own history by forgetting something. That is exactly what happened on the
-- first attempt at this file: 'erase' was dropped, and erasing a reporter's
-- contact details started failing with "Something went wrong" because the
-- log insert in the same transaction violated the narrowed CHECK. The
-- database suite caught it; the wording of the migration never would have.
DO $$
DECLARE
  allowed text[];
BEGIN
  SELECT array_agg(DISTINCT a ORDER BY a) INTO allowed
    FROM unnest(
      ARRAY[
        -- 001
        'correct', 'withdraw', 'restore', 'review', 'veracity',
        'incident', 'media', 'upload_rejected', 'severity',
        -- 028
        'erase',
        -- 036: writing a note, revising one, moving its state, citing a source
        'note', 'note_revised', 'note_state', 'note_link'
      ]
      -- Anything already in the table, whatever this file remembers.
      || coalesce((SELECT array_agg(DISTINCT action) FROM self_service_log), ARRAY[]::text[])
    ) AS a;

  EXECUTE format(
    'ALTER TABLE self_service_log DROP CONSTRAINT self_service_log_action_check,
       ADD CONSTRAINT self_service_log_action_check CHECK (action = ANY (%L::text[]))',
    allowed);
END $$;

COMMIT;
