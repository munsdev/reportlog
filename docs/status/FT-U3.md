# FT-U3: the staff shell and the moderation pages

Branch `claude/ft-u3-staff-shell`. Built against the existing `--rl-*` tokens
and Tailwind names (`bg-deep`, `text-on-deep`, `border-line`, ...): U1's
`TOKENS.md` was not there when I built, so nothing here names a U1 token.

## What I built

- **The shell** (`features/nav/StaffShell.tsx`), to the mock-up's `staff_chrome`:
  top bar with wordmark, solid Staff badge, "View the public site" (from 900 px),
  account chip (initial and "Account"; the label drops below 520 px) and Menu
  below 900 px. A 240 px sidebar beside the page from 900 px, sticky; below it a
  full-screen dark dialog ("Staff menu") with its own Close, two columns from
  700 px, and "View the public site" and Sign out at the foot. Escape, Close or
  following a link shuts it and focus returns to Menu; focus is trapped inside.
- **The sidebar groups** are `STAFF_GROUPS` and `STAFF_AREAS` in
  `features/staff-nav/entries.ts` (still the one place to add a line), in the
  mock-up's order, shown only for what the person may open. Waiting counts sit
  beside Reports queue, Links, List entries and Feedback queue as before.
- **Labels now as in the mock-up**: Your dashboard (was Overview), Signing in
  (was Account and security), Links (was Tip links), Find somebody's entries,
  Filing for an organization (was Intake), Your alerts. The "Account" row of the
  You group is gone (the mock-up has none); the account chip reaches it.
- **`StaffPage`** is now the mock-up's `spage` head (eyebrow, title capped at
  2.4 rem, lede, actions, `tabs` slot, `area` for "Account" / "Your
  organization" eyebrows). `StaffHead` (moderation) has the same measures.
- **Moderation pages**: Reports queue (title and lede, status pills, search with
  placeholder and visually hidden labels, filled Decide here beside an outlined
  Open); a report's page (reference, back link, meta line, chips, in the
  mock-up's order); Links and List entries titles; dashboard with a figures row
  and the Account eyebrow; intake pages carry the Your organization eyebrow.
- `MENU-FOR-U2.md` (repository root of this worktree, uncommitted by design:
  copy it for U2) says what the public menu must show.

## Decisions

- **Breakpoint 900 px** for the staff drawer (the mock-up's), not the public
  menu's 768. `useNarrow` in StaffShell; e2e `staffNav` follows it.
- **The account chip stays a dropdown** (My reports, Email updates, Your
  account, Account and security, Sign out) instead of the mock-up's plain link,
  so Sign out is reachable on a desktop and every existing test keeps its way
  in. On a phone Sign out is also in the drawer foot, as in the mock-up.
- Pills and badge use `rounded-pill`, which falls back to the look's small
  radius in looks that have no pill radius: U1's look decides, not me.
- Staff pages that U5 owns (account, desk, organization, the rest) get the new
  frame and sidebar through the layout and are otherwise untouched.

## Wording that differs from the mock-up

- Front page: the mock-up says "Front page and pages"; mine "Front page" (no
  pages screen exists yet).
- Written accounts (Review and Journalist desk): left out until their pages
  land (M1, J1); add one line each in `entries.ts`.
- Links lede: mock-up "Links from the tip line and from reports"; mine says tip
  line only until S2 files report links.
- Flood screen lede kept as the code has it (it says every switch use is
  recorded and shown publicly); the mock-up's is shorter.
- Dashboard figures: three (reports, links, list entries waiting). The
  mock-up's "oldest waiting" and "published" need numbers the menu totals do not
  carry, so they are not shown.
- "Sign out" and the chip dropdown, as above.

## Not done

- The report page's right column panels, the flood screen, illegal content,
  files, entries and intake screens keep their current inner layout (it already
  follows the mock-up's structure); only their head, titles and eyebrows moved.
  Written-account, link and redaction blocks on the report page belong to M1/S2.
- Search button inside the input's box (mock-up) is a button beside it.
- `AreaTabs.tsx` is unchanged (no area tabs exist any more; it serves page
  sections).

## Tests

Unit: `test/staff-nav.test.tsx`, `intake-nav.test.ts` updated for the labels.
Browser: new `e2e/staff-shell.spec.ts` (desktop sidebar, phone dialog with
focus, Escape, Close, link; moderator and journalist see only theirs; sweep of
every page the administrator and the moderator may open, no sideways scroll).
`navigation.spec.ts`, `navigation-table.ts`, `menu.ts`, board, links, intake and
desk specs follow the renamed labels and the 900 px breakpoint.

Suite totals: see the end of this file.

## Suite totals (final tree, run through heavy.sh)

- `pnpm check`: format, lint, types and boundaries green. The first unit run had two real failures (the drawer unit test and `team.test.ts` still named the old labels); both fixed, and those two files rerun alone: 59 passed. Other packages: seal 46, fields 123, contracts 39, access 13, api 527 passed.
- Browser suite, whole: 1213 passed, 12 skipped, 1 failed. The failure was `staff-shell.spec.ts` "moderator: sidebar" on the phone project, a menu press lost while the machine was busy (it passed alone, twice). The test now presses until the drawer is there; the whole spec rerun alone: 12 passed, 2 skipped by design. The other 1213 ran against the earlier version of that one spec only.
- `pnpm test:db`: 96 files, 1476 passed. I changed nothing in `apps/api`.
