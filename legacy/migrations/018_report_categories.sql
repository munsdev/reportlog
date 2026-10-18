-- What this deployment's reports can be about.
--
-- Additive only, and it does NOT touch `reports`. No fingerprint changes,
-- no rehash, nothing needs re-verifying.
--
-- WHY THIS IS CHEAP, WHICH IS NOT OBVIOUS. `reports.categories` is
-- `text[]` with no CHECK constraint — only `cardinality >= 1`. The values
-- were never constrained by the database; they were constrained by a
-- constant in src/taxonomy.js. So a deployment choosing its own categories
-- needs no migration on the archive table and no recipe change: a report
-- seals whatever category names that deployment used, and goes on
-- verifying against them forever. verify.js reads row.categories straight
-- out of the row and does not re-filter it, which is what makes retiring a
-- category safe.
--
-- THE LABEL IS THE IDENTITY, and that is why there is no rename. The label
-- string itself is what gets sealed into a report's fingerprint. Renaming a
-- row here would not change a single sealed report — they keep the words
-- they were filed under — so a rename is really "retire one name and add
-- another", and calling it a rename would only hide that from whoever does
-- it. Retiring is `active = false`: it stops being offered to new reports
-- and every report already carrying it stays exactly as it is.
--
-- `position` is GLOBAL, not per group: one ordering for the whole list, so
-- the groups come out in the order the operator put them rather than
-- interleaving. A group's place is simply where its first category sits.
--
-- `group_label` is presentation only. It mirrors the headings the form
-- already groups the list under, adds nothing the server validates, and can
-- be changed freely — no report has ever sealed a group name.
--
-- Seeded with the eighteen from src/taxonomy.js, so an existing deployment
-- sees no change and a fresh install is not handed a form with nothing to
-- choose.
BEGIN;

CREATE TABLE IF NOT EXISTS report_categories (
  label       text PRIMARY KEY,
  group_label text NOT NULL,
  position    integer NOT NULL DEFAULT 0,
  active      boolean NOT NULL DEFAULT true,
  CONSTRAINT report_categories_label_check CHECK (btrim(label) <> ''),
  CONSTRAINT report_categories_group_check CHECK (btrim(group_label) <> '')
);

CREATE INDEX IF NOT EXISTS report_categories_group_idx
  ON report_categories (group_label, position);

INSERT INTO report_categories (label, group_label, position) VALUES
  ('Voter turned away or denied a ballot', 'Voter access', 1),
  ('ID improperly demanded or refused', 'Voter access', 2),
  ('Language or disability access denied', 'Voter access', 3),
  ('Long lines or wait times', 'Operations', 4),
  ('Late opening / early closing', 'Operations', 5),
  ('Equipment failure or shortage', 'Operations', 6),
  ('Insufficient or untrained staff', 'Operations', 7),
  ('Voter or worker intimidation', 'Intimidation and interference', 8),
  ('Improper challenge of voters', 'Intimidation and interference', 9),
  ('Armed or uniformed presence', 'Intimidation and interference', 10),
  ('Law enforcement involvement', 'Intimidation and interference', 11),
  ('Disinformation at the site', 'Intimidation and interference', 12),
  ('Observer access denied or restricted', 'Observation', 13),
  ('Observer expelled', 'Observation', 14),
  ('Ballot secrecy or handling issue', 'The count', 15),
  ('Count not observable', 'The count', 16),
  ('Results or certification irregularity', 'The count', 17),
  ('OTHER', 'Anything else', 18)
ON CONFLICT (label) DO NOTHING;

COMMIT;
