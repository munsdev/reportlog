# Interface redesign, stage 5 (thread D) · Settings, admin and account screens: status

- **Branch:** `worktree-agent-a53ae8ea2e8927637`, from `18e8c55` (after stages 1 and 2,
  `docs/status/UI1-look-system.md`, `docs/status/UI2-components.md`).
- **State:** built; not merged; not pushed. One of five parallel threads of stage 5 and 6.
- **Scope:** `docs/design/screens/settings-and-admin.md` and `docs/design/screens/account.md`,
  checked against `docs/design/checks.md` §03 SETTINGS and decision 61. Navigation (thread A),
  public and filing (B), moderation (C) and look packs and Easier reading (E) are other threads'.

## What was built

### Site settings (`routes/(staff)/settings/`, new `features/settings/`)

- **The settings pattern** (`features/settings/panels.tsx`): `SettingsFrame` (one panel open at a
  time, and a `ToastProvider` for switches), `GuardedPanel` (a `SettingPanel` that tells the
  existing `UnsavedChangesGuard` about its changes **by the panel's own name**, only while open:
  "You have changes to Publishing that are not saved"), and `LinkPanel` (a setting with a page of
  its own: what is set, and a secondary "Change" link where the others have Edit).
- **Overview** (`/settings`): the eight panels of §03 in order, two columns on a desktop.
  Accepting reports (the site-wide intake switch, moved here from `/logbooks`, with the flood
  screen's pause and "Logbooks open 2 of 3"), Publishing (the archive switch, a form saved with
  the Save bar), This site's name, How this site looks, Wording ("12 of 31", the last change's
  day), Legal notices (each "Written" or "Outline only, not published", and the terms' state),
  Report and tip forms (the minimum time), Development notice.
- **Switches that apply at once** (`features/settings/Switches.tsx`): Accepting reports and the
  development notice are a pair of choice cards and one primary button ("Turn it off", "Turn it
  on"); choosing a card sends nothing; the result is a toast; an error stays as an alert.
- **Look** (`/settings/look`, decision 61): a `deep` status line ("Preview only. The site is still
  showing Desk. You are previewing Morning edition.") with "Back to what the site shows" and "Apply
  to the site"; the two preview frames; the 16 named looks as choice cards with a strip painted by
  their own palette and "On the site" on the current one; the two selects ("Palette, the colours"
  with light or dark on each option, "Theme, the type and shapes"); a named look shows as chosen
  when the two parts make it. Apply saves both axes with no step-up and toasts "The new look is
  live." Leaving with a preview unapplied asks first ("changes to the look").
- **The preview frames** (`features/settings/LookPreview.tsx`): each frame is a same-origin
  `<iframe>` with nothing loaded in it, holding a copy of the site's own stylesheets, drawn into
  through a React portal; the look is named on **the frame's own `<html>`** (`data-palette`,
  `data-theme`, `data-panel-head`, `data-texture`). The frames are `aria-hidden`, `tabindex="-1"`,
  their body `inert`. Desktop 1280×800 at 0.55, phone 390×640 at 0.5; on a phone, the phone frame
  only, with "Show the desktop preview".
- **"Add looks from a file"**: a clearly marked slot in `features/settings/LookPacks.tsx`
  (`AddLooksFromAFile`, a boxed comment saying thread E's upload replaces it at merge). Until then
  the "Look packs" panel lists the built-in pack: "ReportLog, built in · 17 palettes · 10 themes ·
  16 looks".
- **Name**: the field is open from the start; the Save bar appears once there is a change and names
  it; two previews, the header bar on the deep surface (with its Menu shape) and the page ground
  (`features/settings/NamePreview.tsx`, shared with the wizard).
- **Wording**: grouped by the page each piece is on; each piece a `SettingPanel` showing its first
  lines and "Shipped wording" or "Changed 20 Oct"; open, the editor beside (above, on a phone) the
  piece **in context**, in the site's look, updating as it is typed, placeholders shown as their
  figure, an empty optional piece as a dashed space (`features/settings/wording.tsx`). The server's
  refusal of a broken placeholder is shown beside the field. "Insert a number" and "Go back to the
  shipped wording" kept.
- **Legal notices**: a `SettingPanel` each, "Written" or "Outline only, not published" and the first
  lines; the outline warning and "Take it down" kept.
- **Report and tip forms**: the field open, the Save bar on a change, a toast on save; "Set
  elsewhere" as a `quiet` panel.
- **Starting points**: each template a choice card with its description; choosing shows what it
  changes and applies nothing; "Apply it…" opens the existing dialog.
- **Development notice**: the shared switch panel.

### Setup wizard (`features/identity/SetupWizard.tsx`)

"Step 3 of 7" with a progress rule under it; every step's primary button reads "Use this and
continue", `lg`, full width on a phone; the name step uses the Name screen's header picture; the
look step uses the Look screen's chooser and both preview frames with the name just given, starting
on the stored look (Desk on a fresh site). Choosing repaints only the frames until saved, as before.

### Logbooks (`features/builder/`)

- **The list**: one raised row per logbook (title, state chip, what it says about its state, the
  filing address `/file/<slug>` in mono, question count and files, "Open" secondary); "No logbooks
  yet" as an `Empty`; "Make a logbook" (primary) opens the form, which gets a Cancel. The intake
  switch is gone from here (to the overview) and a sentence links to it.
- **The builder's own controls** (`controls.tsx`): `Panel` is now the shared `Card` with the theme's
  heading, fields use the shared field edge, `Problem` is the shared serious alert. Every builder
  screen picked these up without being edited.

### People and access, records

- **Access** (`/access`): panels in §12's order (You, People with a role, Give somebody a role,
  Reset somebody's second factor, The site password, then the owner's seat and handover); the role
  to give is choice cards limited to `MAY_GRANT` for the person giving it. The identity screens'
  `Panel` and `TextField` (`features/identity/ui.tsx`) now draw the shared panel and field.
- **Transparency log**: a `deep` panel first answering the page's question in a sentence; the
  anchors as a table with mono values; a `quiet` panel saying the log is never rewritten. Read only.
- **Backups and exports**: panels; beside every download, "Downloading is recorded in Who changed
  what before the file leaves."; the restore command under "Nothing here restores." with a "Copy
  the command" button.

### Account screens

- **Sign in**: eyebrow, H1, lede "We email you a code. No password to remember.", one raised panel
  whose content the code step replaces, `lg` block buttons, the code field mono and letter-spaced,
  "Use a different address" keeps the address, the help line under the panel.
- **The second factor**: "One more step" with "Sign in · step 2 of 2", the passkey button first and
  block, "Continue" (secondary under a passkey button), and "Signed in as … Not you? Start again",
  which signs out and returns to the address. Setting up: two choice cards ("An authenticator app",
  "A passkey", each with its note) and Next; only the passkey card, with a sentence, when the server
  has no authenticator key. "Copy the key" beside the written-out secret; "Turn it on"; "Add the
  passkey".
- **Recovery codes**: two columns of mono codes in surface boxes; "Copy them", "Download as a text
  file" (made in the browser), "Print them" (the print rules show only the codes and the site's
  name: `data-print-only`, styles.css); `lg` "I have kept them".
- **Signing in** (`/access/security`): three panels that say what is set before they open
  (authenticator app, "1 passkey", "7 recovery codes left."), one open at a time; a passkey's
  Remove asks in a dialog; the last way to sign in has no Remove and says why; after a change a
  "Done" alert at the top, with focus moved to it.
- **My reports**: whole-row links with a state chip (`open` "Waiting", `tag` "Public", "Not
  published", "Declined", "Withdrawn"; never teal, never serious); `Empty` when there are none;
  "← All your reports" above the title; each section a panel with the theme's heading.
- **Volunteer links**: the new link once, on a `deep` panel titled "Copy the link now" (not teal),
  with Copy and the sentence that only this screen shows it.

### Server and contract (small)

- `CopySlot.changed_at` (contracts `site.ts`): when the operator last saved a piece of wording, or
  null while it is the shipped wording. Filled from `site_copy.updated_at`, which already existed;
  no migration. It feeds "Changed 20 Oct" and the overview's "Last change".

## Decisions taken while building, for the owner to see

1. **The preview frames are iframes**, not scaled `<div>`s (§14 left it open). Two reasons the spec
   did not list: the panel headings and textures in `styles.css` are keyed on `html[data-…]`, so a
   `<div>` would draw them in the look the site wears now; and the phone frame then lays out to a
   390px viewport even on a desktop. The iframe loads nothing (about:blank), so there is no request
   for the CSP's `frame-ancestors` or `X-Frame-Options` to refuse. **Not verified behind Caddy's
   CSP**: the browser suite runs without it.
2. **Single-setting pages keep their field open** (Name, Report and tip forms) with the Save bar
   appearing on a change, instead of a closed panel with Edit: one more click to reach the only
   thing on the page helps nobody. Pages with several settings (overview, Wording, Legal) use panels.
3. **Switches are choice cards plus one button**, and choosing a card sends nothing. This keeps the
   old "asked before, never after" for closing the site to reports: choosing "Not taking new
   reports" (whose note says what happens) and then pressing "Turn it off" are the two acts.
4. **The development notice has two cards, not three.** The server knows "on until a time" and "off";
   "Automatic after a deploy" is not a state it can be put in, so it is said in the summary ("After
   a release: on by itself for 6 hours") and in the "Off now" card's note.
5. **"Last change" has a day but not a name.** `site_copy` has `updated_at` and no author; adding one
   needs a migration and a change to every write. Left out rather than guessed.
6. **The Wording page's "slot in context" uses four miniature shapes** (a title, the line under a
   title, a paragraph, a notice), with the page each slot is on written above it. The design left
   which sections need their own miniature open (§14); every slot the server offers maps to one.
7. **The security page's panels are not `SettingPanel`s.** Nothing there is a form to save: each change
   is its own action and asks for the step-up itself. They look and behave like panels (summary
   closed, one open at a time) without a Save bar that would save nothing.
8. **"Public" on My reports follows the board's rule** (approved, allowed, not withdrawn). The list is
   not told whether the site publishes at all or whether a logbook is counts only, so "Counted"
   (decision 54) is not shown. Needs a field on `MyReport` to do properly.
9. **Logbook rows show the question count, not the report count**: `LogbookSummary` carries no report
   count and no counts-only flag, so neither the count nor the "Counts only" chip is drawn.
10. **The role to give is choice cards**, so the browser tests now choose `radio` "Moderator" where
    they chose from a select. The button still says "Save".
11. **The step-up dialog keeps "Confirm"; the sign-in second step says "Continue"** (`ProveIt` takes
    the label).
12. **The builder's and identity screens' own small controls were restyled in place** (`controls.tsx`,
    `ui.tsx`) rather than every caller rewritten to the shared components: every builder and access
    screen took the look at once, and the callers did not change.

## Files outside this thread's folders, and why

- `apps/web/src/styles.css`: **lines added only**, at the end: the `data-print-only` print rule for
  the recovery codes.
- `packages/contracts/src/site.ts`: one field added to `CopySlot` (`changed_at`). Additive.
- `apps/api/src/site/copy.ts`, `settings.ts`: read `updated_at` and fill `changed_at`.
- `apps/web/src/features/flood/IntakeLinks.tsx`: only the "Copy the link now" block (account.md §12
  is this thread's); the flood screen is untouched.
- `apps/web/src/features/form/MyReports.tsx`: account.md §07 and §08; the filing screens are not
  touched.
- `apps/web/src/features/moderation/queries.ts`: **imported, not edited** (the archive switch's query).
- **Not touched**: `routes/__root.tsx`, the header and footer, `features/staff-nav/`, `SessionNav`,
  and `routes/(staff)/settings/route.tsx`, whose link row thread A removes. The settings pages
  mount their own `ToastProvider` (`SettingsFrame`), so they do not need the root to.

## Checks

| Suite                                     | Before (stage 2) | After                                                                             |
| ----------------------------------------- | ---------------- | --------------------------------------------------------------------------------- |
| web unit (`vitest run` in `apps/web`)     | 372              | 391 passed, 39 files                                                              |
| api unit (`vitest run test/unit`)         | n/a              | 470 passed, 21 skipped (one new test)                                             |
| `pnpm test:db`                            | 1373 in 90 files | 1373 passed in 90 files                                                           |
| `tsc` (web, api, contracts)               | clean            | clean                                                                             |
| eslint and Prettier on every changed file | clean            | clean                                                                             |
| browser suite                             | 1054 passed      | **not run** (fixed ports shared with the other threads; it runs once after merge) |

In one full web run under load, `setup-wizard.test.tsx` "a blank one is refused" failed once and
passed on every run after, alone and in the full suite; in one api unit run, two deploy-script tests
(`deploy-bugsink`, `deploy-install`) timed out and passed when run alone. Neither touches anything
changed here; reported because it happened.

**Browser tests written or changed, not yet run:**

- New `e2e/settings-screens.spec.ts`: one panel at a time and the question before leaving changes;
  the Save bar names what it saves, sits at the foot of the screen, Escape cancels (and asks with a
  change); on Look, choosing changes the two frames (read inside the frame's own document) and not
  `<html>`, sends nothing, and Back puts them back; **applying a look asks for no step-up with the
  step-up made stale** (`stale-step-up`; chromium only, puts the look back in `finally`); axe on the
  overview and Look in all 16 named looks plus High contrast dark with Commons, set by attribute,
  animations off; no third-party request from four settings screens.
- Changed for the new screens: `site-pages.spec.ts` (development notice as a switch, wording through
  its panel and the Save bar with the piece in context, the leave warning naming Publishing, and
  leaving Look with a preview), `door-settings.spec.ts` (reached from the overview's Change link, the
  Save bar), `in-front.spec.ts`, `builder.spec.ts` and `builder-switches.spec.ts` ("Make a logbook"
  first; the intake switch read on the overview), `two-factor.spec.ts` and `identity/access.spec.ts`
  (set-up cards and Next, "Turn it on", "Add the passkey", "Continue" on the sign-in step, the role
  as a card, the wizard's "Use this and continue" and palette select), `filing/intake.spec.ts`
  (the empty state's sentence), `board/extras.spec.ts` (the transparency log's sentence).

## Not done

- **Lists, maps, organizations, journalists, roster, audit, find entries, file limits, the front
  page preview, the logbook builder's §09 layout** (question cards, the after-launch panel, "Read
  it as a reporter"): they took the shared panel and field look through `controls.tsx` and `ui.tsx`,
  but none was rebuilt to its section of the spec.
- **Account screens not rebuilt**: invitations (§06), the declaration (§09), email updates (§10, which
  already used choice cards), journalists and the desk (§11, including "Copy the link"), intake
  batches and the account dialog (§12), feedback and testers (§13), guides (§14).
- **"Who opened protected data" as its own page under Records** (§13): a new route and a menu
  change; still a section of Moderation settings.
- **AreaTabs on the settings pages**: thread A's component; the pages leave room under the lede.
- **The Save bar above a real phone keyboard and the frames on a real phone**: not tried on a device.
- **Looked at** only through tests and the mock-ups' text; no screenshot comparison against
  `mockups/S-settings-desktop.html` or `S-look-*.html` was made, because the browser could not be run.

## Stage 5 follow-up (D2)

- **Branch:** `worktree-agent-ad904115eacce77a8`, from `dc199b9` (stages 1 to 3, 5 and 6 merged;
  thread B, public and filing, still running elsewhere).
- **State:** built; one commit; not merged; not pushed. Website only: no server, contract or
  migration change.

### What was built

- **The staff page frame** (`features/nav/StaffPage.tsx`, new): eyebrow "<site> · Staff", H1, lede,
  then `<AreaTabs />` under them, which takes the frame's fallback row. `Page` gained one optional
  prop, `eyebrow`. Every settings, access, records, logbooks-and-lists and files page uses it; the
  moderation screens get the tabs from `StaffHead` (`features/moderation/parts.tsx`), which now draws
  `<AreaTabs />` under its lede. The fallback row should no longer show on any staff area page.
- **Look offers installed packs**: `features/settings/looks.ts` has a catalogue (the built-in pack
  plus `lookPacksQuery`'s packs, `useLookCatalogue()`). The chooser's cards (a pack's look says
  "From Tideline"), both selects, the status line, the overview's panel ("17 looks, from 2 packs")
  and the preview frames (a pack theme's own panel heading and texture) all read it. Installing a
  pack says so in a toast and its looks join the grid. If the packs cannot be read, the built-in
  looks alone are offered.
- **Who opened protected data** is its own Records page, `/who-opened-what`
  (`features/moderation/AccessLog.tsx`): a table of every opening (when, in UTC and mono; who; what;
  which report, mono; the reason in full), newest first, a count line ("214 openings · since 1 Oct
  2026"), pages of 50, nothing that filters. It asks for 120 months, the most the call answers.
  **The menu entry in `features/staff-nav/entries.ts` now points at the new route** (it was an alias
  of `/moderate/settings#who-opened-what`). Moderation settings keeps a quiet panel with that id
  linking to the page. `e2e/navigation-table.ts` and `test/staff-nav.test.tsx` follow.
- **People and access**: Roles (`/access`) in the frame, its own link row gone (the tabs replace
  it). Organizations as rows with a "You are its manager" chip and an `Empty`; one organization as
  two sections, People (who is in it, with role chips and "Not joined yet"; Invite somebody, the role
  as two choice cards; Invitations waiting; Add a manager directly) and How it appears (the directory
  listing, the logo). "Who is doing what" (the roster: sorted by address, mono counts, a count line,
  the shared select). "Who granted what" (the audit as a table, mono UTC times, pages of 25).
  Journalists: status chips, the facts as a `KeyValueList`, links as selectable mono text, Reject
  asks in a dialog that it deletes what they sent and leaves them on the alert list, Revoke says it
  takes effect on their next request, and "Requests" and "The agreement" as the page's own tabs.
- **Logbooks and lists**: the lists page matches the logbooks list (raised rows, visibility and
  "Taking entries" chips, mono address and counts, Open; "Make a list" opens the existing form).
  Maps: "Make a map" primary, `Empty` "No maps yet", each map closed shows title, short name, on or
  off, threshold in words, what feeds it, planes, where it appears and the public address in mono.
  File limits: "How big, how long, how many" shows the eight limits and the kinds before it is
  opened ("not set" in the second text colour; on a logbook the site's number beside each), and
  "Taking files" is a switch that applies at once with a toast; the file pages' link row is a
  `TabRow`. The front page editor draws a phone-width picture of the button stack beside the list
  (above it on a phone), following moves and wording before saving. The builder (§09): eyebrow with
  the state, a state chip and the filing address; "As a file" beside the title with "The logbook
  file" and, once launched, "Its chain" (step-up first); each question a raised card with chips
  (kind, Needed, Filter, Sometimes) and "answered under `key`"; the after-launch quiet panel in the
  spec's words; "Add a question" as its own quiet panel inside Questions; "Taking reports" showing
  what is set first; panels in the spec's order; "Read it as a reporter" once launched.
- **Account screens**: invitations (two quiet panels; the three signed-in states, including signed
  in as somebody else, with "Sign out and use the invited address" and no accept button; Welcome
  with the Done alert). The volunteer-link join page (its four states, one "Join"). The declaration
  (a quiet "Nothing you type here is sent anywhere.", `data-print-only` instead of its own inline
  print rules, 11pt in print, the fingerprint wraps). Email updates (the save is a status sentence
  beside Save). The journalist desk (anchors as a `TabRow`, the deep "Before you use a link", each
  item a raised panel with the link as selectable mono text and "Copy the link", the tip count as a
  neutral `Count`, answers as pills, `Pagination`, `Empty`, the access-log line at the foot).
  Intake (the organization as choice cards; batches as raised rows with Open or Filed chips and mono
  counts; `Empty`; one batch with a count line, "Not ready: …" on each account, "Before filing" as a
  raised panel). Feedback ("About: Site settings" as a chip with "Not about this page"; the two
  questions as two-column choice cards; the reference in mono; issues with "#42" in mono and a
  status chip, `open` while open; the queue's filter as pressed buttons with counts and a count
  line; Testers with "Give the flag", mono addresses, quiet "Take the flag away", `Empty`). Guides
  (`/docs` as raised panels; each guide with its contents in a 14rem left column on a desktop,
  numbered steps as eyebrows, the "Why" fold-outs with a quiet panel inside).

### Judgement calls

1. **The audit page is called "Who granted what"**, the menu's name for it, and the roster "Who is
   doing what". The backups sentence now says "Who granted what" too: the spec says "Who changed
   what" there and "Who granted what" in §12, and one page should have one name.
2. **File limits and the builder keep their own Save buttons inside their panels** rather than the
   Save bar: the limits form checks every box before sending, and the builder is many small forms.
   The file-limits panel is closed by default and closes again after a save, with a toast.
3. **"Add a question" stays inside the Questions panel** (as a quiet panel of its own), so the
   browser tests' "Questions" region still holds the form. "A filter on the board" is still beside
   Reword, not inside the reword form: moving it would change what RewordForm sends.
4. **"Read it as a reporter" appears only after launch.** The server serves a draft's form to
   nobody, as §14 foresaw.
5. **The desk's "Your alerts" stays an open form** in a panel, not a closed `SettingPanel`: it is
   the journalist's only setting, and the browser test reads its radios straight after a reload.
6. **One "Make" button at a time**: the lists, logbooks and maps pages hide the header's button
   while the page is empty, because the empty state carries it.
7. **Left out because the server does not send it**: organization rows have no logo, listed state
   or people count (`listOrganizations` sends id, name and your role); testers have no "since"; the
   front page's built-in alerts button is still skipped (`homeButtons.ts` gives it no address). Each
   needs a small server change; none was made.

### Files outside this thread's folders

- `components/ui/page.tsx`: one optional prop, `eyebrow`.
- `features/moderation/parts.tsx` (`StaffHead` draws the tabs), `features/moderation/Settings.tsx`
  (the access-log section links to its page), `features/platform/Agreement.tsx` (`StaffPage`, an
  optional `tabs` slot), `features/staff-nav/entries.ts` (the access-log entry; File limits is also
  "here" under `/files/logbooks/`).
- New route `routes/(staff)/who-opened-what.tsx`; `routeTree.gen.ts` regenerated by the Vite plugin.
- Not touched: `routes/__root.tsx`, the public and filing screens, the journalist doors, the server.

### Checks

| Suite                                     | Result                                                     |
| ----------------------------------------- | ---------------------------------------------------------- |
| web unit (`vitest run` in `apps/web`)     | 481 passed in 44 files                                     |
| `tsc -p apps/web` (src, test and e2e)     | clean                                                      |
| eslint and Prettier on every changed file | clean                                                      |
| `pnpm boundaries`                         | no errors; the one existing `boot-guard.js` orphan warning |
| api unit, `test:db`                       | not run: nothing on the server changed                     |
| browser suite                             | **not run** (fixed ports); runs once after merge           |

New unit tests: `test/staff-screens.test.tsx` (the access-log page, the journalist queue's reject
question, the front page picture following a move, the feedback page name, the audit sentence);
two in `test/look-packs.test.tsx` (a pack's looks, palettes and themes on the Look screen and in its
frames; the built-in looks alone when the packs cannot be read); one in `test/files-staff.test.tsx`
(the closed limits panel, and closing after a save).

**Browser specs changed for the new selectors, not run:** `access-a2` (the tabs' "Who is doing
what" and "Who granted what"; the Logo heading at level 3), `identity/access` (the audit link; the
Done alert after accepting), `files/staff` (Edit the limits panel first), `lists` and `links` ("Make
a list" first), `maps` ("Make a map" first), `builder` and `builder-switches` (the filing address by
`data-filing-address`; the after-launch sentence), `site-g2` (a guide step's heading without its
number), `navigation-table` (the access log's address).

### Still not done

- The list editor's panels (§10: Questions, Taking entries, Without the site password, Who can see
  it and the rest as closed panels); it took the frame only.
- The journalist doors (`/journalists/alerts`, `/journalists/access` and its link page, the alert
  settings and stop pages): they are public pages too, and thread B has that set.
- The intake account dialog (§12), the correction page beyond the frame, and the volunteer links'
  rows.
- Whether the server's own refusal of a wrong address on an invitation reads well beside the page's
  new "signed in as somebody else" state was not traced.
- Nothing here was looked at in a browser; no screenshot comparison.
