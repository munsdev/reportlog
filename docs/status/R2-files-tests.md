# R2 · Files on the server, the untested half (F3): status

For the coordinating session and the other workstreams. One file per workstream in `docs/status/`.
The brief is R2 in `docs/parity.md` §7.

- **Branch:** `claude/r2-files-tests`, based on `ccr-c9c93698-ev856l` at `6bd963a`, merged up to `2bdfe05` (R7)
- **Pull request:** PR_LINK, into `ccr-c9c93698-ev856l`
- **State:** finished, waiting for review. Not merged.
- **Last updated:** 2026-10-20

## Checks, as last run before pushing

Run on the branch's head after merging the base at `2bdfe05` (R7). The `docs/parity.md` totals
conflicted with R7's and were recounted from the tables: both branches' changes are in them.

| Suite                                                                       | Result                                                                                                                     |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check`                                                                | passes (format, lint, types, boundaries; unit tests: api 386 passed and 17 skipped, web 477, fields 69, seal 31, access 6) |
| `pnpm test:db`                                                              | 73 files, 1089 tests, all passed (66 of them new here)                                                                     |
| `db:types:check`                                                            | up to date (no migration)                                                                                                  |
| Browser suite (`CI=1`, `CHROMIUM_PATH`, `pnpm --filter @reportlog/web e2e`) | 760 passed, 4 skipped, none failed (15.1 minutes)                                                                          |

- The first `pnpm check`, run while the browser suite was running, had two timeouts in P7's
  `deploy-install.test.ts` (it runs `install.sh`, which this branch does not touch). That file
  passed alone (22 of 22), and the full `pnpm check` above, run on its own, passed.
- The skipped unit tests and browser tests are the existing ones (tools not installed here;
  site-wide switches run on desktop only). This branch adds none of either.

## What was tested

All in `apps/api/test/db/`. 66 new database tests in five files, plus shared fixtures in
`files-helpers.ts` (`stageAndSend`, a WebP with EXIF and XMP, a WebM, an M4A, sound alone in an
`isom` MP4).

| File                     | Tests | What it proves                                                                                                                                                                                                                                                                                                                                                                                                                                  | Closes (§)                                                                    |
| ------------------------ | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `files-posters.test.ts`  | 13    | A video's still and a PDF's pages, public and staff. Public: served only while published, permitted, current and public, checked again at each request; gone, and out of the bucket, when withheld or when the reporter takes permission back. Staff: decrypted from evidence before anything is published, each look on the access log, 403 for the reporter, 401 signed out, 410 once erased. No still on a photo, no page 0 or past the last | §2 both poster rows                                                           |
| `files-sniff.test.ts`    | 36    | Legacy's table case for case (WebP, WAV, HEIC, HEIF, MOV, MP4, M4A, WebM, MP3, AAC, Ogg, PDF), and ELF, MZ, empty, an unknown brand, HTML and SVG are nothing. SVG never: refused as a type, and its bytes declared as a PNG refused by the worker. Real WebP, WebM and M4A through the worker                                                                                                                                                  | §4b "type sniffing"                                                           |
| `files-strip.test.ts`    | 7     | A WebP's EXIF (with GPS) and XMP are lifted out, the RIFF size is rewritten and it still opens; through the worker the copy carries none of it and the record says what went. Stripping twice changes nothing, for JPEG, PNG and WebP, and on what the worker wrote                                                                                                                                                                             | §4b "metadata stripping"                                                      |
| `files-outcomes.test.ts` | 4     | The confirmation names a refused file and not a withdrawn or expired one, and seals exactly the one good file. A slot's and a link's shipped lifetimes are the same; Send gives every file of the draft the link's expiry (and leaves another draft's alone); a sent file is not swept while its link works                                                                                                                                     | §4b "upload outcomes", "confirmation link and staged uploads expire together" |
| `files-tools.test.ts`    | 6     | Without ffmpeg, ImageMagick or poppler (PATH pointed at a directory of only the allowed tools), only the files needing it wait, naming the package, keeping key and bytes. Installed while the worker runs, the next pass prepares them. A tool gone between the check and the run defers, never refuses                                                                                                                                        | §4b "a missing media tool defers only what needs it"                          |

Each new assertion that guards code was checked by breaking that code: the outcome filter in
`fileOutcome` (one condition at a time), the expiry in `releaseDraft`, and the `MissingTool`
deferral in the worker. Each made its test fail; each was put back.

## Bugs found and fixed (all in `apps/api/src/files/`)

1. **A missing tool could destroy a file** (`media.ts`, `worker.ts`). Whether a tool is installed
   was remembered for the life of the process, both ways:
   - a long-running worker (`files:worker`) never noticed a package installed after it started, so
     files stayed "waiting for ffmpeg" until a restart, although the status told the operator to
     install it;
   - a tool removed under a running worker (a package upgrade) was still taken as present. The
     run then failed with ENOENT, which `tool()` turned into a `RejectFile`: **the file was refused
     as "unreadable" and its key destroyed**, for a fault that was the server's.

   Now the check runs for every file (a few `access` calls), only HEIC support's yes is
   remembered, and ENOENT from a tool throws `MissingTool`, which the worker treats as a missing
   tool: the file waits, with the package named. `files-tools.test.ts` failed on all of this
   before the fix.

2. **One page had many addresses** (`routes.ts`). `/page/:n` read its number with `Number()`, so
   `2e0`, `02`, `0x2` and ` 2` each served page two, on the public route and the moderators'. No
   harm came of it, but an address should be one thing. `pageNumber` takes digits without a
   leading zero, and anything else is "not here". The site's own links already wrote numbers this
   way.

## Not done, and why

- **§4b "upload outcomes" stays Partial** for one thing: legacy wrote a moderators' log entry for a
  refused file and the rebuild writes none. That is R0 n, the owner's to rule, and R3's to build
  if ported.
- **Sound alone in an MP4 under a video brand** (`isom`, `mp42`) is sniffed as video and refused:
  "there is no picture in this video". Legacy did the same ("no video track found"), so this is
  parity, and `files-sniff.test.ts` pins it. A voice memo written with the `M4A ` brand, as
  iPhones and the `ipod` muxer write it, is taken as sound. **A question for the owner:** some
  Android recorders write `.m4a` files with an `mp42` or `isom` brand, and those are refused today.
  Taking them would mean probing the streams before choosing the kind, in `worker.ts`.
- **HEIC** is in the sniff table by its brand bytes only. ImageMagick here reads HEIC but cannot
  write it, so there is still no real HEIC fixture (as F said).
- Not touched, as the brief says: `apps/api/src/files/storage*`, `apps/api/src/evidence/`, R0 a,
  m and n.

## Changes outside R2's folders

- `docs/parity.md`: the R2 rows and the totals at the top, with R7's (routes 124 Equivalent,
  0 Partial; `selftest.js` groups 58 / 18 / 5; Missing rows 8, Partial rows 44).
- This file.
