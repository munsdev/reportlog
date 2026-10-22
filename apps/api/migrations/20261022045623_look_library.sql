-- The look library (decision 63). Workstream G.
--
-- The default look becomes Desk (Platinum with Desk), and a site that already
-- exists keeps the look it is wearing: Flint with Signal, the default until
-- now. NOTHING HERE IS SEALED; presentation only.
--
-- site_settings has carried 'flint' and 'signal' as column defaults since it
-- was made, so an existing installation already stores the look it wears and
-- needs nothing written. What changes is the default a NEW installation gets.
-- "New" means nobody has finished setting it up: an installation with no
-- owner. One with an owner keeps whatever is stored, chosen or not.
--
-- Ids from before the library (harbour, docket and the rest) are left as
-- stored. The application reads each as the built-in id that replaced it
-- (packages/contracts/src/look/migration.json) and writes the new one the next
-- time the look is saved, so this file never has to know the catalogue.

ALTER TABLE site_settings ALTER COLUMN palette SET DEFAULT 'platinum';
ALTER TABLE site_settings ALTER COLUMN theme SET DEFAULT 'desk';

UPDATE site_settings
   SET palette = 'platinum', theme = 'desk', updated_at = now()
 WHERE palette = 'flint'
   AND theme = 'signal'
   AND NOT EXISTS (SELECT 1 FROM users WHERE role = 'owner');
