# FT-C: public pages, board, filing cards, lists, token pages (restyle to the mock-up)

Branch `claude/ft-c-public`. Built on the integration branch with the public and staff shells.
Lean testing: tsc, eslint and prettier on changed files, and the unit tests of the files touched
(filing, public-and-filing, site-pages, lists, verify, lock-screen, door-quiet, gate, staff-guards,
follow-band, notifications, files, maps, ui). The browser suite, `pnpm check` and `test:db` were NOT run.

## Built
- `components/ui/band.tsx`: BandPage (full-width band, wrap), BandTabs, TwoCol, AsideCard, Prose, SecHead, Steps.
  The root frame (`routes/__root.tsx`) now wraps the page in `.rl-pad`; a page whose root has `data-bleed` removes
  that padding (`styles.css`), so every other page is unchanged.
- `PublicPage` has two shapes: `variant="band"` (About, How, Legal, Terms, Standards, For journalists) and the
  default `plain` (eyebrow, title, narrow column) which every email-link page and form already uses.
- Pages: About, How (tabs in the band, "On this page" and "Check a report" cards), Legal/Terms/Standards,
  For journalists (sections, side cards, Follow band), NEW `/get-involved` (Follow band on top, one card per open
  list from `/api/lists`, address copy box; `get-involved` added to RESERVED_SLUGS), board (one band on every tab,
  report cards are links, Numbers as bars, Activity tab added), report page (band, key/value answers, share and cite
  cards, technical details), verify (band, result box, visible checks), door (box on the deep ground).
- Filing: step label "Question n" and a visible progress bar inside the card (header rule no longer driven from
  the form), tab title "(question n)", cover as one bordered box with the three-step list, list cover shows
  Published / What we ask / How long kept from the list's own settings, receipts moved to `form/Receipts.tsx`
  (reference card, steps, Follow band), confirm page (reference card, Follow band), chooser `/submit` as link cards,
  list "Sent. Thank you." with steps and Follow band.

## Wording that differs from the mock-up (code honest)
- Verify lead: "This page fetches the report's sealed record and recomputes its fingerprint in your browser, then
  compares it with the chain" (mock: "Nothing is sent to us"; the reference is sent to fetch the record).
- Board: h1 is "Reports" on every tab; tab labels List / Numbers / Maps / Activity / Press pack (mock: "By state",
  maps are the operator's own); no "published / states / today" figures (decision 36: no bare total).
- Report page: no "Confirmed by a moderator" chip (the public report carries no such state); origin label shown.
- Sign-in keeps the h1 "Sign in" (mock "Your email first"). Check-email heading "Check your email to finish".
- Filed heading "Your report to "X" is on the record".
- Get involved has no invented steps or share posts: only the lists the operator opened and the site address.

## Seams for F1 and others
- New filing cards (text, link, sharing, email, review with writing): use `CardFrame` (`stepLabel="Optional"` etc.)
  and `CardBar`; the step count comes from `FilingProgress question={n}` set by the form. `Receipts.tsx` is separate.
- `UnpublishedNote({ text, links })` in `features/board/BoardReport.tsx` is written and not wired: the public report
  contract has no flag for a written account or link yet. Wire it into `ReportBody` when it does (D10).
- Cover header background: `Cover` and `BandPage` use plain bordered boxes; wrap in the look system's MotifHost and
  swap `BandTitle` for FitHeadline (one place each) when worker B's components land (not in this branch yet).

## Not done
- Activity, Press and Maps tab contents keep their existing cards (only the frame and heading changed).
- Setup wizard and sign-in keep their layouts (already one question, progress rule, two-step panel).
- No new browser tests; e2e edited where text moved (board, submit, voting-log, verify, card-frame, door).
