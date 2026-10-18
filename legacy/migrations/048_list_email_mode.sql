-- WHETHER A LIST ALWAYS ASKS FOR AN EMAIL ADDRESS.
--
--   auto      asked only of somebody who writes something — the gate in
--             src/lists/fields.js, derived from the questions. The default.
--   required  always asked and always needed, whatever was answered: a form
--             people use to reach the site, like volunteering or contact.
--
-- 'auto' can never mean "never" on a form where people can write: the gate
-- still applies on top of it. This only ADDS a requirement.
--
-- The volunteer form asked for an address "because you
-- wrote something" from people who had only given their name — true to the
-- rule (a name is typed, so it is personal) and wrong as an explanation. A
-- form that wants an address always now says so, and says why.
ALTER TABLE lists
  ADD COLUMN email_mode text NOT NULL DEFAULT 'auto',
  ADD CONSTRAINT lists_email_mode_check CHECK (email_mode IN ('auto', 'required'));

-- The two shipped forms that exist to reach somebody.
UPDATE lists SET email_mode = 'required' WHERE slug IN ('volunteer', 'contact');
