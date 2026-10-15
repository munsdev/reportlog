-- The layout axis is retired. Width belongs to the theme now.
--
-- ADDITIVE, like everything after 001_init.sql: the column is NOT dropped
-- and nothing stored becomes wrong. A deployment that chose `wide` still
-- has `wide` in this row; nothing reads it any more, and its theme decides
-- the measure instead.
--
-- WHY THE COLUMN STAYS. Dropping it would be the first destructive
-- migration in the project and would buy nothing — one unused column on a
-- single-row table. It would also make this migration impossible to run
-- twice and impossible to reverse, on a schema whose whole discipline is
-- that neither of those is ever true.
--
-- WHY A COMMENT IS THE WHOLE MIGRATION. The next person to read this schema
-- will find a `layout` column and reasonably assume something honours it.
-- The comment is the only place that can tell them otherwise at the moment
-- they are looking. Prose in a document they have not opened cannot.
--
-- Three axes made 216 combinations, twelve of them theme-and-width pairs
-- nobody had authored, and one of those — a typewritten record at 1140px —
-- a bad idea an operator could simply pick. A theme is a finished opinion
-- and its measure is part of the opinion.

COMMENT ON COLUMN site_settings.layout IS
  'DEAD as of migration 021. The layout axis was retired and width folded '
  'into the theme; each theme states its own --page-max in public/index.html. '
  'Nothing reads this column. Kept because migrations here are additive and '
  'dropping it would buy nothing. Do not add a reader.';
