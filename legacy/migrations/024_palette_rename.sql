-- The shipped palette was called `electionlog`. Rename it to `flint`.
--
-- Additive in the sense that matters: nothing here touches `reports`, so no
-- fingerprint changes and no report needs re-verifying. It does UPDATE a
-- settings row, which is a deployment's own presentation choice and not
-- part of the archive.
--
-- WHY NOW. The shipped look in this software was internally named after a
-- different, shelved project, and its label was 'Signal' — which is also
-- the name of a THEME, so the palette picker and the theme picker each
-- offered "Signal" meaning two unrelated things. Both are cheap to fix
-- while the only reports anywhere are test reports, and expensive to fix
-- afterwards. That is the whole argument for doing it today.
--
-- A deployment that chose any other palette is untouched. One that is still
-- on the default either stored the old id explicitly or stored nothing at
-- all; the second case resolves through DEFAULT_LOOK in src/look.js and
-- needs no row written.

BEGIN;

UPDATE site_settings
   SET palette = 'flint', updated_at = now()
 WHERE palette = 'electionlog';

COMMIT;
