-- "Not approved" stays visible to the person who asked (decision 80).
--
-- A rejected request used to be DELETED, so the applicant's page read as if
-- they had never asked. It now stays as a row with status 'rejected', and what
-- they wrote is wiped (the application replaces details_enc with an empty
-- document); only the fact and the time of the decision are kept. Applying
-- again replaces the row, as it does after a revoke (request.ts, writeRequest).
-- The other checks already fit: a decided request names who decided it, and
-- only a revoked one has a revoked_at.
ALTER TABLE journalist_access_requests DROP CONSTRAINT journalist_access_requests_status_check;
ALTER TABLE journalist_access_requests ADD CONSTRAINT journalist_access_requests_status_check
  CHECK (status IN ('pending', 'approved', 'revoked', 'rejected'));
