-- WHERE THE TRANSPARENCY LOG IS PUBLISHED, set by an operator rather than
-- by whoever edits .env.
--
-- The anchor read TRANSPARENCY_LOG_DIR, TRANSPARENCY_LOG_REMOTES and
-- TSA_URL from the environment and nothing else. That is fine for the
-- deployment whose operator also has a shell on the box, and it is the
-- whole configuration story for everybody else — who has an admin panel
-- and no way to answer the one question that decides whether the archive's
-- integrity claim is worth anything: where does the proof go?
--
-- A DEPLOYMENT THAT ANCHORS NOWHERE LOOKS EXACTLY LIKE ONE THAT ANCHORS.
-- The default remote is `origin` of a checkout in the service user's home
-- directory, so a fresh install with nothing configured commits the day's
-- anchor locally and pushes it to whatever that happens to be, or fails in
-- a cron mail nobody reads. The record then exists only on the box it is
-- meant to outlive.
--
-- ONE ROW, like site_settings, and for the same reason: there is one
-- deployment per database and a table that could hold two of these is a
-- table somebody will eventually put two in.

CREATE TABLE transparency_log_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),

  -- The local checkout the anchor commits into. NULL means the old
  -- default — the service user's home directory — so an existing
  -- deployment that never opens the panel keeps behaving exactly as it
  -- did. Nothing here changes a running box until somebody sets it.
  repo_dir text,

  -- The branch pushed. Not assumed to be the checkout's current one: a
  -- detached head after a manual fix would otherwise push nothing and say
  -- it succeeded.
  branch text NOT NULL DEFAULT 'main',

  -- MIRRORS, AS A LIST OF {name, url}. Several hosts under different
  -- operators is the point of the design and not redundancy for its own
  -- sake: a record one company holds is a record one company can be
  -- compelled to remove. jsonb rather than two parallel arrays so a row
  -- cannot half-exist.
  remotes jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- The RFC 3161 timestamp authority. Overridable because an operator in
  -- another jurisdiction may have reason to prefer a different one, and
  -- because an authority that goes away must not take the anchor with it.
  tsa_url text,

  -- THE PUBLIC HALF OF THE DEPLOY KEY, AND ONLY THE PUBLIC HALF.
  --
  -- The private key is a file on disk, mode 0600, outside this database
  -- and outside every backup of it. That is the whole point of generating
  -- a deploy key rather than storing a token: a dump of this database must
  -- not carry write access to the public log. If it did, the log's
  -- independence from the server would be a claim rather than a fact.
  --
  -- The fingerprint is stored beside it so the panel can show the operator
  -- the same string GitHub shows, without reading the key file on every
  -- page load.
  deploy_public_key text,
  deploy_key_fingerprint text,
  deploy_key_made_at timestamptz,

  -- What happened last time, so the panel can say rather than guess.
  -- Written by the anchor; read by the panel. Nothing trusts it back.
  last_push_at timestamptz,
  last_push_ok boolean,
  last_push_detail text,

  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE transparency_log_settings IS
  'Where the daily anchor is published. One row. The deploy key''s PRIVATE '
  'half is never here — see migration 052.';

INSERT INTO transparency_log_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
