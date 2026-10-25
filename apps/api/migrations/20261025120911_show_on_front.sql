-- "Show on the front page", on each logbook and each list.
--
-- On (the default, which is how every logbook and list already behaved): one
-- that is open appears on the front page, added to the end when the page's
-- arrangement does not mention it. Off: it does not appear there, whatever
-- the arrangement says. Whether something is OPEN is still decided by the
-- logbook's or list's own dates and switches; this is only whether its owner
-- wants it advertised.
--
-- Presentation only: never read into a sealed object, so changing it after a
-- logbook launched is as safe as changing its title.
ALTER TABLE logbooks ADD COLUMN show_on_front boolean NOT NULL DEFAULT true;
ALTER TABLE lists ADD COLUMN show_on_front boolean NOT NULL DEFAULT true;
