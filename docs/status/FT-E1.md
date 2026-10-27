# FT-E1: filing limits, the optional email card, the sharing permission

Branch `claude/ft-e1-filing`. Migration `20261027014500_filing_limits.sql`.

## Built

- **D15, link life.** `filing_settings.link_days` (NULL = 90, in `filing/limits.ts`). Read at each
  Send; a held report keeps its own `expires_at`. Email, filing page, confirm page, how page, site
  docs now say 90 days. An unsent draft file still lasts a day (`SLOT_TTL_MS`); the test that said
  the two were equal now says the draft is shorter. A held report whose link lapses is deleted
  whole by the existing nightly `sweep`. Found and fixed: the sweep's delete failed when the report
  had a staged file (foreign key from `upload_slots.submission_id`); the sweep now clears the
  pointer first (files job still expires the file by its own `expires_at`).
- **D5, five per address per day.** `filing_address_days (day, digest, n)`; digest is an HMAC of the
  address under a key derived from `CONTACT_KEY` and the UTC day, so it is no address and matches
  nothing on another day. Counted in the same transaction that stores the held report, so refusals
  count nothing. Sixth: HTTP 429 `try_later`, "We could not take this report right now. Please try
  again tomorrow." Cap is a setting (`address_daily_cap`). Old days swept by `sweep`.
  Only addresses are counted, so a form that takes no address has no cap here (the existing
  per-client rate limit still applies).
- **D4, contacts deleted 31 January 2027.** New named job `contacts-sweep` (03:50, timer file
  generated). Date is `filing_settings.contacts_delete_on`. From the date, every night: runs the
  reporter's own erasure (`eraseContact`) for every thread, with an `erase` row in
  `reporter_actions`, and deletes held (unconfirmed) reports with their cleartext address. Sealed
  reports and the append-only ciphertext are untouched. Already-erased threads are skipped.
- **D8/D20/D21, optional email card.** `logbooks.email_optional boolean` nullable, NULL for every
  existing logbook (= off). Contract: `LogbookSummary.email_optional` (the setting, staff),
  `updateLogbook` body `email_optional`, public logbook `email_optional: true` only when it
  applies (setting on and the form needs no address). Filing: blank = filed on arrival; address =
  held until link followed, as today. Off: an address is still refused as before.
  **Staff control:** API takes it; no builder screen yet (integrator to coordinate the label).
  Not done: logbook file import/export does not carry it.
- **G5, `journalist_sharing`.** Fourth entry in `PERMISSIONS`, `Permissions`, `NONE_GRANTED`;
  `sharingGranted` / `sharingGrantedAmong` in `permissions/log.ts` for moderation and the desk.
  `POST /api/reports` takes `journalist_sharing` (only a yes is logged; held in
  `report_submissions.journalist_sharing` until confirmation). My reports toggle appears through
  the existing permission list (words added in `permissionWords.ts`). Never sealed.

## Decisions

- Migration widens one CHECK (`report_permissions_log_permission_check`), dropping and re-adding it
  with the fourth name. No row changes. **The P1 migration guard needs this listed as an exception.**
  Also adds nullable `report_submissions.journalist_sharing` and `logbooks.email_optional`.
- Counts in a table, not in memory, so a restart or a second process cannot reset them.
- `eraseDueContacts` takes an optional `only` scope, used by tests on the shared database.

## Wording that differs from the mock-up

None checked (no screens built here beyond text changes). The share toggle's wording is mine:
"Journalists may be shown the words and links I wrote, after a moderator has checked them".

## Not done

Staff control for the optional email card; privacy notice page wording for the 31 January date
beyond the data table; browser test for the sharing toggle.

## Tests

`apps/api/test/db/filing-limits.test.ts` (18 tests): link life and setting, existing expiry kept,
lapsed held report with a file deleted, sixth refused, no address stored, refusal counts nothing,
cap setting, old counts swept, contact sweep before/on the date, optional card off/on, sharing.
Suite totals: see the report.
