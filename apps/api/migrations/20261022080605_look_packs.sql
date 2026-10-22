-- Look packs an operator adds without a deploy (docs/design/looks/README.md,
-- section 05; decision 63). NOTHING HERE IS SEALED; presentation only.
--
-- A pack is a look.json and its WOFF2 fonts. The server never stores or
-- serves a stylesheet somebody wrote: `css` is what toCss()
-- (packages/contracts/src/look/pack.ts) wrote from the checked manifest, and
-- it is served at /api/looks/<id>/<css_sha256>.css. The fonts are served at
-- /api/looks/<id>/<sha256>.woff2, so a changed file gets a new address and
-- both can be cached forever.
--
-- Who installed, replaced or removed a pack is written to role_audit (axis
-- 'site', action 'change'), the append-only record the people who grant
-- access already read. `installed_by` here is the latest installer only.

CREATE TABLE look_packs (
  -- The same shape check() holds a pack id to. 'reportlog-core' is the
  -- built-in pack, which lives in the code and never in this table.
  id           text PRIMARY KEY
               CHECK (id ~ '^[a-z][a-z0-9-]{1,39}$' AND id <> 'reportlog-core'),
  version      text NOT NULL CHECK (version ~ '^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$'),
  manifest     jsonb NOT NULL CHECK (jsonb_typeof(manifest) = 'object'),
  css          text NOT NULL,
  css_sha256   text NOT NULL CHECK (css_sha256 ~ '^[0-9a-f]{64}$'),
  installed_at timestamptz NOT NULL DEFAULT now(),
  installed_by text NOT NULL CHECK (length(btrim(installed_by)) > 0)
);

CREATE TABLE look_pack_files (
  pack_id text NOT NULL REFERENCES look_packs (id) ON DELETE CASCADE,
  -- Only fonts: look.json is the manifest above, and nothing else may be in
  -- a pack at all.
  path    text NOT NULL CHECK (path ~ '^fonts/[A-Za-z0-9_-][A-Za-z0-9._-]*\.woff2$'),
  sha256  text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  -- 1 MB a file, and the four bytes every WOFF2 file starts with.
  bytes   bytea NOT NULL
          CHECK (octet_length(bytes) <= 1000000 AND substring(bytes FROM 1 FOR 4) = '\x774f4632'::bytea),
  PRIMARY KEY (pack_id, path)
);
CREATE INDEX look_pack_files_by_hash ON look_pack_files (pack_id, sha256);

-- A pack whose palette or theme the site is wearing is not removed, and a
-- replacement does not drop it, until the site picks another. The installer
-- refuses first, in words; this is the rule holding even if it forgets.
CREATE FUNCTION look_pack_keeps_what_is_worn() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  worn record;
BEGIN
  SELECT palette, theme INTO worn FROM site_settings WHERE id;
  IF NOT FOUND THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF OLD.manifest -> 'palettes' @> jsonb_build_array(jsonb_build_object('id', worn.palette))
     AND (TG_OP = 'DELETE'
          OR NOT NEW.manifest -> 'palettes' @> jsonb_build_array(jsonb_build_object('id', worn.palette))) THEN
    RAISE EXCEPTION 'the site wears the palette % from look pack %', worn.palette, OLD.id;
  END IF;
  IF OLD.manifest -> 'themes' @> jsonb_build_array(jsonb_build_object('id', worn.theme))
     AND (TG_OP = 'DELETE'
          OR NOT NEW.manifest -> 'themes' @> jsonb_build_array(jsonb_build_object('id', worn.theme))) THEN
    RAISE EXCEPTION 'the site wears the theme % from look pack %', worn.theme, OLD.id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER look_packs_keep_what_is_worn BEFORE UPDATE OR DELETE ON look_packs
  FOR EACH ROW EXECUTE FUNCTION look_pack_keeps_what_is_worn();
