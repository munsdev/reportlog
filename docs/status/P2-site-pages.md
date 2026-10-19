# P2 · Site pages and settings that nobody owned (G3): status

For the coordinating session and the other workstreams. Brief: `docs/parity.md` §7, P2.

- **Branch:** `claude/p2-site-pages`, based on `ccr-c9c93698-ev856l`; the base was merged in again at `faa4b68` (D3 and P7 merged)
- **Pull request:** see below, into `ccr-c9c93698-ev856l`
- **State:** finished, waiting for review. Not merged.
- **Last updated:** 2026-10-19

## Checks, as last run before pushing

| Suite                                   | Result                                                                                                                                                  |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check`                            | passes: format, lint, types, boundaries; unit tests api 287, web 440 (P2's: api 5, web 17)                                                              |
| `pnpm test:db`                          | 52 files, 820 passed (P2's: 18, in `site-pages.test.ts`)                                                                                                |
| `db:types:check`                        | generated types up to date (part of `pnpm check`'s typecheck run)                                                                                       |
| Browser suite (`CHROMIUM_PATH`, `CI=1`) | 133 passed, 3 skipped (P2's: 9 passed; its 3 settings tests run on desktop only, as they change site-wide settings, and are the 3 skipped on the phone) |

## What was built, in the order asked

1. **Dev mode and the development badge.**
   - Migration `20261019205443_site_dev_mode.sql`: `site_settings.dev_mode_until` and
     `last_seen_build`, both nullable, neither ever sealed.
   - `apps/api/src/site/devMode.ts`. An **expiry**, never a flag, as in legacy: a notice left on
     by accident teaches testers to ignore it. Every time is the database's.
   - **A deploy arms it by itself.** `server.ts` calls `armDevModeOnDeploy(db, releaseOf())` at
     startup. It compares the release's `REVISION` with `last_seen_build`; a changed build arms
     the notice for 6 hours (never shortening a longer window an administrator set), the same
     build (a crash-restart loop) does nothing, and the first start that knows its build only
     records it. A checkout has no `REVISION` and is left alone. Legacy armed on its git SHA;
     this is the same idea on H's release layout.
   - `GET/PUT /api/admin/site/dev-mode` (administrators; `{ hours }` between 0 and 168, or null
     for off now) and the screen `/settings/development`. A switch, not a form: it applies at
     once.
   - `GET /api/site` carries `dev_mode_until`. The badge (`components/ui/dev-badge.tsx`) shows
     "Under active development" in the corner, opens a dialog with legacy's wording, and takes
     itself down at the expiry without asking again. Neutral colours: no status colour on it.
2. **The five missing copy slots**, so all nine of legacy's exist: `about_archive` (About),
   `submit_intro` (`/submit`), `board_intro` (the board), `how_intro` (How to use this),
   `alliance_intro` (the directory). They render through one component, `CopyText`.
   - **`board_intro` is optional here, not in legacy.** Legacy's default ("Every submitted
     report, in real time") describes the board wrongly, and the board already has its own lede
     saying what it shows and that published is not true. A default would only repeat it.
   - `submit_intro`, `how_intro` and `alliance_intro` are optional, as in legacy: unwritten,
     they show nothing.
3. **About (`/about`), How to use this (`/how`) and the moderation standard (`/standards`).**
   - About: part one is the operator's (`about_archive`, then "how it works, briefly"); part
     two is the software's and no operator can rewrite it. Every claim in part two was checked
     against this code (the database guards, the contact access log the reporter sees, the
     role ceiling, the daily anchor). Legacy's claims that are not true here were not carried
     over: the count of guarded tables, TRUNCATE, the documents and changelog panels.
   - How to use this: legacy shipped placeholder sections. These describe the rebuild's
     filing: one card at a time, the publication question, the email confirmation (24 hours),
     moderation, "My reports", checking a reference.
   - The standard now has its own page; `/legal` holds the imprint and privacy policy and
     links to it.
4. **The public API page**, at `/public-api` (`/api` is the server's). It describes
   `/api/v1` and `/api/v1/stats` as the contracts in `board.ts` define them, the two rules
   about the numbers, the stability promise and the licence. It says the API is behind the
   site's password while the site is, which is true today (decision §8 item 2). **Not
   ported:** legacy's paste-in widget, which wrote its own colours into somebody else's page and
   described fields this archive does not publish.
5. **The footer's attribution and version line** (`components/ui/site-footer.tsx`).
   - "Powered by ReportLog, free software under the AGPL-3.0-or-later licence", with a link to
     the source, **on every deployment**, written from `SOFTWARE_NAME`, never from the site's
     name. It used to appear only when the site was renamed, as "Runs on".
   - The version line: `GET /api/site` carries `version: { release, build }`, read once when
     the routes are registered (`apps/api/src/site/version.ts`): `release` from the root
     `package.json`'s `version`, `build` from `REVISION`. **The root `package.json` has no
     `version` yet**, so a deployment shows "Build abc123…" and a checkout shows nothing. When
     the project starts numbering releases, the footer and H2's update check both pick it up.
   - Links: About, How to use this, Moderation standard, Imprint and privacy, the directory,
     Public API.
6. **An unsaved-changes warning in the shared settings editor** (`settings/-editor.tsx`).
   - **One question for the whole settings area**, held by the settings layout with
     TanStack Router's `useBlocker`. Each editor says whether it differs from what the server
     holds; the question names every one that does. Page wording has nine boxes, and nine
     blockers would ask nine times.
   - "Differs from the server", not "was typed in": a change undone by hand asks nothing, and
     a save clears it. Closing or reloading the tab gets the browser's own question.
   - Wired into Look, Name, Page wording and Legal notices. The front page's buttons (B's
     screen under `/logbooks/front-page`) are outside the settings area and not covered.
7. **Figures in the page wording.**
   - `GET /api/site` renders `{{ … }}` placeholders with D1's `renderText` and `figureValues`.
     The stored text keeps the placeholder, so the editor edits what was written.
   - **Only while the archive is public**; otherwise a placeholder shows "?". This follows
     D1's rule for `/api/board/figures` (counts from a site that publishes nothing are a leak).
     Legacy rendered them always.
   - A save whose placeholder would not work is refused, with D1's `checkText` sentences, as
     legacy did.
   - The wording editor has "Insert a number" for paragraph slots, fed by
     `GET /api/admin/site/figures` (administrators; asked for only when opened). It inserts
     where the cursor was, or at the end if nobody put the cursor in the box.

**Left out, as asked:** "Get the app" and the service worker (§8 item 9). **Skipped:** the style
guide; it is not nearly free.

## Legacy tests and their equivalents

| Legacy                                                                      | Here                                                                                                                          |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `selftest.js` "Attribution survives renaming"                               | `apps/web/test/site-pages.test.tsx` "the footer"                                                                              |
| `selftest.js` "numbers in an operator's own wording" (the route half)       | `apps/api/test/db/site-pages.test.ts` "numbers in an operator's own wording"; the pure half is D1's in `U/moderation.test.ts` |
| `devMode.js` (no self-test existed)                                         | `apps/api/test/db/site-pages.test.ts` "the development notice", "a deploy arms the notice"                                    |
| `admin-editors.js` `confirmDiscard` / `beforeunload` (no self-test existed) | `apps/web/test/site-pages.test.tsx` "unsaved changes"; `apps/web/e2e/site-pages.spec.ts`                                      |
| `tools/browser-tests` no-third-party check, for each new public page        | `apps/web/e2e/site-pages.spec.ts` (About, How, Standards, Public API)                                                         |

## Parity rows this closes

- `admin.js` GET/POST `/dev-mode`; GET/POST `/copy` (9 of 9 slots); GET `/figures` (wording now wired).
- `selftest.js` "attribution survives renaming"; "numbers in an operator's own wording" (the
  list figures are still P5's).
- Screens: `admin-editors.js` (the unsaved warning; closed-panel summaries are not built),
  `contents.js` (About and How exist; the About map slot and changelog are not built),
  `feedback.js` (the badge and the footer version line; on-page edit mode is not built),
  `routes.js` (Standards), `static-page-brand.js` (`api.html`; `app.html` left out as asked).
- Migration 001: `dev_mode_until` and `last_seen_version` (here `last_seen_build`).

## Changes outside P2's folders (named in the commit messages)

- `apps/api/src/server.ts`: one line, arming the notice at startup.
- `apps/api/src/site/` reads `board/figures.ts` and `board/publication.ts` (D's). No new
  boundary rule was needed; `pnpm boundaries` passes.
- One `<CopyText>` line each in `features/board/Board.tsx`, `features/site-pages/Directory.tsx`
  and `routes/submit.tsx`.
- `apps/web/e2e/site.spec.ts`: the legal page's test follows the standard to its own page, and
  the footer link is now "Imprint and privacy".
- `apps/web/test/ui/site.test.tsx` (G's): "every slot is read by some page" now also looks in
  `features/` and recognises `<CopyText slot="…">`.
- `apps/web/e2e/identity/access.spec.ts` (A's): the door test clicks the **header's** "ReportLog"
  link (`getByRole('banner')`). The footer's attribution is now a second link with that name.
- `schema.gen.ts` and `routeTree.gen.ts` regenerated.

## Not done

- **`submit_intro` with only one logbook open.** `/submit` sends somebody straight to the
  form, so the intro is not seen. Putting it on the form's opening card would add text that
  arrives after the card is drawn, which "nothing changes underneath" forbids, and the form
  is C's. It needs the text to be part of the form's own load.
- **The badge on the lock screen and on a door.** It reads `/api/site`, which is behind the
  password; legacy carried it on the lock screen's status call (A's `site-access/status`).
- The About page's contents strip that follows the reader, its map slot and changelog;
  the editors' closed-panel summaries; on-page edit mode.
- A root `package.json` `version`, so the footer can show a release number.
