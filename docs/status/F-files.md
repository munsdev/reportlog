# Workstream F · Files and evidence: status

For the coordinating session and the other workstreams. One file per workstream in `docs/status/`.

- **Branch:** `claude/workstream-F-files`, based on `ccr-c9c93698-ev856l` (foundation + A, B, C, E, G)
- **Pull request:** [#11](https://github.com/munsdev/reportlog/pull/11), into `ccr-c9c93698-ev856l`
- **State:** finished, waiting for review. Not merged.
- **Last updated:** 2026-10-19

## Checks, as last run before pushing

After merging the base at `7898de3` (H, G2, I and D2):

| Suite                               | Result                                                                                         |
| ----------------------------------- | ---------------------------------------------------------------------------------------------- |
| `pnpm check`                        | passes (format, lint, types, boundaries; unit: api 231, web 396, fields 69, seal 31, access 4) |
| `pnpm test:db`                      | 38 files, 632 tests: all passed on one run; on the other, D2's anchor test below failed        |
| `db:types:check`                    | up to date                                                                                     |
| Browser suite (`CHROMIUM_PATH` set) | 79 passed, twice in a row (each run makes its own fresh database)                              |

**D2's `anchor.test.ts` › "a mirror whose history has gone elsewhere is refused and reported, never
forced" is intermittent, and not this branch's.** It failed in one of two full runs here, passed
twice on its own here, and failed twice on its own in a clean checkout of the base `7898de3`. It
expects `partly_published` and sometimes gets `published`. Nothing in this branch touches the
anchor or git.

The files worker is now the `files` job in H's runner, one pass a minute
(`deploy/systemd/reportlog-files.timer`), and the doctor checks files.

## What was built, in the order asked

1. **Storage behind one small interface** (`apps/api/src/files/storage.ts`): `put`, `get` (with
   ranges), `head` and `delete`, over three buckets.
   - `staging`: bytes on their way in, already encrypted.
   - `evidence`: every original and derived copy, encrypted. Never public.
   - `renditions`: published copies only. An object there is the publication decision.

   There are two drivers. **S3-compatible** speaks the S3 API only, with Signature V4 written out
   in `sigv4.ts` and checked against Amazon's three published worked examples. **Disk** is for
   development and the tests. Both pass the same contract tests, the S3 one against an in-process
   stand-in that checks every signature. Keys are random and checked against one pattern, so a
   file's name can never become a path. `pnpm --filter @reportlog/api files:storage-check` checks
   the real provider (write, read, range, delete in each bucket), once one is chosen.

2. **Uploads in the filing flow.**
   - **Staging** (`slots.ts`). A free draft token is stored only as a hash. There is one slot per
     file. Every limit is checked before a byte is sent. The **staging quota** is per address,
     across every draft: three reports' worth by default, and the address is kept as a keyed
     digest. The first slot fixes the draft's logbook, so the client cannot choose whose caps
     apply.
   - **One key per file, from the first byte** (`envelope.ts`). The bytes are encrypted under a
     new key as they stream in, so staging never holds plaintext. Everything later made from the
     file uses the same key: the original, the re-encoded copy, a video's still, a PDF's pages, and
     the metadata that was removed. When the file is sealed, its wrapped key **moves** from the
     slot to `attachment_heads`, so there is exactly one copy. Destroying it erases that one file
     and leaves its fingerprint.
   - **Re-encoding** (`media.ts`, `worker.ts`). Files are decoded and rebuilt, not trimmed:
     - photos (JPEG, PNG, WebP, HEIC) go through ImageMagick, auto-oriented and stripped;
     - video and sound go through ffmpeg, with `-map_metadata -1` and bitexact;
     - PDFs go through pdftoppm and come out as page images.

     A pure walk over the output (`strip.ts`) then lifts out any metadata segment an encoder
     might copy in a later release. Every tool runs as a child process with a time limit, and the
     decoder is named from the sniffed type, never from the browser's claim. Nothing is worked on
     before Send. A missing tool holds back only the files that need it, and the status names the
     package to install.

   - **Wired into C's filing.**
     - `POST /api/reports` takes `draft_token`. Send ties the draft's files to the submission and
       releases them.
     - Confirming while a file is still being prepared answers `preparing` and files nothing. It
       waits at most 30 minutes from Send. The worker requeues a dead claim at 15, and the wait has
       to outlast that.
     - At confirmation, `sealFiles` gives the manifest for `appendReportVersion`'s `attachments`.
       Exactly those rows are written and linked in `report_attachments`, in the same transaction.
     - The confirmation names which files made it into the report and why any did not.
   - **The upload card** (`apps/web/src/features/files/`). It comes **after the address card**,
     wherever the operator put the upload question, because the staging quota is keyed on the
     address (legacy moved it for the same reason). Files upload as soon as they are picked, with
     progress. The page checks the server's limits as a kindness, and the server decides. Send
     waits while a file is still sending.

3. **Renditions and the revocable file permission** (`publication.ts`).
   - A moderator publishes the re-encoded copy, with alt text and a reason. It is decrypted from
     evidence into the renditions bucket.
   - **Consent is the ceiling**, read at the moment of publishing. A database trigger
     (`attachment_heads_guard`) also refuses publication without the reporter's
     `attachment_publication` and the report's sealed `may_publish`.
   - **There is one path down, `takeDown`.** The moderator's withhold and refuse use it. So does
     the reporter's revocation, through C's hook in `setMyPermission`, in the same transaction as
     the log row. So does C's withdraw and erase.
   - Object deletions are written to `storage_deletions` in the deciding transaction, and retried
     until they succeed.
   - **A deferred constraint trigger refuses a revocation that leaves any file of the thread
     published.**
   - Published copies are served only through this origin (`/api/files/public/:key`). Every
     request re-checks:
     - the file is published;
     - the reporter still permits it;
     - it is on the current version;
     - the report is public.

     Responses are `no-cache`, `nosniff` and sandboxed.

   - An administrator can **erase** one file, which destroys its key.
   - Opening an original needs a reason, and the opening is recorded in `attachment_events`.

4. **Upload limits per logbook** (`limits.ts`). There are three layers: logbook, site, shipped.
   NULL is invisible, and kinds intersect, so the site is a ceiling. The ranges match the
   migration's CHECKs, and a test pins them together. Limits may be set after launch. **B's
   `max_files` and `max_total_bytes` are now read**: importing a logbook file sets the logbook's
   caps, and exporting writes them back only when they are set. Admin API:
   `/api/admin/files/settings` and `/api/admin/files/logbooks/:id/limits`.

5. **Evidence requests** (`apps/api/src/evidence/`). A request needs **both** a sealed
   `evidence_declaration` answered yes **and** the reporter's revocable `evidence_request`
   permission, read at every use.
   - One live ask per report. Asks expire after two weeks. A stale ask is stamped rather than
     blocking the next one.
   - The token is stored only as a hash. It is spent first and conditionally, so two presses make
     one version.
   - What the reporter sends becomes **a new version**. It carries the previous version's sealed
     fields byte for byte, its files, then the new ones.
   - The door page (`/evidence/:token`) shows what was asked and the reference, and never the
     report's text.

## Legacy self-tests and their equivalents

| Legacy                                      | Here                                                                                                                                                                          |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `attachment-settings-selftest`              | `apps/api/test/db/files-limits.test.ts` ("the stored switch")                                                                                                                 |
| `upload-limits-selftest`                    | `apps/api/test/db/files-limits.test.ts` ("the three layers"), check for check                                                                                                 |
| `evidence-caps-selftest`                    | `files-limits.test.ts` (caps, ranges, kinds, the logbook file), `files-uploads.test.ts` (the client cannot choose the cap), `evidence-request.test.ts` (the third permission) |
| `evidence-request-selftest`                 | `apps/api/test/db/evidence-request.test.ts`, check for check, plus the door through the routes from the email                                                                 |
| `intake-hardening-selftest` (upload half)   | `apps/api/test/db/files-uploads.test.ts`                                                                                                                                      |
| (new) the worker on real files              | `apps/api/test/db/files-worker.test.ts`                                                                                                                                       |
| (new) attach → send → confirm, and the door | `apps/api/test/db/files-filing.test.ts`                                                                                                                                       |
| (new) publish, revoke, withhold, erase      | `apps/api/test/db/files-publication.test.ts`                                                                                                                                  |
| (new) storage drivers and encryption        | `apps/api/test/unit/files-storage.test.ts`, `sigv4.test.ts`                                                                                                                   |

Two things changed from the legacy tests:

- `evidence-caps` checked a source string (`const forLogbook = fixed || logbookId`). Here the rule
  is checked by behaviour: a second logbook on one draft is refused, and the fixed logbook's
  cap applies.
- Legacy's two names for the photo kind are gone. The test that pinned the `settingKindFor`
  translation now pins that there is one name.

Browser tests:

- `apps/web/e2e/files/attach.spec.ts` attaches a photo, sends, **follows the emailed link**,
  confirms through "preparing", and checks the sealed manifest. It also checks that no other host
  is contacted.
- `apps/web/e2e/files-door/door.spec.ts` does the same **with the site password on**, for a
  logbook opened by link. The lock never comes back.
- `apps/web/e2e/files/evidence.spec.ts` sets up a moderator's ask, then the reporter **follows the
  emailed link** and sends a photo.

Unit tests: `apps/web/test/files.test.tsx`, and C's `filing.test.tsx` updated.

## Decisions a reviewer should know about

- **Changing `FILING_CALLS` is a decision.** The six upload calls pass the password only while a
  logbook opened outside **asks for files**, as legacy conditioned them. Two are tighter than
  legacy: the config and a new slot pass only for the logbook they name. The form therefore calls
  the upload routes only for a logbook with an upload question, and a test checks that it calls
  none otherwise.
- **No browser talks to storage.** Legacy presigned uploads straight to the bucket. Here every byte
  goes through the site's origin, for three reasons:
  - the site makes no third-party request (CSP `default-src 'self'`);
  - a presigned URL would bypass the password gate;
  - it lets bytes be encrypted from the first one.

  The cost is that upload bandwidth goes through the server. The body is streamed and never
  buffered.

- **`FILES_KEY` is not `CONTACT_KEY`.** The worker needs the files key and parses hostile input, so
  it must not hold the key to every address. The quota digest is derived from `FILES_KEY` too, and
  it is wiped from the slot when the file is sealed. After an erasure, nothing links a report to an
  address.
- **The evidence door stays behind the site password**, as in legacy. Whether it should pass on
  its token, as the confirmation link does, is A's decision to make.
- **Evidence does not reset moderation.** The words did not change, and new files are withheld
  until published. C's correction does reset it, because there the words changed.
- **Withdrawal (and C's erase-and-withdraw) takes published files down.** Erasing contact details
  does **not** erase files. Erasing one file is an administrator's act, as in legacy.
- **The original's digest is what is sealed and shown.** The published copy is re-encoded, so
  `PublishedFiles` labels the digest as the original's.

## Changes outside F's folders (all named in the commit messages)

- **C** (`apps/api/src/filing/filing.ts`, `routes.ts`, `mine.ts`, `packages/contracts/src/filing.ts`,
  `apps/web/src/features/form/FilingForm.tsx`, `ConfirmPage.tsx`, `apps/web/test/filing.test.tsx`):
  - the draft token, the `preparing` state and the file outcome;
  - the takedown on revocation, withdrawal and erasure;
  - the files card.
- **A** (`apps/api/src/identity/doors.ts`): the upload calls in `FILING_CALLS`.
- **B** (`apps/api/src/logbooks/logbookFile.ts`, `packages/contracts/src/logbooks.ts`):
  `max_files` and `max_total_bytes` are now read and written.
- **H** (`.github/workflows/ci.yml`): installs ImageMagick, libheif, ffmpeg and poppler-utils in
  both jobs. The worker's tests skip without them locally, and **fail** without them in CI.
- **H, after merging the base:** a `files` entry in `apps/api/src/jobs/registry.ts` and its
  generated timer, one call in `apps/api/src/jobs/doctor.ts`, and two `NOT_SWEPT` entries in
  `apps/api/src/jobs/sweep.ts`. `upload_slots` is expired by the files job, which also deletes its
  objects; `evidence_requests` is the record of asking. H's tests require every table with an
  `expires_at` column to be decided.
- **Shared:**
  - `apps/api/src/app.ts`: two registration lines and the files context;
  - `apps/api/src/server.ts`: the inline worker, for development only;
  - `apps/api/src/config.ts`;
  - `apps/api/package.json`: `files:worker`, `files:storage-check`;
  - `packages/contracts/src/index.ts`;
  - `apps/web/src/routes/evidence/$token.tsx`;
  - `apps/web/playwright.config.ts`: files settings for the test server and the
    `files-behind-password` project;
  - `.env.example`, `.gitignore`, `.claude/hooks/session-start.sh`: a development `FILES_KEY`.
- **Migration:** `apps/api/migrations/20261019180938_files.sql`, new tables only, plus a
  constraint trigger on C's `report_permissions_log`. `schema.gen.ts` and `routeTree.gen.ts` are
  regenerated.

## For the other workstreams

- **H (operations):** the media worker is registered as the `files` job in your runner (one pass a
  minute, `deploy/systemd/reportlog-files.timer`, generated from the registry), and
  `reportlog doctor` now checks files.
  - **Isolation:** under `reportlog-job@` the worker reads the same environment file as everything
    else, `CONTACT_KEY` included. Giving it a unit of its own, with only `DATABASE_URL`, `FILES_KEY`
    and storage, would keep the key to reporters' addresses away from the process that parses
    hostile files.
  - **`install.sh`:** add `imagemagick libheif1 ffmpeg poppler-utils` to what it installs. Until
    then, files wait and the doctor names the packages.
  - **Off-site backups:** they use the AWS SDK; files use hand-written Signature V4. They could share
    one S3 client later.
  - **Alternative command:** `pnpm --filter @reportlog/api files:worker` runs the same pass in a
    loop, every 3 s.
  - **Packages:** `imagemagick` with `libheif1` (HEIC), `ffmpeg`, `poppler-utils`. ClamAV is
    optional: set `CLAMAV_ENABLED=true` with a running clamd.
  - **Environment:** `DATABASE_URL`, `FILES_KEY`, and the same `FILES_STORAGE` / `S3_*` as the
    server. **Not** `CONTACT_KEY`.
  - **Server environment:** `FILES_KEY` (32 random bytes, base64; back it up apart from the
    database; never change it on a running archive), `FILES_STORAGE=s3`, `S3_ENDPOINT`,
    `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET_STAGING`, `S3_BUCKET_EVIDENCE`,
    `S3_BUCKET_RENDITIONS`, and `S3_ADDRESSING` (`path`, or `virtual` for AWS proper).
  - **Buckets:** three, all private. No CORS is needed, and no lifecycle rule is needed (the worker
    clears abandoned staging).
  - **Before launch:** run `files:storage-check`.
  - **Caddy:** raise the request body limit for `PUT /api/uploads/*` and
    `PUT /api/evidence/*/files/*` to at least the largest file limit (shipped: 150 MB for a video).
    Don't log URLs there either.
  - **Isolation:** the worker should run as its own user with no network but storage, and with
    memory and time limits.
- **D (moderation, board):** the moderator's file and evidence **API** is built and tested. No
  **screens** are built; they belong on your moderation page:
  - `GET /api/moderate/files/:threadId`
  - `POST /api/moderate/files/file/:id/publication`
  - the `/rendition`, `/poster`, `/page/:n` and `/original?reason=` views
  - `GET`, `POST` and `DELETE /api/moderate/evidence/:threadId`

  For the board, `apps/web/src/features/files/PublishedFiles.tsx` shows a public report's files
  ("3 attached, 1 published") from `GET /api/files/report/:ref`. Your public-archive switch, once
  it exists, should be read in `servable` and `publicFilesOf` (`apps/api/src/files/publication.ts`).
  The CSV and archive export should carry digests, never URLs. The access log should cover
  `viewed_original`.

- **A (identity):** whether the evidence link should pass the password on its token, like the
  confirmation link. It does not today.
- **B (builder):** the per-logbook limits API (`/api/admin/files/logbooks/:id/limits`) could use a
  panel in the builder.
- **G (settings):** the site's file switch, kinds and limits (`/api/admin/files/settings`) have an
  API and no screen. The response carries each layer's value and source, so a panel can show where
  a number comes from.
- **C (filing):** "My reports" could show a report's files per version, and offer adding one as a
  correction. Neither is built. `reporter_actions` has no `evidence` action, so the record of a
  reporter sending evidence is the spent request in `evidence_requests`.

## Not done

- **Moderator and administrator screens** for files, evidence requests and limits. The APIs are
  complete and tested.
- **A HEIC fixture.** ImageMagick here reads HEIC but cannot write it, so HEIC decoding is not
  covered by a test. The code path is the same as for the other photos.
- **Browser-side encryption** and **resumable (multipart) uploads.** A dropped connection means
  sending that file again.
- **Perceptual-hash de-duplication** and incident-grouped review (legacy phase 4, never built
  there either).
- **A late upload after confirmation.** If a file's bytes arrive after its report was confirmed,
  the file is still processed. It is never sealed, and the sweep removes it when it expires.
