# FT-U2: the public shell and the front page

Branch `claude/ft-u2-public-shell`, cut from the integration branch
(`d34ba03`). Brief: `docs/build/briefs/U2-public-shell.md` in the notes
repository.

## What is built

- **Social placements (D11).** Eight switches, each its own place the
  accounts show: `front`, `get_involved`, `after_filing`, `after_tip`,
  `journalists`, `menu`, `ticker`, `footer`. Contract in
  `packages/contracts/src/social.ts` (`SOCIAL_PLACEMENTS`,
  `resolveSocialPlacements`, `placementOn`); `Site.social_placements` for the
  public read, `SiteEditor.social_placements` and an optional `placements`
  on `PUT /api/admin/site/social` for the screen. Stored in a new nullable
  column `site_settings.social_placements` (migration
  `20261027013700_social_placements.sql`, adds only). Never chosen means every
  placement; left out of a save means kept; an unknown name is refused in
  words. The floating "Follow us" button keeps its own setting.
- **Site, Social media screen** has a "Where the accounts show" group, a
  checkbox per placement, one Save bar.
- **`<FollowBand placement="..." />`** (`features/follow/FollowBand.tsx`):
  a large link per account with its mark, platform and handle. It draws
  nothing when no account is on, its placement is off, or the page is a door
  (it asks the site through `useSite`, which is off on a door). No handle is
  in code: the handle is read from the stored address (`socialHandle`).
  `bleed` is the full-width form the front page uses. Used by the front page
  (placed in the public frame in `routes/__root.tsx`, directly under the
  header and ticker). **Other sessions drop it in** at `get_involved`,
  `after_filing`, `after_tip` and `journalists`; I did not edit those pages
  (U4, F1 and others own them).
- **Header:** the site's name from settings (already so), plus one button,
  "File a report" in the mock-up. It goes **straight to the logbook**: the
  front page's first button that goes somewhere (`mainAction`), the same
  target as the home page. The chooser is in the menu as "What do you want to
  send?".
- **Menu:** accounts as icons at the top (placement `menu`), the chooser link.
- **Ticker** (`features/nav/Ticker.tsx`): an optional line of the operator's
  words (new Wording slot `ticker_text`, ships empty) and a follow link to the
  first account. No strip when it has neither. Never on a form (`/file`,
  `/list`, `/submit`). On a phone only the link stays.
- **Footer:** accounts follow the `footer` placement.
- **Front page:** slogan in a solid bar under the headline (new Wording slot
  `home_slogan`, ships empty, editable in the front page editor); the edit
  buttons are now an edit bar, sticky under the header, with its buttons
  always at the left. **Owner only** (was administrator).
- **404:** the mock-up's page: "404", "That page isn't here", its sentence,
  "File a report" (the header's target) and "Front page".

## Decisions taken

- **Owner only for on-page editing.** The brief says owner only; the code
  had `admin`. An administrator still edits the same words from Site
  settings and the front page's routes are unchanged (admin guards).
  `hero-block.spec.ts` moved into `e2e/public-shell/shell.spec.ts` because it
  now needs the owner's seat.
- **One placement for "after a tip or a sign-up"**, as in the brief and the
  mock-up's single switch.
- **Placements default to on.** A site with accounts and no choice yet shows
  them where the mock-up does. No account, nothing shows.
- **Ticker and slogan words are Wording slots**, not code, so no brand text
  ships. They are also `optional`: empty shows nothing.
- **New e2e project `public-shell`**, one file (so serial), run after
  `chromium` and `phone` and before `identity`: it sets the site's social
  accounts and takes the owner's seat, both whole-site state, and puts both
  back.
- Lint needed `NODE_OPTIONS=--max-old-space-size=8192` in this container
  (eslint ran out of its default 2 GB heap). Not a code issue.

## Wording that differs from the mock-up

| Mock-up | Here | Why |
|---|---|---|
| Header button "File a report" | The first front page button's own label (the operator's; "Demo logbook" on the seeded site, "Submit a report" when none is set) | The label belongs to the operator; the target is the same one the home page's first button has. |
| Follow band: "Follow along on election day. Live counts, what moderators are seeing, and the reports as they are published. Share them; the world is watching." | "Follow {site name}" and "Follow along" | The mock-up's sentence is the instance's copy and promises live counts the code does not deliver. A neutral line ships. |
| Ticker: "Nov 3 / The world is watching / Every report is read by a volunteer ... / Nonpartisan" | Empty until the operator writes the Ticker slot; the follow link needs an account | Brand and event text is instance content. |
| Slogan "The world is watching." | Empty until the operator writes the Front page slogan | Same. |
| Menu: "Send a tip or offer to help" (to `submit.html`) | "What do you want to send?" | The brief's name for the chooser. |
| 404: "Front page", "File a report" | Same | |

## Not done

- **Headline fitting, the header background and the outlined second line.**
  These are U1's components (look format extension) and are not on the
  integration branch. The slogan bar and headline use the existing
  `font-display text-title` classes; nothing placeholder-shaped was added.
  When U1 lands, `FrontPageLayout` is where the fitted headline and
  background go (the `headline` and `slogan` slots).
- **The mock-up's full block editor** (`editor.html`, `editor.js`: block
  types text, steps, cards, cta, live; per-block bars; 20-step undo). The code
  has the page-blocks API for the headline block only (decision 79) and the
  front page editor for buttons, wording and sections. I kept those and made
  the entry bar the owner's, left-aligned. A block editor over arbitrary block
  types needs the pages API extended; it is a build of its own.
- **Follow band on Get involved, after filing, after a tip or sign-up, For
  journalists:** the component and switches exist; those pages are other
  sessions' to edit.
- The staff menu entries (U3 will say through the integrator).
- Mock-up styling of the header (wide one-line wordmark treatment, hero
  motifs) beyond what the existing tokens give.

## Suites

- `pnpm check`: green (web unit 547 tests; lint needed
  `NODE_OPTIONS=--max-old-space-size=8192` here).
- `pnpm test:db`: green, 96 files, 1477 tests (includes the new placements test).
- Browser suite, last full run on this branch: 1224 passed, 1 failed, 32 not
  run because that failure stops the chain. The 18 new tests in
  `e2e/public-shell/shell.spec.ts` pass at 390 and 1280. The 32 skipped ones
  (11 later projects) I ran project by project: all pass except three that
  **fail identically on the integration branch (`d34ba03` plus only my
  additive migration file), so are not from this branch**:
  - `identity/access.spec.ts:442` expects a Moderator radio; the screen has
    checkboxes (multi-role, decision 70).
  - `doors/doors.spec.ts:103` expects `/list/<slug>`, the lock screen links
    `/<slug>` (short address).
  - `flood/flood.spec.ts:142` expects the text "Paused since" in the notice.
  - `board-locked/board.spec.ts:86` fails the same way on the base when the
    project is run alone (its queue call fails); not investigated further.
- One fix after the first full run: the header's button is hidden below
  380px (the 320px header checks failed with a sideways scroll).
