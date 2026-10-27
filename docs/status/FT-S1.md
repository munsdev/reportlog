# FT-S1: the seal change (W1) and the store under it

Branch `claude/ft-s1-seal`, cut from `claude/blissful-gates-7q65uc` at `d34ba03`.
Specs: `free-text-links-email-gap-report.md` (G1, W1), `docs/plan-d-spec.md` K5, K8, K9, X2, X3.

## What was built

**Two new field kinds** (`packages/fields`): `private_text` (setting `maxLength`, cap 5000)
and `private_link` (setting `maxValues`, 1 to 3). Both are in `UNSEALED_TYPES`, so
`buildAnswers` never puts them in `answers`, and in `TYPED_KINDS`, so a logbook that asks one
asks an address. `buildHeldValues` (`packages/fields/src/held.ts`) normalizes them for every
path: text trimmed and capped; a link http or https only, at most 2000 characters, written as
the URL parser writes it, the same link twice kept once. A value a question does not take is
refused with a sentence, never dropped. The existing `short_text`, `long_text` and `url`
kinds are unchanged and still sealed as typed.

**Two new sealed keys** (`packages/seal`), each written only when non-empty:

```
text_fingerprints   { "<question key>": "<hex64>" }
link_fingerprints   { "<question key>": ["<hex64>", ...] }   order sent
```

`heldFingerprint(nonce, value)` = SHA-256 hex of the RFC 8785 JSON `{"nonce": n, "value": v}`,
`n` being 32 random bytes as hex, made per value on the server and kept only with the value.
`normalizeReportFields` validates and writes them; `rebuildSealedObject` reads them back from
the two new `reports` columns; the round-trip unit test now covers none, text, link and both
against every other optional key.

**Storage** (migration `20261027014942_held_values.sql`, additive only):

- `reports.text_fingerprints`, `reports.link_fingerprints`: nullable jsonb, as sealed.
- `report_values`: one row per value, AES-256-GCM of `{nonce, value}` under a key of its own,
  wrapped by a new `values` label derived from the link secret (`links/keys.ts`). Also the
  sealed fingerprint (not secret) and a nullable `group_id` for S2's grouping.
  Erasure deletes the row: value, nonce and key together.
- `report_value_erasures`: the tombstone. Report, question, position, fingerprint, when,
  actor, reason category. UPDATE, DELETE and TRUNCATE refused by trigger.
- `report_submission_values`: a filed-but-unconfirmed report's held values, encrypted as one
  value, deleted when the report is filed from it and with the submission (cascade). The
  submission's `payload` never holds them, because the payload outlives confirmation.

**Module `apps/api/src/reportValues/`**: `store.ts` (store, carry, stage, take), `reads.ts`
(`readForModerator`, `readForDesk` by row id only, `readForReporter`, `erasuresOf`,
`heldCounts`), `erase.ts` (`eraseHeldValue`, `eraseHeldValuesOf`, `ERASURE_REASONS`). A new
boundary rule stops it reaching the seal or the chain, so the moderation and desk code can
read through it.

**Chain**: `chain/held.ts` makes nonces and fingerprints; `appendReportVersion` takes
`held: { keys, rows } | { carryFrom }` and writes the fingerprints and the values from the
same rows in the same transaction. A caller handing in fingerprint keys of its own is
refused (only an archive replay may, because values do not travel). `sealedReportRows`
needed no change: it selects every report column, so the new ones come with it.

**Wired through** (small changes outside S1's folders, each said so in the commit):

- `filing/filing.ts`: held values built and refused like answers, staged encrypted, sealed at
  confirmation. `filing/mine.ts` + `filing/correction.ts`: a reporter's correction holds the
  values it sends, fresh (new nonce, new key, new fingerprint).
- `evidence/requests.ts`: a version that only adds files carries the values unchanged.
- `filing/intake.ts`, `intakeCorrection.ts`: a coordinator cannot file a held value yet;
  sending one is refused with a sentence.
- `lists/fields.ts`: a list cannot ask either kind (it has its own erasable half).
- `logbooks/logbooks.ts`, `refusals.ts`, `contracts/src/logbooks.ts`: the builder accepts
  `maxLength` on `private_text` and `maxValues` (1 to 3) on `private_link`.
- `anchor/archive.ts`: `report_values` and `report_submission_values` are EXCLUDED from an
  export (the link secret does not travel, and a copy would outlive an erasure). Tombstones
  travel; the fingerprints travel with the reports, so a replay seals identically.
- `app.ts`, `filing/routes.ts`: the shared link keys are handed to filing.
- `dev/held-state.ts`: for the browser test only.

## Decisions taken

- **Names**: `private_text` / `private_link` (the plan's working names, kept so nobody had
  to rename). Sealed keys named for what they hold, fingerprints, not for the kind.
- **Recipe 2, only for a report with a fingerprint key** (`recipeFor` in `report.ts`). A
  verifier written for recipe 1 that meets the new keys is told it is reading a newer recipe
  rather than left to think the report changed. Every report without one stays recipe 1,
  byte for byte. `RECIPE` itself stays 1.
- **One store table for text and links**, not a second link table: the rule "no changed
  column" rules out making `links.entry_id` nullable, and one table makes erasure and the
  tombstone one code path. S2 groups report links with tip links through
  `report_values.group_id` -> `link_groups`.
- **The fingerprint is stored beside each value**, so a clearance or an erasure can name a
  value the same way in every version that carries it. Erasing a value erases every carried
  copy (one tombstone per version); a correction's re-sent text has a new fingerprint and is
  not erased with it.
- **A correction holds exactly what it sends**, as with answers. A value left out is not in
  the new version. The correction screen (F1) will need `readForReporter` to prefill it.
- **Values carried by a files-only version skip any already erased**: the new version seals
  only what is still held.
- **Erasure reasons**: the five illegal-content categories of the link store, plus
  `personal-data` and `reporter-request`. A category, never free text.
- **`appendReportVersion` names the new columns only when set**, so a report without a held
  value is the same INSERT as before. That lets the upgrade test file its "before" reports
  with today's code on the old schema, and means today's code also files plain reports on a
  database that has not yet run the migration.

## Rollback safety

How to roll back matters: `sudo reportlog rollback` (switches `current`, never migrates)
works. `sudo reportlog deploy <previous tag>`, which the build plan's section 4a names, is
REFUSED by the migration runner once this migration is applied ("This database has
migrations this code does not"), by design (deploy/README.md, "Why rolling back is safe").
After a rollback the doctor warns, as expected.

- **An older release on a database with these tables and no report using them** runs
  unchanged. It never names the new columns (both nullable, default NULL) or the new tables;
  its INSERT into `reports` leaves the columns NULL; its `selectAll` reads two extra columns
  that its `toStoredRecord` ignores, so every rebuild is what it was. The upgrade test proves
  every fingerprint, link, verify result and chain head is identical across the migration,
  and that a report waiting for its link before the migration confirms after it.
- **An older release with a report that does use them**: it cannot rebuild that report. Its
  `rebuildSealedObject` drops the two keys (and keeps `recipe: 2`), so the verify page shows
  that report as not matching its fingerprint, though nothing stored changed; rolling forward
  again shows it intact. Its filing paths ignore `private_*` questions: an operator who added
  one would see its answers dropped. Its export copies `report_values` (it does not know to
  exclude it) and the importer would replay those reports with different fingerprints. So,
  as the plan says, the questions go onto a live logbook only after the release has run on
  live without a rollback.

## Proved

- `packages/seal/test/legacy-vectors.test.ts`: green, no fixture touched.
- `packages/seal/test/rules.test.ts`: write side and read side byte-identical for none, text,
  link and both, crossed with answers, provenance, form and files.
- `packages/seal/test/held.test.ts`: the fingerprint formula by hand, nonce refusals, the
  value never in the sealed bytes, empty maps sealing exactly as before.
- `apps/api/test/db/held-values.test.ts` (17): through the routes with the emailed link;
  values not in the staged payload; each under its own key; fingerprints recomputable from
  value and nonce; reads; erasure leaves the report verifying with identical bytes; the
  tombstone is append-only; a correction's values are separate; a files-only version carries
  and erasure takes every copy; the chain refuses handed-in or wrong fingerprints;
  byte-identical write and read side for none, text, link, both.
- `apps/api/test/db/held-upgrade.test.ts`: the upgrade proof described above, over every
  existing kind, two chains, a correction, a third-party report and a waiting report. Files
  are not in it (their manifest needs the files worker); P1's fuller test should add them.
- `apps/web/e2e/held-verify.spec.ts`: a report filed and confirmed by link, one link erased,
  checks out in the browser for a reader (fingerprints only) and for staff (the browser
  recomputes the fingerprint from bytes that hold only fingerprints); no value on the page;
  no third-party request.

## Not done

- Moderation, desk and link-store screens and routes (M1, J1, S2). No route erases a value
  yet; `dev/held-state.ts` stands in for one in the browser test.
- The filing cards (F1). Today's form would show a `private_text` question as a one-line box
  and a `private_link` question as one box. The builder already offers both kinds; nobody
  should add one to a live logbook before F1 ships (D23 says Casey adds them).
- Coordinator filing of held values (refused for now, with a sentence).
- Public "a value was removed on <date>" notice (X3): `erasuresOf` returns what it may say;
  no page shows it yet.

## Wording that differs from the mock-up

None: this branch adds no screen. Refusal sentences added (API): "<label> must be a web
address starting with http:// or https://.", "<label> takes at most N links.", "Text and
links that are never published cannot be filed for somebody else yet. Leave them out."

## Suite totals

Lean checks only (owner order): seal 52 and fields 123 unit tests green, legacy vectors green; tsc seal, fields, api, web clean; eslint and prettier clean on changed files. db suite, e2e and pnpm check NOT run by this worker (integrator runs them).
