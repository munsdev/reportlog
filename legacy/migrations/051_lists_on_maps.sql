-- A LIST CAN FEED A HEAT MAP.
--
-- Maps were fed by logbooks only. Nothing about the geometry required
-- that: a map needs a place code and a row somebody approved, and a list
-- has both. What it needed was for the two questions a list answers
-- differently — what counts as approved, and what happens to an answer
-- over time — to have answers that hold.
--
-- THEY ALREADY DID, and that is why this is additive and small.
--
--   * `list_entries.review_state = 'approved'` is, in migration 046's own
--     words, "may this be counted". It is the list's analogue of a
--     published report and no new column is needed to say so.
--   * `answers` is the durable half and `erasable_answers` is what the
--     sweep blanks. A place code is not personal data and belongs in
--     `answers`, so a map's count does not fall away months later when the
--     contact details go. The two-column split is exactly what makes that
--     safe to promise: a query counting `answers` CANNOT reach anything
--     erasable.
--
-- AN ENTRY IS STILL NOT A REPORT. Nothing here seals, chains or hashes; a
-- list is still approved in bulk and still publishes counts rather than
-- content. What is shared is an aggregate, which was only ever counts.

-- ---------------------------------------------------------------------
-- WHICH LISTS FEED A MAP

-- NOT FOLDED INTO `logbook_ids`. Two id spaces in one array would need a
-- tag to tell a logbook 7 from a list 7, and an untagged array would
-- silently count the wrong rows the first time the two sequences
-- overlapped. A second column cannot make that mistake.
--
-- NO FOREIGN KEY, for the reason `logbook_ids` has none: an array cannot
-- carry one, and a map is a view — deleting a draft list must not take
-- down every map that named it. An id naming a list that no longer exists
-- is skipped when the map is built.
ALTER TABLE heat_maps ADD COLUMN list_ids bigint[] NOT NULL DEFAULT '{}'::bigint[];

COMMENT ON COLUMN heat_maps.list_ids IS
  'Lists feeding this map. EMPTY MEANS NONE — unlike logbook_ids, where '
  'empty means every launched one. See the note in migration 051.';

-- EMPTY MEANS NONE, AND THAT ASYMMETRY IS THE POINT.
--
-- `logbook_ids` empty means EVERY launched logbook, which is what the
-- single map did before there were several and is what a deployment with
-- one kind of report wants. Giving `list_ids` the same rule would have
-- opted every map that already exists into counting list entries the
-- moment this migration ran — changing what a published map shows, on
-- behalf of an operator who never chose it and may not know the lists are
-- being counted.
--
-- The same reasoning as the front page's buttons: a thing made later is
-- added deliberately, never retroactively assumed. An operator ticks a
-- list on.

-- ---------------------------------------------------------------------
-- WHICH QUESTION PLACES AN ENTRY

-- The mirror of `logbook_fields.map_location`, added by migration 049.
-- A list's form stays editable — that is half of what a list IS — so
-- there is no launch gate to argue with here and no fingerprint to
-- disturb. Marking a question is an operator's decision and nothing else.
ALTER TABLE list_fields ADD COLUMN map_location boolean NOT NULL DEFAULT false;

-- AT MOST ONE PER LIST, exactly as for a logbook. Two location questions
-- feeding one map would count a single entry twice, in two different
-- areas, and the map would be quietly wrong rather than visibly broken —
-- the worst failure available to something whose entire output is counts.
CREATE UNIQUE INDEX list_fields_one_map_location
  ON list_fields (list_id) WHERE map_location;

-- NO `map_outcome` FOR A LIST, deliberately.
--
-- The Outcome view colours an area by answers a moderator marked positive
-- or negative, which is a judgement made one entry at a time. A list is
-- approved in BULK — that is the format's defining trade — so there is no
-- moment at which somebody made that judgement about an entry, and a
-- column here would invite a view whose colour means nothing. A list
-- feeds the volume view. If an outcome view for lists is ever wanted it
-- needs its own decision about who marks what and when, not this column
-- borrowed because it was the nearest one.
