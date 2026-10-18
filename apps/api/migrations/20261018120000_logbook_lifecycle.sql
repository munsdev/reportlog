-- ════════════════════════════════════════════════════════════════════════
-- Logbooks and the builder (workstream B).
--
-- 1. When a launched logbook takes reports. THREE NULLABLE COLUMNS ON A CORE
--    TABLE, and none of them is read into a sealed object: whether a logbook
--    is open is a question about the clock, answered when somebody asks
--    (stateOf in apps/api/src/logbooks/logbooks.ts), never flipped by a timer.
--
-- 2. The front page's buttons, as an order. A table of its own rather than a
--    column on a site-settings table, because that table belongs to another
--    workstream and does not exist yet. One row at most.
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE logbooks ADD COLUMN opens_at  timestamptz;
ALTER TABLE logbooks ADD COLUMN closes_at timestamptz;
-- A deliberate close. Reversible, unlike launching: closing an intake is not
-- retiring a record, and a logbook closed by accident on a busy night must
-- come back in one press.
ALTER TABLE logbooks ADD COLUMN closed_at timestamptz;

-- A draft is never scheduled or closed: those are states of a logbook that
-- has launched. Saying so here keeps "draft" meaning one thing.
ALTER TABLE logbooks ADD CONSTRAINT logbooks_schedule_needs_launch
  CHECK (launched_at IS NOT NULL OR (opens_at IS NULL AND closes_at IS NULL AND closed_at IS NULL));
ALTER TABLE logbooks ADD CONSTRAINT logbooks_schedule_order
  CHECK (opens_at IS NULL OR closes_at IS NULL OR opens_at < closes_at);

-- THE ORDER IS THE ONLY THING STORED. No colour (the first button is the
-- accent, by position) and no href (a button goes where its logbook or list
-- is). NULL `buttons`, or no row at all, means nobody has arranged the page;
-- '[]' means an operator removed every button. Those are different answers.
CREATE TABLE home_buttons (
  id         boolean PRIMARY KEY DEFAULT true CHECK (id),
  buttons    jsonb CHECK (buttons IS NULL OR jsonb_typeof(buttons) = 'array'),
  updated_at timestamptz NOT NULL DEFAULT now()
);
