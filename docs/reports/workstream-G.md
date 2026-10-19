# Workstream G (look, site and administration): status report

For whoever coordinates the workstreams. Written 19 October 2026 by the
session working on branch `ccr-6a9a8566-x4bc8m`.

- **Pull request:** [#1](https://github.com/munsdev/reportlog/pull/1), into
  `ccr-c9c93698-ev856l`. Open, not merged. CI green on both jobs; no review
  comments yet.
- **Commits:** `f6822f7` shared UI components; `e326422` browser-suite CI fix
  (foundation file, one flag); `c96cf89` palettes, themes and site settings;
  plus this report.
- PR #1 was opened with only the components, so other streams could use them
  early. It wasn't merged, and this session can push to only one branch, so
  the rest went on the same PR. **`e326422` is the components on their own,**
  if they are wanted before the rest.

## Needs a decision before merging

1. **The front page's buttons were built twice, by G and by B, and the two
   collide.**
   - B's branch `ccr-a9827e7a-smcut3` has `apps/api/src/logbooks/homeButtons.ts`,
     its own table, `/api/home-buttons` and `/api/admin/home-buttons`, and a
     screen at `(staff)/logbooks/front-page`.
   - This branch has `apps/api/src/site/homeButtons.ts`, a `home_buttons`
     column on `site_settings`, `/api/home/buttons`, and a screen at
     `(staff)/settings/front-page`.
   - Both contract files export `ButtonKind`, `AvailableButton`, `HomeButton`,
     `getHomeButtons` and `setHomeButtons`. With both `export *` lines in
     `packages/contracts/src/index.ts` the build fails on the duplicate names.
   - **Recommendation:** keep B's module, table, routes and screen. B owns
     logbooks and already handles closing them, which G can't. G would then
     remove its own `homeButtons.ts`, the `home_buttons` column use, the
     contract entries, the settings screen and their tests, and have the
     front page (`routes/index.tsx`) read B's `/api/home-buttons`. The
     `home_buttons` column in G's migration would stay, unused, since
     migrations are never edited. G is waiting on this decision before
     changing anything.
2. **All three branches have a migration named `20261018120000_*`**
   (`_site`, `_logbook_lifecycle`, `_identity`). The names differ, so the
   files don't overwrite each other, and the runner orders them by full
   name. None of the three depends on another, so it probably works. Check it
   after the merge anyway, and pick distinct timestamps from now on.
3. **Mounting G's settings routes needs A.** `siteAdminRoutes(app, db,
{ requireAdmin })` takes the guard as a required argument and is
   deliberately not registered in `app.ts` yet. A's branch
   `ccr-b78522c6-nw0aj6` exports `requireRole(request, roles)` from
   `apps/api/src/identity/guards.ts`. Once both are merged, wiring it is one
   line in `app.ts` with a small adapter. The settings screens then work;
   until then they say the server doesn't offer them yet.
4. **A changes `apps/web/playwright.config.ts` too.** It will conflict with
   G's `--host 127.0.0.1` fix in the same file. Keep the flag: without it the
   browser job times out in CI before any test runs, and CI on `c96cf89`
   showed the flag fixes it. A's branch doesn't have it and will likely hit
   the same timeout.

## What is done

| Step | What                                                                                                                                                                                                 | Where                                                                                              |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 1    | Text field, text area, select (native), checkbox, radio group, label, field hint and error, dialog, card, alert, page layout. Each is accessible (labels, keyboard, focus, contrast) and has a test. | `apps/web/src/components/ui/`, `apps/web/test/ui/`                                                 |
| 2    | 18 palettes and 6 themes, ported from legacy `tokens.css`. Applied at runtime with `data-palette` and `data-theme` on `<html>`. The theme sets no colour; status colours never go on buttons.        | `apps/web/src/styles.css`, `components/ui/site.tsx`, catalogue in `packages/contracts/src/site.ts` |
| 3    | Site name (two-tone marks), page wording (4 slots), imprint and privacy text, a web manifest per deployment, front-page buttons (see the collision above), and public routes for each.               | `apps/api/src/site/`, migration `20261018120000_site.sql`                                          |
| 3    | Front page, legal page, and five settings screens: Look, Name, Page wording, Legal notices, Front page.                                                                                              | `apps/web/src/routes/`, `apps/web/src/routes/(staff)/settings/`                                    |

Legacy tests and their equivalents:

| Legacy                      | Equivalent                                                | Status                                                                   |
| --------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------ |
| `legal-selftest.mjs`        | `apps/api/test/db/site.test.ts`, `test/unit/site.test.ts` | Ported                                                                   |
| `home-buttons-selftest.mjs` | `apps/api/test/db/site.test.ts`                           | Ported except closing a logbook (`it.todo`); B's branch has its own port |
| `alliance-selftest.mjs`     | none                                                      | Not ported: needs A's organisations                                      |
| `selftest.js` "The look"    | `apps/web/test/ui/look.test.ts`                           | Ported, plus contrast for all 18 palettes                                |

Last local run before pushing:

| Suite                            | Result                             |
| -------------------------------- | ---------------------------------- |
| `pnpm check`                     | green (web 344 tests, API unit 30) |
| `pnpm test:db`                   | 52 passed, 1 todo                  |
| Browser suite, desktop and phone | 22 passed                          |

## Not started (blocked)

- **Feedback** (`feedback*.js`): needs signed-in users, a tester flag and
  mail (A).
- **Digests and notify templates**: need users, mail and the published board
  (A, D).
- **Updates and the update check**: tied to the deployment model (H).
- **Alliance directory**: needs organisations (A has them on its branch).
- **Docs pages** and `admin-updates`.
- **The password gate.** `/api/site`, `/api/legal` and `/api/home/buttons`
  are public until A's gate is merged. In legacy they sit behind it; the
  manifest stays outside.

## Foundation notes

- `route()` in `apps/api/src/http/route.ts` doesn't pass the request body to
  handlers. G reads it through the contract's schema instead (`bodyOf` in
  `site/routes.ts`). Adding `body` to `HandlerInput` would help every stream.
- In jsdom, Radix's radio group doesn't show an option becoming checked on
  arrow keys, so that is untested until a screen with one can open in the
  browser suite.

## Changes outside G's folders (all named in commit messages)

- `apps/api/src/app.ts`: one registration line.
- `apps/web/src/routes/__root.tsx` and `index.html`: header name, footer
  link, page width, manifest and icons.
- `apps/web/public/icons/`: the legacy icons.
- `apps/web/test/setup.ts`: a stand-in ResizeObserver.
- `apps/web/playwright.config.ts`: the `--host` flag.
- `.dependency-cruiser.cjs`: a rule that the seal and chain code never reach
  `apps/api/src/site`.
- `packages/contracts/src/index.ts`: one export line.
- `docs/reports/workstream-G.md`: this file.
