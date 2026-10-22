-- Which of the front page's quieter sections show, and in what order: the
-- introduction, the map, the figures, checking a report, and the other
-- links (decided 22 October 2026, with the on-page editor).
--
-- NULL means "as shipped", the same as `home_buttons` beside it, so a site
-- nobody has arranged keeps following the software's default when that
-- changes. A list of {id, shown} otherwise; the server reads it through one
-- function that drops an id it does not know and appends one it was not
-- given, so a section added in a later release still appears. Presentation
-- only: never read into a sealed object.
ALTER TABLE site_settings
  ADD COLUMN home_sections jsonb CHECK (home_sections IS NULL OR jsonb_typeof(home_sections) = 'array');
