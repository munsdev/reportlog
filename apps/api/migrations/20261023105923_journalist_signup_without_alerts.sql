-- One sign-up for alerts, desk access, or both (owner decision 69).
--
-- A journalist may hold desk access and get no alerts at all, so a
-- subscription may now cover no states, but only while its alerts are off:
-- alerts that are on still need at least one state to be about. The shape
-- and size checks are unchanged.
ALTER TABLE journalist_subscribers DROP CONSTRAINT journalist_subscribers_states_check;
ALTER TABLE journalist_subscribers ADD CONSTRAINT journalist_subscribers_states_check
  CHECK (cardinality(states) <= 60 AND states::text !~ '[^A-Z,{}-]');
ALTER TABLE journalist_subscribers ADD CONSTRAINT journalist_subscribers_alerts_need_states
  CHECK (alerts_paused_at IS NOT NULL OR cardinality(states) >= 1);

-- Somebody who asks for no alerts when signing up is paused from the start,
-- before they have confirmed. The alert job reads only confirmed rows
-- (journalists/alerts.ts), so a paused unconfirmed row is mailed nothing,
-- and confirming keeps it paused. This replaces "only somebody on the list
-- can have paused anything", which that sign-up would break.
ALTER TABLE journalist_subscribers DROP CONSTRAINT journalist_subscribers_paused_active;
