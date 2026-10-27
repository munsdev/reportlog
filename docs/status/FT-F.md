# FT-F: the free-text screens

Branch `claude/ft-f-screens` (merges `claude/ft-e-freetext`; on conflicts in `reportValues/` and the
status files it took E's side). Lean checks only: tsc web and api, eslint and prettier on changed
files, `test/filing.test.tsx`, `builder-switches`, `files` unit tests. No db, e2e or `pnpm check`.

## Built

1. **Filing cards** (`features/form/`): `HeldControls.tsx` (text box with "n / 5000", link boxes with
   "Add another link", the "Not published on the board" note, "Skip this"), `WrittenCards.tsx` (sharing
   card, address card "Needed because you wrote something", optional "manage" card), walk helpers
   (`wroteSomething`, held kinds validated with the same `@reportlog/fields` functions as the server),
   FilingForm: sharing card only when something was written; address required when written (D8) or
   optional when the logbook's optional setting is on (D20: given = held until the link is followed);
   review rows ("In your words · not published", "Vetted journalists", "Email" / "Manage link sent to
   Nobody (skipped)"); finality sentence only when no address (G7), else "You can correct or withdraw...
   original stays in the record" (D2); receipts "It's on the record", "Check your email to finish"
   (with "change the address"), "This address can't file more today" (429 `try_later`, answers kept).
2. **Moderator** (`features/moderation/Texts.tsx`): Written accounts queue (Waiting/Checked/Redacted/
   Withheld, counts), check form (Illegal asks a category and a tick), Redact page (original beside the
   copy, why, save, review by another moderator or the owner, history), `ReportWritten` panels on the
   report page (written account, link, erased markers). Sidebar line "Written accounts" with the
   waiting count; routes `/moderate/texts`, `/moderate/texts/$ref`.
3. **Desk**: `/desk/texts` "Written accounts" (search + My states), sidebar line, checked links show
   "shared in N reports".
4. **Links page**: chips "3 from tips" / "1 from a report", logbooks named beside lists, lede updated.
5. **My reports**: "What you wrote · not published" panel (words, links, check state, sharing switch
   "Vetted journalists may read it", erase with tick); sharing removed from "What you allow".
   A correction is prefilled with the held words and links (the server keeps only what a correction sends).
6. **Builder**: private kinds start from the approved label/help, link count (1 to 3), "Offer an
   optional email address" setting.

## Server changes (small, outside my folders)

- `filing/filing.ts`, `logbooks/logbooks.ts`: erasable text/links no longer make `asks_email` true on
  their own (they did via TYPED_KINDS, which made the email mandatory even when nothing was written,
  against D8). Held values now require an address (sentence) and always hold the report; a logbook that
  asks them accepts an optional address. Not covered by a db test: **integrator please run
  filing-limits, held-values and the optional-card tests.**
- Public logbook gains `contacts_delete_on` (YYYY-MM-DD) so the card can say the deletion day.

## Wording that differs from the mock-up

- Sharing card: nothing pre-selected (mock has "Yes" ticked); Next says "Choose yes or no."
- Review "What is published" note is added under the logbook's own publication terms rather than replacing them.
- Report page erased marker: no "by the reporter" (the contract carries no actor).
- Address bullets: first line joined to "Never published. A moderator can open it only with a written reason, and you are shown that reason." on both cards (the writing card adds "never shown to journalists").
- Progress/tab title still shows "(n of m)" and cards have no "Question n" label: that is U4b's frame.
- Step-label "Optional" is on the two new cards only.

## Not done

- No browser tests (lean order). Routes `moderate/texts*` and `desk/texts` untested in a browser.
- Desk restyle beyond the texts tab (J1), "Next waiting" for written accounts, filing-page no-third-party test.
- Coordinator/intake filing of held values (refused by S1).
