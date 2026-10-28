-- Where a list appears on the public site, beside the front page's switch
-- (show_on_front): on Get involved, and as the site's contact form.
--
-- Get involved showed every list open to the public, a contact form or a
-- tip list included, as a "way to help". Now it shows the lists marked for
-- it. Every list that exists is marked, so the page loses nothing the day
-- this arrives.
--
-- The contact form is the one list the footer, the site menu, About and the
-- terms send people to when they want to write to whoever runs the site.
-- One at most: the index refuses a second, so no page has to choose.
--
-- Advertising only. Nothing here opens, closes or hides a list, and nothing
-- is sealed: an entry is not a report.
ALTER TABLE lists ADD COLUMN on_get_involved boolean NOT NULL DEFAULT false;
ALTER TABLE lists ADD COLUMN is_contact boolean NOT NULL DEFAULT false;
UPDATE lists SET on_get_involved = true;
CREATE UNIQUE INDEX lists_one_contact ON lists ((true)) WHERE is_contact;
