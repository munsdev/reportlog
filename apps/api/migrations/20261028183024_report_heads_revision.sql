-- A report head's revision: one more on every change to the row, whoever
-- makes it.
--
-- WHY. Two moderators open one report; one approves it; the other, still
-- looking at the page as it was, declines it. Before this, the second
-- decision silently replaced the first (and a decline emails the reporter).
-- Now the queue hands out each report's revision as `seen`, every act sends
-- it back, and moderation/queue.ts refuses one whose report moved since,
-- under the row lock (decide, take off, put back, batch approve, bulk
-- decline).
--
-- A TRIGGER, NOT EACH WRITER'S GOOD MANNERS. Decisions, corrections, new
-- files, a reporter's withdrawal and a bulk decline all update this row from
-- different places. Counting here means one added later is counted too, and
-- the count only ever goes up, so no two versions share a value.
-- `updated_at` is not used for this: the digest reads it, and the dev
-- fixtures set it back on purpose.
--
-- Not sealed, not public: a projection's change counter, beside the state.
ALTER TABLE report_heads ADD COLUMN revision bigint NOT NULL DEFAULT 0;

CREATE FUNCTION report_heads_revision() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.revision := OLD.revision + 1;
  RETURN NEW;
END;
$$;
CREATE TRIGGER report_heads_revision BEFORE UPDATE ON report_heads
  FOR EACH ROW EXECUTE FUNCTION report_heads_revision();
