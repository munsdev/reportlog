-- HEAT MAPS, as many as an operator wants, each with its own settings.
--
-- The map shipped on 11 October as ONE view, hardcoded as a board tab,
-- reading four settings that did not exist yet. This replaces that plan:
-- the settings are per map, not site-wide, and there can be several.
--
-- WHY SEVERAL RATHER THAN ONE, which is the decision this table records.
-- One site-wide map answers one question. An operator running an archive
-- of two kinds of thing wants "where were the polling-place problems" and
-- "where were the workplace ones" side by side, at different thresholds,
-- fed by different logbooks — and a single map with a reader-facing
-- logbook switch is not the same feature, because the threshold and the
-- outcome question belong to the operator and not to the reader
-- (docs/map.md: a reader who could lower the threshold could undo the only
-- thing it is for).
--
-- NOTHING HERE IS HASHED, and no fingerprint reads any of it. A heat map is
-- delivery: which published counts get drawn, for whom, where on the site.
-- Every report it counts was sealed long before the map existed, and
-- deleting a heat map takes no report with it. `npm test` asserts that
-- reportCore.js, verify.js, chainFile.js and snapshot.js never read it, the
-- same guard that stands over the upload limits and the keyword list.
--
-- NOT APPEND-ONLY, and that is deliberate rather than forgotten. The
-- archive is append-only because the RECORD must be permanent. A map is a
-- view of the record: an operator who raises a threshold has changed what
-- is shown and nothing about what happened. Named here as excluded so a
-- later session does not read the missing trigger as an oversight.

CREATE TABLE heat_maps (
  id            bigserial PRIMARY KEY,

  -- In the address, in a link somebody shares, and in the query that
  -- prefilters it. Editable: nothing seals it, no report points at it, and
  -- unlike a logbook's slug it is not in anybody's fingerprint. A stale
  -- link 404s, which is the ordinary cost of renaming a page.
  slug          text NOT NULL UNIQUE
                  CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  title         text NOT NULL,
  blurb         text,

  -- OFF UNTIL SOMEBODY TURNS IT ON, per map, like the site-wide switch it
  -- replaces. A map created and left alone publishes nothing.
  enabled       boolean NOT NULL DEFAULT false,

  -- THE THRESHOLD, AND THE FLOOR IS IN THE DATABASE. An area is shaded
  -- only at this many published reports or more; below it the area travels
  -- as a bare code with no count attached (src/mapData.js says why that is
  -- the whole mechanism rather than a nicety).
  --
  -- 2 is the floor and it is enforced here rather than only in a route,
  -- because a threshold of 1 is not a low threshold — it is the feature
  -- switched off while still claiming to be on, and it would publish
  -- "one report came from here" for every thin area at once.
  min_area      integer NOT NULL DEFAULT 3 CHECK (min_area >= 2),

  -- Which plane or planes this map offers: 'us', 'world'. A map of one
  -- country's states and a map of the world answer different questions and
  -- an operator may want either or both.
  planes        text[] NOT NULL DEFAULT ARRAY['us']::text[]
                  CHECK (cardinality(planes) BETWEEN 1 AND 2),

  -- What the colour can show: 'volume', 'outcome', 'severity'. The reader
  -- picks among these; the operator decides which are offered.
  views         text[] NOT NULL DEFAULT ARRAY['volume']::text[]
                  CHECK (cardinality(views) BETWEEN 1 AND 3),

  -- WHICH LOGBOOKS FEED THIS MAP. Empty means every launched one, which is
  -- what the single map did and stays the sensible default for a
  -- deployment with one kind of report.
  --
  -- NO FOREIGN KEY, because an array cannot carry one. A logbook id that no
  -- longer exists is skipped by the aggregate rather than erroring: a map
  -- is a view, and a deleted draft logbook must not break every map that
  -- happened to name it. The alternative — a join table — buys referential
  -- integrity for a value that is read whole, every time, by one query.
  logbook_ids   bigint[] NOT NULL DEFAULT '{}'::bigint[],

  -- WHICH QUESTION COLOURS THE OUTCOME VIEW, chosen from the questions an
  -- operator marked `map_outcome` below. ON DELETE SET NULL rather than
  -- CASCADE: losing the question is not a reason to lose the map, and
  -- `resolveViews` drops an outcome view with no question behind it rather
  -- than drawing a view of nothing.
  outcome_field_id bigint REFERENCES logbook_fields(id) ON DELETE SET NULL,

  -- WHERE IT APPEARS. One of the slots the interface actually has, listed
  -- in src/mapSlots.js.
  --
  -- NO CHECK CONSTRAINT ON THIS COLUMN, on purpose: the slots are a
  -- property of the front end, and a new one should be a line in a module
  -- and a card in the panel, not a migration. The route validates against
  -- that list on every write, and a row carrying a slot the interface no
  -- longer has is simply not placed — which is the right failure, because
  -- the map still exists and its address still works.
  slot          text NOT NULL DEFAULT 'board_tab',

  -- Within a slot, the operator's order. Ties break on id, so two maps that
  -- were never ordered still come out in a stable sequence.
  position      integer NOT NULL DEFAULT 0,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX heat_maps_placement ON heat_maps (slot, position, id) WHERE enabled;

-- THE TWO OPERATOR FLAGS, and they live BESIDE `filterable` rather than in
-- a settings blob for the reason src/formText.js states: the sealed form
-- definition lists the keys that change what a question MEANS, and these
-- change only what is drawn from the answers afterwards. A question gaining
-- a map flag rehashes nothing, so a LAUNCHED logbook can be put on a map —
-- which is the whole point, since a logbook that has been collecting
-- reports for a year is exactly the one somebody wants to map.
--
-- Putting them in `settings` would have had the opposite effect: settings
-- IS in the definition, so marking a launched logbook's question would
-- have changed the form hash every report of it was sealed against.

-- WHICH QUESTION PLACES A REPORT ON A MAP. Only a `location` question can
-- carry it — a free-text `place` answer is prose and cannot be counted —
-- and the route enforces that.
ALTER TABLE logbook_fields ADD COLUMN map_location boolean NOT NULL DEFAULT false;

-- WHICH QUESTION CAN COLOUR AN OUTCOME VIEW. Marked per question; which of
-- the marked ones a given map uses is that map's own `outcome_field_id`.
ALTER TABLE logbook_fields ADD COLUMN map_outcome boolean NOT NULL DEFAULT false;

-- AT MOST ONE LOCATION QUESTION PER LOGBOOK MAY FEED A MAP. A logbook can
-- ask where twice — where it happened and where the reporter lives are
-- different questions — but an aggregate that found both would have to
-- decide which one a report's area is, and there is no honest way to pick.
-- So the operator picks, once, and the database holds them to it.
CREATE UNIQUE INDEX logbook_fields_one_map_location
  ON logbook_fields (logbook_id) WHERE map_location;
