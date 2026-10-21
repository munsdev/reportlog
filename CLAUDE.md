# ReportLog — notes for an assistant

This branch is the **rebuild**: a pnpm monorepo in TypeScript, React and
Tailwind. It reached parity with the previous JavaScript application on
2026-10-20 (`docs/parity.md`), and the old code was deleted. To read it, check
out commit `3793861`, the last one with `legacy/` beside the rebuild, or see
`main` and the `reportlog-archive` repository. Owner decisions are in
`docs/decisions.md`.

Read `docs/architecture.md` once, and `docs/workstreams.md` for which folders
are yours.

## The layout

```
packages/fields     what a question is and what an answer normalizes to   (pure)
packages/seal       what a report's fingerprint is made of; checking it   (pure, runs in a browser)
packages/access     role ceiling and rank                                 (pure)
packages/contracts  every API request and response, as zod schemas        (pure)
apps/api            Fastify + PostgreSQL (Kysely). Node runs the .ts directly, no build step
apps/web            Vite + React + Tailwind + TanStack Router/Query + shadcn/ui conventions
```

`packages/*` must run in a browser: no `node:` imports. The boundary check
fails the build if one appears.

## The rule that breaks everything if you get it wrong

**A key is written into the sealed object ONLY when it applies.**

An absent key and a `null` one serialize differently under RFC 8785, so
making an optional key unconditional changes the fingerprint of every report
ever filed. `answers`, every key inside it, `logbook_form`, `attachments`, the
third-party provenance block, and `help`/`shown_when` in a form definition
are all conditional for this reason. The code uses conditional spreads
(`...(x ? { x } : {})`) on purpose. **Do not tidy them.** The types say
"optional", never "nullable", and `exactOptionalPropertyTypes` stops anyone
assigning `undefined` to one.

`packages/seal/test/legacy-vectors.test.ts` checks the sealing code against
fingerprints the old implementation actually produced. **If it goes red, stop
and say so.** Never edit a fixture under `test/fixtures/` to make a test pass.
The few deliberate differences from the old code are listed, with reasons, in
`FIXED` at the top of each vector test.

## The invariants, and where each is enforced

Many are enforced by the database itself (`apps/api/migrations/`), so they
hold even if application code forgets. Do not weaken a database guard to
make a feature easier. Change the feature.

- **`reports` is append-only.** Never UPDATE, never DELETE. A correction is a
  new row in the same thread. _Database trigger._
- **One chain per logbook.** A report links to the newest report in ITS
  logbook; a logbook's first report links to `chainGenesis(slug)`. Every
  append goes through `appendReportVersion` (`apps/api/src/chain/append.ts`)
  inside a transaction. _The database re-checks every link on insert._
- **The slug is never edited, and a launched logbook is never deleted or
  unlaunched.** _Database trigger._
- **Launching is a one-way door.** Afterwards a logbook may gain a new
  OPTIONAL question and have its wording (labels, help) changed, and nothing
  else: keys, kinds, codes, order and conditions are frozen (decision 48).
  _Database trigger on `logbook_fields`._
  Adding an optional question is safe only because of the absent-key rule.
- **Write side and read side agree byte for byte.** `normalizeReportFields`
  and `rebuildSealedObject` live side by side in `packages/seal/src/report.ts`.
  Any query that rebuilds a sealed object goes through `sealedReportRows`
  (`apps/api/src/chain/record.ts`), which carries the form join.
- **A report seals the questions it was answered against** (`logbook_form`),
  the version the reporter was actually asked.
- **Once listed, always listed.** The daily anchor's list of chain heads may
  never drop a logbook or shrink a count (`contradictions` in
  `packages/seal/src/heads.ts`). It is the only thing that notices a whole
  logbook disappearing.
- **Nothing is public until a moderator approves it.** There is no
  auto-publish path and there must not be one.
- **Permanence decides where a value lives.** Seal what must never change.
  A permission a reporter can take back is an append-only log with the
  current value as a projection, under `apps/api/src/permissions/`. The
  boundary check forbids the seal or the chain code from ever reaching it.
- **The publication answer is sealed with the digest of the exact card
  wording** (`packages/seal/src/consent.ts`). The server issues the digest; a
  client never computes one. _Foreign key from `reports` to `consent_texts`._
- **Consent is the ceiling, moderation is the floor.** A moderator may
  publish a report's text and not its files, never the reverse.
- **Only the reporter changes a reporter's permission.** No moderator route
  writes that log.
- **The role ceiling.** An Access Manager can make Moderators and cannot
  make Access Managers. Only the owner appoints or removes an administrator.
  The owner's seat is in no row of `MAY_GRANT` (`packages/access`), so no
  grant can produce one. Rank: owner satisfies admin; nothing else outranks
  anything; admin does not imply moderator.
- **An entry is not a report.** A list (as opposed to a logbook) seals
  nothing and never reaches the chain. `apps/api/src/lists/` may not reach
  `packages/seal` or `apps/api/src/chain` even transitively. _Boundary check._
  Lists share answer normalizing through `packages/fields`, which is kept
  apart from sealing for exactly this reason.
- **The transparency log is never rewritten**, not even to correct it.
- **Every role holder proves a second factor** (decision 50, plan E E3). Until
  a session has, `userForSession` hands every route a person with no role and
  no memberships, so no guard needs to ask. The actions plan-e.md lists also
  take `stepUpGuard()` (`apps/api/src/identity/stepUp.ts`) on a scope of their
  own; a new one joins `LISTED` in `apps/api/test/db/second-factor.test.ts`.
- **Nothing is filterable unless an operator said so.** No built-in date or
  location filter.
- **No third-party requests from the site.** No CDN, no web fonts from
  elsewhere, no analytics, and no map tile layer. `apps/web/e2e/verify.spec.ts`
  fails if a page requests another host; give each new public page the same
  test.
- **One card asks one question**, and nothing on the card in front of
  somebody changes underneath them. No auto-advance.
- **Logs never hold an IP address or a full URL** (URLs can carry tokens).
  The request serializer logs the route pattern.

## Working in parallel

Several sessions build this at once. To keep that working:

- **Stay in your workstream's folders** (`docs/workstreams.md`). If you need
  a change in another workstream's folder or in a shared package, keep it
  minimal and say so in the commit message.
- **Migrations are new files only**, named `YYYYMMDDHHMMSS_what.sql`, with
  the real time you wrote it (three workstreams once all chose
  `20261018120000`). Never edit one that exists: the runner refuses an
  applied migration whose text changed. Adding a nullable column to a core table is fine; changing how an
  existing column is read into a sealed object is not.
- **After a migration, regenerate the database types**:
  `pnpm --filter @reportlog/api db:types`. CI fails if they are stale. If the
  generated file conflicts in a merge, regenerate it rather than resolving
  it by hand.
- **API shapes go in `packages/contracts/src/<area>.ts`**, one file per
  workstream, plus one export line in its `index.ts`.
- **Server routes go in `apps/api/src/<area>/`**, registered with one line in
  `apps/api/src/app.ts`.
- **Staff routes are guarded per scope, not per route**:
  `scope.addHook('preHandler', roleGuard(['admin']))` (from
  `apps/api/src/identity/guards.ts`), so a route added to the scope later
  cannot forget to ask. Staff screens wrap their layout in `<StaffOnly>`
  (`apps/web/src/features/identity/`), and their browser tests use
  `test.use({ storageState: ADMIN })` from `apps/web/e2e/auth.ts`.
- **A door page calls only the calls named in front of the password for that door**
  (`IN_FRONT` and `FILING_CALLS` in `apps/api/src/identity/`). Anything else is refused and
  sends the visitor back to the password screen. A shared component that
  fetches (the header, say) must stay quiet on a door: see `useSite`.

## Running things

```
pnpm install
pnpm check                                   # format, lint, types, boundaries, unit tests
pnpm test:db                                 # database tests, on a throwaway database
pnpm --filter @reportlog/web e2e             # browser tests, on a database made for the run
pnpm --filter @reportlog/api db:migrate      # migrate the database in DATABASE_URL
pnpm --filter @reportlog/api db:seed         # a demo logbook and two reports
pnpm dev                                     # API on :3000, website on :5173
```

**All three suites before anything ships**: `pnpm check`, `pnpm test:db`
and the browser suite. None covers another.

In a cloud session, `.claude/hooks/session-start.sh` starts a local Postgres
and writes `.env`. In this container the browser suite needs
`CHROMIUM_PATH=$(ls -d /opt/pw-browsers/chromium-*/chrome-linux/chrome | head -1)`.

`pnpm test:db` creates a database beside the one `TEST_DATABASE_URL` names,
migrates it, runs, and drops it. The database you point it at is never
written to.

A path that only runs when somebody clicks a link in an email is the path
nothing reaches by accident. When you build one (report confirmation, list
erasure), give it a browser test that follows the link.

## Style

- Plain language in anything a person reads: the site, emails, errors.
  API errors carry a sentence a person can read, in the `ApiError` shape.
- Comments explain **why**, especially where code looks untidy on purpose.
  Match the density of the file you are in.
- No `any`. Narrow `unknown` instead. Types for database rows are generated,
  never hand-written.
- Report what actually happened. If a test failed, show it. If something was
  assumed rather than verified, say which.
