# Interface redesign, stage 4 · Public and filing screens: status

- **Branch:** `worktree-agent-a3b88069778d83b60`, after stage 2 (`18e8c55`, `docs/status/UI2-components.md`).
  Built beside stage 3 (navigation) and stage 5 (staff), which run in parallel.
- **State:** built; not merged. Stage 4 of six in `docs/design/README.md`.
- **Scope:** every screen in `docs/design/screens/public.md` and `screens/filing.md`, phone first,
  and the two small server additions they name.

## What was built

**Filing** (`features/form/`, `features/lists/`, `features/files/`, `features/flood/`, `routes/submit.tsx`)

- **`CardFrame.tsx`**, the frame every filing card wears: the logbook as the eyebrow, the question
  as the page's `<h1>` in the section size (focused on every card change), "Optional.", help, the
  error (a sentence with a mark, `role="alert"`, and it takes focus), and **`CardBar`**: Back a
  third and Next two thirds, fixed to the bottom of a phone's screen above the keyboard
  (`visualViewport`, as a CSS variable), under the card on a desktop. Next is never disabled.
- **The progress rule** is published by `useFilingProgress()` (and as `data-filing-progress` and
  `--rl-filing-progress` on `<html>`) for the header to draw. The page keeps a visually hidden
  `role="progressbar"`. The thick in-page bar is gone.
- **The tab title** is restored: "How did it go? (2 of 8) · ElectionLog", counted against the cards
  still possible; the opening card is the logbook's title, the review "Check your answers".
- **The opening card**: eyebrow "File a report", the title, the blurb, **the emergency notice**
  (`HelpNow`), "What happens next" in three numbered lines (the second follows `asks_email`), Start,
  "How to use {site}", and "Sealed and timestamped on arrival."
- **Question kinds**: "Tick everything that applies." when the wording does not say it; a date's
  format and a date-and-time's clock spoken in the help; `inputmode`/`autocomplete` per kind; a
  "312 of 500" count once half the room is used; long text at least six lines, growing with its
  words; the county list says it follows the state.
- **Publication card**: "Loading the wording…", and "Try again" in a serious alert if it fails.
- **Review**: rows with the question in the label face, "Not answered" for an optional blank,
  Change on the right, the statement as a choice card, `send_note`, then a deep panel with the line
  that must not be missed. "Send report" says "Sending…"; problems are a focused serious alert
  above the bar.
- **Receipts**: "Your report to "{logbook}" was received" (quiet, a tick and "Done", never teal) or
  "Check your email"; the tip offer as a secondary `lg` "Send a link"; "Back to the front page" and
  "See the live board".
- **Closed, scheduled, paused, switched off, missing** (`FormNotice.tsx`, `PausedForm`): the same
  column, a quiet or deep panel, and links to the front page and the board.
- **`/submit`**: the entry card on the frame; "Next" (was "Continue").
- **Lists** (`/list/:slug`) on the same frame, with progress and tab title. The tip card: each row
  a plain panel "Link 1", "Link 2 (optional)"; "What kind of thing is it?"; side by side on a
  desktop; errors name the row ("Link 2 has no type. Choose what kind of thing it is.").
- **Confirmation link**: every state in a 640px column with the logbook as the eyebrow; the expiry
  in mono; "Filing…"; preparing files each marked "Preparing"; an expired link offers "File it
  again"; a public report "See it on the board" and "Check it has not been changed".
- **Evidence**: H1 "A moderator asked for evidence", the reference in mono, the request in a quiet
  panel, each file's line "Uploading, 40%" / "Preparing" / "Ready", and a sentence under Send saying
  how many are still preparing.
- **Erase**: H1 "Erase your contact details", what it does not do in a deep panel, the statement as
  a choice card, "Erase my details" as a secondary button.

**Public** (`routes/`, `features/board/`, `features/site-pages/`, `features/journalists/`, `features/platform/`, `features/identity/LockScreen.tsx`)

- **Front page**: eyebrow, headline, lede; the ways in full width and stacked (blurb as a second
  line; the board's carries the published count; **the alerts button is drawn again**, to
  `/journalists/alerts`); the meta line; `home_intro`; the emergency notice; the map; "Check a
  report" in a quiet panel. Seven columns to five on a desktop, by grid placement only.
- **Board**: "Live report board", Submit, tabs (`BoardTabs`), search on Enter or its own button
  (decision 59), "Filter" with a count opening a dialog (a sheet on a phone) holding only the
  operator's filters, removable tag chips and "Clear all", the mono count line (`role="status"`),
  report cards in two columns on a desktop (reference in the panel heading, origin / "Via …" /
  "Corrected" / "Archive note" tags, answer pills, the reporter's words clamped to four lines),
  pagination, "Download these (CSV)", the counts-only panel, empty states, and "Publishing is
  paused" in a deep panel.
- **The board's other tabs** on the same frame: numbers as panels of key-value lists with "Not
  answered" last; activity tables that scroll inside their own box; the press pack as rows with
  Download and a missing file said in its row.
- **One report**: back link, the logbook as eyebrow, the reference as a mono H1, filed time and
  tags, "What the reporter said", files, the archive's note in a quiet panel, "Check it has not been
  changed" with "Check this report". Not public, counts-only and unknown read the same.
- **Verify**: the bare **`/verify`** form (new route); `/verify/:ref` with the verdict in a deep
  panel (words first, which check failed named), the four checks, the timestamp sentence, the
  fingerprints with Copy, "Check it yourself" with the genesis and a shell recipe, and "Check
  another" under everything.
- **About, How, Standards, Legal, Terms, Public API** on `PublicPage` (eyebrow, H1, lede);
  numbered eyebrows in the label face; About's divide "Part two · what you can check yourself";
  unwritten legal text in a quiet "Not written yet." panel; the API's addresses with Copy.
- **Organizations**: the disclaimer as a quiet panel above the rows, rows as raised panels, an
  empty state; the listing switch as two choice cards, a preview, Save and a toast.
- **Journalists**: sign-up with the searchable `StatesPicker` ("All states" first, "3 states
  chosen"), "Joining gives you no access to anything." in a quiet panel, "Join the list"; changing
  alerts with the same picker and "Save"; leaving asks in a dialog first.
- **Illegal content**: busy "Sending…"; the status page's decision in a quiet panel, never teal.
- **Lock screen**: the whole screen deep, a 26rem column, the two-tone name, the operator's
  paragraph, the password field, "Continue" (`lg`, "Checking…"), "That password is not right." with
  focus back on the field, and the doors under a rule as 44px links ("File a report: …"). The look
  comes with the password check (decision 60), as the gate already painted it.
- **Not found**: `NotFoundPage` in `features/site-pages/NotFound.tsx`, built and tested, **not
  wired in**: `routes/__root.tsx` belongs to the navigation stage.

**Server**

- **`help_now`** (decision 62): a new wording slot with the owner's shipped words. Not optional and
  no figures (it is shown on doors). Saving it empty goes back to the shipped wording, as every
  slot does, and the table refuses a blank body, so no stored value can make it vanish. It is also
  sent with the logbook's own form call (`getPublicLogbook` gains `help_now`), because a door may
  not ask for the site's wording.
- **An expired confirmation link** now carries its logbook's slug, so the page can offer to file
  again.
- No migration.

## Decisions taken while building, for the owner to see

1. **Send pressed before the door's puzzle is solved is kept**: the button says "Sending…" and the
   form goes the moment the door is ready (`useSendWhenReady`). Before, the button was disabled
   with a status line; "Next is never disabled" now holds for Send too. A failed door drops the
   press and says so.
2. **An empty row of the tip card is not sent** (filing.md §08). The browser test that expected
   `{ url: '', type: '' }` in the middle now expects two rows. Rows keep their order.
3. **The states picker's search applies on Enter or its Find button**, not as somebody types:
   decision 59 says nothing on the site filters as you type, and account.md's "filter field" is
   read that way.
4. **The character count appears once half the room is used**, as the spec's rule says; its
   example ("212 of 500") is under half.
5. **On a door, links to the front page, the board and How to use are not drawn** (receipts, the
   form notices, the opening card): all three are behind the password and would lead only to it.
6. **The lock screen keeps an `<h1>`** "This site needs a password", small and in the label face
   under the name (the mock-up has none; a page needs one), and the field keeps the label "Site
   password".
7. **"That password is not right."** is the page's own sentence for a 401; any other failure shows
   the server's.
8. **The board's tabs are local** (`BoardTabs` in `BoardFrame.tsx`) until the navigation stage's
   `AreaTabs` exists; then they should become a use of it.
9. **The CSV button is drawn twice, one hidden by width** (beside Submit on a desktop, under the
   list on a phone), because the two places are in different parts of the page.
10. **A filter question with six options or fewer is choice cards** in the dialog, a longer one a
    select, each with "Any answer".
11. **The front page's board count** is the board's own first page's total (listed reports; a
    counts-only logbook's are not in it), from the same request the board makes.
12. **The report page shows its chain hash as "Its link in the chain"**, which is what
    `PublicReport.chain_hash` is, so the printed page carries a fingerprint.
13. **The erase and evidence buttons are disabled until they can act**, each with a sentence
    beside it saying why (components.md allows that). The listing switch's Save says "Nothing
    changed yet." the same way.
14. **The listing page's toast** has its own `ToastProvider`, since none is mounted at the root.

## Touched outside this stage's folders, and why

- **`apps/web/src/lib/utils.ts`** (shared): `cn` now tells tailwind-merge about the site's own
  utilities. Without it, every button lost its outline (`border-control` was dropped beside
  `border-ink`), every quiet button kept the hard shadow (`shadow-raised` beat `shadow-none`), and
  `Lede` lost its size (`text-lede` beside `text-ink-alt`). Found by a screenshot; checked by
  computed style. It changes how buttons look on every page, as components.md always said they
  should.
- **`components/ui/prose-section.tsx`**: the numbered eyebrow in the label face, the contents list
  as a quiet panel, scroll margin for a sticky header. Used only by public pages.
- **`features/journalists/AlertSettings.tsx`**: its `SettingsForm` is shared with the desk
  (`DeskAlerts`, account.md, stage 5). The states picker and "Save" therefore change on the desk
  too; `DeskAlerts` itself is untouched. `e2e/journalist-desk/desk.spec.ts` follows the rename.
- **`packages/contracts`** (`site.ts`, `logbooks.ts`, `filing.ts`): one slot key and two response
  fields, added only.
- **Specs in other areas** updated where these screens' words changed: identity (lock screen),
  board-maps, journalist desk.

## For the other threads

- **Navigation (A):** draw the header's progress rule from `useFilingProgress()` (or the
  `data-filing-progress` attribute and `--rl-filing-progress` on `<html>`); wire `NotFoundPage` as
  the root's `notFoundComponent`; replace `BoardTabs` with `AreaTabs` when it exists.
- **Settings (D):** the words page offers "Insert a number" for every block slot but the lock
  screen's; `help_now` refuses figures too, so it should be left out there as well. Consider saying
  on that slot that saving it empty restores the shipped wording.

## Checks

| Suite                                 | Result                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| web unit (`vitest run`)               | 390 passed in 39 files (stage 2 left 372)                                                                                                                                                                                                                                                                                                          |
| api unit                              | 470 passed, 21 skipped. `deploy-install.test.ts` timed out once under load and passed alone                                                                                                                                                                                                                                                        |
| `pnpm test:db`                        | 1374 passed in 90 files (one new). One unhandled "terminating connection due to administrator command" from `copies.test.ts`, which passes alone; not touched here                                                                                                                                                                                 |
| typecheck, lint, Prettier, boundaries | clean (the boundary check's one warning, `public/boot-guard.js` orphaned, was there before)                                                                                                                                                                                                                                                        |
| browser suite                         | **not run** (shared ports; it runs once after merge). Specs updated for every changed word, and `e2e/filing/card-frame.spec.ts` added: the opening card, an error that takes focus, page and browser Back keeping answers, the absent-key rule on what is sent, the tab title, the fixed phone bar, the review, and `/verify` asking no other host |

**A smoke check, not a suite:** the built site against a throwaway database, at 390px and 1280px,
in Desk, ElectionLog, Evening News, Green Screen and High contrast: 26 public and filing addresses
each, plus a walk through a form. No axe violation (WCAG 2.0 to 2.2 A and AA), no page scrolling
sideways, no request to another host, no script error. Screenshots were looked at by a model, not a
person.

## Not done

- **The front page's map figures** are still drawn inside `HeatMap`, not as a separate figures panel
  beside "Check a report" on a desktop.
- **The lock screen and not-found page** need the navigation stage's root to show them as specified
  (no header on the lock screen is already so; not found needs wiring).
- **Fixed bar above the phone keyboard**: not tried on a real device.
- **The journalist access form's fields** still use the identity screens' `TextField`, restyled
  there in stage 5.
