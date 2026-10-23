-- COUNTIES ON A MAP, past a threshold of their own (owner's request,
-- 23 October). NULL is the old behaviour: every county counts toward its
-- state and is never shown alone (decision 44). A number N: a county with at
-- least N reports (and at least the map's own threshold) is shown on its own;
-- under that it is only ever part of its state's count.
ALTER TABLE heat_maps ADD COLUMN county_min integer
  CHECK (county_min IS NULL OR county_min BETWEEN 1 AND 100000);
