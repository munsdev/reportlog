-- THE MAP FLOOR IS 1 (owner's decision, 22 October): an operator may shade
-- an area from its first report. The default stays 3, and the panel still
-- says what a low threshold risks; it is the operator's call per map.
ALTER TABLE heat_maps DROP CONSTRAINT heat_maps_min_area_check;
ALTER TABLE heat_maps ADD CONSTRAINT heat_maps_min_area_check CHECK (min_area >= 1);
