-- The journalist alert list (plan D, J1 to J6).
--
-- A subscriber's name, outlet and address are encrypted like a reporter's
-- contact details: under a key of their own (AES-256-GCM), wrapped by
-- CONTACT_KEY (apps/api/src/filing/contactKeys.ts). The keyed digest of the
-- address finds a subscriber without decrypting anyone's address, and keeps
-- one address from being on the list twice.
--
-- Leaving the list deletes the row. Nothing here is sealed, chained or
-- public, and being on it grants no access to anything.
CREATE TABLE journalist_subscribers (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dek_wrapped  bytea NOT NULL,
  email_hmac   text NOT NULL UNIQUE,
  email_enc    bytea NOT NULL,
  name_enc     bytea NOT NULL,
  outlet_enc   bytea NOT NULL,
  -- Coverage areas as place codes ('US-AZ'). Checked against the gazetteer
  -- by the application; the shape and the size are checked here.
  states       text[] NOT NULL
               CHECK (cardinality(states) BETWEEN 1 AND 60 AND states::text !~ '[^A-Z,{}-]'),
  -- 'pending' until the confirmation link's button is pressed (double opt-in).
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  -- Where the next alert's window starts; set on confirming.
  last_sent_at timestamptz,
  CHECK ((status = 'active') = (confirmed_at IS NOT NULL))
);

-- Links in emails: stored only as a hash, like digest_stop_links.
CREATE TABLE journalist_links (
  token_hash    text PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  subscriber_id bigint NOT NULL REFERENCES journalist_subscribers (id) ON DELETE CASCADE,
  purpose       text NOT NULL CHECK (purpose IN ('confirm', 'stop')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  used_at       timestamptz
);
CREATE INDEX journalist_links_subscriber_idx ON journalist_links (subscriber_id);
CREATE INDEX journalist_links_expires_idx ON journalist_links (expires_at);
