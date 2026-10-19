-- ════════════════════════════════════════════════════════════════════════
-- Heat maps (workstream I).
--
-- Where published reports came from, as counts. As many maps as an operator
-- wants, each off until they turn it on, each with its own threshold, its own
-- feeds and its own place on the site. Ported from legacy migrations 049 and
-- 051, as four tables of this workstream's own: nothing is added to a core
-- table.
--
-- NOTHING HERE IS SEALED, and no fingerprint reads any of it. A heat map is a
-- view of the record: which published counts get drawn, for whom, where.
-- Every report it counts was sealed before the map existed, and deleting a
-- map takes no report with it. The boundary check forbids the seal and the
-- chain code from ever reaching apps/api/src/maps/.
--
-- NOT APPEND-ONLY, on purpose. The archive is append-only because the RECORD
-- must be permanent. An operator who raises a threshold has changed what is
-- shown and nothing about what happened.
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE heat_maps (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- In the map's own address and in links somebody shares. Editable: nothing
  -- seals it and no report points at it. A stale link answers 404.
  slug       text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  title      text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 160),
  blurb      text CHECK (blurb IS NULL OR length(blurb) <= 2000),

  -- OFF UNTIL SOMEBODY TURNS IT ON. A map made and left alone publishes
  -- nothing.
  enabled    boolean NOT NULL DEFAULT false,

  -- THE THRESHOLD, AND THE FLOOR IS HERE, not only in a route. An area is
  -- shaded only at this many published reports or more; under it the area
  -- is sent as a bare code with no count. A threshold of 1 is not a low
  -- threshold: it is the protection switched off while still claiming to be
  -- on, publishing "one report came from here" for every thin area at once.
  min_area   integer NOT NULL DEFAULT 3 CHECK (min_area >= 2),

  -- Which planes the map offers: the United States by state, the world by
  -- country, or both.
  planes     text[] NOT NULL DEFAULT ARRAY['us']::text[]
               CHECK (cardinality(planes) BETWEEN 1 AND 2
                      AND planes <@ ARRAY['us', 'world']::text[]),

  -- What the colour can show. `volume` is how many; `outcome` is the
  -- operator's positive/negative reading of one closed question. Legacy's
  -- third view, `severity`, reads a moderator's assessment, which the
  -- moderation workstream has not built; it is a new migration when it is.
  views      text[] NOT NULL DEFAULT ARRAY['volume']::text[]
               CHECK (cardinality(views) BETWEEN 1 AND 2
                      AND views <@ ARRAY['volume', 'outcome']::text[]),

  -- WHICH LOGBOOKS FEED THE MAP. EMPTY MEANS EVERY LOGBOOK, which is what a
  -- deployment with one kind of report wants.
  --
  -- No foreign key, because an array cannot carry one. An id naming a
  -- logbook that no longer exists (a deleted draft) is skipped when the map
  -- is built: a map is a view and must not break because a draft went.
  logbook_ids bigint[] NOT NULL DEFAULT '{}'::bigint[],

  -- WHICH LISTS FEED IT. EMPTY MEANS NO LISTS, the opposite of logbook_ids,
  -- and that asymmetry is the point (legacy 051): a list is opted in by an
  -- operator ticking it, never assumed. Only approved entries are counted.
  list_ids   bigint[] NOT NULL DEFAULT '{}'::bigint[],

  -- WHICH QUESTION COLOURS THE OUTCOME VIEW, and how the operator reads each
  -- of its answers: {"<answer>": "positive" | "neutral" | "negative"}.
  --
  -- THE READING IS THE MAP'S, NOT THE QUESTION'S. Legacy kept it in the
  -- question's settings, which the rebuild seals into the form definition:
  -- there it would have to be decided before launch and could never change.
  -- Here it is a property of one drawing of the answers, as it should be.
  --
  -- ON DELETE SET NULL: losing the question (a draft's) is not a reason to
  -- lose the map. The aggregate drops an outcome view with no question.
  outcome_logbook_id bigint,
  outcome_key        text,
  outcome_stances    jsonb NOT NULL DEFAULT '{}'::jsonb
                       CHECK (jsonb_typeof(outcome_stances) = 'object'),
  FOREIGN KEY (outcome_logbook_id, outcome_key)
    REFERENCES logbook_fields (logbook_id, key) ON DELETE SET NULL ON UPDATE CASCADE,
  CHECK ((outcome_logbook_id IS NULL) = (outcome_key IS NULL)),

  -- WHERE IT APPEARS: one of the slots the website has (MAP_SLOTS in
  -- packages/contracts/src/maps.ts). NO CHECK, on purpose: a slot is a
  -- property of the website, and a new one is a line there and a component
  -- on a page, not a migration. Every write is checked against the list; a
  -- row carrying a slot the site no longer has is simply not placed, and its
  -- own address still works.
  slot       text NOT NULL DEFAULT 'own_page',
  -- The operator's order within a slot. Ties break on id.
  position   integer NOT NULL DEFAULT 0,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX heat_maps_placement ON heat_maps (slot, position, id) WHERE enabled;

-- ── which question places a report ──────────────────────────────────────
-- AT MOST ONE PER LOGBOOK (the primary key). A logbook can ask where twice —
-- where it happened and where the reporter lives — but an aggregate that
-- found both would have to guess which one a report's area is. The operator
-- picks, once.
--
-- ITS OWN TABLE, NOT A COLUMN ON logbook_fields. Legacy added a flag beside
-- `filterable`; a table of this workstream's own reaches the same place
-- without touching a core table, and a launched logbook can still be put on
-- a map because nothing here is in its sealed form definition.
CREATE TABLE map_place_questions (
  logbook_id bigint PRIMARY KEY,
  field_key  text NOT NULL,
  marked_at  timestamptz NOT NULL DEFAULT now(),
  -- ON DELETE CASCADE: only a draft's question can be removed, and a draft
  -- has no reports. ON UPDATE CASCADE: a draft's question can be re-keyed.
  FOREIGN KEY (logbook_id, field_key)
    REFERENCES logbook_fields (logbook_id, key) ON DELETE CASCADE ON UPDATE CASCADE
);

-- ONLY A `location` QUESTION PLACES A REPORT. A free-text `place` answer is
-- prose ("Phoenix", "phoenix az"), so marking one would draw a map on which
-- every report is unplaced: an empty map that reports no fault.
CREATE FUNCTION map_place_questions_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  k text;
BEGIN
  SELECT kind INTO k FROM logbook_fields
   WHERE logbook_id = NEW.logbook_id AND key = NEW.field_key;
  IF k IS DISTINCT FROM 'location' THEN
    RAISE EXCEPTION 'only a location question can place a report on a map (%)', NEW.field_key;
  END IF;
  RETURN NEW;
END;
$$;
-- ON INSERT ONLY. A draft's question can still change kind in the builder
-- afterwards, and refusing that edit with this trigger's message would be
-- the builder failing for a reason it cannot see. The aggregate reads only
-- location questions anyway, so a marking left on another kind places
-- nothing; the staff screen says so.
CREATE TRIGGER map_place_questions_guard BEFORE INSERT ON map_place_questions
  FOR EACH ROW EXECUTE FUNCTION map_place_questions_guard();

-- ── which question places a list entry ──────────────────────────────────
-- The mirror of the above (legacy 051). A list's form stays editable, so
-- there is no launch gate here, and nothing about an entry is sealed.
--
-- AN ENTRY IS STILL NOT A REPORT. The map counts approved entries in a query
-- of their own, from `answers` and never from `erasable_answers`, and the
-- page says "entries" when it counts them.
CREATE TABLE map_list_place_questions (
  list_id   bigint PRIMARY KEY,
  field_key text NOT NULL,
  marked_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (list_id, field_key)
    REFERENCES list_fields (list_id, key) ON DELETE CASCADE
);

-- A location question, and one whose answers are kept: the map reads only
-- the durable half of an entry, so a count cannot shrink by itself months
-- later when the sweep runs.
CREATE FUNCTION map_list_place_questions_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  k text;
  r text;
BEGIN
  SELECT kind, retention INTO k, r FROM list_fields
   WHERE list_id = NEW.list_id AND key = NEW.field_key;
  IF k IS DISTINCT FROM 'location' THEN
    RAISE EXCEPTION 'only a location question can place an entry on a map (%)', NEW.field_key;
  END IF;
  IF r IS DISTINCT FROM 'durable' THEN
    RAISE EXCEPTION 'a question whose answers are erased cannot place an entry on a map (%)', NEW.field_key;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER map_list_place_questions_guard BEFORE INSERT ON map_list_place_questions
  FOR EACH ROW EXECUTE FUNCTION map_list_place_questions_guard();
