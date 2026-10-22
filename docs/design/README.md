# REPORTLOG DESIGN

## T H E I N T E R F A C E , F O R T H E B U I L D

**Everything Claude Code needs to rebuild the ReportLog interface, in the order to build it**

21 October 2026 · approved by the owner: model B navigation, the old character made better, the look library · `apps/web`, with small parts in `apps/api` and `packages/contracts`

---

### 01

### W H A T T H I S I S

**A design, written down so it can be built in parallel and checked against the pictures**

**THE PROBLEM IT FIXES**

The TypeScript rebuild reached feature parity and lost the interface: the navigation is unusable on a phone, the visual character is gone, and conveniences the old app had (look previews, setting summaries, inline moderation, live search, counts) are missing. `docs/design/` is the answer, screen by screen.

**WHAT IS FIXED AND WHAT IS NOT**

Fixed: every hard rule in `CLAUDE.md`, every route and guard, every API shape, the sealing code. This is presentation. Where the design needs something from the server (a look pack table, a waiting-count endpoint, theme metadata in `GET /api/site`), it says so in the file concerned, and it is small.

**WHEN A FILE AND A PICTURE DISAGREE**

The file wins. The canvas is drawn by hand; a difference is a bug in the canvas.

---

### 02

### T H E F I L E S

**Read them in this order**

| File                                      | What it settles                                                                                        |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `README.md`                               | This page: order, rules, the token names                                                               |
| `looks/README.md`                         | Palettes, themes, named looks, look packs, the migration, Easier reading                               |
| `looks/reportlog-core.look.json`          | The built-in look pack: the data                                                                       |
| `looks/look-pack.mjs`                     | Reference `check()` and `toCss()`; port it                                                             |
| `looks/looks.css`, `looks/migration.json` | Its output for the built-in pack; old ids to new                                                       |
| `components.md`                           | Every component, variant and state                                                                     |
| `reference/components.css`                | The same components as plain CSS on the look variables. A visual reference, not for shipping           |
| `navigation.md`                           | Header, menu panel, phone sheet, staff areas, area tabs, footer                                        |
| `screens/public.md`                       | Front page, board and its pages, a report, verify, about pages, journalists' public pages, lock screen |
| `screens/filing.md`                       | Every filing screen and card, ElectionLog's forms, confirmation, evidence, erase                       |
| `screens/moderation.md`                   | Queue, one report, flood screen, tip links, list review, notices, files, settings                      |
| `screens/settings-and-admin.md`           | Site settings, Look with previews, setup wizard, logbooks, lists, maps, access, records                |
| `screens/account.md`                      | Sign in, two-factor, security, my reports, email updates, desk, intake, feedback                       |
| `checks.md`                               | What has to pass before any of this ships                                                              |
| `mockups/*.html`                          | Each canvas screen as a static page, for side-by-side checks in the browser suite                      |

The canvas "ReportLog Navigation" (an Artifact) holds the same screens with a look switcher on each.

---

### 03

### T H E B U I L D O R D E R

**Six stages; each ends green on all three suites**

**STAGE 1, THE LOOK SYSTEM**

Port `check()` into `test/ui/look.test.ts` and `toCss()` into the build, generate the built-in blocks of `styles.css` from `reportlog-core.look.json`, add the new theme variables and the three derived colours, bundle the 9 font families, retire Red Hat Mono, add `panelHead` and `texture` to the site response and apply them as `data-` attributes, ship the migration that pins existing sites to Flint and Signal. No screen changes yet. An existing site looks as it does today except for two deliberate changes: page titles become fluid again (2rem on a phone to 3rem on a desktop, as the old app had), and the mono face becomes IBM Plex Mono (as ElectionLog's brand sheet requires).

**STAGE 2, COMPONENTS**

Everything in `components.md`, each with a unit test and an entry on a components page reachable in development only. Replace every native radio, checkbox and file input.

**STAGE 3, NAVIGATION**

`SiteHeader`, `MenuPanel`, `MenuSheet`, `AreaTabs`, the staff areas in `entries.ts`, the progress rule. Delete `SessionNav` and `StaffNav` and the link rows in `settings/route.tsx` and `moderate/route.tsx`. Nothing changes in the web server.

**STAGE 4, PUBLIC AND FILING**

`screens/public.md` and `screens/filing.md`. Phone first.

**STAGE 5, STAFF**

`screens/moderation.md`, `screens/settings-and-admin.md`, `screens/account.md`. These can run as three parallel sessions; each stays in its own folders (`docs/workstreams.md`).

**STAGE 6, LOOK PACKS AND EASIER READING**

The pack tables, the installer, the upload screen and the command, serving pack files under `/api/looks/` (already sent to the app by Caddy, so no Caddyfile change), the Easier reading switch.

**VERSION**

Do not bump the version for this work in progress. Cutting a release is the owner's call.

---

### 04

### T H E T O K E N N A M E S

**What a component may use; nothing else**

| Tailwind name                                                      | Variable                                                                                    | Notes                                |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- | ------------------------------------ |
| `paper`, `paper-alt`, `deep`, `surface`, `line`                    | `--rl-background`, `-alt`, `-deep`, `--rl-surface`, `--rl-border`                           | as today                             |
| `ink`, `ink-alt`, `muted`                                          | `--rl-text`, `-alt`, `-muted`                                                               | as today                             |
| `on-deep`, `on-deep-muted`                                         | `--rl-text-on-deep`, `--rl-text-on-deep-muted`                                              | as today                             |
| `action`, `on-action`, `brand`, `brand-on-deep`                    | as today                                                                                    | action on buttons only               |
| `serious`, `on-serious`, `confirmed`, `on-confirmed`               | as today                                                                                    | status only                          |
| `deeper`                                                           | `--rl-background-deeper`                                                                    | new, derived: the open menu          |
| `line-on-deep`                                                     | `--rl-border-on-deep`                                                                       | new, derived: hairlines on deep      |
| `font-display`, `font-sans`, `font-mono`                           | as today                                                                                    |                                      |
| `font-label`                                                       | `--rl-font-label`                                                                           | new: buttons, tabs, labels, eyebrows |
|                                                                    | `--rl-label-transform`, `--rl-label-tracking`, `--rl-label-stretch`, `--rl-display-stretch` | new                                  |
|                                                                    | `--rl-h1-size`, `--rl-body-size`, `--rl-press`                                              | new                                  |
| `radius-card`, `radius-control`, `shadow-raised`, `container-page` | as today                                                                                    |                                      |

---

### 05

### R U L E S T H A T D O N O T B E N D

**From CLAUDE.md and the project instructions, as they touch the interface**

- One card asks one question. No auto-advance. Nothing on a card changes underneath the person; the county list following the state on the same card is the one exception.
- Nothing is public until a moderator approves it. Counts-only logbooks never show a single report in public.
- No third-party requests: fonts are bundled, look packs carry no URLs, no map tiles, no analytics.
- Colour is exclusive: action on buttons only; serious red and confirmed teal on status only.
- Every page passes the axe check, in every built-in palette, with nothing faded mid-transition.
- Phone first. 44px targets. Plain language everywhere a person reads.
- The rebuild is served by Caddy (`deploy/caddy/Caddyfile`, decision 43): `/api/*` goes to the app, anything else falls through to `index.html`. A new path that must reach the server and is not under `/api/` needs a `handle` block and a case in `apps/api/test/unit/deploy-caddy.test.ts`. The project instructions still say nginx and `electionlog.conf`; that describes the old app.
- Merging to master arms a deploy. Ask the owner first.

---

### 06

### K N O W N L I M I T A T I O N S , P R E C I S E L Y

- The canvas shows the main screens; the rest are specified in words and built from the same components. Any screen not drawn is flagged in its spec.
- Fonts on the canvas load from Google; in `mockups/` they fall back to system faces, because the font files are not in this folder. The app bundles them. Visual comparisons should use the app's own fonts.
- Two server additions are designed but not specified to the line: the waiting-count endpoint for the Menu button and the look pack installer. Each has its own section in the file concerned.
- The owner has approved the direction, the navigation model and the look library. The individual screen specs have not yet been read by the owner.
