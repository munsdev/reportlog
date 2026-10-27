-- What the site's settings were just before an import of a site bundle
-- (packages/contracts/src/sitebundle.ts), so the owner can put them back.
-- One row per import; `snapshot` is a bundle without look packs.
-- NOTHING HERE IS SEALED; presentation only. Adds a table, changes nothing.
CREATE TABLE site_bundle_backups (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  text NOT NULL CHECK (length(btrim(created_by)) > 0),
  snapshot    jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  restored_at timestamptz
);
