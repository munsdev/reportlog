# Workstream B · Logbooks and the builder — status

For the coordinating session and the other workstreams. One file per
workstream in `docs/status/`, so these never conflict in a merge.

- **Branch:** `ccr-a9827e7a-smcut3`, based on `ccr-c9c93698-ev856l` (the foundation)
- **Pull request:** [#2](https://github.com/munsdev/reportlog/pull/2), into `ccr-c9c93698-ev856l`
- **State:** finished and merged into `ccr-c9c93698-ev856l` (`e1d1f3f`).
- **Last updated:** 2026-10-19

## Checks, as last run before pushing

| Suite                               | Result                                                               |
| ----------------------------------- | -------------------------------------------------------------------- |
| `pnpm check`                        | passes (lint, format, types, boundaries; unit tests: api 22, web 10) |
| `pnpm test:db`                      | 9 files, 99 tests, all passed                                        |
| `db:types:check`                    | generated types up to date                                           |
| Browser suite (`CHROMIUM_PATH` set) | 16 passed, on two runs in a row                                      |

CI on GitHub had not reported when this was written. Check the pull request.

## What was built

**API (`apps/api/src/logbooks/`)**

- `logbooks.ts`: drafts and their questions (add, change, remove, reorder),
  launching, deleting a draft, closing and reopening, opening times, and the
  title and description. A logbook's state (draft, scheduled, open, closed)
  is worked out from the clock, never stored.
- **The one-way door.** `assertDraft` is in the module. Every change to a
  question takes the logbook's row lock inside a transaction, so a launch
  and an edit cannot interleave. The module refuses with a sentence before
  the database trigger is ever reached. After launch, the only things
  allowed are a new optional question and turning a question's board
  filter on or off.
- Launching, and adding a question afterwards, both record a form version
  (`ensureFormVersion`).
- `refusals.ts`: every refusal is an `HttpError` with a code and a sentence.
  The one-way door gives 409.
- `logbookFile.ts`: importing and exporting a logbook as a file. An import
  is all or nothing and always makes a draft.
- `templates.ts` and `templates/*.json`: the five shipped starting points.
- `homeButtons.ts`: the front page's button order. A logbook that closes is
  skipped, one made after the page was arranged is added at the end, and
  the first button is the main one. Where list buttons come from is left
  for workstream E to plug in (`ButtonSources`).
- `routes.ts`: staff routes under `/api/admin/logbooks` and
  `/api/admin/home-buttons`. Public: `/api/logbooks` and
  `/api/logbooks/:slug` (launched logbooks only, a draft is 404), and
  `/api/home-buttons`.
- Contracts: `packages/contracts/src/logbooks.ts`.

**Screens (`apps/web/src/features/builder/`, `apps/web/src/routes/(staff)/logbooks/`)**

- `/logbooks`: every logbook; make one from nothing, from a starting point,
  or from an uploaded file.
- `/logbooks/$id`: the questions in order and everything you can do to them.
  Launching and deleting a draft are confirmed by typing the title.
- `/logbooks/front-page`: arranging the front page's buttons.

## Legacy self-tests and their equivalents

| Legacy                                    | Here                                                                                                       |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `logbook-selftest.mjs`                    | `apps/api/test/db/logbooks.test.ts`                                                                        |
| `conditions-selftest.mjs`                 | `apps/api/test/db/conditions.test.ts`                                                                      |
| `template-selftest.mjs`                   | `apps/api/test/db/templates.test.ts` (**the logbook half only**)                                           |
| `home-buttons-selftest.mjs`               | `apps/api/test/db/home-buttons.test.ts`                                                                    |
| the matching pure groups of `selftest.js` | `apps/api/test/unit/logbooks.test.ts`                                                                      |
| —                                         | `apps/api/test/db/logbooks-http.test.ts`, `apps/web/test/builder.test.tsx`, `apps/web/e2e/builder.spec.ts` |

## Changes from legacy behaviour (deliberate)

The module now refuses five things the old one allowed:

- removing a question that another question's condition depends on
- moving a question in front of the one it depends on
- taking away a choice that a condition is waiting for
- a setting the question's kind does not read (it would still be sealed into the form)
- a choice question with no choices

Two smaller changes:

- The logbook file format now carries a location question's scope, plus
  length and number limits. The old format lost them on a round trip.
- An address an operator types for a new logbook is used exactly or refused.
  An address taken from a file still gets `-2` added if it is taken.

## Changes outside B's folders (all small, all in the commit messages)

- `apps/api/src/app.ts`: one import and one registration line.
- `packages/contracts/src/index.ts`: one export line.
- New migration `apps/api/migrations/20261018120000_logbook_lifecycle.sql`:
  - adds `opens_at`, `closes_at` and `closed_at` to `logbooks`. All nullable,
    none read into a sealed object.
  - adds two CHECKs: a draft has no schedule and is not closed, and a
    logbook opens before it closes.
  - adds a one-row `home_buttons` table.
- `apps/api/src/db/schema.gen.ts` and `apps/web/src/routeTree.gen.ts`: regenerated.
- `apps/web/package.json` and `pnpm-lock.yaml`: `@reportlog/fields` added.
- This file.

## For other workstreams

- **A (identity):** there are 23 `TODO(workstream A)` markers, all asking
  for `requireRole('admin')`. The staff API routes all sit in one Fastify
  scope in `apps/api/src/logbooks/routes.ts`, so one `preHandler` hook
  covers them. The three staff screens each need a `beforeLoad` check, and
  the browser test needs to sign in. **Until then the staff API is open to
  anyone who can reach it. Don't deploy before A is merged.**
- **C (filing):** `GET /api/logbooks/:slug` serves the form, including
  `shown_when` and the place list for location questions.
  `toDefinitions(fieldsFor(...))` gives exactly what `questionsFor` gives;
  a test checks this.
- **D (board):** `GET /api/logbooks?include=closed` lists every logbook that
  has ever launched. Each logbook's filters are in its `filters` list. The
  built-in front-page buttons point at `/board`, `/submit` and an `alerts`
  action, none of which exist yet.
- **E (lists):** pass `{ buttons: { lists } }` to `logbookRoutes` in
  `app.ts` to put lists on the front page. One line.
- **F (files):** the public form only says `asks_for_files`. Freezing
  uploads, upload limits and whether storage is available are F's to add.
  Shipped files carry `max_files` and `max_total_bytes`; they are accepted
  and ignored for now.
- **G (site):** deployment templates (site settings, page text) were not
  ported because their tables do not exist yet. When they do, call
  `createFromFile` inside the same transaction. The front page itself does
  not show the buttons yet; `GET /api/home-buttons` is ready. The order is
  stored in its own `home_buttons` table; G may want to move it into site
  settings, or keep it.

## Notes on the foundation (nothing blocked)

- The route helper's `HandlerInput` has no typed `body`, so handlers cast
  `request.body` after zod has already checked it.
- The browser suite reuses any server already on port 3000. In this
  container the legacy app was running there and had to be stopped first,
  or the suite would have tested the old app. This is worth a line in the
  session hook.
- The browser suite runs desktop and phone at the same time against one
  database. The front-page test retries its whole round, because another
  test can close a logbook while the arrangement is being saved, and the
  server rightly refuses an arrangement that names a closed logbook.
