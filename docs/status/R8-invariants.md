# R8 · Invariant leftovers: status

For the coordinating session. Brief: `docs/parity.md` §7, "R8 · Invariant leftovers (tests only)".

- **Branch:** `claude/r8-invariant-leftovers`, based on `ccr-c9c93698-ev856l` at `2bdfe05`
- **Pull request:** see the PR into `ccr-c9c93698-ev856l`
- **Last updated:** 2026-10-20

## Files

| File                                           | What                                                                   |
| ---------------------------------------------- | ---------------------------------------------------------------------- |
| `apps/web/e2e/third-party.spec.ts`             | I1: the pages that take a token, opened with a real one                |
| `apps/api/test/db/anchor-reset.test.ts`        | I5: the `anchor reset-marker` command itself                           |
| `apps/web/test/staff-guards.test.tsx`          | new: the walk of the staff routes                                      |
| `apps/web/e2e/a11y-locked/lock-screen.spec.ts` | new: decision 12, the lock screen with the password on                 |
| `apps/web/e2e/accessibility.spec.ts`           | the axe helpers moved out to `e2e/a11y.ts`, so both passes share them  |
| `apps/web/e2e/a11y.ts`                         | new, outside the brief's list: the shared helper                       |
| `apps/web/playwright.config.ts`                | outside the brief's list: one project, `accessibility-behind-password` |
| `docs/parity.md`                               | I1, I5, the staff-guard row and decision 12's lock screen: Equivalent  |

No feature code, migration or fixture was changed.

The new project runs after `owner` and before `in-front-of-password`, which now depends on it and
is still last. Its folder is added to the `chromium` and `phone` projects' ignore pattern.

## What each test proves

### I1 · Real tokens (`third-party.spec.ts`, "with a real token")

- **The confirmation page and every `/mine/*` page, in one test.** One report per browser project,
  because the per-client filing limit is shared with the rest of the suite.
  - It files a report through `/api/reports` and follows the link the server emailed.
  - The page is listened to in both of its states: "Confirm your report", then "Your report is
    filed" after the button is pressed.
  - It signs in as the reporter, by the emailed code, and opens `/mine/`, `/mine/<thread>` and
    `/mine/declaration/<thread>`. Each is checked by its own heading, so the real screen is the
    one listened to, not its "not found" state.
  - The test fails if the route tree gains a `/mine/*` page this list does not open.
- **The invitation.**
  - An administrator makes an organization and invites a coordinator.
  - A fresh context with no session follows the emailed link and sees "Join … as coordinator".

### I5 · The command (`anchor-reset.test.ts`, "the anchor reset-marker command")

P1 said the command's config accepts only https://, ssh:// or git@ remotes. That is out of date:
the config also accepts `file://` and absolute paths. The test uses the form a real deployment
would anyway:

- **The setup:** `https://anchor:<token>@log.example.org/owner/log.git`. Git's `insteadOf`, passed
  by environment, points that address at the test's bare repository.
- **How it runs:** `node src/anchor/cli.ts`, in its own process, with only `PATH`, `HOME`,
  `DATABASE_URL`, the `TRANSPARENCY_LOG_*` settings and the git setting.
- **What it proves:**
  - With no `--reason`, the command exits 1 with the usage line. With a reason that is too short,
    it exits 1 and names the reason. Neither publishes anything.
  - A real run exits 0 and prints `Published resets/<today>.json: 1 anchor(s) no longer
reconcile.` and `pushed to remote 1 (log.example.org)`. The token is never printed.
  - The published file is the record's exact bytes. It names the voided anchor, the old and new
    heads, the reason and the count.
  - The anchor already in the log is byte for byte as published. The old head is an ancestor of
    the new one. The only change is the one added file.
  - Run again the same day, it exits 1 with "never replaced", prints no token, and leaves the log
    unchanged.

### The staff routes (`staff-guards.test.tsx`)

- **The set** comes from the real route tree. Every page (a route with no children) must be
  decided:
  - a page in the `(staff)` group is a staff screen unless `OPEN_IN_STAFF` names it, with a
    reason;
  - a page outside the group must be in `STAFF_ELSEWHERE` (`/feedback/`, `/feedback/testers`) or
    in `OPEN`.
  - A new page fails until somebody decides which it is. A name in any of these lists that no
    longer exists also fails.
- **Open in the group, and why:**
  - `/access/sign-in`: signing in is how anybody becomes staff.
  - `/access/invitation/$token`: the invitee reads the invitation before they have an account.
  - `/access/`: every signed-in person's own "Your account" page. Its staff parts show only to
    those who grant access.
- **The walk:** each staff screen (37) is rendered by the real router twice, signed out and
  signed in with no role.
  - `StaffOnly`, `OnlyFor` and `ReviewersOnly` are wrapped with `vi.mock`, so each one marks
    where it stands.
  - The "Sign in first" or "Not for this account" heading must be inside one of them, and it must
    be the only level-1 heading on the page.

### Decision 12 · The lock screen (`a11y-locked/lock-screen.spec.ts`)

axe, with the same rules and helper as the walk of every page. The site password is turned on
through `filing/dev-state.ts curtain`. Each state is checked at desktop width (1280) and phone
width (412):

1. the bare lock screen;
2. with the site's name, the operator's paragraph, the development badge and a logbook door
   listed under "Open without the password";
3. the development notice open (a dialog);
4. after a wrong password, with the alert "That is not the password." showing.

`afterAll` turns the password off and puts back the name, the paragraph, the badge and the demo
logbook's door.

## Planted violations

Every plant was reverted with `git checkout`. None is in the branch.

| Plant                                                                                 | Went red                                                                                                              |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `<img src="https://example.org/…">` on the confirm page's "Confirm your report" state | "with a real token" confirmation test, chromium and phone. The old "names nothing" walk of the same page stayed green |
| The same on `InvitationPage` once an invitation is found                              | the invitation test, chromium and phone. The old walk stayed green                                                    |
| The same on the signed declaration                                                    | "/mine/declaration/<thread> asked another host"                                                                       |
| `cli.ts` prints the configured remotes after a push                                   | the command's publish test (the token appeared)                                                                       |
| `cli.ts` exits 0 from its catch                                                       | the refusal test and the same-day test                                                                                |
| `cli.ts` publishes under a fixed date (already published) instead of today            | the command's publish test                                                                                            |
| `StaffOnly` removed from `/backups`                                                   | `/backups`, both states                                                                                               |
| `ReviewersOnly` removed from `/lists/review/`                                         | `/lists/review/`, both states                                                                                         |
| `StaffOnly` added around `AuditPage` (a gap fixed)                                    | "/access/audit is still a known gap (remove it from KNOWN_GAPS…)"                                                     |
| `/about` taken out of `OPEN`                                                          | "every page is decided"                                                                                               |
| `<img>` with no `alt` on the lock screen                                              | "bare, desktop": `image-alt (critical)`                                                                               |

The first try of the declaration plant went red for the wrong reason. That run used `--no-deps`,
so the lock-screen project ran at the same time and turned the password on. Run alone, the plant
went red as above. In the real suite the projects are serialised by their dependencies.

## Gaps found

**Three staff screens have no door.** I reported this to the coordinating session when I found
it.

- **Which:** `/access/audit` (`AuditPage`), `/access/orgs/` (`OrganizationsPage`) and
  `/access/orgs/$id` (`OrganizationPage`), all in `apps/web/src/features/identity/`.
- **What happens:** each checks only that somebody is signed in, using a bare `SignInPrompt`. So a
  signed-in account with no role is shown the staff screen ("Who changed what", or the
  Organizations page with its form for making one), and the data calls then fail with 403.
- **Nothing leaks:** the server refuses those routes (`requireGranter`, `requireOrgAuthority`). It
  is the courtesy that is missing.
- **In the test:** per the brief, their walk is `skip`ped, with the reason in `KNOWN_GAPS`. A test
  checks that each gap is still open, and fails once a door is added, so the entry is removed with
  the gap.
- **The fix, in A's folder:** wrap the first two in `StaffOnly needs={['admin',
'access_manager']}`. Wrap `orgs/$id` in `OnlyFor` with the `organization` audience plus the
  granters, because a manager with no system role may open it.

## Totals

All three suites were run here (not on CI) on this branch. `origin/ccr-c9c93698-ev856l` had
nothing new to merge (`2bdfe05`).

| Suite                                       | Result                                                                                                                                                                             |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check`                                | passes: format, lint, types, boundaries (663 modules); unit tests fields 69, seal 31, access 6, api 386 (+17 skipped, not R8's), web 549 (+6 skipped: the three gaps × two states) |
| `pnpm test:db`                              | 68 files, **1026 passed**                                                                                                                                                          |
| Browser suite (`CI=1`, `CHROMIUM_PATH` set) | BROWSER_RESULT                                                                                                                                                                     |

R8's own tests:

| File                              | Tests                                                                                         |
| --------------------------------- | --------------------------------------------------------------------------------------------- |
| `anchor-reset.test.ts`            | 8 passed (5 before, 3 new)                                                                    |
| `staff-guards.test.tsx`           | 72 passed, 6 skipped: the floor, 3 known-gap checks, 37 staff screens × 2 (3 screens skipped) |
| `third-party.spec.ts`             | 2 new per browser project (chromium, phone)                                                   |
| `a11y-locked/lock-screen.spec.ts` | 3 passed (4 states × 2 widths)                                                                |
