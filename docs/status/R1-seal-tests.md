# R1 · Seal and chain tests: status

For the coordinating session. Brief: `docs/parity.md` §7, R1.

- **Branch:** `claude/r1-seal-tests`, based on `ccr-c9c93698-ev856l` (R7 merged in before the last run of all three suites)
- **Pull request:** [#31](https://github.com/munsdev/reportlog/pull/31), into `ccr-c9c93698-ev856l`
- **State:** finished and merged into `ccr-c9c93698-ev856l` (`9a839fe`).
- **Last updated:** 2026-10-20

**Tests only. No code changed, no fixture touched.** Every new test passed against the real code
on its first run, so there is no finding to report.

## Checks, as last run before pushing

| Suite                                   | Result                                                                                                                             |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check`                            | passes: format, lint, types, boundaries; unit tests seal 46 (was 31), fields 69, access 6, web 477, api 386 (17 skipped, not R1's) |
| `pnpm test:db`                          | 68 files, 1024 passed (R1's: 1 new, in `chain-files.test.ts`)                                                                      |
| Browser suite (`CHROMIUM_PATH`, `CI=1`) | 761 passed, 4 skipped, 11.1 minutes (R1 adds none: no page changed)                                                                |

## The tests, and the plant that proved each one

Each plant was a one-line change to the real code, run against the new tests, then reverted
(`git checkout`). Every plant turned the named test red and nothing else among the new tests.

### `packages/seal/test/hashed-object.test.ts` (8 tests)

| Test                                                                    | Plant                                                                                             |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| changes the hash when one file's `byte_size` changes                    | `buildSealedObject` seals every attachment with `byte_size: 0`                                    |
| changes the hash when the same files are in another order               | `buildSealedObject` sorts attachments by `sha256` and renumbers them                              |
| reads `'true'` and `'false'` as the booleans, and seals the boolean     | `normalizeReportFields` stops reading `'false'`; separately, stops reading `'true'`               |
| refuses anything else instead of guessing                               | `normalizeReportFields` also accepts `'yes'` and `1`                                              |
| a form's hash changes when help is added or reworded                    | `formDefinition` drops `help`                                                                     |
| keeps its hash when there is no help, however "none" is spelled         | `formDefinition` writes `help: f.help ?? null` unconditionally                                    |
| keeps its hash whatever filterable, the position numbers or the ids say | `formDefinition` spreads the whole field (`...f`), so a row's `id`, `position`, `filterable` leak |
| still changes its hash when the order of the questions changes          | none needed: it guards the other test from passing by sealing nothing about order                 |

### `packages/seal/test/card-wording.test.ts` (4 tests)

| Test                                             | Plant                                                                                                   |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| never says consent                               | the question becomes "Do you consent to this report being published?"                                   |
| promises nothing about timing                    | "reviewed soon either way"                                                                              |
| describes two permissions                        | the old "your report and anything you attached to it"; separately, the files sentence loses "back down" |
| says permanent, search, download, and either way | "Publication is permanent." removed; separately, "either way" removed                                   |

These plants also break the legacy card-digest vector, as they should. The point of the new tests
is that a deliberate rewording (new vector, new digest) would no longer slip a rule past.

### `packages/seal/test/chain-file-before-forms.test.ts` (3 tests)

| Test                                                         | Plant                                                                                                |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| checks out with no `forms` key at all                        | `checkChainFile` calls a report without `logbook_form` a problem; separately, a file without `forms` |
| checks out with an empty list of forms                       | the first plant above                                                                                |
| checks out when early reports have no form and later ones do | the first plant above. It also asserts the later reports are still held to their form                |

### `apps/api/test/db/chain-files.test.ts`, "a chain from before forms were sealed" (1 test)

Two reports written as rows with `form_id` null, sealed without `logbook_form` and linked by hand
(the database's link guard still checks them), then one filed today through
`appendReportVersion`. The complete chain file is downloaded over HTTP as an administrator and
checked.

| Plant                                                                                    |
| ---------------------------------------------------------------------------------------- |
| `checkChainFile` calls a report without `logbook_form` a problem                         |
| `sealedReportRows` inner-joins `logbook_forms`, so pre-form reports vanish from the file |
| `rebuildSealedObject` writes `logbook_form` unconditionally (`?? ''`)                    |

## Totals

16 new tests: 15 in `packages/seal` (seal goes from 31 to 46) and 1 database test. 19 plants, all
caught.

## `docs/parity.md`

Five §4b rows moved from Partial to Equivalent, each with its test's path: "the hashed object",
"publication permission", "the card text and its digest", "the form a report was answered
against", "when a question is asked". The totals table follows (on top of R7, merged meanwhile): `selftest.js` groups 54 / 21
became 59 / 16, and the Partial count 49 became 44. The §7 R1 entry is left for the coordinator.

## Assumed rather than verified

- That "position does not change the hash" means the position NUMBER. The order the numbers produce
  does change it, and a test says so.
- That a pre-form report can only reach the database as an imported row; nothing in the rebuild
  files one today, so the database test writes it directly.
