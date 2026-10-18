-- A question can be asked only when an earlier answer calls for it.
--
-- WHAT THIS REPLACES. The form engine has supported conditional cards since
-- it was written — `when` and `settled` in public/js/form.js, with a
-- progress bar that copes with a question turning out not to apply. Until
-- now the only conditions in the whole application were three hardcoded
-- ones: which logbook was chosen, whether that logbook takes files, and
-- whether the reporter said they had any. An operator building a form could
-- not express a fourth.
--
-- So every logbook asked every question of everybody. "What is the video
-- of?" went to people with no video; "which polling place" went to somebody
-- reporting something that happened nowhere in particular. The form's own
-- rule — ONE CARD ASKS ONE QUESTION, and nothing on the card changes
-- underneath the person reading it — means the answer cannot be a field that
-- appears halfway down a card. It has to be a card that is not shown.
--
-- IT IS PART OF WHAT A QUESTION MEANS, SO IT IS SEALED. src/formText.js
-- writes it into the form definition, which is hashed and sealed into every
-- report as `logbook_form`. A report with no answer to question 7 means
-- something different depending on whether question 7 was PUT to that
-- reporter, and somebody checking an old report has to be able to tell which
-- — so the condition travels with the questions rather than being a setting
-- that could have changed since.
--
-- WRITTEN INTO THE DEFINITION ONLY WHEN THERE IS ONE. The absent-key rule,
-- and this is the migration where getting it wrong would be worst: a
-- definition that carried `shown_when: null` unconditionally would change
-- the form hash of every logbook that already exists, which would break the
-- sealed `logbook_form` of every report ever filed against them and make
-- `immutableFieldsFor` throw rather than rebuild a different object. The
-- column is nullable, src/formText.js writes the key only when it is set,
-- and `npm test` asserts both.
--
-- DRAFTS ONLY, like every other edit to a question. `assertDraft` guards
-- `addField` and `updateField`, so a launched logbook's conditions are
-- frozen with its wording. The one thing a launched logbook may still do —
-- gain a new OPTIONAL question — may give that new question a condition,
-- because a question nobody has been asked yet has no answers to
-- invalidate.
--
-- Additive. One nullable column, no backfill, nothing rehashed.

BEGIN;

-- WHEN THIS QUESTION IS ASKED, or NULL for "always", which is every question
-- that exists today.
--
-- Shape: {"field": "<another question's key>", "in": ["value", ...]}
--
-- Satisfied when that question's answer is one of those values — or, for a
-- choose-any question, includes one of them. Checked and normalized by
-- src/conditions.js, which is also what the form and the answer validator
-- use, so the three cannot drift.
--
-- jsonb and not two columns, because the useful unit is the whole condition:
-- it is validated as one thing, sealed as one thing, and a half-written
-- condition spread over two columns is a question asked at the wrong times.
ALTER TABLE logbook_fields ADD COLUMN IF NOT EXISTS shown_when jsonb;

COMMENT ON COLUMN logbook_fields.shown_when IS
  'When this question is asked, or NULL for always. {"field": "<key>", "in": [values]} — satisfied when that earlier question''s answer is one of these. Sealed into the form definition because being asked is part of what a question means. Refuses forward references, so conditions cannot cycle. Editable only while the logbook is a draft.';

-- NO CONSTRAINT ON THE SHAPE, and that is a decision rather than an
-- omission. The checks worth making are relational — the named question must
-- exist, must come EARLIER in this logbook, must be a kind whose answers are
-- enumerable, and the values must be among the ones it actually offers. None
-- of that is expressible in a CHECK without a subquery, and a trigger that
-- re-derived it would be a second implementation of src/conditions.js that
-- could disagree with the first. The guard lives in the module every path
-- goes through, which is where `assertDraft` already lives for the same
-- reason.

COMMIT;
