-- Coverage: articles journalists link to their profile, tagged with where
-- the events they report happened (decision 84).
--
-- NOT A REPORT. Nothing here is sealed or reaches the chain, and a reporter
-- is never named: an article is a journalist's published work, linked by its
-- author. So it may be edited or deleted by its author, unlike a report.
--
-- The page behind the link is never stored. Only the address is; the card a
-- reader sees (title, description, publisher) is read from the page when it
-- is shown and kept in memory for a while (articles/preview.ts).

-- How a journalist is credited on the public coverage list. Written by the
-- journalist for exactly this purpose, so it is plain text, unlike the name
-- and outlet given when they signed up, which stay encrypted and private.
CREATE TABLE coverage_bylines (
  user_id     bigint PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  outlet      text CHECK (outlet IS NULL OR length(btrim(outlet)) BETWEEN 1 AND 160),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE coverage_articles (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id       bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  url           text NOT NULL CHECK (url ~ '^https?://' AND length(url) <= 2000),
  -- The address's host, for showing and for finding; derived from url on write.
  host          text NOT NULL CHECK (length(host) BETWEEN 1 AND 253),
  -- The day the events it reports happened, when the journalist gives one.
  happened_on   date,
  -- About the United States as a whole.
  national      boolean NOT NULL DEFAULT false,
  -- About somewhere outside it, with or without a country named in places.
  international boolean NOT NULL DEFAULT false,
  -- The journalist's choice: on the public coverage list and the maps, or
  -- only on their own profile. Approval is still needed for either.
  listed        boolean NOT NULL DEFAULT true,
  review_state  text NOT NULL DEFAULT 'waiting'
                  CHECK (review_state IN ('waiting', 'approved', 'declined')),
  reviewed_by   text,
  reviewed_at   timestamptz,
  review_note   text CHECK (review_note IS NULL OR length(review_note) <= 1000),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, url),
  CHECK ((review_state = 'waiting') = (reviewed_at IS NULL))
);

CREATE INDEX coverage_articles_waiting ON coverage_articles (created_at)
  WHERE review_state = 'waiting';
CREATE INDEX coverage_articles_public ON coverage_articles (happened_on DESC, id DESC)
  WHERE review_state = 'approved' AND listed;

-- Where: place codes in the gazetteer's spelling, as a location answer
-- normalizes to (US-AZ, US-AZ-04013, a country such as DE). National is the
-- column above, not the code US, so a map never mistakes it for a place.
CREATE TABLE coverage_article_places (
  article_id  bigint NOT NULL REFERENCES coverage_articles (id) ON DELETE CASCADE,
  code        text NOT NULL CHECK (code ~ '^[A-Z]{2}(-[A-Z0-9]{1,3}(-[0-9]{5})?)?$' AND code <> 'US'),
  PRIMARY KEY (article_id, code)
);

CREATE INDEX coverage_article_places_code ON coverage_article_places (code);
