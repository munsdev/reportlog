-- Who has a report open right now, so two moderators can see each other
-- before they both decide it (the queue's "is looking" badge and the report
-- page's banner).
--
-- PRESENCE, NOT A LOG. One row per person per report, refreshed by a
-- heartbeat while the page is open and deleted when it closes; rows nobody
-- refreshed are swept on every heartbeat. It says nothing about the past,
-- and nothing reads it as a record of who read what: that is
-- moderation_log's job, and contact_access_log's for contact details.
-- No address, no URL, no device: a user and a time.
--
-- Advisory only. What stops a decision overwriting one its author never saw
-- is the version check in moderation/queue.ts, not this table.
CREATE TABLE report_viewers (
  thread_id uuid NOT NULL REFERENCES report_heads (thread_id),
  user_id   bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  seen_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (thread_id, user_id)
);

CREATE INDEX report_viewers_seen_at ON report_viewers (seen_at);
