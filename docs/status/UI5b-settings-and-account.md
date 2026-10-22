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
