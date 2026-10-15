-- The veracity verdict is withdrawn. A note where somebody will look.
--
-- WHY IT WENT. A one-word verdict about a named third party is the archive
-- publishing its own factual assertion, and it is the hardest kind of
-- assertion to defend. "Likely true" printed on a report that identifies a
-- polling official by role, place and time was this deployment asserting
-- something about that person which no court, no regulator and no editor had
-- stood behind — in two words, in a coloured badge, to the public.
--
-- The exposure does not disappear with the verdict. It moves: an editorial
-- note, written and signed by the moderator who made the publication
-- decision, is a considered statement somebody can defend in place of a
-- verdict nobody can.
--
-- NOTHING IS DROPPED HERE, AND THAT IS THE POINT OF THE FILE. This is a
-- COMMENT ON COLUMN and nothing else — the same shape as migration 021 and
-- the second halves of 032 and 033. Three reasons the column stays:
--
--   1. Migrations are additive. A report's fingerprint has never covered
--      veracity (report_heads is not hashed), so dropping it would break no
--      seal — but a column an older process may still be selecting turns a
--      rolling deploy into an outage, and there is nothing to gain.
--
--   2. /api/v1/stats still publishes a `by_veracity` breakdown, because
--      public/api.html promises that an existing field is not renamed,
--      retyped or removed without a /api/v2. The field now reads `pending`
--      for everything, which is not a placeholder but the true count: there
--      is nothing left that assesses veracity. api.html says exactly that,
--      and says the field goes at v2.
--
--   3. AN ARCHIVE THAT RECORDED VERDICTS BEFORE TODAY KEEPS REPORTING THEM.
--      The stats breakdown is still computed from this column rather than
--      hardcoded to zeros, so a deployment that assessed reports under the
--      old model goes on telling the truth about what it concluded. Zeroing
--      it would be this software rewriting a deployment's own history on
--      deploy, which is the one thing it exists to make impossible.
--
-- The CHECK constraint stays too. Nothing writes the column, so it
-- constrains nothing — and a constraint that outlives its writer is cheaper
-- to leave than to drop.

BEGIN;

COMMENT ON COLUMN report_heads.veracity IS
  'WITHDRAWN 4 October 2026 and written by nothing. Was a moderator''s verdict on whether a report was true, one of six values; it is replaced by an editorial note, because a one-word verdict about a named third party is an assertion this archive cannot defend. Kept because migrations are additive and because /api/v1/stats publishes a frozen by_veracity breakdown until there is a /api/v2. Rows written before the withdrawal keep their value and are still counted honestly. Do not read this column for anything else, and do not write it.';

COMMIT;
