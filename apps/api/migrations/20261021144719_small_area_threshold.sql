-- Plan E, session PE4: the small-area threshold of a "publish as counts
-- only" logbook (owner, 2026-10-21).
--
-- On a counts-only logbook a place (state, county, any location answer)
-- with fewer published reports than this is sent WITHOUT its count, on
-- every public surface: the counts route, the numbers and /api/v1/stats,
-- and any heat map reading the logbook. The heat maps' rule, applied
-- whether or not a map reads the logbook.
--
-- THE FLOOR IS THE DATABASE'S, as heat_maps.min_area's is: the one setting
-- whose wrong value is a disclosure rather than a broken page. With no row
-- the logbook has the default, 2, which the code reads the same way.
--
-- NOTHING HERE IS SEALED. How a count is published is not part of a report.
ALTER TABLE logbook_publication ADD COLUMN small_area integer NOT NULL DEFAULT 2
  CHECK (small_area BETWEEN 2 AND 100000);

-- Every change is a public switch use, like counts_only itself: an
-- operator lowering a privacy threshold is something the public may audit.
-- The value is the new threshold, as digits.
ALTER TABLE site_switch_log DROP CONSTRAINT site_switch_log_switch_check;
ALTER TABLE site_switch_log ADD CONSTRAINT site_switch_log_switch_check
  CHECK (switch IN ('pause_intake', 'puzzle', 'counts_only', 'small_area'));
ALTER TABLE site_switch_log DROP CONSTRAINT site_switch_log_value_check;
ALTER TABLE site_switch_log ADD CONSTRAINT site_switch_log_value_check
  CHECK (
    (switch <> 'small_area' AND value IN ('on', 'off', 'normal', 'harder'))
    OR (switch = 'small_area' AND value ~ '^[1-9][0-9]{0,5}$')
  );
