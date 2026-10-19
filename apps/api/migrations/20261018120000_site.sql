-- How this deployment looks and what it says about itself. Workstream G.
--
-- NOTHING HERE IS SEALED. Presentation only: a report must not verify
-- differently because somebody renamed the site or corrected a policy.

-- One row, always. `id` can only be true, so a second row is impossible.
CREATE TABLE site_settings (
  id            boolean PRIMARY KEY DEFAULT true CHECK (id),
  -- NULL is "nobody has named it", and the site uses the software's name.
  -- The marks (quotes) are stored as typed; the limit on the name itself is
  -- the application's, which counts it without them.
  site_name     text CHECK (site_name IS NULL OR length(btrim(site_name)) BETWEEN 1 AND 200),
  -- Not constrained to the catalogue here: the catalogue lives in code, and
  -- a value the code no longer offers resolves to the default rather than
  -- leaving the page with no colours.
  palette       text NOT NULL DEFAULT 'flint',
  theme         text NOT NULL DEFAULT 'signal',
  -- NULL is "not published", and the public page says so. Never defaulted
  -- to an outline: an operator who opened the editor and walked away must
  -- not have published our dummy as their legal notice.
  impressum_text text CHECK (impressum_text IS NULL OR length(impressum_text) <= 100000),
  privacy_text   text CHECK (privacy_text IS NULL OR length(privacy_text) <= 100000),
  -- NULL is "nobody has arranged the front page" (the shipped order); `[]`
  -- is an operator who removed every button. Different answers.
  home_buttons  jsonb CHECK (home_buttons IS NULL OR jsonb_typeof(home_buttons) = 'array'),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
INSERT INTO site_settings (id) VALUES (true);

-- The words on the site's own pages, one row per slot an operator has
-- written. No row is "use what ships". Key/value so that another editable
-- paragraph never needs a migration.
CREATE TABLE site_copy (
  key        text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]{0,62}$'),
  body       text NOT NULL CHECK (length(btrim(body)) > 0 AND length(body) <= 20000),
  updated_at timestamptz NOT NULL DEFAULT now()
);
