-- THE COUNTS-ONLY SMALL-AREA FLOOR IS 1 (owner's decision, 23 October), as
-- the heat maps' is. The default stays 2; an operator may now choose 1 on a
-- logbook, which counts a place from its first accepted report.
ALTER TABLE logbook_publication DROP CONSTRAINT logbook_publication_small_area_check;
ALTER TABLE logbook_publication ADD CONSTRAINT logbook_publication_small_area_check
  CHECK (small_area BETWEEN 1 AND 100000);
