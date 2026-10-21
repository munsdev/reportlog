-- Two things a list may now do (ElectionLog questionnaires §04, ruling 49).
--
-- A STRICT FORM. A list keeps its lenient reading by default: a key it does
-- not ask is dropped, so a form left open in a tab still sends. A list whose
-- form says `strict` refuses instead, as a logbook does (L7). Off for every
-- list that exists, so nothing already running changes.
ALTER TABLE lists ADD COLUMN strict boolean NOT NULL DEFAULT false;

-- WHAT KIND OF LINK EACH ONE IS, on the link's own row. Kept beside the
-- encrypted value rather than in the entry's answers, because it describes
-- that one link: the desk shows it beside the link (J9), and it goes when the
-- link is erased, since a type with no link says nothing. A code from the
-- question's own list, checked when the entry is filed; NULL on every link a
-- form without types collected.
ALTER TABLE links ADD COLUMN link_type text
  CHECK (link_type IS NULL OR link_type ~ '^[a-z0-9][a-z0-9_]{0,62}$');
