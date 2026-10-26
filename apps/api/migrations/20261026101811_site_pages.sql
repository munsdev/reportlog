-- Decision 79. The fixed pages (home, about, get-involved) built from blocks.
-- PRESENTATION ONLY: never sealed, never read into a sealed object, and the
-- boundary check keeps the seal and the chain code away from it.
--
-- site_pages holds the live blocks. No row (or NULL blocks) means "as
-- shipped": the server derives the blocks from the page wording that ships,
-- so a page looks the same until its first save.
CREATE TABLE site_pages (
  page       text PRIMARY KEY CHECK (page IN ('home', 'about', 'get-involved')),
  blocks     jsonb CHECK (blocks IS NULL OR jsonb_typeof(blocks) = 'array'),
  -- The edit row that is live now, so Undo can walk back through the chain.
  edit_id    bigint,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One row per save (and a NULL-blocks row for "as shipped" before the first).
-- `parent` is the edit that was live when this one was saved. Only the newest
-- twenty per page are kept; older rows are pruned, which is why `parent` is
-- not a foreign key.
CREATE TABLE site_page_edits (
  id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  page     text NOT NULL CHECK (page IN ('home', 'about', 'get-involved')),
  blocks   jsonb CHECK (blocks IS NULL OR jsonb_typeof(blocks) = 'array'),
  parent   bigint,
  saved_at timestamptz NOT NULL DEFAULT now(),
  saved_by bigint REFERENCES users (id) ON DELETE SET NULL
);
CREATE INDEX site_page_edits_page_idx ON site_page_edits (page, id DESC);
