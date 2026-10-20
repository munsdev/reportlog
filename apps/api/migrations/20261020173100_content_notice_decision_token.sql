-- D1: the decision email carries its own status link, so the receipt's link
-- keeps working after the decision. Both are stored only as hashes.
ALTER TABLE content_notices ADD COLUMN decision_token_hash text UNIQUE
  CHECK (decision_token_hash IS NULL OR decision_token_hash ~ '^[0-9a-f]{64}$');
