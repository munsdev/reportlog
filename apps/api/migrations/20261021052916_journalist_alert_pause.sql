-- Alerts a journalist can turn off without leaving the list (owner decision 47).
--
-- WHY A TIMESTAMP, AND WHY NOT A NEW STATUS. `status` already means "has
-- confirmed the address" and is read as that by the access request link
-- (vetting.ts) and, through the request, by the desk. A third status would
-- make every one of those checks ask "active or paused" and a check that
-- forgot would quietly end someone's access. A separate nullable column
-- leaves `status` meaning what it meant: a paused subscriber is still
-- active for access and the desk, and only the alert job reads this.
-- NULL is "alerts on", so every existing row keeps getting alerts. The time
-- is kept because "paused since" is what a person asking about it needs.
ALTER TABLE journalist_subscribers ADD COLUMN alerts_paused_at timestamptz;

-- Only somebody on the list can have paused anything.
ALTER TABLE journalist_subscribers ADD CONSTRAINT journalist_subscribers_paused_active
  CHECK (alerts_paused_at IS NULL OR status = 'active');
