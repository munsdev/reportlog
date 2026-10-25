# REPORTLOG DESIGN

## S E T T I N G S A N D A D M I N

**Site settings, the setup wizard, logbooks and lists, people and access, and records**

21 October 2026 · `routes/(staff)/settings/`, `features/builder/`, `features/identity/`, `features/maps/`, `features/lists/`, `features/journalists/`, `features/backups/`, `features/anchor/` · canvas boards "Site settings · overview, one panel open", "Site settings · Look, with previews", "Site settings · Look · phone"

---

### 01

### W H A T T H I S F I L E C O V E R S , A N D T H E R U L E S I T K E E P S

**Every staff screen an administrator or the owner uses to run the site**

**SCOPE**

The Site settings area (section 03 to 06), the setup wizard (07), the Logbooks and lists area (08 to 11), People and access (12) and Records (13). Moderation screens are in `moderation.md`; account, sign-in and two-factor screens are in `account.md`.

**KEPT FROM THE REBUILD, EVERYWHERE**

Every route keeps its address, its `StaffOnly needs=` guard and its server guard exactly as they are. Every feature the design brief lists for these screens stays. Every screen keeps its plain-language refusals and its "could not be read" states. The unsaved-changes guard stays and now names the open panel.

**OWNER DECISION REVERSED, SAID PLAINLY**

Decision 27 dropped "editors' extras (edit mode, panel summaries, extra policies, live look preview)" **for now**. This design brings two of them back, because the owner asked for the old features back, better:

- **Panel summaries**: every setting shows its current value before it is opened (section 02).
- **The live look preview**: desktop and phone frames on the Look screen and in the setup wizard (section 04).

It replaces the third, on-page edit mode, with something narrower: the Wording page shows each slot **in context, beside its editor** (section 05). Nobody edits on the public page itself. "Extra policies" stays dropped.

**HARD RULES THESE SCREENS TOUCH**

- A launched logbook is frozen except rewording (labels, help, coded option labels) and adding an optional question (decision 48). The builder shows frozen parts as read-only, with the reason, never as disabled inputs that look broken.
- The transparency log is read-only. No screen can rewrite it.
- Owner-only actions (backups, the journalists queue, appointing administrators, handover, two-factor resets of others) stay owner-only, on the server and in the menu. The site password stays what it is today: an administrator setting (`hasAdminAuthority`), not owner-only.
- Step-ups stay exactly where `docs/plan-e.md` and the code put them today; this design adds none to existing actions. Applying a look gets no step-up, as today. The one new step-up is installing, replacing or removing a look pack, which is part of the new installer (decision 50).

---

### 02

### T H E S E T T I N G S P A T T E R N

**See what is set, open one thing, save it with a bar that says what it saves**

**SETTING PANEL**

Every setting on every screen in this file is a `SettingPanel` (components.md, section 08). Closed, it shows its title and a `KeyValueList` of the current values, with an Edit secondary button. Open, it shows its form. Only one panel is open on a page; opening another while the first has changes asks first ("Save Publishing first, or discard the change?").

**SAVE BAR**

While a panel is open, the `SaveBar` sits fixed at the bottom of the viewport: "Saving: Publishing" on the left, Cancel (quiet) and Save (primary) on the right. Escape is Cancel, with the same question if there are changes. On a phone it sits above the keyboard (`visualViewport`). After a save, the panel closes and shows its new values, and the bar goes.

**SWITCHES THAT APPLY AT ONCE**

A setting that applies the moment it is pressed (Accepting reports, the development notice, freezing uploads) is not a form and has no Save. It is a pair of choice cards with a primary "Turn it off" or "Turn it on" button, and its result is a `Toast` ("Accepting reports is now off."). Errors stay inline as alerts, never toasts.

**SUCCESS**

After a save: the panel's new values plus a toast. Never a teal success box (teal means a moderator confirmed something).

---

### 03

### S I T E S E T T I N G S , O V E R V I E W

**`/settings`: the whole configuration on one page, every panel showing what is set**

**WHAT IT REPLACES**

Today `/settings` is a heading and one paragraph. It becomes the old Admin page's best feature: a page of closed panels that show the current state. Canvas: "Site settings · overview, one panel open".

**LAYOUT**

Eyebrow "ReportLog · Staff" (the site name), H1 "Site settings", lede, `AreaTabs` for the Site settings area (navigation.md, section 04). Below, a grid of `SettingPanel`s: two columns on desktop, one on a phone.

**THE PANELS, IN ORDER**

| Panel                | Closed, it shows                                                                   | Opens to                                                                                         |
| -------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Accepting reports    | Accepting yes or no; paused by the flood screen yes or no; logbooks open, "2 of 3" | The site-wide intake switch (today on `/logbooks`, `Switches.tsx`), applied at once with a toast |
| Publishing           | On or off                                                                          | Choice cards On and Off, saved with the Save bar                                                 |
| This site's name     | The two-tone name as it renders; the plain name used in emails                     | Link to Name                                                                                     |
| How this site looks  | Look name, palette, theme, number of installed looks                               | Link to Look                                                                                     |
| Wording              | "12 of 31 changed from the shipped wording", the last change and by whom           | Link to Wording                                                                                  |
| Legal notices        | Imprint and privacy policy: each "Written" or "Outline only"                       | Link to Legal notices                                                                            |
| Social media         | The platforms shown, by name, and how many are kept but switched off               | Link to Social media                                                                             |
| Report and tip forms | The minimum time a form must be open                                               | Link to Report and tip forms                                                                     |
| Development notice   | On, off or automatic, and until when                                               | Applied at once, with a toast                                                                    |

A panel that only links elsewhere has a secondary "Change" link where the others have Edit.

---

### 04

### L O O K

**`/settings/look`: choose a look, see it on a desktop and a phone, then apply it**

Canvas: "Site settings · Look, with previews" and "Site settings · Look · phone".

**PREVIEW ONLY**

At the top, a `deep` panel with `role="status"`: "Preview only. The site is still showing Desk. You are previewing Morning edition." with "Back to what the site shows" (quiet, on deep) and "Apply to the site" (primary). Before anything is chosen it says "The site is showing Desk." and has no buttons. Nothing on the page the administrator is using repaints until Apply, as today.

**THE PREVIEW FRAMES**

Two frames side by side on desktop: "Desktop" (a 1280px page drawn at about 0.55) and "Phone" (a 390px page at about 0.5). On a phone, the Phone frame only, with a "Show the desktop preview" secondary button under it. Each frame is a real miniature of the site in the chosen look, built from the same components: header with the wordmark and Menu, eyebrow, H1, lede, a primary and a secondary button, a report card with the three status chips (Confirmed, Serious, Open), a field, and the panel heading the theme uses. It uses the name the site has now. The frames set `data-palette`, `data-theme`, `data-panel-head` and `data-texture` on their own root, so they are painted by the site's stylesheet, never by a colour this screen computed. They are `aria-hidden`; the status line says in words what is being previewed.

**LOOKS**

A grid of choice cards (4 columns on desktop, 2 on a phone), one per named look, `role="radiogroup"`. Each card shows a strip painted by its palette (deep, page, action, surface), the look's name, and "On the site" as a tag chip on the current one. Choosing a card changes the frames and the status line.

**OR CHOOSE THE TWO PARTS YOURSELF**

Two selects under the grid: "Palette, the colours" (each option labelled light or dark, with its description as the option's hint) and "Theme, the type and shapes". Choosing either updates the frames. If the pair matches a named look, that card shows as chosen.

**APPLY AND REVERT**

Apply saves palette and theme together with no step-up (as today's route), applies them, shows the toast "The new look is live." and resets the status line. "Back to what the site shows" puts the chooser back on the current look. Leaving with a preview unapplied asks first.

**ADD LOOKS FROM A FILE**

A `SettingPanel` at the foot of the page, for the owner and administrators (looks/README.md, section 05):

1. "Choose a .zip" (the `FilePicker`, never a native file input) and one sentence: "A look pack is a .zip with a look.json and its fonts. Every colour is checked before anything is installed."
2. After choosing, the server runs `check()`. If it fails: an error alert listing every sentence the check returned, grouped by palette or theme, and nothing is installed. If it passes: "This pack adds 3 palettes, 1 theme and 2 looks." with the new looks shown as cards and an "Install" primary button.
3. Install asks for a step-up, then installs. The new looks appear in the grid at once, with a toast.

Under it, "Installed": one row per pack, "ReportLog, built in · 17 palettes · 10 themes · 16 looks", then each uploaded pack with its version, who installed it and when, and a Remove quiet button. Remove is refused, with the reason in words, while any of the pack's looks is on the site.

---

### 05

### N A M E , W O R D I N G , L E G A L

**Text the site shows, edited where you can see how it will read**

**NAME** (`/settings/name`)

Kept as built: the field, the help on double and single quotes for the two accents, and the live two-tone preview, now drawn inside a miniature of the real header bar so it shows on the deep surface it will sit on, and a second preview on the page ground for the lock screen and emails. Save with the Save bar.

**WORDING** (`/settings/words`)

Kept: one entry per slot, grouped by the page it appears on; the "still the shipped wording" note; "Go back to the shipped wording"; "Insert a number" with the figure picker that inserts at the cursor; the server's refusal of a broken placeholder, shown beside the field.

Changed: the list is a page of closed `SettingPanel`s, one per slot, each showing its current text (first two lines) and its status ("Shipped wording" or "Changed 20 Oct"). Opening one shows, beside the editor on desktop and above it on a phone, **the slot in context**: a miniature of the part of the page it sits on, in the site's look, with the slot's text updating as it is typed and placeholders shown as their current figure. An empty optional slot shows a dashed outline where it would appear, so an operator can see what they are not using yet. This replaces the old on-page "Edit content" mode: the text is still edited in a form, never on the public page.

**LEGAL NOTICES** (`/settings/legal`)

Kept as built: the two legal kinds (`LEGAL_KINDS`), imprint and privacy policy, as free text, published unchanged, and the plain warning while the editor still holds the outline. Each is a `SettingPanel` whose closed state says "Written" or "Outline only, not published" and shows the first lines. The terms are not a legal notice: they are wording slots, edited on the Wording page.

**SOCIAL MEDIA** (`/settings/social`, added 25 October 2026)

The site's accounts elsewhere: Facebook, Instagram, Threads, Bluesky, TikTok, YouTube, Mastodon, X, Telegram and WhatsApp (`SOCIAL_PLATFORMS`), one `quiet` card each with the platform's mark, an address field and its own "Show on the site" checkbox. The address takes a link (with or without `https://`) or, where the platform has them, a handle; the card says the link a handle stands for as it is typed. An address on another site, a platform's own front page, or anything not https is refused in words beside the field, by the same `socialAddress` the server checks with. The checkbox is disabled until there is a valid address, and emptying the address switches it off; an address may be kept switched off. One Save bar for the page.

What is switched on is drawn as marks in the footer of every page (`aria-label` "Site on Platform") and, named, as the front page's "Follow us elsewhere" section, which the front page's editor may hide or move like the others. Each is a plain link sent with `rel="me noopener noreferrer"`: the marks are bundled paths (Simple Icons, CC0) in the text colour, never fetched and never in brand colours, and nothing is embedded. On a door the footer asks nothing, so it shows none.

---

### 06

### T H E O T H E R S E T T I N G S P A G E S

**Forms, starting points, development notice, the feedback queue and testers**

**REPORT AND TIP FORMS** (`/settings/forms`)

One `SettingPanel`: the minimum time a form must be open before it is sent. Kept: the "Set elsewhere" section, now a `quiet` panel listing where the other door settings live (the puzzle on the flood screen, the per-address limits as server settings, the refusal sentence as a wording slot), each as a link where there is a screen.

**STARTING POINTS** (`/settings/starting-points`)

Kept: the same templates as the setup wizard, through the same route; choosing one applies nothing. Each template is a choice card with its one-line description. "Apply it…" opens the dialog that lists, in the server's own words, every setting it will change, with "Apply it" (primary) and Cancel. Nothing on the page moves while the dialog is read.

**DEVELOPMENT NOTICE** (`/settings/development`)

Kept: a switch, not a form, applied at once. Three choice cards: "Automatic after a deploy", "On until…" (with the end time), "Off now". The current state as the panel's summary, the change as a toast.

**FEEDBACK QUEUE AND TESTERS, TWO PAGES**

- `/settings/feedback` is the administrators' feedback queue (`FeedbackQueue`). Administrators only. It sits in the menu under Site settings, as "Feedback queue".
- `/feedback/testers` is the Testers page (`OnlyFor` administrators and access managers). Access managers cannot see Site settings, so it sits in the menu beside Feedback in the "You" row (navigation.md, section 02), where both audiences reach it, and is linked from the feedback queue.

---

### 07

### T H E S E T U P W I Z A R D

**`features/identity/SetupWizard.tsx`: seven steps, a progress bar, and the same preview as the Look screen**

**STEPS, KEPT**

Owner, Name, Start (starting point or "Skip, set everything up myself"), Publication ("Yes, publish approved reports" or "No, keep everything internal"), Files ("Yes, take files" or "No files"), Look, Password (keep it or change it). Back only where it is safe, as built.

**CHANGED**

- The header shows the wordmark only, no Menu. The header's bottom rule is the progress bar, as on a filing card (navigation.md, section 01), and the line "Step 3 of 7" stays above the step title.
- Every choice is a choice card with its description; no small radio dots.
- The Look step uses the Look screen's grid of named looks and its two preview frames, showing the name typed at the Name step. The Desk look is chosen to start with.
- The Name step uses the Name screen's header preview.
- Each step is one question with a primary "Use this and continue" at the bottom, full width on a phone.

---

### 08

### L O G B O O K S

**`/logbooks`: the list, and making one**

**THE LIST**

H1 "Logbooks", the area's `AreaTabs`, then one row per logbook as a raised panel: title, state as a chip (`tag` "Draft", `tag` "Open", `tag` "Closed", `tag` "Counts only" where it applies), the number of reports, its filing address in mono, and Open (secondary). An empty site shows the `EmptyState` "No logbooks yet" with "Make a logbook" as its action. The site-wide intake switch moves to the Settings overview; this page links to it in one sentence.

**MAKE A LOGBOOK**

A primary "Make a logbook" button opens a `SettingPanel` on the page (not always open, as today):

1. "Start from": choice cards, one per template, with "Start from nothing" first.
2. Title, Web address (optional), as fields.
3. "Or upload a logbook file": the `FilePicker`. No native file input.
4. "Make the draft" (primary).

**NEW REPORTS, ACROSS THE SITE**

The "New reports, across the site" card moves to the Settings overview's Accepting reports panel.

---

### 09

### T H E L O G B O O K B U I L D E R

**`/logbooks/:id`: a draft is editable; a launched logbook says what is frozen and why**

**HEADER**

"← All logbooks" (quiet), eyebrow with the state, H1 the logbook title, chips for its state, and on the right "As a file" with two downloads: "The logbook file" and "Its chain".

**PANELS, IN ORDER**

| Panel                       | Closed, it shows                                                    | Notes                                                                                  |
| --------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Title and description       | Both                                                                | Editable before and after launch                                                       |
| Asking for an email address | Asked or not, and why (decision 55's rule in words)                 | "Ask for an email address anyway" kept                                                 |
| Questions                   | The numbered list, always visible (not a closed panel)              | See below                                                                              |
| Taking reports              | Open or closed, opening and closing times                           | "Opens (leave empty to open now)", "Closes (leave empty for no end)"                   |
| Without the site password   | Who can file without it, with the filing link in mono               | From `Switches.tsx`                                                                    |
| Files                       | Uploads on or frozen, and the limits, with the site default in grey | Freeze and unfreeze apply at once with a toast; per-logbook limits link to File limits |

**QUESTIONS**

One raised card per question, in order: number, the question as the reporter reads it, chips for its kind (`tag`, mono: LOCATION, CHOICE ONE, DATE…), "Needed", "Filter", "Sometimes", the sentence "Asked only when How it went is Something went wrong" where it has a condition, and "answered under `problems`" in mono. Buttons: Move up, Move down, Edit (draft) or Reword (launched).

"A filter on the board" is a checkbox choice card inside the question's editor, not a native checkbox beside the Reword button.

**ADD A QUESTION**

A `SettingPanel` "Add a question" with the existing `QuestionForm` fields, all kept: kind (choice cards, with per-kind help), the question, help, choices one per line, "An answer is needed", "Offer it as a filter on the board", place lists, county depth ("How exact"), "Let people type a place that is not on the list", date bounds (Earliest, Latest), "asked on the same card as the question above it", and **"Ask it only when"**: a select of an earlier question, then choice cards of "The answers that bring it up". After launch, "An answer is needed" is shown locked with the sentence "After launch, a new question can only be optional." (decision 48).

**AFTER LAUNCH**

A `quiet` panel above the questions: "Launched on 20 Oct. The questions' keys, kinds, order, conditions and codes are frozen, so every sealed report still checks. You can reword a label or help, and add an optional question." Reword opens `RewordForm` in the question's card, showing old and new wording side by side.

**LAUNCH AND DELETE**

Launch is a primary button at the foot of a draft, with the one-way-door paragraph above it and a confirm dialog. Delete this draft keeps `TypeToConfirm`.

**PREVIEW AS A REPORTER**

Neither app had one. A secondary "Read it as a reporter" opens `/file/:slug` in a new tab, for a draft too (in a preview mode the server already allows to the logbook's administrators, or, if it does not, the button is left out; see limitations).

---

### 10

### F R O N T P A G E , L I S T S , M A P S , F I N D E N T R I E S , F I L E L I M I T S

**The rest of the Logbooks and lists area**

**FRONT PAGE** (`/logbooks/front-page`)

Kept: buttons in order with Move up and Move down, optional wording, "Not on the page" for the ones left off. Added: a live phone-width preview of the front page's button stack beside the list (above it on a phone), in the site's look, updating as the order or wording changes. The built-in alerts button is the sign-up for the journalist alert list (`apps/api/src/logbooks/homeButtons.ts`, where its `href` is null today): it is drawn, linking to `/journalists/alerts` with no sign-in, instead of being skipped.

**LISTS** (`/lists`, `/lists/:id`)

The list page matches the logbook list. "Make a list" first asks "Does it have to be permanent and checkable?" as two choice cards: "Yes" leads to "Make a logbook instead", "No: links, check-ins or messages" continues. The list editor's panels follow section 09: Questions, Taking entries, Without the site password, Who can see it, Ask for an email address, Email each new entry, Countable and Publish the counts, and "Counts so far" as a read-only summary.

**MAPS** (`/maps`)

Now in the menu (navigation.md, section 04). The page keeps the two decisions in order: first "Which question places a report", per logbook and per list (a logbook with no location question listed with the reason); then the maps, each a `SettingPanel` whose closed state shows title, short name, on or off, threshold in words, feeds, planes and "Where it appears", and the public address in mono. The server's refusals appear beside the setting they refuse. "Make a map" is a primary button; an empty page shows the `EmptyState` "No maps yet".

**FIND ENTRIES** (`/lists/search`, administrators)

Kept as built, with the page pattern: H1, a search field, results as rows.

**FILE LIMITS** (`/files/settings`, `/files/logbooks/:id`)

A `SettingPanel` "How big, how long, how many": closed, the old key-value table (Largest photo, Largest video, Largest audio file, Largest PDF, Longest video, Most pages in a PDF, Most files on one report, Most in total on one report), "not set" in `ink-alt` where unset. Per-logbook limits show the site default in `ink-alt` beside each value.

---

### 11

### W H A T T H E L O G B O O K S A R E A S H O W S O N A P H O N E

**One column, the same panels**

Every panel stacks. Key-value lists stack key over value. The question cards keep Move up and Move down as full-width secondary buttons in a two-column row. Downloads sit under the H1. The Save bar sits above the keyboard.

---

### 12

### P E O P L E A N D A C C E S S

**Roles, organizations, journalists, roster, audit, two-factor resets, site password, handover**

**ROLES** (`/access`)

Today one long page. It becomes `SettingPanel`s, in this order, each shown only to those who may use it:

| Panel                                 | Closed, it shows                                                                      | Who                                                     |
| ------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| You                                   | Your role, your desks, your two-factor state, with a link to Account and security     | Everybody with a role                                   |
| People with a role                    | A table: email in mono, role, since, granted by; Remove per row                       | Administrators, access managers                         |
| Give somebody a role                  | (a form: their email address, the role as choice cards limited to what you may grant) | Administrators, access managers; the role ceiling stays |
| Reset somebody's second factor        | (a form: their email address)                                                         | Owner, with the step-up it has today                    |
| The site password                     | On or off; when changed                                                               | Administrators, as today; no step-up                    |
| The owner                             | Who it is                                                                             | Everybody with a role                                   |
| Hand it to                            | Pending handover, if any                                                              | Owner, with the step-up it has today                    |
| You have been offered this deployment | (shown only to the recipient: the code from the email)                                | The recipient                                           |

**ORGANIZATIONS** (`/access/orgs`, `/access/orgs/:id`)

The list as rows with logo, name, listed or not, people count. "Make an organization": its name and first manager's email. One organization: panels for People (with Invite somebody, Invitations waiting, Add a manager directly), How it appears (listing switch, logo through the `FilePicker`).

**JOURNALISTS** (`/access/journalists`, owner only)

Kept as built: requests the owner decides one by one, nothing automatic. Each request is a raised panel: who, outlet, states, the links they sent shown as mono text, never as links (the owner copies one on purpose; the site never fetches it), and Approve (primary) and Reject (secondary). Reject's dialog says it deletes what they sent and leaves them on the alert list. Approved journalists are listed with Revoke, which says it takes effect on their next request. The agreement (`/access/journalists/agreement`) is a tab in the page header, not a separate link.

**WHO IS DOING WHAT** (`/access/roster`)

Kept: everybody with a role, flag or organization, how much they filed and when they last acted. Nothing flags volume; no colour, no ranking, sorted by name. Putting somebody on the team and their desks stays here.

**WHO GRANTED WHAT** (`/access/audit`)

Kept: the grant and revoke history as a table, newest first, mono timestamps, with Pagination.

---

### 13

### R E C O R D S

**Transparency log, backups and exports, who opened protected data**

**TRANSPARENCY LOG** (`/transparency-log`, administrators)

Read only, on purpose. A `deep` panel at the top answers the page's one question in a sentence: "The archive's daily claim was last published 21 Oct 06:00, to 2 places this server does not control." Under it, a table of recent anchors (date, chain heads count, where published, in mono). A `quiet` panel says the log is never rewritten, and that a fact which invalidates published proofs is published beside them by a server command, not a button. No form and no button on this page changes anything.

**BACKUPS AND EXPORTS** (`/backups`, owner only)

Kept: start a backup or an archive export, then download the finished file from this server. Each start is a primary button; each finished file is a row with size, time and Download, and beside every download the sentence "Downloading is recorded in Who changed what before the file leaves." Restore stays a command, shown in a mono block with a copy button, under "Nothing here restores."

**WHO OPENED PROTECTED DATA**

Today a section of Moderation settings. It moves to Records as its own page, listed in the menu: a table of every access to observer identity (Tier B), newest first: who, when, which report (reference in mono), and the written reason in full. Read only. No filter can hide a row; the page shows a count line ("214 openings · since 1 Oct"). The route for it is new; until it exists, the menu links to the section where it is today.

---

### 14

### K N O W N L I M I T A T I O N S , P R E C I S E L Y

- Only the overview and the Look screen are drawn on the canvas. Every other screen in this file is specified in words against the components and has no mock-up.
- The Look preview frames are drawn at fixed scales on the canvas. Whether to draw them with CSS `transform: scale` (as the canvas does) or a same-origin `iframe` of a preview route is not decided; `transform` keeps fonts and states identical, an iframe isolates the preview's focus order. Either must stay `aria-hidden`.
- The Wording page's in-context preview needs a miniature of each page section a slot sits on. There are 31 slots; which sections need their own miniature, and which can share one, is not worked out.
- "Read it as a reporter" for a draft logbook assumes the server can serve a draft's form to its administrators without sealing anything. If it cannot, the button appears only after launch.
- Moving "Who opened protected data" to Records is a new route and a menu change. The access log itself does not change.
- Moving the site-wide intake switch and "New reports, across the site" from `/logbooks` to the Settings overview moves components between workstreams' folders (`features/builder/` to `routes/(staff)/settings/`).
- Decision 27 is reversed in part by this file, and the owner agreed on 22 October 2026 (decision 61): panel summaries and the live look preview come back, and the Wording page previews each slot in context instead of an on-page edit mode. "Extra policies" stays dropped.
