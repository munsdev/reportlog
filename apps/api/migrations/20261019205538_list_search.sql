-- Lists (P6): the full-text index for subject access requests, and the three
-- other indexes legacy's 046 had that the first port left out.
--
-- THE TEXT INDEX COVERS ONLY WHAT THE SWEEP ERASES: the string answers in
-- `erasable_answers`, and the address in `email`. A subject access request is
-- "what do you hold about me", and what is held about a person is in those two
-- columns; the durable half is links and choices, with nobody in it. Indexing
-- a column the sweep empties is intended: what has been erased is not findable,
-- because it is not there.
--
-- NOT QUITE, ON ITS OWN. A GIN index keeps an erased word's bytes in its pages
-- after the UPDATE that blanked it, and VACUUM does not take them out (it drops
-- the row pointers and leaves the key). So the list sweep rebuilds this index
-- after it erases (`rebuildTextIndex` in apps/api/src/lists/search.ts), and
-- test/db/lists-search.test.ts reads the index's raw pages to show the word
-- has gone.
--
-- `simple`, NOT `english` AS LEGACY HAD IT: this finds a person, by name or
-- address, and English drops stop words. "Will", "May" and "June" are names.
-- No stemming either: the search is for what was written.
--
-- jsonb_to_tsvector over string values only, rather than to_tsvector of the
-- column cast to text, so a question's key is not a word in the index and an
-- escaped newline does not glue two words together.
--
-- THE EXPRESSION IS REPEATED CHARACTER FOR CHARACTER IN search.ts. Postgres
-- uses an expression index only for the same expression; a drifted copy reads
-- every row instead, and the test that checks the plan goes red.
CREATE INDEX list_entries_text_idx ON list_entries USING gin ((
  jsonb_to_tsvector('simple'::regconfig, coalesce(erasable_answers, '{}'::jsonb), '["string"]'::jsonb)
  || to_tsvector('simple'::regconfig, coalesce(email, ''))
));

-- Counting a closed vocabulary groups on a key of the durable half.
CREATE INDEX list_entries_answers_idx ON list_entries USING gin (answers);
-- The links a reviewer sorts by site.
CREATE INDEX list_entry_links_host_idx ON list_entry_links (host);
-- The most-sent links first (`linkCounts`).
CREATE INDEX link_index_count_idx ON link_index (submission_count DESC);
