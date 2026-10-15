-- WHAT REACHES PAST THE SITE PASSWORD, and lists that email somebody.
--
-- 1. `outside_access` on lists AND logbooks: whether somebody WITHOUT the
--    site password may use it.
--
--      closed  behind the password like everything else — the default
--      link    open to anybody who has its address, and shown nowhere
--      door    open, and linked from the password page itself
--
--    It is about the curtain only. On a deployment with no password it
--    changes nothing. A logbook that is open here is open for FILING and
--    nothing else: its board, the other logbooks and the rest of the site
--    stay behind the password.
--
--    A LIST MAY ONLY BE OPEN OUTSIDE IF IT IS LISTED INSIDE. A hidden list
--    reachable by strangers without a password, or a team-only list
--    reachable by people who have not even got the site password, is the
--    same setting saying two things. The CHECK makes the database refuse it.
--
-- 2. A list can email each new entry to somebody. The address is the
--    deployment's admin address unless an administrator names another, and
--    ANOTHER ADDRESS MUST CONFIRM BEFORE IT RECEIVES ANYTHING: a
--    typo would otherwise send people's applications to a stranger. Until it
--    confirms, mail keeps going where it went before.
--
-- 3. The volunteer form becomes a list. Created here from this deployment's
--    own role catalogue so every box keeps what its form offered, with the
--    reach the old form had: no password needed, linked from the password
--    page, each application mailed to the admin address. The old tables stay
--    (migrations are additive); nothing reads them after this release.
--
-- Nothing here is hashed and nothing touches a report.

ALTER TABLE lists
  ADD COLUMN outside_access text NOT NULL DEFAULT 'closed',
  ADD CONSTRAINT lists_outside_access_check
    CHECK (outside_access IN ('closed', 'link', 'door')),
  ADD CONSTRAINT lists_outside_needs_listed
    CHECK (outside_access = 'closed' OR visibility = 'listed');

ALTER TABLE logbooks
  ADD COLUMN outside_access text NOT NULL DEFAULT 'closed',
  ADD CONSTRAINT logbooks_outside_access_check
    CHECK (outside_access IN ('closed', 'link', 'door'));

ALTER TABLE lists
  ADD COLUMN notify boolean NOT NULL DEFAULT false,
  -- NULL means the deployment's admin address (ADMIN_EMAIL), read at send
  -- time, so changing that setting moves every list that never named its
  -- own. A value here has been CONFIRMED by whoever owns it.
  ADD COLUMN notify_email text,
  -- Named and not yet confirmed. Receives nothing until it is.
  ADD COLUMN notify_pending_email text,
  ADD CONSTRAINT lists_notify_email_check
    CHECK (notify_email IS NULL OR notify_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  ADD CONSTRAINT lists_notify_pending_check
    CHECK (notify_pending_email IS NULL OR notify_pending_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$');

-- The link an address clicks to agree to receive a list's entries. Stored
-- hashed, like an erasure token: a copy of this table must not let whoever
-- holds it redirect the mail.
CREATE TABLE list_notify_confirmations (
  token_hash text PRIMARY KEY,
  list_id    bigint NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  email      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  CONSTRAINT list_notify_confirmations_hash_check CHECK (token_hash ~ '^[0-9a-f]{64}$')
);
CREATE INDEX list_notify_confirmations_list_idx ON list_notify_confirmations (list_id);

-- The volunteer form, as a list. Skipped where an operator already made a
-- list at this address.
DO $$
DECLARE
  roles jsonb;
  vid bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM lists WHERE slug = 'volunteer') THEN
    RETURN;
  END IF;

  -- In the order the form showed them: by group, then within it.
  SELECT jsonb_agg(k.label ORDER BY coalesce(g.position, 2147483647), k.position, k.id) INTO roles
    FROM volunteer_kinds k LEFT JOIN volunteer_groups g ON g.id = k.group_id
   WHERE k.active;
  -- No catalogue in the database means the form was showing the shipped
  -- default, so the list gets the same.
  IF roles IS NULL THEN
    roles := '["Lead developer", "Developer, supporting", "Accessibility",
               "Moderating reports", "Testing the site before it is public",
               "Bringing an organization onto the record", "Policy or legal",
               "Translation", "Design or writing", "Outreach", "Something else"]'::jsonb;
  END IF;

  INSERT INTO lists (slug, title, blurb, visibility, outside_access, notify)
  VALUES ('volunteer', 'Volunteer',
          'Tell us how you would like to help. Your message goes to the people who run this site.',
          'listed', 'door', true)
  RETURNING id INTO vid;

  INSERT INTO list_fields (list_id, key, kind, label, help, required, position, options, retention)
  VALUES
    (vid, 'name', 'short_text', 'Your name', NULL, true, 0, NULL, 'transient'),
    (vid, 'roles', 'choice_many', 'How would you like to help?', 'Tick as many as you like.', true, 1,
       jsonb_build_object('options', roles, 'allowOther', false), 'durable'),
    (vid, 'note', 'long_text', 'Anything else we should know', NULL, false, 2, NULL, 'transient');
END $$;
