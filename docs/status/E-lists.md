# Workstream E · Lists: status

For the coordinating session and the other workstreams. One file per workstream in
`docs/status/`, so these never conflict in a merge.

- **Branch:** `claude/eloquent-dijkstra-b98fkw`, based on `ccr-c9c93698-ev856l` (foundation + A, B, G)
- **Pull request:** into `ccr-c9c93698-ev856l` (linked from the PR itself)
- **State:** finished, waiting for review, not merged.
- **Last updated:** 2026-10-19

## Checks, as last run before pushing

| Suite                               | Result                                                                         |
| ----------------------------------- | ------------------------------------------------------------------------------ |
| `pnpm check`                        | passes (format, lint, types, boundaries; unit tests: api 127, web 358)         |
| `pnpm test:db`                      | 18 files, 320 tests, all passed (222 before this branch; 98 are E's)           |
| `db:types:check`                    | generated types up to date                                                     |
| Browser suite (`CHROMIUM_PATH` set) | 50 passed, run with `CI=1` (42 before; E adds 4 tests, run on desktop + phone) |

CI on GitHub had not reported when this was written. Check the pull request.

## What was ported

**API (`apps/api/src/lists/`, migration `20261019124712_lists.sql`, contracts `packages/contracts/src/lists.ts`)**

In the order the task gave:

1. **Lists and their questions** (`fields.ts`, `manage.ts`, `values.ts`). Question kinds and answer
   normalizing come from `@reportlog/fields`. The gate is derived from the questions; only a
   closed vocabulary can be counted.
2. **Entries, in two columns** (`entries.ts`, `policy.ts`): `answers` (durable) and
   `erasable_answers` (what the sweep blanks). Links are lifted into `list_entry_links` and the
   deduplicated `link_index`. Addresses are HMAC'd under a per-day secret (`salt.ts`).
3. **The sweep** (`sweep.ts`) erases columns and leaves rows standing. It also destroys old
   secrets and spent links. `pnpm --filter @reportlog/api lists:sweep` runs it once.
4. **Bulk review and published counts** (`review.ts`, `aggregates.ts`).
   - Review works on named ids, and shows link hosts and clusters.
   - Counts are published only for a listed list whose counts an administrator published.
   - `snapshotDocument` (the daily counts file legacy published beside the anchor) is built and
     tested, but nothing publishes it yet.
5. **The erasure link** at `/api/forget/:token`, and the list-mail link at `/api/list-mail/:token`
   (`pages.ts`, `routes.ts`).
   - Plain HTML, in front of the site password, under their own strict CSP.
   - **A GET changes nothing**; only the POST acts.
6. **The three templates** (`templates/*.json`): the Tip List, check-ins, a contact form.
7. **Screens** (`apps/web/src/features/lists/`, `routes/(staff)/lists/`, `routes/list/$slug.tsx`):
   - `/lists` and `/lists/:id` for administrators.
   - `/lists/review` and `/lists/review/:id` for moderators and administrators.
   - `/list/:slug`, the public form, one question per card.

The database also enforces, beyond legacy:

- a question's key and kind never change;
- a list that has taken entries is never deleted;
- `erasable_answers` is never `{}`;
- `file` and `evidence_declaration` are refused on a list.

`docs/lists.md` is the port of `legacy/docs/lists.md`, rewritten for the new paths.

## Legacy tests and their equivalents

| Legacy                                              | Here                                                                                                                    |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `lists-selftest.mjs`                                | `apps/api/test/db/lists.test.ts` (47 tests), check for check                                                            |
| `lists-routes-selftest.mjs`                         | `apps/api/test/db/lists-routes.test.ts` (51 tests): every check, plus the password's list doors and the list-mail link  |
| the lists groups of `selftest.js`                   | `apps/api/test/unit/lists.test.ts` (71 tests): rules, the import-graph walk, migration, templates, links, clusters      |
| the erasure and list-mail links (no legacy browser) | `apps/web/e2e/lists.spec.ts`: both links **followed out of the email the server wrote**; opening either changes nothing |
| —                                                   | `apps/web/test/lists.test.tsx`: the card form (no auto-advance, the address card's reason, what is sent)                |

`selftest.js` checks that this port does not carry, and why:

- **Table counts in INSTALL.md and docs.html.** Those documents do not exist in the rebuild.
- **The sweep timer runs both sweeps.** The timer is H's. In its place, a unit test fails if any
  code outside `lists/` deletes rows from a list table.
- **Lists are not in the archive export.** The export is D's and not written yet; `docs/lists.md`
  says what it must do.

The separation checks were seen to fail on a planted two-hop import (lists → logbooks → chain), in
both the unit test and `pnpm boundaries`, then the plant was removed.

## Changes outside E's folders (all small, all in the commit messages)

- **`apps/api/src/http/route.ts` (foundation): `route()` takes an optional route `config`.**
  Without it, a contract route cannot carry the `curtain: 'decides-itself'` mark at registration,
  which is when the gate checks it. Setting the mark from a scope's `onRoute` hook would run
  _after_ the gate's own check and slip past it, so I did not do that.
- `apps/api/src/app.ts`:
  - one registration line for the list routes;
  - `{ buttons: { lists: listButtons } }` passed to `logbookRoutes`, as agreed with B;
  - an optional `lists` setting on `AppDeps`.
- `apps/api/src/server.ts`: passes the list settings.
- `apps/api/src/config.ts`: `LIST_PERSONAL_DAYS` (a typo stops the server rather than turning
  retention off), `LIST_SALT_DAYS`, `LIST_ERASURE_LINK_DAYS`, `LIST_KNOWN_HOSTS`, `ADMIN_EMAIL`.
- `apps/api/src/identity/doors.ts` (A): door lists join `doors()`, from `listDoors` in E's module.
- `apps/api/test/db/doors.test.ts` (A): its stand-in list route moved to
  `/api/lists/stand-in/:slug`, because `/api/lists/:slug` is now real and Fastify refuses a
  duplicate.
- `apps/api/package.json`: the `lists:sweep` script.
- `apps/web/src/routes/list/$slug.tsx`: the door path agreed with A is `/list/`, which a file in
  E's `routes/lists/` folder cannot produce.
- `apps/web/src/features/lists/`: the screens' components, beside the other workstreams' features.
- Regenerated: `apps/api/src/db/schema.gen.ts`, `apps/web/src/routeTree.gen.ts`.
- `packages/contracts/src/index.ts`: one export line.
- `docs/lists.md`, and this file.

## For the other workstreams

- **H (operations):**
  - Schedule `pnpm --filter @reportlog/api lists:sweep` daily. Until something runs it,
    `LIST_PERSONAL_DAYS` is a sentence only.
  - It is not the credentials sweep. **Never add a list table to that one**: it deletes rows, and
    the list sweep erases columns.
  - Set `ADMIN_EMAIL` and, optionally, `LIST_KNOWN_HOSTS` in the deployment's environment.
- **D (board, anchor):**
  - `snapshotDocument(db)` in `aggregates.ts` is the daily counts file legacy published as
    `counts/<date>.json` beside the anchor. It had its own digest (sha256 of
    `{counts_format, date, lists}` under RFC 8785) and its own timestamp, never folded into the
    anchor's signed format. Wiring it is yours. It must not make lists import the seal: compute
    the digest on your side.
  - The archive export must leave the eight list tables out.
- **I (maps):** a list's `location` answers are durable and impersonal, so they survive the sweep.
  Legacy let a list feed a heat map (migration 051, `list_fields.map_location`, `heat_maps.list_ids`).
  _Corrected later (P6):_ I built this on its side (`heat_maps.list_ids`, `map_list_place_questions`,
  approved entries only, read from `answers` and never `erasable_answers`; `docs/status/I-maps.md`).
- **C (filing):** the list form has its own small card engine in `features/lists/ListForm.tsx`.
  Once your card form exists, the two could share card components, but **never the filing
  code**: an entry is not a report.
- **G (site):** there is no staff navigation yet, so `/lists` is reached by typing it. When a staff
  menu exists, it needs Lists (administrators) and List entries (moderators and administrators).
- **A (identity):** no change to the gate. Only routes under `/api/lists/`, `/api/forget/` and
  `/api/list-mail/` carry the mark, and the doors test still proves nothing else may.

## Not done, and why

- **The list door in a browser with the password on.** The server side is tested in
  `lists-routes.test.ts`:
  - a door list opens;
  - a closed one answers `locked`;
  - `/api/doors` offers it;
  - hiding it closes the door.

  The `/list/:slug` page under the gate was not walked in the browser. That would mean turning the
  password on, which only the `identity` project may do (A's folder).
  _Corrected later:_ C3 walked it (`apps/web/e2e/doors/doors.spec.ts`).

- **Volunteering as a list** (legacy 047): there are no volunteer roles in this database.
- ~~**Lists on heat maps** (legacy 051): I's, see above.~~ _Corrected later (P6):_ done, by I. The
  maps handle lists; see `docs/status/I-maps.md`, "Optional, done: lists on maps".
- **`crossTabFor` and `linkCounts` over HTTP**: built and tested, with no route, as in legacy.
- **Opening times in the editor.** The API takes `opens_at` and `closes_at`. The screen offers
  only "Taking entries" (closing and reopening).
  _Corrected later:_ C3 built them (`docs/status/C3-form-and-doors.md`).

## Running it in a cloud container

As A's report says: the session hook writes `.env` only if none exists. The one in this container
was the legacy app's and pointed at the wrong database. `node_modules` at the root was also the
legacy app's, so run `pnpm install` first. Then:

```
export DATABASE_URL='postgres://postgres@/rebuild_dev?host=/var/tmp/rl-pg/run&port=5446'
export TEST_DATABASE_URL='postgres://postgres@/postgres?host=/var/tmp/rl-pg/run&port=5446'
export CHROMIUM_PATH=$(ls -d /opt/pw-browsers/chromium-*/chrome-linux/chrome | head -1)
pnpm --filter @reportlog/api db:migrate
CI=1 pnpm --filter @reportlog/web e2e
```
