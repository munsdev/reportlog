# P1 · Invariant tests: status

For the coordinating session. Brief: `docs/parity.md` §7, "P1 · Invariant tests". Closes I1 to I7
of §1. I8 is left alone: it waits on the owner's ruling.

- **Branch:** `claude/p1-invariant-tests`, based on `ccr-c9c93698-ev856l`
- **Pull request:** see the PR into `ccr-c9c93698-ev856l`
- **Last updated:** 2026-10-19

## Files

New files only, as the brief says, plus one rule in `.dependency-cruiser.cjs`:

| File                                    | Closes                       |
| --------------------------------------- | ---------------------------- |
| `apps/api/test/db/invariants.test.ts`   | I2, I3, I4, I6               |
| `apps/api/test/db/anchor-reset.test.ts` | I5                           |
| `apps/web/e2e/third-party.spec.ts`      | I1                           |
| `apps/web/test/door-quiet.test.tsx`     | I7                           |
| `.dependency-cruiser.cjs`               | `files-stay-out-of-the-seal` |

No feature code, migration or fixture was changed.

## What each test proves, and where its set comes from

Wherever the brief said "found rather than listed", the set is read off the running system, so a
new table, route, page or caller is covered the moment it exists.

### I4 · Append-only tables (`invariants.test.ts`)

- **The set** is read from the Postgres catalogue: every table with a trigger named
  `*_append_only`, or a row trigger that runs `reject_modification()` on UPDATE. Today that is 20
  tables.
  - The parity audit's `file_publication_log` is not among them: a later migration dropped it.
  - D3's `report_assessments` is not among them either, on purpose. It is changed by UPDATE and
    refuses only DELETE and TRUNCATE, using the same function. The first version of this test
    counted any use of the function, and went red on it when D3 merged. The definition was
    narrowed; the table was not changed.
- **A second net:** every table that a migration's comment calls APPEND-ONLY must be in that set.
  This catches a table described as append-only whose trigger was forgotten.
- **One row is planted in each table.** A table in the set with no row fails, naming the table and
  saying to add a row to `plantOneRowEach()`. Without a row, a row trigger has nothing to fire on.
- **The catalogue check:** each table has an enabled BEFORE trigger for UPDATE and DELETE (row
  level) and for TRUNCATE (statement level).
- **The behaviour check:**
  - UPDATE, DELETE and TRUNCATE are run on every table, each in a transaction that is rolled back.
  - Each must be refused by a message that names the table itself.
  - That matters for TRUNCATE … CASCADE. When `reports` lost its own guard in the plant, the
    TRUNCATE was still refused, but by `attachments`' trigger. Only the name check caught it.

### I6 · Card wording and the third-party block (`invariants.test.ts`)

- **`consent_texts`:**
  - A wording stored under another sentence's digest is refused.
  - A decomposed (NFD) body is stored under the digest of its composed (NFC) form, and only that
    one.
  - A stored wording cannot be edited. The I4 sweep covers this as well.
- **The `reports` third-party CHECK:**
  - Refused: `third_party = false`, a block missing `filed_via`, one missing `intake_method`, one
    missing `attested_at`, and a collection date on a direct report.
  - Accepted: a direct report, and a complete block with or without a collection date.
  - The filing path (`normalizeReportFields`) also refuses a partial block.
  - One case is a gap: see below.

### I2 · Staff routes (`invariants.test.ts`)

- **The set:** `buildApp` is unchanged, but the test's `fastify` import is wrapped so that an
  `onRoute` hook is added as soon as the instance exists. Every route registered after that, in
  any scope, is recorded.
- **Staff routes** are those under `/api/admin/`, `/api/moderate/`, `/api/moderation/`,
  `/api/access/`, `/api/intake/` and `/api/list-review`.
- **Every other route** must sit under a prefix listed as not staff. A route under a new prefix
  fails the test until somebody decides which side it is on.
- **Each staff route is called twice:**
  - not signed in, it must answer 401;
  - signed in with no role, it must answer 403.
- **Validation is switched off for this file only.** A guard runs at preHandler, after Fastify
  validates the request, so a request refused by validation proves nothing about the guard.
- **One exception, on purpose:** `GET /api/access/owner` answers anybody signed in, because the
  owner's seat can be offered to somebody with no role. The test checks that such a person sees
  only `{ awaitingMyAcceptance: false }`.
- There are 119 staff routes today, out of 216 (methods counted separately, HEAD left out).

### I3 · Rebuilding a sealed object (`invariants.test.ts`)

- **The walk** uses the TypeScript compiler API over `apps/api/src`, `apps/web/src` and every
  `packages/*/src`. Identifiers are resolved by the binder. Every `rebuildSealedObject` call must
  take `toStoredRecord(row)` as its first argument.
- **Following `row` back:** through variables, reassignments, `for … of`, `await`, method chains
  and functions that return it, `row` must start at a call to `sealedReportRows`.
- **Refused outright:**
  - a function parameter, because the walk cannot see the caller;
  - an import under another name;
  - the function passed around as a value.
- **The walk is tested on planted snippets, permanently:**
  - Refused: a row from its own query, a parameter, an object made on the spot, a variable
    reassigned to another query, the function passed around, and a right row and a wrong row in
    the same file.
  - Accepted: the three shapes the real callers use.

### I5 · The reset marker (`anchor-reset.test.ts`)

- **The path, as an operator takes it:**
  - A deployment anchors to a log, a bare git repository standing in for the mirror.
  - It is exported, then imported with `--new-chain`. One sealed answer is changed in the export,
    row and sealed object alike, so the replay produces new chains.
  - The reset is published from a fresh checkout.
- **What it proves:**
  - A reason that is too short is refused.
  - The record names the voided anchor: its date, root and log path. Its `previous_chains` hash
    to the published anchor's root, and `new_chains` are this database's and differ from them.
  - `resets/<date>.json` is written with the record's exact bytes, and the commit message carries
    the count and the reason.
  - The anchor already in the log is byte for byte as published. The old head is an ancestor of
    the new one, so nothing was force-pushed, and the only change is the one added file.
  - A second publish for the same day is refused. That holds from the same checkout and from one
    that has not seen the first, and the log is unchanged afterwards.
- **Not run:** the `anchor reset-marker` command itself. Its config accepts only https://, ssh://
  or git@ remotes. It is a thin wrapper over the two functions tested.

### I1 · No third-party requests (`third-party.spec.ts`)

- **The set:** every page in the router's `fullPaths`, read from `src/routeTree.gen.ts`. That is 66
  today.
- **Each page is opened twice**, as a stranger and as an administrator. Each of those runs in the
  chromium and phone projects.
- **Parameters** get the demo logbook, a filed report's reference, or a value that names nothing.
  A new parameter name fails until it is given a value.
- **The setup wizard** is opened by answering `/api/setup/status` as a fresh deployment would.
- **What is checked:** that a `<main>` rendered, and that no request went to any host but the
  site's own.
- This covers every page I1 listed without a listener, including `/file/confirm/$token`,
  `/submit`, `/mine/*`, `/notifications`, `/feedback`, `/organizations/$id/listing`,
  `/access/sign-in`, `/access/invitation/$token` and the wizard.

### I7 · The root frame on a door (`door-quiet.test.tsx`)

- **The setup:** the real `__root.tsx` renders inside the real `SiteGate`, with a stand-in page
  that asks nothing.
- **Door shapes:** one address of each shape in `DOOR_PATHS`. A test fails if a new shape is added
  without one.
- **What is checked:**
  - The header, the footer and the page rendered.
  - The only request was `/api/site-access/status`, even with `/api/auth/me` answering as an
    administrator.
- **A control:** the same frame past the password does ask for `/api/site` and `/api/auth/me`, so
  the test can see the frame's calls when they happen.

### The boundary rule

`files-stay-out-of-the-seal`: nothing in `packages/seal/` or `apps/api/src/chain/` may reach
`apps/api/src/files/` or `apps/api/src/evidence/`, even transitively.

It does not run the other way. `evidence/requests.ts` has to reach the chain, because an evidence
request files a new version.

## Planted violations

Each test was checked by planting the violation it guards against, watching it go red, and
removing the plant. Every plant was reverted (`git checkout`, or the planted file deleted). None
is in the branch.

| Plant                                                                    | Went red                                                                         |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| Temporary migration: a table commented APPEND-ONLY with no trigger       | "described as append-only and has no such trigger"                               |
| Same migration: an append-only table with no TRUNCATE trigger and no row | "empty here", the trigger structure check                                        |
| Same migration: a row inserted, so UPDATE and DELETE fire                | "planted_log: went through" for UPDATE and DELETE                                |
| `DROP TRIGGER reports_no_truncate`                                       | TRUNCATE: "reports: … not permitted on attachments" (refused by the wrong table) |
| `ALTER TABLE role_audit DISABLE TRIGGER role_audit_append_only`          | catalogue check, UPDATE and DELETE: "role_audit: went through"                   |
| `DROP CONSTRAINT consent_texts_check`                                    | both digest tests                                                                |
| `DROP CONSTRAINT reports_check1, reports_third_party_check`              | all six third-party refusals                                                     |
| An open `GET /api/admin/planted-open` in `app.ts`                        | 401 and 403 sweeps                                                               |
| `GET /api/admin/planted-signed-in` that only calls `requireUser`         | 403 sweep                                                                        |
| `GET /api/planted-new-prefix`                                            | "every route is under a prefix somebody decided"                                 |
| `roleGuard` removed from the maps staff scope                            | 9 maps routes in both sweeps (one answered 400, still caught)                    |
| `src/anchor/planted.ts`: a row from its own query, and an aliased import | the I3 walk, both problems named; the caller list changed                        |
| `reset.ts`: one anchor dropped from the record                           | "names every anchor"                                                             |
| `reset.ts`: the refusal to replace a notice disabled                     | the commit message check, and "never replaced"                                   |
| `useSite` made to ignore the door                                        | all three door addresses                                                         |
| `<img src="https://example.org/…">` in the `__root.tsx` footer           | the I1 walk (see totals)                                                         |
| `chain/heads.ts` importing `files/context.ts`                            | `files-stay-out-of-the-seal`                                                     |
| `chain/verify.ts` → a new `chain/planted.ts` → `evidence/routes.ts`      | `files-stay-out-of-the-seal` (transitive)                                        |

## Gaps found

Each one went red against the real code. Per the brief, the test is kept and marked `skip` with
the reason in a comment, and nothing was fixed. **The fixes are migrations in other workstreams'
folders.**

1. **`feedback_events` and `feedback_comments` can be TRUNCATEd.**
   - Both are append-only for UPDATE and DELETE.
   - Neither has a `BEFORE TRUNCATE` trigger (`20261019180450_site_feedback_digests.sql`). Every
     other append-only table has one.
   - They are in `KNOWN_GAPS`. A test fails once either is fixed, so the skip is removed with the
     gap.
   - The fix: one `CREATE TRIGGER … BEFORE TRUNCATE … reject_modification()` per table, in a new
     migration.
2. **The third-party completeness CHECK passes a whole block with no flag.**
   - The row: `third_party` NULL, with `filed_via`, `intake_method` and `attested_at` all present.
   - The core CHECK then evaluates to NULL, and SQL lets a NULL CHECK pass. Such a row is stored.
   - `rebuildSealedObject` adds the block only when `third_party` is true. So the row would hold a
     coordinator's provenance that its seal leaves out: the "silently dropped block" the rebuild
     fixed in code, still open in the database.
   - Nothing writes such a row today: `normalizeReportFields` refuses it.
   - The fix: a new CHECK, for example `third_party IS NOT NULL OR (filed_via IS NULL AND
intake_method IS NULL AND attested_at IS NULL AND collected_on IS NULL)`.

## Totals

All three suites were run here (not on CI), after merging `origin/ccr-c9c93698-ev856l` at
`a8ea595` (A2, C3, D3, P7, P4 and P6 by then):

| Suite                                       | Result                                                                                                                                   |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check`                                | passes: format, lint, types, boundaries (610 modules); unit tests fields 69, seal 31, access 6, api 327 (+11 skipped, P7's own), web 436 |
| `pnpm test:db`                              | 61 files, **905 passed, 3 skipped** (the three skips are the gaps above)                                                                 |
| Browser suite (`CI=1`, `CHROMIUM_PATH` set) | **410 passed**, all projects                                                                                                             |

P1's own tests:

| File                   | Tests                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------- |
| `invariants.test.ts`   | 33 passed, 3 skipped                                                                              |
| `anchor-reset.test.ts` | 5 passed                                                                                          |
| `door-quiet.test.tsx`  | 6 passed                                                                                          |
| `third-party.spec.ts`  | 134 per browser project (chromium, phone): 66 pages × 2 viewers, the wizard, the route-list check |

**The merges were a test of the sweeps.**

- **A2** added a door shape (`/notifications/stop/$token`). `door-quiet` failed on it, as
  designed, and now covers it. The frame is quiet there too.
- **D3** added a new prefix, `/api/press`. The route sweep failed until it was classified: it is
  the public press pack.
- **D3** added `report_assessments`, which the first definition of append-only wrongly counted
  (see I4).
- **P4** added a trigger-guarded table, and **P6** added list indexes. Both were picked up with no
  change to the tests: P4's table is not append-only, so it is correctly not in the set.
- **Picked up with no other change:** after the merges there are 119 staff routes, all refusing,
  66 pages, none asking another host, and still 20 append-only tables.
