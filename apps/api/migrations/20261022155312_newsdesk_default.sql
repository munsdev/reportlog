-- The default look becomes Newsdesk (the Newsdesk palette with the Newsdesk
-- theme). NOTHING HERE IS SEALED; presentation only.
--
-- The same move 20261022045623_look_library.sql made for Desk: the column
-- defaults change, so a NEW installation starts on Newsdesk, and an
-- installation nobody has finished setting up (no owner yet) that is still
-- wearing the previous default moves with it. One with an owner keeps
-- whatever is stored, chosen or not: a site that is live does not change
-- overnight, and a look an operator chose is never touched.

ALTER TABLE site_settings ALTER COLUMN palette SET DEFAULT 'newsdesk';
ALTER TABLE site_settings ALTER COLUMN theme SET DEFAULT 'newsdesk';

UPDATE site_settings
   SET palette = 'newsdesk', theme = 'newsdesk', updated_at = now()
 WHERE palette = 'platinum'
   AND theme = 'desk'
   AND NOT EXISTS (SELECT 1 FROM users WHERE role = 'owner');
