# Workstream D2 · The daily anchor, the transparency log and exports: status

For the coordinating session and the other workstreams. One file per workstream in `docs/status/`.
D was split in two: D1 does moderation and the board, D2 (this) the anchor, the log and exports.

- **Branch:** `claude/d2-anchor`, based on `ccr-c9c93698-ev856l` (foundation + A, B, C, E, G, and H merged in at `09b08ce`)
- **Pull request:** [#8](https://github.com/munsdev/reportlog/pull/8), into `ccr-c9c93698-ev856l`
- **State:** finished and merged into `ccr-c9c93698-ev856l` (`7898de3`). Nothing has been sent to the real
  transparency log or the real timestamp authority.
- **Last updated:** 2026-10-19

## Checks, as last run before pushing

| Suite                           | Result                                                                     |
| ------------------------------- | -------------------------------------------------------------------------- |
| `pnpm check`                    | passes (format, lint, types, boundaries; unit tests: api 215, web 364)     |
| `pnpm test:db`                  | 28 files, 449 tests, all passed, after merging H                           |
| `db:types:check`                | generated types up to date                                                 |
| Browser suite (`CHROMIUM_PATH`) | 60 passed, after merging H. D2 has no screen; run because `app.ts` changed |

The browser suite first refused to start: the legacy app (`node server.js` in `legacy/`) was
listening on port 3000 from the container's start, as A and B also found. I stopped it.

## What was built, in the order asked

1. **The daily anchor** (`apps/api/src/anchor/anchor.ts`). `currentHeads` → `headsDigest` → an
   RFC 3161 token → `chain_anchors` and `chain_anchor_heads`, in one transaction under an advisory
   lock.
   - **Before anything is timestamped, today's list is compared with the last published one
     twice:** as this database recorded it (`lastPublishedHeads`), and as the log itself holds it
     (the newest `anchors/*.json` in the checkout). A dropped logbook or a shorter chain on either
     side refuses the run: nothing is timestamped, nothing is written, the run is recorded as
     `refused`, the job exits 2, and the next day's run refuses again. Reading the log as well
     matters: a database restored from the wrong backup has forgotten what it published, and the
     log has not.
   - A log that already holds today's anchor which this database never wrote is also refused,
     never overwritten.
   - **One anchor a day.** A second run timestamps nothing, writes whichever of the day's files are
     missing, and pushes again, so a day whose push failed is retried rather than skipped. A
     unique index on `chain_anchors (anchor_date)` holds that if code forgets.
   - **The timestamp** (`tsp.ts`): the request and reply are written and read here (a small DER
     reader, no `openssl` binary in production). A reply is accepted only if it is granted, carries
     a token over exactly our SHA-256 digest, and echoes our nonce. The authority's signature is
     not checked on the server; anybody holding the published token checks it with
     `openssl ts -verify` and DFN's chain. The default is DFN (`https://zeitstempel.dfn.de`).
2. **The transparency log** (`translog.ts`, `records.ts`). Each day: `anchors/<date>.json` (the
   old application's format, key for key), `snapshots/<date>.json` (every published report with
   exactly what was hashed, in canonical JSON, with a mismatch published rather than hidden), and
   `counts/<date>.json`.
   - Files are written once and never replaced. There are no amends and no force pushes. A mirror
     whose history has gone elsewhere refuses the push, and that refusal is reported.
   - Each remote is pushed on its own. Some reached means `partly_published` (exit 0, the doctor
     warns). None reached means `not_published` (exit 1). A fresh checkout is cloned from
     whichever mirror answers.
   - No address reaches a log line or the run record. Remotes are named by position and host, and
     git's own error text is scrubbed of the address and of anything that looks like a
     credential.
   - **Publishing what invalidates published proofs** (`reset.ts`, `anchor reset-marker`): after an
     import that had to build new chains, `resets/<date>.json` names every anchor that no longer
     reconciles, the old heads and the new, and the reason. The old anchors stay where they are.
3. **E's daily counts** (`countsRecord` in `records.ts`). Built from `snapshotDocument`, with only
   the named fields copied. It has its own digest (SHA-256 of `{counts_format, date, lists}`
   under RFC 8785, computed in `anchor/`, so lists never reach the seal) and its own token from the
   same authority, in the same commit. A failure here never stops the reports' anchor.
4. **Chain file downloads** (`routes.ts`, `packages/contracts/src/anchor.ts`).
   - `GET /api/chain/:slug` serves the published file, behind the site password like every board
     read.
   - `GET /api/admin/chain/:slug` serves the complete file, administrators only (scope guard).
   - `GET /api/admin/anchor` gives the anchor's health, the last 30 anchors and the last 30 runs.
   - A draft or an unknown logbook is 404.
   - **The command-line checker** (`check-chain.ts`, `pnpm --filter @reportlog/api check-chain
<file> [anchors-folder]`) imports nothing but `@reportlog/seal` and the token reader. With a
     copy of the log's `anchors/` folder it also checks that each published anchor agrees with the
     file, matches its own digest, and carries a token over that digest.
5. **Export and import of a whole archive** (`archive.ts`, `anchor export` / `anchor import`).
   - Every table is found in the catalogue rather than listed. What does not travel is in
     `EXCLUDED` with its reason: **the eight list tables**, live credentials (sessions, codes,
     site-password cookies, unconfirmed filings), the runner's own tables, and the anchors. A
     test fails if a table is neither carried nor excluded.
   - Reports are **replayed through `appendReportVersion`** from the sealed object the verifier
     rebuilds, and each result is checked against the exported fingerprint.
   - **Ids are kept.** A correction seals the id of the version it corrects, so a replay that
     renumbered (a rolled-back filing leaves a gap) would change those fingerprints. The import
     positions the id sequence before each replay. The test has a gap, and fails without this.
   - A fingerprint that does not reproduce refuses the whole import, unless `--new-chain` is given.
     Anchors are restored only when every fingerprint is identical; otherwise the operator is
     told to publish a reset marker.
   - A column in `reports` that the replay does not write is refused by name, rather than lost.
6. **The anchor's health check for the doctor** (`health.ts`, `job.ts`).
   - `anchorDoctorCheck(ctx)` returns H's `Finding` shape (`{status, check: 'anchor', detail}`).
   - It fails when the newest anchor is over 36 hours old (`ANCHOR_MAX_AGE_HOURS`), when nothing
     was ever anchored but reports exist, when the last run refused (this outranks everything),
     when the last run published nothing, or when no remote is configured.
   - It warns when some mirrors were missed.
   - Every run is recorded in a new append-only table, `anchor_runs`: a timer that fires is not a
     timer that works.

## Legacy self-tests and their equivalents

| Legacy                             | Here                                                             | Notes                                                                                     |
| ---------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `chain-selftest` (anchor half)     | `apps/api/test/db/anchor.test.ts` ("once listed, always listed") | Contradictions planted in the last published list, as legacy did                          |
| `chain-selftest` (chain-file half) | `apps/api/test/db/chain-files.test.ts`                           | Over HTTP with the password on, then the CLI on the downloaded file                       |
| `chain-selftest` (the rest)        | already in the foundation's `chain.test.ts`                      | Interleaved logbooks, heads, form versions                                                |
| `translog-selftest`                | `anchor.test.ts` ("mirrors"), `test/unit/anchor.test.ts`         | Where the push goes, each mirror alone, no address in a log line, settings refused        |
| `translog-selftest` (deploy key)   | none                                                             | The rebuild has no settings panel; the key is a file named in configuration               |
| `archive-roundtrip-selftest`       | `apps/api/test/db/archive.test.ts`                               | Plus: an id gap, lists left out, anchors restored, a changed shape refused, both commands |
| (new) the timestamp itself         | `apps/api/test/unit/tsp.test.ts`                                 | Against real OpenSSL as the authority: refusal, error page, wrong digest, replay          |

**The timestamp authority in every test is a local stand-in** (`apps/api/test/db/stand-in-tsa.ts`):
real OpenSSL (`openssl ts -reply`) behind a loopback HTTP server with a throwaway key. So our
request is read, and our token verified (`openssl ts -verify`), by an implementation that is not
ours. The real DFN service was never contacted. The anchor and chain-file tests each use a
database of their own, because the anchor tables are append-only and a planted contradiction
refuses for good.

## Changes outside D2's folders (all named in the commit message)

- `apps/api/src/config.ts`: `TSA_URL`, `TRANSPARENCY_LOG_DIR`, `TRANSPARENCY_LOG_REMOTES`,
  `TRANSPARENCY_LOG_BRANCH`, `TRANSPARENCY_LOG_SSH_KEY`, `TRANSPARENCY_LOG_AUTHOR_NAME`,
  `TRANSPARENCY_LOG_AUTHOR_EMAIL`, `ANCHOR_MAX_AGE_HOURS`. Empty values count as unset.
- `apps/api/src/app.ts`: one registration (`anchorRoutes`), and two more config keys in `AppDeps`.
- `packages/contracts/src/index.ts`: one export line.
- Migration `20261019180914_anchor_runs.sql`: the new `anchor_runs` table, and **a unique index on
  the core table `chain_anchors (anchor_date)`**. Nothing sealed is read differently.
  `schema.gen.ts` regenerated.
- `apps/api/package.json`: the `anchor` and `check-chain` scripts.
- `.dependency-cruiser.cjs`: `anchor/cli.ts` and `anchor/job.ts` are entry points, not orphans.
- `.env.example`: the log's settings.

## For the other workstreams

- **H (operations):** wired in after H was merged into the base (named in the merge commit):
  - `jobs/registry.ts`: the anchor slot now runs `runAnchorJob` (`reportlog-anchor.timer` was
    already there).
  - `jobs/doctor.ts`: `anchorDoctorCheck` after the backups. On an unconfigured machine it says
    `FAIL anchor NOTHING HAS EVER BEEN ANCHORED…` once reports exist.
  - `deploy/README.md`: the job table's anchor row, and a paragraph on its settings and refusals.
  - Put `TRANSPARENCY_LOG_DIR` under `/var/lib/reportlog` (the unit's only writable path), with
    the ssh key and its `known_hosts` beside it, mode 0600. The server needs `git`, not `openssl`.
  - `anchor_runs` is never swept.
- **D1 (board):** what counts as published is written twice: `buildChainFile` in the foundation,
  and `publishedReportRows` in `anchor/records.ts`, which feeds the snapshot. They use the same
  three conditions: the current version, not withdrawn, `valid`, and the reporter said yes. When
  the board gains a condition (C mentions a public-archive switch), the snapshot and the
  published chain file must gain it in the same change, because the log is never rewritten. One
  function owned by you, which both call, would be better. The snapshot publishes each report's
  whole sealed object, as legacy did. If the board ever hides part of what was sealed, say so
  before it reaches the log.
- **F (files):** the export carries `attachments` and `report_attachments` rows, **not the stored
  files**. Moving an archive also means copying the bucket. Storage keys travel unchanged.
- **C (filing):** an export carries `contact_keys` and `report_contacts` as they are, wrapped by
  `CONTACT_KEY`. The new server needs the same key.
- **A (identity):** the published chain file is behind the gate, as the board is. No change to
  `IN_FRONT`.

## Needs you

1. **Credentials for `munsdev/reportlog-transparency-log`, as configuration on the server**, never
   in code. Either:
   - a deploy key with **write** access (recommended): generate one on the server, add the public
     half to the repository, and set `TRANSPARENCY_LOG_SSH_KEY` and
     `TRANSPARENCY_LOG_REMOTES=git@github.com:munsdev/reportlog-transparency-log.git`; or
   - a fine-grained token with contents write, in an https address in `TRANSPARENCY_LOG_REMOTES`.
   - The repository currently holds only its README, which a first run clones and builds on.
2. **Mirrors.** The log is on GitHub, a US company. The timestamp goes to DFN in Germany, as asked,
   but the log itself does not have to live only in the US. Adding an EU mirror (Codeberg, say)
   is one more address in `TRANSPARENCY_LOG_REMOTES`. Your call.
3. **One first real run** (`pnpm --filter @reportlog/api anchor run` on the server) to see DFN
   accept our request. The format is checked against OpenSSL, not against DFN itself.

## Not done, and why

- **`anchor-watch` as its own script.** H's alert on a failed unit, plus `anchorDoctorCheck`,
  cover it.
- **A screen.** The admin route exists (`GET /api/admin/anchor`). Legacy's `admin-translog.js`
  settings panel had no equivalent to port, because the settings are configuration.
- **Verifying the authority's signature on the server.** That needs DFN's certificate chain kept
  current. Readers verify it, and the structure, digest and nonce are checked here.

## Notes on the foundation (nothing blocked)

- `chain_anchors` allowed several anchors on one day. Each day's file in the log is written
  once, so a second row would be a timestamp nobody can find. I added the unique index (see above).
- `public_log_ref` can never be updated (the table is append-only), so the anchor row is written
  with its log path before the push, and `anchor_runs` records whether the push happened.
