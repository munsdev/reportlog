-- The review-flag keyword list, as something an operator edits.
--
-- A term matching a report's free text raises a flag for somebody more
-- senior to look. That is all it does: not a severity, not a finding, not a
-- conclusion about anybody.
--
-- WHY IT IS A SETTING AND NOT A CONSTANT. A keyword list is wrong the day it
-- is written and stays wrong until somebody watches real traffic go past it.
-- The shipped set in `src/reviewKeywords.js` has never seen a single real
-- report. An operator who cannot cut a term that fires on half their
-- submissions will turn the whole flag off instead, which is the worst of
-- the available outcomes.
--
-- NULL MEANS "USE THE SHIPPED SET", the same three-layer habit as 038's
-- limits one layer shorter: there is no per-logbook keyword list, because
-- the thing a flag asks for is a second pair of eyes and that is a property
-- of the team rather than of the form. If a logbook ever needs its own, this
-- is where the column would go.
--
-- AN EMPTY ARRAY IS NOT NULL, and the difference is the whole point of
-- allowing it. `NULL` means "we have not chosen, use the defaults".
-- `ARRAY[]` means "we have chosen, and the answer is no keyword matching" —
-- which an operator running a logbook of equipment faults may well want. A
-- design that could not express the second would make turning the feature
-- off impossible without turning the flag off.
--
-- NOT HASHED, and nothing that computes a fingerprint may read it. A report
-- must not verify differently because an operator added a word to a list
-- months later.
--
-- Additive. One nullable column, no backfill.

BEGIN;

ALTER TABLE site_settings ADD COLUMN IF NOT EXISTS review_keywords text[];

COMMENT ON COLUMN site_settings.review_keywords IS
  'Words and phrases that raise a review flag on a report. NULL means use the shipped set in src/reviewKeywords.js; an empty array means the operator has deliberately chosen no keyword matching. Never hashed — a report must not verify differently because somebody edited this.';

-- WHO LAST CHANGED IT AND WHEN, because a list that governs which reports
-- get a second look is a thing somebody should be able to ask about. Not an
-- append-only history: the list itself is not evidence, and keeping every
-- revision of four hundred terms would be a table nobody reads.
--
-- The full change history is `site_settings`' own business; what is kept
-- here is enough to start a conversation with the person who did it.
ALTER TABLE site_settings ADD COLUMN IF NOT EXISTS review_keywords_set_by text;
ALTER TABLE site_settings ADD COLUMN IF NOT EXISTS review_keywords_set_at timestamptz;

-- A SANITY CEILING, not an opinion. Each term is matched inside one regular
-- expression built from the whole list, and a list in the tens of thousands
-- stops being a triage tool and starts being a way to make the submit
-- handler slow. Two thousand is far above any list anybody would write and
-- far below where it would hurt.
ALTER TABLE site_settings ADD CONSTRAINT site_settings_review_keywords_check
  CHECK (review_keywords IS NULL OR array_length(review_keywords, 1) IS NULL
         OR array_length(review_keywords, 1) <= 2000);

COMMIT;
