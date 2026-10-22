# REPORTLOG DESIGN

## P U B L I C S C R E E N S

**Everything a visitor sees, except filing: front page, board, a report, checking it, the information pages, journalists, illegal content, the lock screen**

21 October 2026 · `apps/web/src/routes/` and `features/board`, `features/maps`, `features/journalists`, `features/platform`, `features/site-pages` · canvas rows "Screens · front page", "Screens · board", "Screens · lock and sign in"

---

### 01

### R U L E S E V E R Y P U B L I C S C R E E N K E E P S

**Read these before any single screen**

**CHROME**

Every page has the sticky header and Menu from navigation.md, the eyebrow (the site's name) above the H1, and the footer. Page width is the theme's `--rl-page-max`. Running text keeps a 65ch measure everywhere, on every page, at every width.

**ONLY PUBLISHED, ONLY PERMITTED**

Nothing on these screens shows a report a moderator has not approved, or a part of one its reporter did not permit. A counts-only logbook never shows a single report anywhere: not on the board, not at `/board/:ref`, not in a CSV. A reference that is not public reads exactly like one that does not exist. Severity is staff-only (decision 16) and never appears on a public screen.

**DOORS**

A door page (`/journalists/confirm/:token`, `/journalists/settings/:token`, `/journalists/stop/:token`, `/journalists/access/:token`, a filing door) shows the wordmark and no Menu button, and calls only its own calls (the `useSite` rule). Its wordmark falls back to the default name when the site's is not available.

**NOTHING FROM ANOTHER HOST**

Maps are the self-drawn SVG (`HeatMap.tsx`), no tile layer. Organization logos are served from this site. Every new public page gets the `verify.spec.ts` style test that fails on a request to another host.

**LOADING, ERROR, EMPTY**

Loading is a `role="status"` sentence in the place of the content ("Reading the reports…"), never a spinner alone. A failed call is an error `Alert` in words that says what could not be loaded; the rest of the page stays usable. Empty is the dashed `EmptyState` with a title and one sentence, never a bare line.

**WORDING**

The operator's slots (`home_headline`, `home_lede`, `home_intro`, `about_archive`, `how_intro`, `standards`, legal notices, terms slots, the origin labels) are shown exactly as written, line breaks kept. An unwritten optional slot shows nothing; an unwritten legal or terms slot says it is unwritten and is never filled with something that reads like the real thing. Text the software owns (About part two, the first half of Terms, How to use) is not an editable slot.

---

### 02

### F R O N T P A G E

**`/` · everyone · the operator's headline, the ways in, the map, checking a report**

**THE FRONT PAGE AS BUILT, 22 OCTOBER 2026** (owner decision of that day; it replaces the layout below where they differ)

Who it is for: somebody stressed at a polling place, who barely uses a touchscreen, pulls out a phone and must send a report or a tip within two minutes. So the top of the page carries only what she needs, and everything else is underneath, quieter.

1. Eyebrow (the site's name), a big H1 `home_headline` (larger on a desktop), and `home_lede`, which should be one short sentence of what this is.
2. The front-page buttons from `getHomeButtons`, full width at every size, at least 64px tall, the label in a larger size; the first is the accent. Blurbs, the board count and `FALLBACK_BUTTONS` as before (`features/home/buttons.tsx`).
3. "What is this? About this site" (a link to `/about`), and the meta line.
4. The `help_now` notice (decision 62). Always drawn, never removable.
5. Under all of that, the quieter sections, in the order an administrator chose, each of which may be hidden: what this archive is for (`home_intro`), Check a report, the map (full width), the figures (the published count and a link to `/board/numbers`; drawn only while the archive is public), and More you can do (board, alerts, how to use, moderation standard). Shipped order: intro, check, map, figures, links, all shown.

Desktop: the top part is one strong centred column (max 48rem), not a strip beside other things; the quieter sections sit under it in a two-column grid whose container carries `layout-split`, so a theme can style it.

The order and visibility of the quieter sections is the site setting `home_sections` (`site_settings.home_sections`, NULL is the shipped order), served in `getSite` and the settings editor state, written by `PUT /api/admin/site/home-sections` (administrators, like every site settings write). `resolveHomeSections` in `packages/contracts/src/site.ts` drops an unknown id and appends a missing one, so a section added later appears.

**EDIT MODE.** An owner or administrator (whoever can open `/settings`) sees "Edit this page" at the top of the front page. Nobody else fetches anything for it: the editor's calls are made only once edit mode is switched on, and never on a door. In edit mode the page keeps its shape (`features/home/FrontPageEditor.tsx` fills the same `FrontPageLayout` with fields), and every piece an operator owns has a dashed line round it:

- the headline, the lede, the introduction and the emergency notice's wording, edited in place (the `setCopy` route the Wording screen uses; raw text, so a `{{ figure }}` is edited as written). The notice can be reworded, not removed: saved empty, it goes back to its shipped wording.
- each button: Move up, Move down, Hide, and for a logbook or a list its own wording (empty means the record's title). A built-in keeps its wording. Hidden buttons are listed under "Not on the front page" with "Show it" (`setHomeButtons`).
- each quieter section: Move up, Move down, Hide or Show; a hidden one stays on screen, dimmed, marked "hidden from visitors".

A Save bar fixed to the bottom says "Editing the front page" with Cancel and Save. Nothing is public until Save. Cancel with changes asks before throwing them away; leaving the page or closing the tab with changes asks too (`UnsavedChangesGuard`). Save sends only what changed, then refetches the page, so the saved page is what shows when edit mode closes. A refusal is shown above the page and edit mode stays open. The Wording screen and `/logbooks/front-page` still edit the same things in forms.

**PHONE** (canvas "Front page · phone · ElectionLog front door")

1. Eyebrow, H1 `home_headline`, lede `home_lede`.
2. The front-page buttons, full width, `lg`, stacked, 16px apart, in the operator's order (`/logbooks/front-page`). The first is primary; every other is secondary. A button may carry a second line in body face, its `blurb` (the ElectionLog buttons use it: "Good or bad, in person or by mail").
3. The meta line "Anyone can file. Sealed and timestamped on arrival."
4. `home_intro`, as written, when there is one.
5. A `deep` panel "If someone needs help right now" with the `help_now` wording slot. It ships with wording, an operator can reword it but cannot blank or remove it, and it is always drawn here and on the filing landing.
6. The home map slot (`MapSlot slot="home"`): title, one sentence on the threshold, the map, zoom buttons, the figures as a `KeyValueList`, "The table behind the map".
7. "Check a report" in a `quiet` panel: reference field (mono) and "Check it", full width.

**DESKTOP** (canvas "Front page · desktop")

Two columns, 7 to 5. Left: eyebrow, H1, lede, `home_intro`. Right, level with the H1: the button stack, full column width, then the meta line. Below, across the page: the map panel on the left, and on the right the figures panel above the Check a report panel. The help-now panel sits under the intro in the left column.

**THE BUTTONS**

Kinds come from `getHomeButtons`: a logbook, a list, or a built-in (`submit`, `board`, `alerts`).

- The board button carries the published count as a neutral `Count` ("134", `aria-label` "134 published reports").
- **The alerts button is drawn again** (the rebuild skips it because it has an `action`, not an `href`). The built-in `alerts` is the journalist alert list sign-up (`apps/api/src/logbooks/homeButtons.ts`), so it is a link to `/journalists/alerts`, with no sign-in.
- When the call fails, `FALLBACK_BUTTONS` (Submit, Board) are shown, as now. The page is never a dead end.

**ELECTIONLOG'S FRONT DOOR**

ElectionLog does not need its own home page. Its operator orders the buttons: the logbook "Log how voting went" (accent, with its blurb), the tip list "Send a link" (with its blurb), the board, alerts. The two big buttons go straight to the logbook and the tip list; the entry card "What do you want to do?" is the first card of `/submit` for anyone who arrives there instead. Same answers, same codes, two ways in.

**STATES**

Before the site's wording loads, the H1 is the default name and the buttons area holds its status sentence. No map placed in the home slot: the map panel is absent, not empty. A map with nothing above the threshold: the map draws unshaded and the figures say 0.

**CHANGED FROM THE REBUILD**

Buttons were small and inline, above the intro; now full width, below the lede, in the right column on desktop. The eyebrow is back. The help-now notice is back as the new `help_now` wording slot, always drawn here and on the filing landing (the old filing landing had it). Check a report moves into a quiet panel and loses its explanatory paragraph to one sentence of help under the label: "Every report has a reference. Enter one to check it has not been changed."

**ACCESSIBILITY**

The buttons are a `<ul aria-label="What you can do here">`. Each is a link. The figures are a `<dl>`. The map's table is the keyboard and screen-reader path.

---

### 03

### T H E B O A R D

**`/board` · everyone · published reports, newest first, narrowed only by what the operator allowed**

**PHONE** (canvas "Board · phone")

1. Eyebrow, H1 "Live report board", lede: "First-hand accounts a moderator has read and approved for publication, with their reporters' permission. Published means judged publishable, which is a weaker claim than true." (the rebuild's sentence, kept).
2. "Submit a report", primary, `lg`, full width. Goes to `/submit`.
3. `AreaTabs`: Reports, By the numbers, Maps (only when a map is placed on the board), Arrivals and declines, Press pack.
4. Search field "Search the words", full width.
5. "Filter", secondary, full width, with a neutral `Count` of filters on. There is no sort button (see sort, below).
6. The filters that are on, as removable `tag` chips ("Logbook: Election incidents ✕"), then "Clear all" (quiet).
7. The count line (mono): "19 reports · 2 filters" or "19 reports · page 2 of 4".
8. Report cards, one column, 20px apart.
9. Pagination.
10. "Download these (CSV)", secondary, full width.
11. The counts-only note, when any launched logbook is counts-only (below).

**DESKTOP** (canvas "Board · desktop")

Title block on the left, and on the right of it "Submit a report" (primary) and "Download these (CSV)" (secondary). Tabs. A row: search field (grows), Filter. Active filters, count line, then cards in two columns, pagination centred, the counts-only note.

**FILTER**

"Filter" opens a `Dialog` (a bottom sheet on a phone) holding what the rebuild's "Narrow the board" form holds, and nothing more: Logbook, then, once a logbook is chosen, only the questions its maker marked as filters (choice cards for a short list, a select for a long one, Yes and No for a yes-no question). Actions: "Clear all" quiet on the left, "Cancel" and "Show reports" on the right. **Nothing is filterable unless the operator said so**: no built-in date or place filter.

**SEARCH AND THE "NOTHING CHANGES UNDERNEATH" RULE**

The rebuild applies filters only when "Show reports" is pressed, and writes them into the address so a filtered board can be shared. That stays. Search applies on Enter, or with the field's own "Search" button; it does not re-run on every keystroke. The moderation queue follows the same rule (decision 59). Nothing on the site filters as you type.

**SORT**

Newest first, fixed, as the API serves it. The canvas shows a sort button; it is built only if the API gains a sort parameter.

**THE REPORT CARD**

A `raised` panel, panel heading per theme carrying the reference.

- Top row: logbook title (label face, `ink-alt`) on the left; on the right the `tag` chips that public data supports: the origin label (operator's wording, "Unverified public report" by default, or "Via {organization}"), "Corrected" when this version corrects an earlier one, "Archive note" when there is one.
- The answers, as bordered answer pills ("How it went · Something went wrong"), via `ReportAnswers`. Location and date answers in words, never codes.
- The reporter's text, when published, clamped to four lines.
- Bottom row: reference and filed time in mono; "Read in full" (quiet link, `aria-label` "Read in full: RL-…").

**There is no Confirmed chip and no corroboration count on a public card.** The public report carries neither (`PublicReport` in `packages/contracts/src/board.ts`). The canvas cards that show "Confirmed", "2 accounts" or "Single account" are wrong on this point.

**COUNTS-ONLY**

With no logbook chosen, a `quiet` panel under the list: "Counted, not shown: {titles}. Choose one in Filter to see its counts." With a counts-only logbook chosen, the list is replaced by its counts panel (`CountsOnlyPanel`, kept as built), and the CSV link is not drawn.

**STATES**

Loading: "Reading the reports…". No published report at all: `EmptyState` "Nothing published yet" and "Reports appear here once a moderator has approved them." No match: `EmptyState` "No published report matches that" with "Clear all". Publishing switched off by the operator: a `deep` panel "Publishing is paused. Reports still arrive and are being read." in place of the list.

**CHANGED FROM THE REBUILD**

Submit is back on the board. The sub-pages are `AreaTabs` with a "you are here", not buttons. The always-open filter form becomes a Filter button with a count and removable tags. The count line moves above the list and is `aria-live="polite"`. The CSV link becomes a button.

---

### 04

### T H E B O A R D ' S O T H E R T A B S

**Counts, maps, arrivals and the press pack, each its own address**

**BY THE NUMBERS** (`/board/numbers`)

Prose width. Each logbook as an H2, each counted question as a panel with a `KeyValueList` of answer and count, "Not answered" last. Published reports only (decision 36). No headline figure, on purpose. The `NOT_A_SAMPLE` sentence (`not-a-sample.tsx`) sits under the lede. Loading "Counting…".

**MAPS** (`/board/maps`, and every map at `/map/:slug`)

Each placed map in the operator's order, as on the front page: the plane toggle (United States, Elsewhere or World) and the view toggle (volume, outcome) as pressed-state secondary buttons, the SVG map with territory insets, the legend ramp with its "no reports" and hatched "under the threshold" keys, zoom in, zoom out and reset, drag to pan when zoomed, the readout panel for the area pointed at, the figures, "The table behind the map". An area under its threshold has no number anywhere on the page. `/map/:slug` carries only `plane`, `view` and `area` in its address, never a threshold. The tab is hidden when no map is placed on the board.

**ARRIVALS AND DECLINES** (`/board/activity`)

Tables, not charts, as built: arrivals by hour for the last two weeks, by day, by place, by where reports came from; per logbook "declined, by reason" from the fixed list; "The flood switches, every time they were used" with their times and never who. Counts only; nothing names a report. Each table has a caption and scrolls sideways inside its own box on a phone.

**PRESS PACK** (`/board/press`)

The operator's built documents as a list of rows: title, kind and size in mono, a secondary "Download" button. A listed file that is missing shows "Listed in the pack, but the file is missing." in its row, not hidden. No pack: `EmptyState` "Nothing published here yet".

---

### 05

### O N E P U B L I S H E D R E P O R T

**`/board/:ref` · everyone · what the reporter said, where it came from, and how to check it**

**LAYOUT** (phone and desktop, prose width)

1. "← Back to the board" (quiet).
2. Eyebrow: logbook title. H1: the reference, in mono, no display transform.
3. Meta line: filed time; the origin label; "Corrected" when it is.
4. Panel "What the reporter said": the answers as a `KeyValueList`, then the published text.
5. Files the reporter and the moderator both allowed, as a gallery: image with its alt text, other files as rows with Download.
6. Panel `quiet` "A note from the archive", when there is one: the note, its date, and its revision history as written.
7. Panel "Check it has not been changed": one sentence and the primary button "Check this report", to `/verify/:ref`.
8. For an organization's report: "Filed through {organization}, collected {date}." Never who typed it.

**STATES**

Loading "Loading…". Not public, counts-only, or unknown: the same page, H1 "No published report", one sentence "There is no published report with that reference.", and links to the board and to Check a report. The three cases are indistinguishable on purpose.

**PRINT**

Header, menu, footer and buttons hidden; the page prints as the report with its reference and fingerprint.

---

### 06

### C H E C K I N G A R E P O R T

**`/verify` and `/verify/:ref` · everyone · does this report still match its fingerprint**

**`/verify`** (new, restoring the old bare form)

H1 "Check a report", one sentence of what it does, the reference field (mono, `autocomplete="off"`, `spellcheck="false"`) and "Check it". Enter submits and goes to `/verify/:ref`.

**`/verify/:ref`** (prose width)

1. Eyebrow "Check a report". H1 the reference in mono.
2. The verdict as a `deep` panel: "This report has not been changed." with a tick, or, when any check fails, "This report does not check out." with a cross and which check failed. Words first; colour second.
3. The four checks as `CheckRow`s, kept as built: "The report has not been edited", "Its place in the chain is intact", "Nothing has been inserted or removed around it", "Checked again in your browser".
4. The outside timestamp sentence, as built, including "not covered until tomorrow".
5. For a report that is not public: "What this report says is not shown", and only the fingerprints.
6. The fingerprints as a `KeyValueList` in mono, each value wrapping, with a Copy quiet button.
7. "Check it yourself" fold-out, kept: canonical JSON, hashes, the genesis and the shell hint.
8. Under everything, the reference field again with "Check another", so a second check does not go back to the front page.

**STATES**

Loading "Checking…". No such reference: H1 stays the reference, an error `Alert` "There is no report with that reference.", the field to try again.

---

### 07

### A B O U T , H O W , S T A N D A R D S , L E G A L , T E R M S

**Prose pages, the operator's part and the software's part kept apart**

**SHARED LAYOUT**

Prose width. Eyebrow, H1, lede. A "Contents" list of the page's sections as links (kept static, decision 28). Each section a `ProseSection` with its numbered eyebrow ("Part one · 01") and an H2. Long text at body size with 1.55 leading.

**ABOUT** (`/about`)

Part one is the operator's (`about_archive`, then "How it works, briefly"); part two is ReportLog's and not editable. A link to the changelog. A visual divider between the parts: a `plain` panel rule and the eyebrow "Part two · what you can check yourself".

**HOW TO USE THIS** (`/how`)

The operator's optional `how_intro`, then the software's four sections (filing, publishing, confirming, afterwards) with "On this page" contents.

**MODERATION STANDARD** (`/standards`)

The operator's `standards`. Until written, the shipped wording that says plainly there is no standard yet.

**IMPRINT AND PRIVACY** (`/legal`)

Two sections, each the operator's text as plain text. Unwritten: a `quiet` panel "Not written yet." Failed to load: error `Alert`.

**TERMS AND CONTACT** (`/terms`)

The software's half first (reports, tips, illegal content), then the operator's three slots: their own terms, a contact for people who use the site, a contact for authorities.

---

### 08

### O R G A N I Z A T I O N S

**`/organizations` and `/organizations/:id/listing`**

**DIRECTORY** (`/organizations`, everyone)

Prose width. H1 the directory's name. The server's disclaimer as a `quiet` panel "What this list is", above the rows, always. Each organization a `raised` panel: logo (from this site, decorative, `alt=""`) beside the name as H2, then its listing text and links. Ranked by members, never by reports. Empty: `EmptyState` "No organization has asked to be listed yet."

**LISTING SWITCH** (`/organizations/:id/listing`, the organization's manager)

"{Organization} in the directory": the switch as two choice cards (Listed, Not listed) and the preview of how its row appears, with the disclaimer shown as it will be. Changes save with the panel's own Save, with a toast on success.

---

### 09

### J O U R N A L I S T S

**Sign-up, asking for the desk, and the pages behind the links in an alert**

**ALERTS SIGN-UP** (`/journalists/alerts`, everyone)

Prose width. H1 "Journalist alerts", lede "An email when new approved reports appear in the states you cover. It says how many, and nothing more." Four fields only: name, outlet, email, states covered (the searchable checkbox list with a count line, as in account.md section 11: a filter field above a scrolling list of checkbox choice cards, "All states" first, and the mono line "3 states chosen" under it). A `quiet` panel before the button: "Joining gives you no access to anything." with links to the imprint and privacy policy. Primary "Join the list". Afterwards "Check your email", the same whether the address was known or not.

**ASKING FOR DESK ACCESS** (`/journalists/access`, and the emailed `/journalists/access/:token`, a door)

Step one: email only, same answer either way. Step two, from the link: "Ask for access to the journalist desk", for the address shown, text and links only ("Links to your published work"), nothing sent until the button. Result pages: "Your request is with the owner", "You already have access", "This link does not work any more", "This link could not be checked".

**CONFIRM AND STOP** (`/journalists/confirm/:token`, `/journalists/stop/:token`, doors)

Opening the link changes nothing. The page asks: "Join the alert list?" or "Stop these alerts?", with one primary button. Stop keeps the person on the list and keeps desk access (decision 47); the page says so and links to Change your alerts. Results: "You are on the alert list", "Alerts are off", "You are off the alert list".

**CHANGE YOUR ALERTS** (`/journalists/settings/:token`, a door)

The states as the same searchable checkbox list with its count line, alerts On or Off as two choice cards, Save. Below, apart, a `plain` section "Remove me from the list entirely" with a sentence that it also ends desk access, and a secondary button that asks again in a `Dialog` before acting.

---

### 10

### R E P O R T I N G I L L E G A L C O N T E N T

**`/illegal-content` and `/illegal-content/status/:token`**

**THE FORM** (everyone, no account)

Prose width. H1 "Report illegal content", lede as built. Fields: "Where is it?" (a reference or an address), "Why do you think it is illegal?" (textarea), "Your name (optional)", "Your email address (optional)" with help "Only for a receipt and the decision.", and the good-faith declaration as a checkbox choice card. Primary "Send the notice", busy "Sending…". Failure: error `Alert` "Your notice was not sent" with the reason.

**SENT**

"We have your notice", and the receipt reference in a `quiet` panel with a tick and the word "Done". The rebuild uses the `confirmed` tone here; teal means a moderator confirmed a report, so it changes. The sentence differs with and without an email address, as built.

**STATUS** (a door)

H1 "Notice {receipt}". Undecided: `quiet` panel "Not decided yet". Decided: the decision in words ("We removed the content.", "We restricted access to the content.", "We did not remove the content.") and the reason, in a `quiet` panel, never teal. Bad link: "This link does not match a notice" and "Check that the whole link was copied."

---

### 11

### T H E L O C K S C R E E N

**Any address while the site password is on · everyone not yet past it**

**LAYOUT** (canvas "Lock screen")

No header, no Menu, no footer. The whole screen is `deep`. From the top, in a 26rem column, centred on desktop: the site's two-tone name at 26px (from the password check, never from `getSite`); the operator's lock paragraph, when written, in `on-deep-muted`; the Password field with an `on-deep-muted` edge; "Continue", primary, `lg`, full width; then, under a `line-on-deep` rule, "Open without the password" and each door as a 44px link ("File a report: Election incidents"). With no doors, that section is absent.

**IT WEARS THE SITE'S LOOK**

Decided by the owner on 22 October 2026 (decision 60, amending decision 3): the lock screen wears the site's palette and theme, as the old app's did. It still shows nothing else about the site: the name and the operator's `lock_intro`, as decision 3 says. `LockScreenSite` (`packages/contracts/src/identity.ts`) gains `palette` and `theme` (ids only) and, when the look comes from an installed pack, that pack's stylesheet address. The screen applies them like any page, and the remembered look in this browser paints first so there is no flash.

**STATES**

Wrong password: error `Alert` under the field, "That password is not right.", focus back on the field. Checking: Continue shows "Checking…". History stays locked to two states, as built.

---

### 12

### T H E P U B L I C A P I P A G E

**`/public-api` · everyone · what `/api/v1` serves, for people building on the figures**

Static text, as built: it asks the server for nothing. Prose width. Eyebrow, H1 "Public API", lede as built ("The figures {name} publishes, as JSON. No key and no sign-up."). `ProseSection`s: Addresses (each endpoint in mono in a `quiet` panel with a Copy quiet button), "Two rules about the numbers", the stability promise, the licence. Example responses in mono blocks that scroll sideways inside their own box on a phone. The old paste-in widget stays unported.

---

### 13

### N O T F O U N D , A N D T H E F O O T E R

**The page for a wrong address, and the line under every page**

**NOT FOUND**

Header and footer as usual. H1 "Nothing here", "There is no page at this address.", then secondary buttons Home and Board, and the reference field "Looking for a report? Enter its reference." with Check it.

**FOOTER**

As navigation.md section 06: About, How to use this, Moderation standard, Imprint and privacy, Terms and contact, Report illegal content, the directory's name, Public API, For journalists, Easier reading; the line "Every report is fingerprinted and chained, so any later change shows."; the version link; "Powered by ReportLog" with the source link and licence. Links in a wrapped row on desktop, a two-column list on a phone, each 44px tall on a phone.

---

### 14

### K N O W N L I M I T A T I O N S , P R E C I S E L Y

- **Sort** is not built: the board API has no sort parameter, and the canvas no longer draws one.
- **The lock screen** needs `palette`, `theme` and a pack stylesheet address added to `LockScreenSite` (decision 60). Until that lands it shows the default look.
- **The `help_now` slot** is new: it needs adding to the wording slots with its shipped wording, and the words settings page must refuse a blank value for it.
- **Button blurbs** on the front page assume `blurb` from `getHomeButtons`, which the type has; whether the front-page editor lets an operator write one is not checked.
- `/verify` as a bare address is a new app route. Caddy's catch-all already hands it to the app; nothing to change in `deploy/caddy/Caddyfile`.
- The map's pinch zoom stays missing (buttons and drag only), as in the rebuild.
