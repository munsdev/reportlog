-- The development notice, and the build the server last started on.
--
-- An EXPIRY rather than a boolean: a notice left on by accident trains
-- testers to ignore it, which is worse than never showing it. An expiry
-- switches itself off. NULL is "off".
--
-- `last_seen_build` is what lets a deploy arm the notice by itself: the
-- server compares the build it is starting (the release's REVISION) with
-- this, and arms the notice only when they differ, so a crash-restart loop
-- does not keep re-arming it. Neither is ever read into a sealed object.
ALTER TABLE site_settings
  ADD COLUMN dev_mode_until  timestamptz,
  ADD COLUMN last_seen_build text CHECK (last_seen_build IS NULL OR last_seen_build ~ '^[0-9a-f]{40}$');
