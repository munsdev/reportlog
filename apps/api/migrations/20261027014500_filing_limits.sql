-- Filing limits, the optional email card, and the sharing permission (E1).
--
-- Everything here adds. Nothing is updated or deleted, and no existing
-- logbook, list or report row changes. One CHECK is widened, below, and that
-- is the single deliberate exception to "only add".

-- ── the optional email card (D8, D20, D21) ──────────────────────────────
-- A logbook with no typed question may show the email card and let the
-- reporter skip it. NULL is off, and it is NULL for every logbook that
-- exists: the live logbook does not change until its owner turns this on.
-- Never sealed, never read into a sealed object.
ALTER TABLE logbooks ADD COLUMN email_optional boolean;

-- ── the filing settings (D15, D4, D5) ───────────────────────────────────
-- One row, written only when an operator chooses something. NULL, or no row
-- at all, is the software's own answer, which lives in the code
-- (apps/api/src/filing/limits.ts), so a fresh database is already right.
--
--   link_days           how long a confirmation link works. Default 90.
--                       A held report keeps the expires_at it was given.
--   contacts_delete_on  the day every report contact is deleted. Default
--                       2027-01-31.
--   address_daily_cap   reports one address may send in a day. Default 5.
CREATE TABLE filing_settings (
  id                 boolean PRIMARY KEY DEFAULT true CHECK (id),
  link_days          integer CHECK (link_days BETWEEN 1 AND 365),
  contacts_delete_on date,
  address_daily_cap  integer CHECK (address_daily_cap BETWEEN 1 AND 1000),
  updated_by         text,
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- ── the per-address daily count (D5) ────────────────────────────────────
-- NO ADDRESS IS HERE. `digest` is an HMAC of the address under a key derived
-- from CONTACT_KEY and the day, so a digest on one day matches nothing on
-- another and cannot be looked up from a guessed address without the key.
-- Rows of earlier days are useless and are deleted by the sweep.
CREATE TABLE filing_address_days (
  day    date    NOT NULL,
  digest text    NOT NULL CHECK (digest ~ '^[a-f0-9]{64}$'),
  n      integer NOT NULL CHECK (n > 0),
  PRIMARY KEY (day, digest)
);

-- ── the sharing permission (G5) ─────────────────────────────────────────
-- A fourth permission a reporter gives and takes back. The table is
-- append-only and this changes no row: the CHECK that names the permissions
-- is replaced by one that also names journalist_sharing.
-- The answer given at filing waits with a held report until its link is
-- followed, then goes into the permissions log. Never sealed.
ALTER TABLE report_submissions ADD COLUMN journalist_sharing boolean;
ALTER TABLE report_permissions_log DROP CONSTRAINT report_permissions_log_permission_check;
ALTER TABLE report_permissions_log ADD CONSTRAINT report_permissions_log_permission_check
  CHECK (permission IN ('contact_passing', 'attachment_publication', 'evidence_request', 'journalist_sharing'));
