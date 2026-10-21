-- At the door (Plan E, session PE2): the checks every report and tip passes
-- before anything of it is stored, and the one logbook setting E1 adds.
--
-- NOTHING HERE HOLDS A NETWORK ADDRESS, hashed or not. Rate limiting keeps
-- its keyed hashes in memory under a key that rotates daily (door/clients.ts),
-- so a table could only ever have been a second copy of them.

-- E1: THE OPERATOR MAY REQUIRE AN EMAIL ON ANY FORM. A form that asks a
-- question somebody types into, or takes files, asks for one anyway; this only
-- adds it to a form that would not. Not sealed, so it may change after launch:
-- it decides what the NEXT report is asked, never what an earlier one was.
ALTER TABLE logbooks ADD COLUMN email_required boolean NOT NULL DEFAULT false;

-- A PUZZLE IS SOLVED ONCE. The hash of each accepted challenge's signature,
-- kept until the challenge would have expired anyway, and refused if it comes
-- back. A hash of a value the server itself issued: nothing of the visitor's.
CREATE TABLE door_spent_puzzles (
  signature_hash text PRIMARY KEY CHECK (signature_hash ~ '^[a-f0-9]{64}$'),
  expires_at     timestamptz NOT NULL
);
CREATE INDEX door_spent_puzzles_expires_idx ON door_spent_puzzles (expires_at);

-- THE DOOR'S SETTINGS, one row. How long somebody must have had the form open
-- before it may be sent, and how hard the puzzle is. The moderator screen's
-- "Harder puzzle" switch (session PE3) writes `puzzle`.
CREATE TABLE door_settings (
  id             boolean PRIMARY KEY DEFAULT true CHECK (id),
  min_form_ms    integer NOT NULL DEFAULT 3000 CHECK (min_form_ms BETWEEN 0 AND 600000),
  puzzle         text NOT NULL DEFAULT 'normal' CHECK (puzzle IN ('normal', 'harder')),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
INSERT INTO door_settings (id) VALUES (true);

-- REFUSALS, COUNTED BY CHECK AND HOUR, AND NOTHING ELSE: no content, no time
-- finer than the hour, nothing about who. The moderator screen's "refusals per
-- hour" reads this (session PE3 may replace the module that writes it).
CREATE TABLE door_refusals (
  -- The start of the hour (UTC), as the module writes it.
  hour     timestamptz NOT NULL,
  check_id text NOT NULL CHECK (check_id ~ '^[a-z_]{2,40}$'),
  count    integer NOT NULL DEFAULT 0 CHECK (count >= 0),
  PRIMARY KEY (hour, check_id)
);
