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

-- THE DOOR'S SETTING, one row: how long somebody must have had the form open
-- before it may be sent. (How hard the puzzle is, and the refusal counts, are
-- the moderators' flood switches: flood_settings and intake_refusal_counts.)
CREATE TABLE door_settings (
  id             boolean PRIMARY KEY DEFAULT true CHECK (id),
  min_form_ms    integer NOT NULL DEFAULT 3000 CHECK (min_form_ms BETWEEN 0 AND 600000),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
INSERT INTO door_settings (id) VALUES (true);
