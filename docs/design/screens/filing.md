# REPORTLOG DESIGN

## F I L I N G

**Everything a reporter touches, from the front page's button to the link in their email**

21 October 2026 · `features/form/`, `features/files/`, `features/lists/`, `features/door/`, `features/flood/`, `routes/submit.tsx`, `routes/file/`, `routes/list/`, `routes/evidence/` · canvas row "Screens · filing"

---

### 01

### W H A T T H I S C O V E R S , A N D T H E R U L E S I T K E E P S

**The rebuild's filing logic stays; the screens around it change**

**SCOPE**

`/submit`, `/file/:slug` (opening card, question cards, the fixed cards, review and send, the receipt), `/file/confirm/:token`, `/evidence/:token`, `/file/erase/:token`, `/list/:slug` (the tip list and every other list form), and the closed, scheduled, paused and door versions of all of them.

**WHAT DOES NOT CHANGE**

`walk.ts`, `cardHistory.ts`, `toSubmission`, the door's puzzle and hidden box, the uploader, the tip carry-over in `tipOffer.tsx`, and every call each page is allowed to make on a door. This spec is about what is drawn. Nothing here asks for a new API call except where section 13 says so.

**THE RULES**

- **One card asks one question.** A question with several parts (date, hour and "Approximate"; state and county) is one question.
- **Nothing on the card in front of somebody changes underneath them.** The county list following the state chosen on the same card is the one allowed exception. A question an answer turns on appears on the NEXT card.
- **No auto-advance.** Choosing an answer never moves anybody on. Next does.
- **Next is never disabled.** Pressing Next on a required card with no answer keeps the person on the card and shows the error under the control. A disabled Next gives no reason; an error does.
- **The absent-key rule.** A question that was not asked is not sent, not even as an empty value. `toSubmission` already does this. The screens must not add hidden inputs, default values or "N/A" answers that would put a key into the sealed object. An optional question left blank is not sent either.
- **Phone first.** Every layout below is written for 390px first.

---

### 02

### T H E C A R D F R A M E

**The same shell around every card, phone and desktop**

Canvas: "Filing · one choice", "Filing · state and county".

**HEADER**

The site header (navigation.md) with the Menu button. On every card after the opening one, the header's 6px bottom rule becomes the progress track (navigation.md, Progress rule): `brand-on-deep` over `line-on-deep`, width by `stillPossible`, no numbers, never growing back. The rebuild's in-page `role="progressbar"` stays in the page for screen readers, visually hidden. The thick dark in-page bar is removed.

**ON THE CARD, TOP TO BOTTOM (PHONE)**

1. Eyebrow: the logbook's title (label face, `muted`). Replaces the plain "Demo logbook" line.
2. The question as the page's `<h1>`, set in the H2 type style (components.md §02), `tabindex="-1"`. Focus moves here on every card change, as now.
3. "Optional." after the question when it is optional (kept from the rebuild).
4. Help, in `ink-alt`, under the question. Help that depends on an earlier answer is chosen when the card is reached (`helpFor`), never while it is shown.
5. The control (section 04).
6. The error, when there is one: `serious` text with an icon and a sentence, `role="alert"`, linked to the control by `aria-describedby`.

**THE BAR AT THE BOTTOM (PHONE)**

Fixed to the bottom of the viewport: `surface` fill, a top edge in `ink-alt` at the theme border width, 14px padding, safe-area inset below. Back (secondary, `lg`) takes one third, Next (primary, `lg`) two thirds. Back on the first question card goes to the opening card. The page gets bottom padding equal to the bar so the last choice is never hidden. The bar sits above the phone keyboard the same way the Save bar does (`visualViewport`).

**DESKTOP**

The card is centred in a 640px column on the page. No fixed bar: Back and Next sit under the control, Next on the right, both `lg`. The header and progress rule are the same.

**THE TAB TITLE**

Restored from the old app: the question, then "(n of m)" counted against the cards still possible, then the site name. "How did you vote, or try to vote? (2 of 8) · Our Town Votes". The opening card's title is the logbook title. The review card's is "Check your answers".

**BACK IN THE BROWSER**

Each card stays a history entry (`cardHistory.ts`). The browser's Back and the on-page Back do the same thing.

**LEAVING**

"Leave this page?" on unload once anything is typed or chosen (kept).

---

### 03

### B E F O R E T H E F I R S T Q U E S T I O N

**The submit card, and a logbook's opening card**

**`/submit`: WHAT DO YOU WANT TO DO?**

Canvas: "Filing · the voting site entry card".

One card, in the frame above, with no progress rule. The question is the operator's `submit_question` ("What are you reporting?" by default; the voting site writes "What do you want to do?"). The answers are choice cards (components.md, Choice card), one per open logbook and one for the tips list, each titled by what it opens and noted with its blurb. The voting site's two: "Log how voting went" and "Send a link". The operator's `submit_intro` sits under the question. Next goes to the chosen form. Nothing is preselected, even when there is only one answer.

When the front page offers the logbook and the tips list as its own two big buttons (front page spec), those buttons go straight to `/file/:slug` and `/list/tips`. `/submit` stays for every other link that says "File a report", including the Menu.

**`/file/:slug`: THE OPENING CARD**

Canvas: "Filing · landing".

- Eyebrow "File a report", the logbook title as H1, the operator's blurb as the lede.
- **The emergency notice, restored.** A `deep` panel: label-face heading "If someone needs help right now", then the wording of `help_now`, a new wording slot with shipped wording. Operators can reword it but not blank or remove it. It is drawn on the filing landing (this opening card) and on the front page. Shipped wording, approved by the owner (decision 62): "This is a record, not an emergency line. If you or someone else is in danger, call your local emergency number."
- What happens next, as three numbered lines with neutral `Count` markers: one question at a time; you check your answers before you send; a moderator reads it before anything is public. The second line follows `asks_email`: with an address, "Nothing is filed until you confirm it from your email"; without, "Once you send it, it is filed as it is".
- Start: primary, `lg`, full width on a phone.
- "How to use {site}": quiet, under Start, linking `/how`. Restored.
- The seal line in mono, `muted`: "Sealed and timestamped on arrival." Restored.

No progress rule on this card.

---

### 04

### E V E R Y K I N D O F Q U E S T I O N O N A C A R D

**`QuestionControl.tsx` keeps its logic and swaps its controls**

No native browser radio, checkbox, select arrow or file input is visible anywhere on these cards.

| Kind                                                                 | Control                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `choice_one`, `place` with a closed list                             | Choice cards, one per option, radio group, arrow keys move within it. The label is the option's label; the code is never shown.                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `choice_many`                                                        | Choice cards with square marks, checkbox group. The question says "Tick everything that applies." when the operator's wording does not.                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `yes_no`                                                             | Two choice cards, Yes and No.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `yes_no` as a checkbox (`settings.checkbox`)                         | One choice card with a square mark, the question as its title.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `evidence_declaration`                                               | Two choice cards: "Yes, I have something" and "No, I do not".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `short_text`, `place` with "other" allowed, `email`, `url`, `number` | One input, full width, 44px, 16px text. `inputmode` and `autocomplete` as the kind needs (`email`, `url`, `numeric`). The character limit under it in `muted` mono once half used: "212 of 500".                                                                                                                                                                                                                                                                                                                                                                       |
| `long_text`                                                          | Textarea, at least 6 lines, grows with its text, same counter.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `date`                                                               | A date input (`type="date"`) styled as a field, with the format spoken in the help ("Day, month and year"). Earliest and latest from the question's settings become the input's own min and max (`inputLimits`), so the picker offers nothing the server would refuse.                                                                                                                                                                                                                                                                                                 |
| `time`                                                               | A time input (`type="time"`) styled as a field, same limits rule.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `datetime` (a date with a time part)                                 | One date-and-time input (`type="datetime-local"`), shown in the reporter's own clock. Its limits are moments, converted to the reporter's local time for min and max (`localMoment`). The help says the time is the reporter's local time.                                                                                                                                                                                                                                                                                                                             |
| `number` with `picker: 'hour'`                                       | A select "Choose an hour", 24 hours in the reporter's words (`hourLabel`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `location`, state (`settings.code === 'postal'`)                     | A select "Choose a state", the 50 states, DC and the territories by name.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `location`, county code (`settings.code === 'fips'`)                 | A county question tied to a state question through `settings.within`, handled on its own in `QuestionControl.tsx`, never as "Choose a place". A select reading "Choose a state first", styled as disabled (dashed edge, `paper-alt`, `ink-alt` text at 4.5:1, never faded), until the state named by `within` has an answer; then "Choose a county" with that state's counties, each stored as its five digits. The card clears it when the state changes. Used where the state and the county are two questions on one card (The voting site's `state` and `county`). |
| `location`, county depth                                             | `CountyPicker`: both selects on the card from the start (canvas "Filing · state and county"). The county select reads "Choose a state first" until a state is chosen, styled as disabled (dashed edge, `paper-alt`, `ink-alt` text at 4.5:1, never faded). Choosing a state answers with the state and the county list fills; "Not sure which county" stays a real answer. A line of help under the county says the list follows the state.                                                                                                                            |
| `location`, any other                                                | A select "Choose a place", United States and Countries as groups when both exist.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `file`                                                               | Its own card (section 05).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

**PARTS ON ONE CARD**

Where the operator put a question "on the same card as the question above it" (`cardsOf`), each part is a labelled field in a group under the card's one heading, in order. The voting site's When card is the example: date, then hour, then "Approximate" as a one-card checkbox choice card.

**ANSWERS THAT NEED ANOTHER CARD**

Never revealed on the current card. A choice that opens a follow-up question shows nothing new; the follow-up is the next card.

---

### 05

### T H E F I X E D C A R D S

**Publication, address, files, and checking the answers**

**PUBLICATION CARD**

The server's wording and digest (`getPublicationCard`), as now. Its two options become choice cards. While the card's wording is loading, the card says "Loading the wording…" with `role="status"`; Next is still pressable and says why if pressed too early. If the wording fails to load, the card says so in a `serious` alert and offers "Try again"; the report cannot be sent without it.

**WHERE TO REACH YOU**

Only when the logbook asks for an address (decision 55). One email field, the reason in the help in the rebuild's words. On this card the bottom bar's primary reads Next, as everywhere.

**FILES**

After the address card (the staging quota is keyed on it), as now. The new file picker (components.md, File picker): "Choose files" secondary button over a hidden input, the list of chosen files with name, size, a progress line per file while it uploads ("Uploading, 40%", "Preparing", "Ready") and Remove (quiet). The limits in one sentence above it. What happens to camera and location details stays said before anybody picks a file (`FilesCard.tsx` wording). Drag and drop on desktop as an extra. "Optional." when it is.

**CHECK YOUR ANSWERS**

Canvas: "Filing · review and send".

- H1 "Check your answers", then the rebuild's sentence that depends on `asks_email`.
- Every asked answer as a row: the question in label face (`ink-alt`, 12px), the answer under it, "Change" as a quiet button on the right with an `aria-label` naming the question. Change goes to that card and returns here after Next. Rows are separated by `line` hairlines.
- An optional question left blank reads "Not answered", in `ink-alt`. The rebuild shows a dash; a dash is not a word.
- "Published if approved", files and the address are rows too, as now.
- The statement (`STATEMENT`) as a one-card checkbox choice card, not a bare checkbox.
- The operator's `send_note`, then a `deep` panel with the line the reporter must not miss. For a logbook without an address: "This report can't be changed or withdrawn after you send it." (The voting site's send card wording) and, under it, "It is sealed the moment it arrives. A moderator reads it before anything is public." With an address: "Nothing is filed until you confirm it from your email."
- The bottom bar's primary reads "Send report". While sending: "Sending…", `aria-busy`, a second press ignored. The door's status line (`doorStatus`) sits above the bar while the puzzle finishes.
- Errors (no statement ticked, send refused) are a `serious` alert above the bar, focused. The answers stay.

---

### 06

### E L E C T I O N L O G ' S L O G B O O K

**The cards in `docs/voting-questionnaires.md`, as they render**

No special code: each is an ordinary question kind. Listed so the build can be checked against them.

| Card                             | Renders as                                                                                                                                                                                                                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Entry, "What do you want to do?" | `/submit` (section 03): "Log how voting went", "Send a link"                                                                                                                                                                                                                   |
| 1 How it went                    | Choice cards: "It went fine", "Something went wrong"                                                                                                                                                                                                                           |
| 2 Method                         | Choice cards, four (canvas "Filing · one choice")                                                                                                                                                                                                                              |
| 3 Where                          | `CountyPicker` (canvas "Filing · state and county"). Help chosen from the method on arrival: "The county where the polling place was." in person; "The county where you are registered." by mail and overseas                                                                  |
| 4 When                           | One card: date; then, only when the method was in person, hour ("Choose an hour", local time at the polling place) and "Approximate" as a one-card checkbox. Mail and overseas see the date only. Which parts show is decided on arrival from card 2, never while on this card |
| 5 You were                       | Choice cards, four. Only in person                                                                                                                                                                                                                                             |
| 6 Wait                           | Choice cards, six. Only in person. After it, "It went fine" goes to the send card                                                                                                                                                                                              |
| 7 What went wrong                | Choice cards with square marks; the list for the method chosen (20 in person, 9 by mail, 10 overseas). "Tick everything that applies." On a phone the list is long: the bottom bar stays fixed and the last option clears it                                                   |
| 8 Did you vote                   | Choice cards; "Yes, a provisional ballot" only in person                                                                                                                                                                                                                       |
| Send                             | The review card (section 05) with "This report can't be changed or withdrawn after you send it." and "Send report"                                                                                                                                                             |
| Thank you                        | Section 07                                                                                                                                                                                                                                                                     |

The voting site's logbook asks for no address, so it seals on arrival and there is no confirmation link (decision 55).

---

### 07

### A F T E R S E N D I N G

**The receipt, and the offer to send a link**

**THE RECEIPT**

Replaces the form on the same page; focus moves to its heading.

- No address asked: H1 "Your report to {logbook} was received", a `quiet` panel with a tick and the word "Done": "It is sealed. A moderator reads it before anything is public." Not a teal alert: teal means a moderator confirmed something (components.md, Others). The rebuild's `Alert tone="confirmed"` here changes.
- Address asked: H1 "Check your email", "We have sent a link to {email}. Nothing is filed until you press the button on that page.", and how long the link works.

**THE TIP OFFER**

Under the receipt, as owner wording: "Thank you. Have a link, photo or video? Send it as a tip." with "Send a link" as a secondary `lg` button to the tips list. The carry-over of state, county and time stays browser-only (`tipOffer.tsx`): nothing on the page or in the request connects the tip to the report, and the screen must not add a reference, a query string or anything else that would.

Then "Back to the front page" (quiet) and "See the live board" (quiet).

---

### 08

### T H E T I P L I S T , A N D E V E R Y O T H E R L I S T F O R M

**`/list/:slug` uses the same card frame; an entry is not a report**

**FRAME**

The same header, progress rule, card layout, bottom bar and tab title as a logbook. No publication card and no statement (an entry is never published). The first card says what happens to an entry, in words (the rebuild's wording). The address card appears only where the rebuild already shows it.

**THE TIP CARD (VOTING §04)**

One card, three link rows, always all three; nothing is added or removed while on it.

- The text above the rows, the owner's wording: "Links you send here are never published. A moderator checks each one, and links that pass may be shared with vetted journalists. Don't link to your own account if you want to stay anonymous."
- Each row is a `plain` panel with a label-face heading "Link 1", "Link 2 (optional)", "Link 3 (optional)": a URL input (`inputmode="url"`, placeholder "https://"), then "What kind of thing is it?" as a select of the eight types.
- Row 1 is required. A row's type is required once its link is filled in; the error says which row: "Link 2 has no type. Choose what kind of thing it is."
- A type without a link, or a link without a type, is never sent. A blank row is never sent as an empty row.
- On a phone the three rows stack; on desktop the URL and the type sit side by side in each row (2 to 1).

When the tips list has its own "where" and "when" cards (decision 45), they render as in section 04 and take the browser-only carry-over as their starting answer, visibly, so the reporter can change it.

---

### 09

### T H E L I N K I N T H E E M A I L

**`/file/confirm/:token`: one page, six states, never filing on open**

Same header. Opening the link files nothing (mail scanners open links); filing is the button. Every state is a centred 640px column with the logbook title as the eyebrow.

| State             | Heading                             | Body                                                                                                                                | Action                                                              |
| ----------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `unconfirmed`     | Confirm your report                 | Filing seals it; it can be corrected with a new version, never quietly changed; a moderator reads it first. The expiry time in mono | "Confirm and file my report", primary `lg`. "Filing…" while pressed |
| `preparing`       | Your files are still being prepared | Nothing is filed yet; why files are checked; the list of files with "Preparing" beside each                                         | "Try again", secondary                                              |
| `expired`         | This link has expired               | Nothing was filed; links work 24 hours; file again                                                                                  | A link to the logbook's form                                        |
| filed, not public | Your report is filed                | A moderator will read it. Which non-public state it is in is never said                                                             | The tip offer (section 07)                                          |
| `counted`         | Your report is counted              | It is counted in the public figures; its words are not shown (decision 54)                                                          | The tip offer                                                       |
| `public`          | Your report is public               | Where to see it                                                                                                                     | "See it on the board", and "Check it has not been changed"          |

A failure to file is a `serious` alert above the button; the button stays. A link that does not exist says so in a sentence and links home. On a door this page calls only the two confirmation calls (unchanged).

---

### 10

### E V I D E N C E A N D E R A S I N G

**Two small pages from emailed links, kept small on purpose**

**`/evidence/:token`**

H1 "A moderator asked for evidence", the report's reference in mono, the moderator's request in a `quiet` panel in their own words, then the file picker (components.md) with each file's progress line. "Send these files", primary, appears pressable only when every file says Ready; until then the line under it says how many are still preparing. No report text and no way to change an answer, as now. After sending: a `quiet` "Done" panel saying the files were added and a moderator will see them.

**`/file/erase/:token`**

H1 "Erase your contact details", what will be erased and, as plainly and in its own `deep` panel, what will not: the report is not withdrawn. The confirming statement as a one-card checkbox choice card, then "Erase my details" as a secondary button (a destructive action is never primary-coloured). Opening the link erases nothing (unchanged). After: "Done" panel. On a door, only the two erase calls.

---

### 11

### W H E N A F O R M C A N N O T T A K E A R E P O R T

**Closed, not yet open, paused, switched off, missing, and on a door**

Each replaces the opening card, in the same frame, with no progress rule. None is a dead end: each links to the front page and the board.

- **Scheduled:** H1 the logbook title, a `quiet` panel "This logbook has not opened yet. It opens on {date and time}."
- **Closed:** the same, "This logbook is closed. It is not taking reports."
- **Intake paused by a moderator** (`PausedForm`, Plan E): a `deep` panel with the pause notice. Asked once when the page opens; a pause that starts mid-form is met by the send, refused with the same notice, and the answers stay on screen (unchanged).
- **The site switch off:** "This site is not taking reports at the moment. Nothing you type here could be sent. Please come back later."
- **No such logbook:** H1 "There is no logbook here", "Check the address you were given. It may have a typing mistake in it."
- **On a door** (site password on, this logbook or list opened outside it): the header shows the wordmark and no Menu button (navigation.md, On a door). Everything else on this page is the same. The emergency notice is part of the form's own wording and is shown. Nothing else is fetched (`useSite` stays quiet; the page falls back to the default name and look).

---

### 12

### W H A T C H A N G E D F R O M T H E R E B U I L D , A N D W H Y

**For the reviewer comparing old screenshots, new screenshots and this**

| Change                                                    | Why                                                                                    |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Progress moves to the header rule                         | The old app's identity; the page loses a heavy bar and keeps the accessible one hidden |
| Choice cards replace radio dots                           | 44px+ targets on a phone; the brief's lost convenience 17                              |
| Fixed Back and Next on phones                             | The thumb finds them without scrolling past long lists (card 7)                        |
| Next is never disabled                                    | An error says why; a dead button does not                                              |
| Emergency notice, "How to use" and the seal line restored | Lost in the rebuild (brief, problem 5)                                                 |
| Tab title "(n of m)" restored                             | Lost convenience 18; tells somebody with many tabs where they are                      |
| "Not answered" replaces the dash on review                | Plain language                                                                         |
| Statement as a choice card                                | No native checkbox anywhere                                                            |
| Receipt is not teal                                       | Colour is exclusive: teal is a moderator's confirmation                                |
| File picker replaces "Choose File, No file chosen"        | Brief, problem 6                                                                       |

---

### 13

### K N O W N L I M I T A T I O N S , P R E C I S E L Y

- `help_now` is a new wording slot with shipped wording: operators can reword it but not blank or remove it, and it is drawn on the filing landing and the front page. Its shipped wording was approved by the owner on 22 October 2026 (decision 62). That is a small server change, not only a screen.
- The opening card's emergency notice on a door depends on the slot being returned with the form's own calls, because a door may not ask for the site's wording. Today it is not; it needs adding to what the logbook's form call returns, or the notice is not shown on a door.
- The voting site's When card shows the hour only "in person". That is decided by the card's conditions in the logbook definition, which the questionnaire specifies; the screen only renders what `walk.ts` asks. If the definition puts the hour on its own card instead, the result is still correct, just one card longer.
- The tab title's "(n of m)" uses the cards still possible, so m can fall as the reporter answers. The old app did the same. Whether a falling total reads as a bug to reporters is not tested.
- The fixed bottom bar above the phone keyboard has not been tried on a real device; it follows the Save bar's method, which has not either.
- The date input's look varies by browser even when styled. A custom date picker is not proposed; whether the native one is acceptable on old Android browsers is not checked.
- The tip card's side-by-side desktop rows and the exact wording of "Link 2 has no type" are new; the questionnaire specifies the checks, not the sentences.
- The canvas shows the review card and the voting cards in the Civic look only, and the opening card in Desk. Other looks are reached by the board's look switch, not drawn separately.
