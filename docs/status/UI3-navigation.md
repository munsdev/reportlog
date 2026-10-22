# Interface redesign, stage 3 · Navigation: status

- **Branch:** `worktree-agent-af09f7d20d3d58f6f`, from `18e8c55` (after stage 2,
  `docs/status/UI2-components.md`). Thread A of five building the redesign in parallel.
- **State:** built; not merged. Stage 3 of six in `docs/design/README.md`.
- **Scope:** `docs/design/navigation.md` (header, menu panel, phone sheet, staff areas, area
  tabs, progress rule, footer) and `docs/design/checks.md` section 02.

## What was built

**In `apps/web/src/features/nav/` (new):**

- `SiteHeader.tsx`: one sticky `deep` bar, 56px on a phone and 64px from 768px, inside a
  1216px container: the wordmark and the Menu button, nothing else. Its 6px bottom rule is
  the brand rule or, on a filing card, the progress track. On a door it is the wordmark alone
  and asks nothing (the part that asks is not mounted). The menu closes on Close, Escape, a
  click outside it, choosing a link, and any change of address (it is open AT an address).
  Focus moves to the first link on open, is kept inside (the menu plus the Close button)
  while open, and goes back to the Menu button on close. The page behind does not scroll and
  is dimmed by a `deeper` scrim at 55%.
- `Wordmark.tsx`: the two-tone name, label face, uppercase, 15/16px, 13px under 360px,
  truncated before it can push the button.
- `MenuButton.tsx`: a real `<button>` with `aria-expanded` and `aria-controls`, "Menu" and
  three bars or "Close" and a cross, 44px. The count of reports waiting for a moderator, in
  `action` tone, said as "7 reports waiting for a moderator."
- `Menu.tsx`: `MenuPanel` (desktop: this site, staff columns, you) and `MenuSheet` (below
  768px: full height, tiles two to a row, folding staff areas with the current one open,
  then work links, your account, signed in as, Sign out). The current page has
  `aria-current="page"` and a 3px `brand-on-deep` inset edge, once. Neutral counts beside
  Queue, Tip links, List review and Feedback.
- `AreaTabs.tsx`: `TabRow` (a row of links, label face 13px, current one `ink` with a 3px
  `brand` underline; scrolls sideways on a phone with a fade while there is more, current tab
  scrolled into view), `AreaTabs` (the staff area for this address, only the pages the person
  may open, none if fewer than two), `AreaTabsFallback`, `AreaTabsSlot`, `useHideAreaTabs`.
- `progress.tsx`: `HeaderProgressProvider`, `useHeaderProgress`, `<HeaderProgress>`, and the
  `ProgressRule`. Decoration only (`aria-hidden`); the form keeps its own `role="progressbar"`.
- `waiting.ts`: the waiting query (under the `moderation` key, so every moderation screen's
  invalidation refreshes the count), the words for each total, and `usePhone()`.
- `EasierReadingSlot.tsx`: **the marked spot for the Easier reading switch** (thread E). It
  is rendered at the end of the menu's "You" row (both shapes) and at the end of the footer,
  and draws only a hidden `<span data-easier-reading>` until stage 6. Wiring the switch in is
  this one file.

**`features/staff-nav/entries.ts`** is now five areas (`STAFF_AREAS`) and two groups outside
them (`STAFF_GROUPS`: "Your organization", and Journalist desk, Feedback, Testers, Guides),
with `STAFF_ENTRIES` kept as the flat list (desks.ts and OnlyFor read it). Each page keeps its
old `for`; new pages take their route's own guard. New: `areasFor`, `groupsFor`, `entryAt`
(exact address, else the longest `under` prefix; never an alias), `areaAt`, and per page
`tab`, `under`, `hash`, `alias`, `waiting`. `/maps`, `/lists/search`, `/moderate/agreement`,
`/moderate/illegal-content`, every `/settings/*` page, `/access/orgs`, roster, audit and
`/feedback/testers` have entries for the first time.

**Deleted:** `features/identity/SessionNav.tsx`, `features/staff-nav/StaffNav.tsx`, and the
link rows in `routes/(staff)/settings/route.tsx` and `routes/(staff)/moderate/route.tsx`.

**`__root.tsx`**: the header, then the pause banner, then `<main>` with the area tabs fallback
above the page. **Footer**: two labels shortened to the spec's ("How to use", "Terms"), the
Easier reading slot at the end. **DevBadge** sits above the Save bar's published height.

**The server addition:** `GET /api/menu/waiting` (`packages/contracts/src/menu.ts`,
`apps/api/src/menu/`, one line in `app.ts`). A scope guarded once for anybody signed in;
inside it each total is present only for the people its own screen admits, by that screen's
own rule (imported, not restated): `reports` and `list_entries` for moderators and
administrators who have accepted the moderator agreement (the queue's and list review's
`moderatorGuard`), `tip_links` for moderators and administrators, `feedback` for testers,
administrators and Access Managers (`mayUseTracker`). Absent, not zero, for anybody else.
Totals only. Not in `IN_FRONT` or `FILING_CALLS`, so refused on a door; the website never asks
it there. `/api/menu/` is added to `NOT_STAFF_PREFIXES` in `invariants.test.ts` with its reason.

## Decisions taken while building, for the owner to see

1. **The Menu button's number is the queue's waiting reports only.** navigation.md lists
   list review and tip links as work too, but checks.md says the button "matches the queue's
   waiting count". The other totals are beside their pages inside the menu.
2. **Waiting totals follow each screen's guard exactly**, agreement included: a moderator who
   has not accepted a published agreement sees no queue count (the queue refuses them too).
3. **Area tabs are drawn by the frame until a page draws its own.** The spec puts them under
   each page's H1 and lede, but the H1s belong to screens threads B, C and D are rewriting. So
   `__root.tsx` draws them above the page (`AreaTabsFallback`), and a page that renders
   `<AreaTabs />` under its own heading takes the slot and the frame's row steps aside (before
   paint). **Stage 4/5 screens should render `<AreaTabs />` under their lede**; the agreement
   gate, which the moderation spec says hides the tabs, can call `useHideAreaTabs()`.
4. **The board's tabs are not built here.** They are a public screen (thread B); `TabRow` is
   exported for them.
5. **"Check a report" points at the front page's check panel** (`/#check-a-report`) until
   `/verify` exists (thread B, screens/public.md section 06). It is one line in `Menu.tsx`
   (`PUBLIC_LINKS`). The front page has no element with that id yet.
6. **"Who opened protected data"** (Records) links to `/moderate/settings#who-opened-what`, an
   alias that is never marked as the current page. Thread C may give that section the id.
7. **The main action** is "Submit a report" (to `/submit`), or the operator's first front-page
   button that goes somewhere, under the operator's label, when it is not the built-in one under
   its own name. In the seeded demo that is the demo logbook.
8. **The "Organizations" tile uses the directory's own name** ("Participating organizations"),
   as the footer does.
9. **Account links:** My reports, Email updates; "Your account" (`/access`) for people who do
   not grant access (granters reach it as Roles); "Account and security" (`/access/security`)
   for anybody who HOLDS a role, so somebody who has not proved a second factor yet (and so acts
   with no role and sees no staff page) can find it.
10. **"Report a bug on this page"** carries the route id as `from`, as the old staff bar's
    Feedback link did; "Feedback" itself goes to the tracker plainly.
11. **The header and panel use a fixed 1216px container**, not the theme's page width, so the
    bar does not move between themes or pages.
12. **The progress track jumps rather than slides**: the client-first test allows an inline
    width and nothing else, and the motion rule allows only transform and box-shadow.
13. **Every link in the menu is at least 44px tall** (the mock-up draws 38px page links).
14. **Sign out on the deep panel is the stage 2 secondary button**, not restyled.
15. **The footer keeps its one-sentence line**; "shorter" was taken as the two shortened labels.

## Files touched outside this thread's folders, and why

- `features/form/FilingForm.tsx`: one element (`<HeaderProgress percent=… />`) and its import,
  so the header's rule shows the form's progress. The in-page bar is untouched (thread B hides
  it, per screens/filing.md).
- `components/ui/dev-badge.tsx`: one class, so the badge sits above the Save bar.
- `apps/api/src/app.ts`: the import and registration of `menuRoutes`.
- `packages/contracts/src/index.ts`: one export line.
- `apps/api/test/db/invariants.test.ts`: `/api/menu/` in `NOT_STAFF_PREFIXES`.
- Browser specs whose selectors named the old bars: `site-g2`, `site-ops`, `site-pages`,
  `access-a2`, `two-factor`, `identity/access`, `owner/backups`, `files/staff`,
  `filing/intake`, `board/moderate`, `board/extras`. They go through `e2e/menu.ts` now. The
  owner's menu check is a new test in `owner/backups.spec.ts` (the only project holding the
  owner's seat); the door header check is three assertions added to `doors/doors.spec.ts`.

## Checks

| Suite                                             | Result                                                                                                                   |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| web unit (`vitest run` in apps/web)               | 420 in 39 files; one `/desk` case in `staff-guards` timed out once under load and passed on its own and on rerun (99/99) |
| api unit                                          | 469 passed, 21 skipped                                                                                                   |
| db: `menu-waiting` (own database)                 | 9 passed                                                                                                                 |
| db: `invariants`, `public-leak-sweep`, `feedback` | 59 passed                                                                                                                |
| types (web incl. e2e, api, contracts)             | clean                                                                                                                    |
| eslint, prettier on changed files                 | clean                                                                                                                    |
| boundaries                                        | no errors (the one existing `boot-guard.js` warning)                                                                     |
| browser suite                                     | **not run** (shared fixed ports); runs once after merge                                                                  |

New browser tests (`e2e/navigation.spec.ts`, both projects): the header on one row at 320,
390, 768 and 1280 shut and open with no sideways scroll; Menu by click, Enter, Space,
Escape and the scrim, focus in, kept in, returned; for visitor, reporter, moderator,
administrator, Access Manager, journalist, coordinator and tester, every page in
`e2e/navigation-table.ts` reachable (Menu, the area on a phone, the page) and no other shown,
the first page of each area followed; `/maps` for an administrator; Sign out by keyboard and
by tap at 390 wide for every signed-in role, each on a fresh account; `aria-current` once in
the menu and once in the tabs; the button's count against the queue. The table is checked
against `entries.ts` by `test/navigation-table.test.ts`, so it cannot fall behind.

Looked at by a model in a private dev server (desktop 1280 and phone 390, signed out and as an
administrator); not by a person and not on a real phone.

## Not done

- The browser suite has not run. Expect a first run to need small selector fixes.
- No count beside "Board" (the published total): there is no cheap public call for it.
- Pages do not render `<AreaTabs />` under their own headings yet (stages 4 and 5).
- `/verify`, the board's tabs, the agreement gate hiding the tabs: other threads' screens.
- No entry on `/dev/components` for the navigation pieces (the header is on every page).
- An owner who is also a journalist and an organization manager: the groups wrap; not drawn.
