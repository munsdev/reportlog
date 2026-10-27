-- N1: whether a logbook lets reporters attach a note or link (the held kinds).
-- NULL and false are off, for every logbook that exists. A setting, not a
-- question, so the launch trigger lets it change; never sealed.
ALTER TABLE logbooks ADD COLUMN accepts_notes boolean;
