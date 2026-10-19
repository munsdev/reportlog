# Workstream G2 · The rest of look, site and administration: status

For the coordinating session and the other workstreams. One file per workstream in `docs/status/`.

- **Branch:** `claude/g2-site-nav-feedback-digests`, based on `ccr-c9c93698-ev856l` (foundation + A, B, C, E, G, and H merged in at `09b08ce`)
- **Pull request:** [#7](https://github.com/munsdev/reportlog/pull/7), into `ccr-c9c93698-ev856l`
- **State:** finished, waiting for review. Not merged.
- **Last updated:** 2026-10-19

## Checks, as last run before pushing

| Suite                                   | Result                                                                 |
| --------------------------------------- | ---------------------------------------------------------------------- |
| `pnpm check`                            | passes (format, lint, types, boundaries; unit tests: api 185, web 376) |
| `pnpm test:db`                          | 28 files, 465 passed after merging H (57 are G2's, in 3 new files)     |
| `db:types:check`                        | generated types up to date                                             |
| Browser suite (`CHROMIUM_PATH`, `CI=1`) | 70 passed, 10 of them G2's (5 tests, each on desktop and phone)        |

## What was built, in the order asked

1. **Staff navigation** (`apps/web/src/features/staff-nav/`).
   - One bar under the header, for signed-in people with at least one staff screen. Nobody else
     sees a bar.
   - **`entries.ts` is the whole list.** Each line is a path, a label and who may open it, as
     roles from `@reportlog/access` plus `tester` for the tester flag. Rank is the package's:
     the owner sees what an administrator sees, and an administrator does not see a
     moderator-only screen.
   - Lists what exists now: Access, Logbooks, Front page, Lists, List review, Settings, plus
     G2's Feedback and Guides.
   - **On a door it renders nothing and asks nothing**: the door check happens before the part
     that queries is mounted. A unit test renders it on a door and asserts the only request made
     was the gate's own; planting the regression makes that test fail.
   - `OnlyFor` (same folder) is the screen-side guard for an audience of several roles, reading
     the same rule as the menu.
2. **Feedback** (`apps/api/src/feedback/`, `apps/web/src/features/feedback/`).
   - `/feedback`: file an issue (kind, how much it gets in the way, title, description, an
     optional report reference) and read every tester's issues with masked handles, the
     replies, and comments.
   - `/settings/feedback`: the administrator's queue, filtered by status, with counts. Moving an
     issue needs a note, which is emailed to the tester and shown on the issue.
   - **The tester flag** (`/feedback/testers`, `POST /api/admin/testers`). It is a flag on
     `users`, not a role, and opens the tracker and nothing else. Administrators and Access
     Managers give it. Each change writes a `role_audit` row (axis `flag`) in the same
     transaction. `Me` now carries `tester`.
   - The database keeps what a tester wrote: only `status` and `status_changed_at` can change on
     `feedback`, nothing is deleted, and events and comments are append-only (triggers).
   - The screen a tester filed from is sent as the **route id** (`/(staff)/settings/look`), never
     the address, which can carry a token.
3. **Email updates and digests** (`apps/api/src/site/digest.ts`, `notifications.ts`,
   `apps/web/src/features/site-pages/NotificationsPage.tsx`).
   - `/notifications` (linked as "Email updates" in the header): none, hourly or weekly, from
     every logbook or chosen ones. Only launched logbooks can be followed; an unknown slug and a
     draft's slug get the same refusal.
   - `runDigest({ frequency })` emails each subscriber the reports published since their last
     digest. **Only what the board shows**: moderator-approved (`valid`), not withdrawn, and
     `may_publish`. Answers only, never files, in the logbook's question order and wording.
   - A run uses the **database's clock and stops one minute behind it**, so a moderation still
     committing is not skipped. A failed send leaves that subscriber's clock where it was, so
     the same reports are tried next time. The clock never moves backwards.
   - `runFeedbackDigest` emails `ADMIN_EMAIL` every open issue, longest-untouched first, and
     marks the ones untouched for 7 days as stale.
   - **Registered in H's job runner** (`apps/api/src/jobs/registry.ts`, through
     `apps/api/src/site/jobs.ts`), so the timers `reportlog-digest-hourly`, `-weekly` and
     `reportlog-feedback-digest` run them. By hand: `pnpm --filter @reportlog/api ops run digest-hourly`.
     The digests read the database's clock, not the runner's.
4. **The directory of organizations** ("Alliance" in legacy; `apps/api/src/site/directory.ts`).
   - `/organizations`: listed organizations, ranked by accepted members only, with the
     disclaimer served by the API alongside the rows. There is a link to it in the footer.
   - `/organizations/:id/listing`: an organization's managers (or an administrator) switch
     listing on or off, and are shown what appears, the disclaimer, and what leaving does not do.
     A manager reaches it from the organization's page under Access.
   - `listed` defaults to false. `listed_at` is kept across an opt-out.
   - **No logos.** They need file storage, which F is building.
5. **Guides** (`/docs`, `/docs/first-logbook`, `/docs/checking`), plain pages in the site's
   look, from the parts of legacy `docs.html` that still describe this software. The install
   half of `docs.html` was **not** ported: it describes the old application's install (npm,
   nginx, its `.env`), and the new install is H's. The old page's script (copy buttons, fill-in
   panel) served only those commands.

**Not done, as asked:** updates and the update check (legacy `updates.js`, `updateCheck.js`,
`admin-updates.js`). They depend on how H deploys.

## Legacy tests and their equivalents

| Legacy                                                                                                                 | Here                                                  | Notes                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `alliance-selftest.mjs`                                                                                                | `apps/api/test/db/directory.test.ts`                  | Check for check, plus the routes                                                                                                                        |
| `selftest.js`: "The Alliance directory says what it is not", "The listing toggle says…", "The Alliance is not chained" | `apps/api/test/db/directory.test.ts`                  | "Migration touches only organizations" became "the column defaults to false" plus a source check of `chain/` and `packages/seal`, and the boundary rule |
| `selftest.js` feedback and digest groups                                                                               | `apps/api/test/db/feedback.test.ts`, `digest.test.ts` | **There are no such groups.** The one digest check in `selftest.js` is the doctor's timer check (H's). These files test what the legacy code promised   |
| `tools/browser-tests/toggles.test.js` (the notification half)                                                          | `apps/web/test/notifications.test.tsx`                |                                                                                                                                                         |
| `tools/browser-tests/alliance.test.js`, `docs-page.test.js`                                                            | `apps/web/e2e/site-g2.spec.ts`                        | Only what still applies: the pages render and ask no third party. The docs script they tested was not ported                                            |
| `selftest.js` "The standalone docs site", "The one-file install handout"                                               | none                                                  | Not ported: no standalone docs build or install handout exists in the rebuild                                                                           |

I wrote each test file alongside its module rather than strictly before it; all were run red
during the work (a digest timing bug was found that way, see below).

## Changes outside G2's folders (all named in the commit messages)

- **Migration `20261019180450_site_feedback_digests.sql`**:
  - adds `users.is_tester`, and `organizations.listed` and `listed_at` (A's tables; none read
    into a sealed object);
  - **widens A's `role_audit_axis_check` to allow `flag`**, the axis legacy used for the tester
    flag. Every existing row still passes;
  - new tables: `feedback`, `feedback_events`, `feedback_comments`, `digest_subscriptions`.
- `apps/api/src/identity/` (A's): `SignedIn.tester`, read in `userForSession`, returned by `toMe`;
  `AuditAxis` gains `'flag'`.
- `packages/contracts/src/identity.ts` (A's): `Me` gains `tester`.
- `apps/api/src/app.ts`: two registration lines, and `ADMIN_EMAIL` added to the config it accepts.
- `apps/api/src/jobs/registry.ts` (H): the three digest jobs' `run` lines.
- `deploy/README.md` (H): the three digest rows describe the jobs.
- `.dependency-cruiser.cjs`: the seal and chain code may not reach `apps/api/src/feedback/`
  either.
- `apps/web/src/routes/__root.tsx`: the staff menu, and the directory link in the footer.
- `apps/web/src/features/identity/SessionNav.tsx` (A's): an "Email updates" link, and the
  account link now always says "Your account". It said "Access" to people who grant access,
  which duplicated the staff menu's "Access" (same page) and made A's own browser test find two
  links.
- `apps/web/src/features/identity/Organizations.tsx` (A's): a link to the listing page, for the
  organization's managers and administrators.
- New route files outside the settings folder: `routes/feedback/`, `routes/notifications.tsx`,
  `routes/organizations/`, `routes/docs/`; components in `features/feedback/` and
  `features/site-pages/`.
- `schema.gen.ts` and `routeTree.gen.ts` regenerated.

## For the other workstreams

- **D1 (moderation, board):**
  - Add your screens to the menu with one line each in
    `apps/web/src/features/staff-nav/entries.ts`, e.g.
    `{ to: '/moderate', label: 'Moderation', for: ['moderator'] }` (add `'admin'` only if
    administrators should see it: admin does not imply moderator).
  - **`boardVisible` in `apps/api/src/site/digest.ts` is my copy of "what the board shows"**
    (`valid`, not withdrawn, `may_publish`). It has no public-archive switch, because none exists
    yet. When the board has its own predicate, the digest should call it, so the two can never
    disagree. It is marked `TODO(workstream D)`.
  - The digest emails link to `/board`, the path B's front-page button already uses.
  - The digest reads `report_heads.updated_at` as "when it was published". If approving a report
    does not touch `updated_at`, approved reports will never be emailed. Please keep it moving on
    every moderation change.
- **D2 (anchor):** nothing.
- **F (files):** add your screens to `entries.ts`. Organization logos for the directory need
  your storage; nothing is built for them.
- **I (maps):** add your screens to `entries.ts`.
- **H (operations):** the three digest slots in `registry.ts` now point at `apps/api/src/site/jobs.ts` (three lines changed in your file), and the three rows in `deploy/README.md` no longer say "Not built yet". Your doctor's legacy rule (digest timers required once anybody has subscribed) can count `digest_subscriptions`.
- **A (identity):** see the changes to your files above. The tester flag has no control on the
  Access screens; it lives at `/feedback/testers`.

## Running it in a cloud container

The container starts the legacy application on port 3000 (`node server.js` in `legacy/`). The
browser suite with `CI=1` refuses to start while anything holds that port; stop it first.

## Not done

- Updates and the update check (H's deployment decides how).
- Logos in the directory (F's storage).
- The install guide (H's runbook replaces it).
- Unsubscribing from the digest without signing in. Every email says where to change it, and
  that page needs a sign-in. Legacy was the same.
