# S1 shared names (W1, the seal change)

Branch `claude/ft-s1-seal`, pushed as commit `d33573c` (shared names). Later commits keep these names. Not for merging as a file: the integrator reads it from disk.

## Field kinds (`packages/fields`)

- `private_text`: erasable text, never published. Settings: `maxLength` (default and cap 5000).
- `private_link`: erasable links, never published. Settings: `maxValues` (1 to 3, default 1).
  The body sends a string or an array of strings under the question key, inside `answers` as today.
- Constants: `PRIVATE_TEXT_TYPE`, `PRIVATE_LINK_TYPE`, `HELD_TYPES`; both kinds are in
  `UNSEALED_TYPES` (so `buildAnswers` never puts them in `answers`) and in `TYPED_KINDS`
  (so the logbook asks an address).
- `packages/fields/src/held.ts`: `buildHeldValues(fields, body, answers) -> { held, errors, problems }`,
  `HeldValues = { text?: Record<key, string>; links?: Record<key, string[]> }`,
  `normalizePrivateText`, `normalizePrivateLink`, `maxLinksOf`, `holdsAnything`,
  `MAX_PRIVATE_LINKS = 3`, `MAX_PRIVATE_LINK_LENGTH = 2000`, `PRIVATE_TEXT_MAX = 5000`.

## Sealed keys (`packages/seal`)

Top level, each written ONLY when non-empty:

- `text_fingerprints: { "<question key>": "<hex64>" }`
- `link_fingerprints: { "<question key>": ["<hex64>", ...] }` (order sent)

Fingerprint = `heldFingerprint(nonce, value)` = sha256 hex of RFC 8785 JSON
`{"nonce": <64 lowercase hex, random per value>, "value": <value>}`. Never the value.
`HELD_RECIPE = 2`: a report carrying either key is sealed under recipe 2 (`recipe: 2` in the
sealed object); a report without them is recipe 1, byte for byte as today. `recipeFor(fields)`.

## Tables (migration `20261027014942_held_values.sql`)

- `reports.text_fingerprints jsonb NULL`, `reports.link_fingerprints jsonb NULL` (as sealed; NULL, never `{}`).
- `report_values` (id, report_id, field_key, kind, position, group_id NULL -> link_groups,
  fingerprint, value_enc, value_key, created_at). One row per value; encrypted JSON `{nonce, value}`
  under its own key, wrapped by `LinkKeys.values` (new label in `links/keys.ts`).
  ERASE = DELETE the row. `group_id` is for S2 (K11 grouping with tip links); S1 leaves it NULL.
- `report_value_erasures` (tombstone, APPEND-ONLY by trigger): report_id, field_key, kind,
  position, fingerprint, reason_category, actor, created_at. UNIQUE (report_id, field_key, position).
- `report_submission_values` (submission_id PK -> report_submissions ON DELETE CASCADE,
  value_enc, value_key): held values of a report waiting for its confirmation link.

## Module `apps/api/src/reportValues/` (may not reach seal or chain: boundary rule)

- `store.ts`: `HeldRow`, `HeldSlot`, `HeldKind`, `storeHeldRows`, `carryHeldRows`, `heldSlotsOf`,
  `stageHeld`, `takeStagedHeld`, `hasStagedHeld`, `openRow`.
- `reads.ts`: `readForModerator(db, keys, reportIds)`, `readForDesk(db, keys, valueIds)`
  (caller passes only cleared ids and logs first), `readForReporter(db, keys, reportId)`,
  `erasuresOf(db, reportIds)` (public-safe: that a value went, and when), `heldCounts`.
  `HeldRead = { id, reportId, fieldKey, kind, position, fingerprint, groupId, value }`.
- `erase.ts`: `eraseHeldValue(trx, valueId, { reason, actor })` (every carried copy with the same
  fingerprint, one tombstone per version), `eraseHeldValuesOf(trx, reportIds, ...)`,
  `ERASURE_REASONS` = the five link `REASON_CATEGORIES` + `personal-data`, `reporter-request`.

## Chain (`apps/api/src/chain/`)

- `held.ts`: `prepareHeld(held) -> HeldRow[]` (fresh nonce per value), `fingerprintKeys(slots)`.
- `appendReportVersion(trx, { ..., held?: { keys, rows } | { carryFrom: reportId } })`.
  Fingerprints are made inside append from the rows; a caller passing fingerprint keys in
  `fields` is refused (except an archive replay).

## For other workers

- A check / clearance / redaction (M1, J1) should name a value by `report_values.id` or, to
  survive a files-only version, by `fingerprint`. A correction that re-sends text makes a NEW
  fingerprint, so a clearance keyed on fingerprint drops by itself (D2).
- S2: report links are `report_values` rows with kind `private_link`; set `group_id` at store.
