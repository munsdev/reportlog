-- The volunteer list, moved out of the source and into the database.
--
-- Additive only. Nothing here touches `reports`, so no fingerprint changes
-- and no report needs re-verifying. `involvement` itself is untouched: it
-- goes on storing the ids it always stored.
--
-- WHY. The list of things somebody can volunteer for was two hardcoded
-- arrays in src/involvement.js, which meant "which roles are open" was a
-- code change and a deploy — and it was sitting on the maintainer's own list
-- of things waiting on them, because nobody else could change it. An operator
-- running their own deployment recruits for their own roles, and none of
-- ours apply to them.
--
-- DEACTIVATE, NEVER DELETE. `active` is the switch the admin panel uses.
-- A kind somebody has already chosen is referenced by id in their stored
-- application and printed by label into the email they were sent; deleting
-- the row would turn an old application into a list of bare ids nobody can
-- read. Taking a role off the form is `active = false`, which stops it
-- being offered and keeps it readable forever. The delete path exists for
-- one case only and the route enforces it: a row nobody has ever chosen.
--
-- SEEDED WITH WHAT THE SOURCE ALREADY SAID, so an existing deployment sees
-- no change on the day this runs and a fresh install is not handed an empty
-- form. The arrays stay in src/involvement.js as the shipped default and
-- are no longer the source of truth; the comment there says so.
BEGIN;

CREATE TABLE IF NOT EXISTS involvement_groups (
  id       text PRIMARY KEY,
  label    text NOT NULL,
  position integer NOT NULL DEFAULT 0,
  CONSTRAINT involvement_groups_id_check CHECK (id ~ '^[a-z0-9_]{1,40}$'),
  CONSTRAINT involvement_groups_label_check CHECK (btrim(label) <> '')
);

CREATE TABLE IF NOT EXISTS involvement_kinds (
  id        text PRIMARY KEY,
  label     text NOT NULL,
  group_id  text NOT NULL REFERENCES involvement_groups(id) ON DELETE RESTRICT,
  sublabel  text,
  position  integer NOT NULL DEFAULT 0,
  -- False means "no longer offered", not "gone". See the note above.
  active    boolean NOT NULL DEFAULT true,
  CONSTRAINT involvement_kinds_id_check CHECK (id ~ '^[a-z0-9_]{1,40}$'),
  CONSTRAINT involvement_kinds_label_check CHECK (btrim(label) <> '')
);

CREATE INDEX IF NOT EXISTS involvement_kinds_group_idx ON involvement_kinds (group_id, position);

-- Not append-only, deliberately, unlike almost everything else here. This is
-- a list of what an operator is currently recruiting for — mutable state
-- about the present, not a record of anything that happened. The record of
-- what somebody applied for is in `involvement`, which IS protected.

INSERT INTO involvement_groups (id, label, position) VALUES
  ('building', 'Building it',          1),
  ('running',  'Running the archive',  2),
  ('orgs',     'Organizations',        3),
  ('other',    'Other help',           4),
  ('ask',      'Something else',       5)
ON CONFLICT (id) DO NOTHING;

INSERT INTO involvement_kinds (id, label, group_id, sublabel, position) VALUES
  ('lead_dev',      'Lead developer',                            'building', 'Carrying the development side through the election and the wind-down', 1),
  ('dev',           'Developer, supporting',                     'building', 'Plain JavaScript, Node, PostgreSQL, one Linux server',                 2),
  ('accessibility', 'Accessibility',                             'building', 'Testing with a screen reader, keyboard, magnification',                3),
  ('moderating',    'Moderating reports',                        'running',  'Deciding what is published, and what is held back',                    1),
  ('testing',       'Testing the site before it is public',      'running',  'Using it, breaking it, and saying what went wrong',                    2),
  ('group',         'Bringing an organization onto the record',  'orgs',     'An organization filing through its own coordinators',                  1),
  ('policy',        'Policy or legal',                           'other',    NULL,                                                                   1),
  ('translation',   'Translation',                               'other',    NULL,                                                                   2),
  ('design',        'Design or writing',                         'other',    NULL,                                                                   3),
  ('outreach',      'Outreach',                                  'other',    NULL,                                                                   4),
  ('other',         'Something else',                            'ask',      'Say which below — the list is short because the project is small',      1),
  ('hello',         'Just saying hello, or asking something',    'ask',      NULL,                                                                   2)
ON CONFLICT (id) DO NOTHING;

COMMIT;
