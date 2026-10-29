# REPORTLOG DESIGN

## M O D E R A T I O N

**The queue, one report, and every screen in the Moderation area**

21 October 2026 · `features/moderation/`, `features/flood/`, `features/lists/` (review and link checks), `features/files/staff/`, `features/platform/ContentNotices.tsx` · canvas boards "Moderation queue · desktop", "Moderation queue · phone", "Moderation · one report · desktop", "Moderation · one report · phone"

---

### 01

### W H A T T H I S A R E A M U S T K E E P

**Every guard in the code today stays exactly where it is**

**THE RULES**

- A decision is a new row. Nothing on these screens edits or deletes a report; "Change the decision" records another decision on top, and the page shows the history.
- Nothing is public until a moderator approves it. No screen here has a path that publishes without a recorded approval.
- "Who filed it" (Tier B): every look asks for a written reason and writes an `access_log` row before anything is shown, behind a step-up. Moderators and administrators may look, as the server guard already allows (decided by the owner, 22 October 2026).

**DECIDED: WHO MAY OPEN TIER B**

Moderators and administrators, which is what `moderatorGuard` in `apps/api/src/moderation/agreement.ts` already admits to `openReportContact`. The owner decided this on 22 October 2026 (decision 58). No server change. The older wording "Tier B is moderator-only" in the project's instructions is out of date; every other part of that rule stands: a written reason, a step-up, and an `access_log` row for every look.

- Serious red and confirmed teal appear only as status chips. No button, link or "you are here" marker wears them.

**THE GUARDS**

- The agreement gate (`AgreementGate audience="moderator"` in `moderate/route.tsx`) still wraps every Moderation page except Agreement and Moderation settings. A moderator meets the agreement only through that gate; the Agreement page is administrators' (section 10).
- Step-up (decision 50, `docs/plan-e.md`) before: opening a reporter's or tipster's email, pausing intake, the puzzle switch, bulk decline, publishing an agreement. Ordinary decisions never ask again.
- Nobody overwrites a decision they never saw. Every report the queue hands out carries `seen` (the head's `revision`, which a database trigger moves on every change); decide, take off, put back, batch approve and bulk decline send it back, and the server refuses one whose report moved since (409 `changed`, "maria@… approved it after you opened it. Nothing you sent was recorded."), under the head's row lock. Batch and bulk skip such a report and act on the rest. A note revision sends the version count it was shown (`based_on`) and is refused the same way. `moderation/queue.ts`; `moderation-concurrency.test.ts`.
- A bulk decline sends no email to anybody (decision 51). A single decline tells the reporter one reason from `REJECTION_REASONS`, in those words, and never the moderator's own note.
- Declined reports are counted in public by reason only (decision 52). Counts-only logbooks show no single report in public and say "counted", never "public" (decisions 53 and 54).

**THE AREA TABS**

Queue · Flood screen · Tip links · List review · Illegal content notices · Files · Agreement · Moderation settings, as `AreaTabs` (navigation.md section 05). They replace the link row in `moderate/route.tsx` and give the tab row its missing "you are here".

---

### 02

### T H E Q U E U E , / m o d e r a t e

**Work through reports without leaving the list, or open one to read it closely**

**HEAD**

Eyebrow "ReportLog · Staff", H1 "Moderation", lede "Nothing is public until it is approved here. A decline tells the reporter one reason from the fixed list.", then the area tabs. If the public archive is switched off, the existing Alert sits under the lede, in the `deep` panel.

**STATUS BUTTONS**

A row of secondary buttons with `aria-pressed`, one per value of `QueueStatusFilter`, each with a neutral `Count`: Waiting (`pending`), Approved (`valid`), Declined (`invalid`), Unclear (`unknown`), Withdrawn (`withdrawn`), All (`all`). One is pressed at a time; Waiting by default. They replace the "Showing" select. On a phone the row scrolls sideways inside the gutter, as `AreaTabs` do.

**SECOND READ IS NOT A STATUS**

"Waiting for a second read" is the separate `flagged` filter and combines with any status. It is a separate toggle button after the status row, visually set apart by a gap and a different label ("Only second reads", `aria-pressed`), with `open_flags` as its count. It never sits among the status buttons.

**SEARCH, FILTER, SORT**

- Search: one field, "Search words or a reference", applied on Enter or with the field's own Search button, never on each keystroke (decision 59: the same rule as the public board). The address updates (`?q=`) so the filtered queue can be bookmarked and Back works.
- Filter: a secondary button with a neutral `Count` of filters on. It opens a panel (a `Dialog` on a phone, a panel dropping under the row on desktop) holding every filter today's form and the query take: logbook, severity (including "nobody has rated it"), arrived from and until, place (state or county code), identical answers (`answer_set`), lane (filed by an organization or through the open form), organization, and the second-read toggle again for keyboard users. Actions: "Clear all" (quiet, left), "Cancel" and "Apply" (right).
- Sort: Oldest first (default for Waiting), Newest first. The query already takes `sort`.

**NEW API THIS NEEDS**

Today's `GET /api/moderation/reports` returns the reports for one status and `open_flags`; it has no counts per status and no pagination. The status buttons need a count for each `QueueStatusFilter` value under the current filters (search, logbook, severity, dates, place, answer set, lane, organization, flagged), and the list needs pagination (a page or cursor, and a total). Both are new: either fields on this response or a sibling counts call. Until they exist, the buttons show without counts and the list shows what the call returns today.

**COUNT LINE**

Mono, `aria-live="polite"`, under the tools: `7 waiting · 1 filter: arrived today · oldest first`. It always names the filters in force in words.

**SELECTING AND BATCH ACTIONS**

Each row has a checkbox (`ChoiceCard` control style, 44px target, `aria-label="Select RL-…"`). When one or more are ticked, a `deep` bar appears above the list: "2 selected", a "Select all 7" link, then "Approve selected" (primary) and "Decline selected…" (secondary on deep). On a phone the bar sticks to the bottom of the viewport.

- Approve selected: one approval row per report, no reason asked (as `batchApproveReports`). Up to `MAX_BATCH` (100); above that the button says "Approve the first 100".
- Decline selected…: opens a dialog: "Decline 12 selected", the reason select from `REJECTION_REASONS`, the sentence "Nobody is emailed when you decline in bulk.", and "Decline 12" as the dialog's action. Step-up first.

**A ROW**

Raised panel, theme panel heading off (rows are too many for title bars). Inside: checkbox; chips (Waiting or the current state; Serious if a severity is set, as status; Second read and Organization as `tag` chips); one line summarising the answers in words, never codes; mono meta: reference, logbook, arrived time, "open form" or the organization's name. On the right (under, on a phone): "Decide here" (secondary) and "Open" (quiet link to `/moderate/:threadId`).

**DECIDE HERE**

Pressing it opens the row in place (`aria-expanded` on the button) and shows exactly the report page's Decide form (section 03). Only one row is open at a time; opening another with an unfinished form asks first. After "Record the decision" the row closes, collapses out of the Waiting list with a toast ("RL-4HT8-0QNC approved."), and focus moves to the next row's "Decide here".

**BELOW THE LIST**

Pagination, then the existing "Across the published reports" corroboration panel as a `quiet` panel.

**EMPTY**

`EmptyState`: "Nothing waiting" and "New reports appear here as they arrive. This page does not refresh by itself; reload to check." (or, if live refresh is built, drop the second sentence).

---

### 03

### O N E R E P O R T , / m o d e r a t e / : t h r e a d I d

**The decision first, everything else as closed rows that show what is set**

**HEAD**

"Back to the queue" (quiet, keeps the queue's filters), eyebrow "Logbook title · waiting 41 minutes", H1 the reference in the mono face, chips: state, "Not public" or "Public" (`tag`), Second read, Withdrawn by its reporter.

**DESKTOP LAYOUT**

Two columns, 7 to 4. Left: "What the reporter said" (raised panel, `KeyValueList`, answers by label and in words), the files (section 04), "The record" (quiet panel: a mono line per event, oldest first: sealed, via whom, each decision with who and why, each correction). Right: the Decide panel, `position: sticky; top: 88px`, then the closed rows.

**PHONE LAYOUT**

One column in this order: head, What the reporter said, files, closed rows, The record. A bar fixed to the bottom on `deep`: "Approve…" (primary) and "Decline…" (secondary). Each opens a sheet holding the Decide form with that choice already made. "Unclear for now" is inside the sheet.

**THE DECIDE FORM** (the same here and in the queue's "Decide here")

- Three choice cards, one question: Approve ("Publishes the text. Files only if the reporter allowed it."), Decline ("The reporter is told one reason from the list."), Unclear for now ("Stays out of the public archive; you or another moderator decide later."). The choice is the first thing on the form, so the reason field appearing under Decline is a change below the answer just given, not above or around it. (The one-question rule binds filing cards; staff forms follow it as closely as this.)
- When Decline is chosen: "The reason the reporter is told", a select of `REJECTION_REASONS`, with the help "They are emailed this reason and a link to the terms, if their address can still be read. They are never sent what you write below."
- "Note for the record (never sent)", optional, "Kept on the record with your name. Not shown publicly."
- "Record the decision" (primary, `lg`, full width of the panel). Busy: "Recording…".
- After success: a `quiet` alert with a tick, "Done. Recorded." plus the server's notice words. Not teal: today's `tone="confirmed"` success alert in `Item.tsx` changes to the success style in components.md section 09.
- "Next waiting report" (secondary, full width) under it, in the queue's current order and filters.

**THE CLOSED ROWS** (`SettingPanel`, plain variant: title, one line of what is set, one button)

| Row                                 | Shows when closed                                    | Button              | Opens                                                                                                                                                      |
| ----------------------------------- | ---------------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity                            | "Not set" or the rating                              | Edit                | rating select, "Clear the rating", Why                                                                                                                     |
| Threat to life or safety            | No / Yes, with who and when                          | Edit                | the existing form                                                                                                                                          |
| Same incident                       | "Not linked" or the linked references                | Link                | reference field, Why, the linked list with unlink                                                                                                          |
| Second read                         | why it was asked ("the word list: turned away")      | Clear               | confirmation                                                                                                                                               |
| Ask for evidence                    | Not asked / asked, answered                          | Ask                 | `AskDialog`                                                                                                                                                |
| The archive's note                  | none, or its state and last revision                 | Write / Revise      | note body, Why it is being revised, sources, state (administrators)                                                                                        |
| Take it off the board / Put it back | current state                                        | Take off / Put back | "It goes back as" select, Why                                                                                                                              |
| Who filed it                        | "Restricted. Every look is logged with your reason." | Look…               | step-up, then "Why you need them" (required), then the details and the line "This look was recorded." Shown to moderators and administrators (decision 58) |

Each row opens one at a time with the Save bar (components.md section 08), so a moderator cannot leave two half-written. Every action here records a new row; the closed row then shows the new value and who set it.

**TWO MODERATORS ON ONE REPORT**

While the page (or a queue row's "Decide here") is open it sends a heartbeat every 20 seconds (`markViewing`). Under the head, a `note` alert names the others who have it open: "maria@… has it open too. If you are both deciding it, agree who will." In the queue, a row somebody else has open carries a tag chip, "maria@… has it open", read every 20 seconds without reordering the list. Presence only (`report_viewers`, swept when a heartbeat stops): it is not a record of who read what, and it is not what stops an overwrite (the `seen` check above is).

When a heartbeat says the report moved since the page read it, a `serious` alert says "This report changed after you opened it" with "Show it as it is now". The page does not reload itself: nothing changes under somebody mid-sentence. A refused decision shows the server's sentence and the same button.

**WITHDRAWN BY ITS REPORTER**

A `deep` panel above the Decide panel: "Withdrawn by its reporter on 4 Nov. It is off the board and cannot be put back by a moderator." The Decide form is replaced by that sentence.

---

### 04

### F I L E S O N A R E P O R T

**`ReportFiles.tsx`, restyled; the consent rules unchanged**

A raised panel "Files (3)" inside the report page. The reporter's permission is stated first as a `quiet` alert ("The reporter allows their files to be published" or "These files cannot be published", with why). Each file is a row: thumbnail or type icon, name, size, state chip (`open` "Not published", `tag` "Published", `serious` "Refused"), and actions: "Publish…" (dialog with required alt text, "Describe what the picture shows for someone who cannot see it"), "Refuse…", "The original" (opens the original, logged). "Sent and not accepted (2)" is a closed row listing refused uploads with their reasons. A moderator may publish the text and not the files, never the reverse: when the report is not approved, "Publish…" is replaced by "Approve the report first".

---

### 05

### F L O O D S C R E E N , / m o d e r a t e / f l o o d

**What is arriving, and the three switches for when too much is**

**ORDER**

1. Switches, first and in a `deep` panel, because in a flood they are what the person came for: "Intake is open." with "Pause intake" (primary), and "The puzzle is at its normal difficulty." with "Make the puzzle harder" (secondary). Each asks for step-up, then confirms with a toast ("Intake is paused. The forms say so and a notice is on every page."). Under them, "Every use" as a mono list: when, who, which switch.
2. "Submissions per hour, the last 24 hours" and "Refused at the door, per hour, by check": the existing tables, each with a small bar column drawn in `ink-alt` (no status colour), and the table kept for screen readers.
3. "Identical answers, the last 24 hours".
4. "Every report, by where it stands" (by logbook): the staff totals from decision 52.
5. Organizations: the lane. Each organization's name links to the queue filtered to it, with "3 waiting of 40".
6. "Tip links, by time window": arrived from, until, "Withhold these" (step-up).

**BULK DECLINE**

Reached from the queue (section 02), filtered to the flood's window. The flood screen links to it: "Decline reports in bulk: go to the queue, filter by arrival time, select all." No second bulk path.

**WHEN PAUSED**

The header area of every staff page shows a slim `deep` strip under the bar: "Intake is paused since 14:20." with a link to this page. The public notice (`IntakePaused.tsx`) is unchanged.

---

### 06

### T I P L I N K S , / l i s t s / l i n k s

**`LinkChecks.tsx`: checking links before a journalist ever sees one**

Head with lede "Links are never published. A link that passes may be shared with vetted journalists." A status button row like the queue's (Waiting, Passed, Withheld, Blocked), the count line, then one raised row per link group: the address in mono with its site in bold, the type the tipster chose, arrived time, then the check form inline: Pass / Withhold / "This may be illegal" as choice cards; for illegal, "Why it is illegal" and "Stop it coming back" (block this address or this site); "Comment for journalists" (optional). The existing "If a link may be illegal" guidance is a `deep` panel at the top, collapsible after the first read (remembered per browser). The block list sits under the queue as its own panel with "Block" (address or site), Why, and each entry's "Take off" with "Why take it off". Opening a tipster's email is a step-up, logged like Tier B.

---

### 07

### L I S T R E V I E W , / l i s t s / r e v i e w a n d / : i d

**Entries, not reports: triage in bulk, nothing sealed**

**INDEX**

One row per list: title, "12 waiting" as a neutral `Count`, Open. Empty: `EmptyState` "No list has entries waiting".

**ONE LIST**

H1 "Review: list title", Showing as status buttons, the "At a glance" alert as a `quiet` panel (sites linked, unfamiliar ones marked, repeats from one source), then a compact table on desktop (cards on a phone): tick, entry summary, source, arrived. "Tick every entry on this page" above the table, and a sticky bar like the queue's: "Mark the ticked entries as" with the triage choices as buttons. The status line after an action is `role="status"`. Find somebody's entries (`/lists/search`, administrators) is linked from here and lives under Logbooks and lists.

---

### 08

### I L L E G A L C O N T E N T N O T I C E S

**`/moderate/illegal-content`: each notice, its receipt, and the answer the sender reads**

A list of notices, newest first, each a raised panel with the receipt number as its heading (mono), what was reported and where, when, and its state chip (`open` "Waiting", `tag` "Answered"). Waiting notices show the form: Decision (choice cards from the existing list) and "Reason, as the sender will read it". Answered ones show the decision and the reason in a `quiet` panel (not the teal success alert used today). The page explains in its lede that the sender can follow the notice at their status link.

---

### 09

### F I L E S , / f i l e s a n d b e l o w

**The file queue and the tools around it**

- `/files`: "Find a report by its reference" field at the top, then reports with files waiting, newest first: reference, how many files, the reporter's permission in words. Open goes to `/files/:ref`, which is section 04 on its own page.
- `/files/erase`: "Erasing a file". A `deep` panel says what erasing does and that it is recorded. "Which report is the file on?", then the files with "Erase … for good" each behind a `TypeToConfirm` dialog.
- `/files/logbooks` and `/files/logbooks/:id`: per-logbook limits, the site default shown beside each in `ink-alt`. Reached from the Files page and from Logbooks and lists › File limits.
- The "This site cannot take files yet" alert keeps its wording, as a `quiet` panel.

---

### 10

### A G R E E M E N T A N D S E T T I N G S

**The two pages outside the gate**

**AGREEMENT, `/moderate/agreement`**

**THE MODERATOR'S VIEW IS THE GATE.** A moderator never opens this page; they meet the agreement through `AgreementGate`, which replaces any gated Moderation page until they have agreed. The gate shows the current agreement in the prose style, the version and date, and "I agree" (primary), with the area tabs hidden. After agreeing, the page they asked for loads.

**THE ADMINISTRATOR'S VIEW IS THE PAGE.** The route is `StaffOnly needs="admin"` (`AgreementAdminPage`). It shows the published version, the editor for the next one, and "Publish this version" behind step-up, with the note that every moderator meets the gate again.

**MODERATION SETTINGS, `/moderate/settings`** (administrators)

`SettingPanel`s, one editor at a time, each closed panel showing its values:

- The public archive: on or off, and "Downloads of the whole archive" (step-up for the export).
- Words that ask for a second read: closed, "14 terms: turned away, intimidated, …"; open, a textarea one term per line.
- Counts-only publishing (`CountsOnlySettings.tsx`): each counts-only logbook with its small-area threshold, closed "Threshold 2: a place with fewer published reports shows its name and no number." The number field refuses below 2. Each change is recorded as a public switch use; the panel says so before Save.
- Editorial notes.
- Who opened what: the access log, moving to Records in the menu (navigation.md section 04). Until the route moves it stays here, as a closed panel "312 looks recorded. Last: 3 Nov 14:40 by mod@example.org" with Open.

---

### 11

### K N O W N L I M I T A T I O N S , P R E C I S E L Y

- The canvas Decide form shows Approve and Decline only. The code has a third decision, "Unclear for now" (`unknown`), which this spec keeps. The canvas is wrong on that point; this file wins.
- The status counts and pagination need new API (section 02). Live search and "Decide here" do not: the queue call already takes `q`, and `decideReport` is the same call. Moving focus and the row out of the list after a decision is new client behaviour and needs a browser test.
- Tier B access is broader in code than the stated rule (section 01). Not changed here; waiting on the owner.
- The Filter panel and the status buttons together replace today's always-open form. Severity stays a filter here although it is staff-only; it is not offered on the public board (decision 16).
- "Next waiting report" depends on the queue's order and filters being carried to the report page in the address. Not built today.
- "Unclear" (`unknown`) gets its own status button because the query already filters by it. Whether moderators want it beside Waiting is for the owner.
- Tip-link and list-review screens are specified from the code and the brief, with no canvas board. Their layouts follow the queue's patterns; a board for Tip links would be the next to draw.
- The flood screen's switch confirmation toasts assume the toast component is built (components.md section 08).
