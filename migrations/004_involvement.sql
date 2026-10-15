-- An application to get involved, held only between the moment someone
-- fills the form in and the moment they click the link in their email.
--
-- Deliberately not part of the chain. The chain is the archive of incident
-- reports; who volunteered is not an incident, and putting a name and an
-- address in there would make them permanently unremovable — exactly wrong
-- for someone who applied, was not taken up, and later wants to be
-- forgotten.
--
-- Deliberately not kept, either. The row exists so the application survives
-- the round trip to a mail client. Once the link is clicked the message is
-- sent and the row is deleted; an unclicked one expires. There is no table
-- of everyone who ever asked.
CREATE TABLE involvement_requests (
  token      text PRIMARY KEY,
  email      text NOT NULL,
  payload    jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

-- Expiry is swept on write rather than by a scheduled job, so there is no
-- extra thing to run and no way for the sweep to be quietly not running.
CREATE INDEX involvement_requests_expires_idx ON involvement_requests (expires_at);
