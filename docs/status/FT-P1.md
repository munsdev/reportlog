# FT-P1: the public stays shut, and no migration breaks what is there

Tests and scripts only. No product code changed. Branch `claude/ft-p1-guards`.

## What was built

1. **Migration guard** (`apps/api/test/unit/migration-guard.test.ts`, rules in
   `test/support/migration-rules.ts`). Every migration file not in
   `test/support/baseline-migrations.ts` (the 55 files on main at `d34ba03`, with
   SHA-256 of each) may only CREATE a table, index, type, function, trigger or
   sequence, or ALTER TABLE ... ADD COLUMN that is nullable or has a constant
   default. The text is cut into statements by a tokenizer that knows comments
   (nested), strings, E-strings, quoted names and `$tag$` bodies, so a trigger
   function that says UPDATE is a definition, not an update. Deliberate
   exceptions go in `EXCEPTIONS` by file name with a reason (empty now). The
   baseline files are also checked to be unedited. Unit project, so it runs in
   `pnpm check`.
2. **Upgrade test** (`test/db/upgrade.test.ts`). Builds a database from exactly the
   baseline files, loads `test/upgrade/rows.json` into it, applies every newer
   migration, then requires: no row of any pre-existing table changed, appeared or
   went; every fingerprint, chain head, per-report check and the response of every
   public route equal `test/upgrade/golden.json`; and the report still waiting for
   its link confirms and verifies.
3. **Public sweep** (`test/db/public-sweep.test.ts`). Seeds marker strings into
   typed answers, tip text, links, contacts, a volunteer list, a moderator and a
   journalist, then asks every public GET route (found through Fastify's
   `onRoute`), plus the three documents a daily anchor publishes, and requires no
   marker in any of eight spellings. It also reads whatever sits in any table or
   column not in `baseline-schema.ts` and requires none of it on a public page.

## How to add a case

- A new kind of text or link: one entry in `MARKERS` in `test/support/seed-world.ts`
  and have `seedWorld` write it. The sweep needs nothing else.
- A table or column a migration adds: nothing; it is found by diffing against
  `BASELINE_SCHEMA`. A column meant to be public goes in `MEANT_TO_BE_PUBLIC`
  with a reason.
- A new case in the upgrade data: edit `seedWorld`, then regenerate with
  `BUILD_UPGRADE_FIXTURE=1 pnpm --filter @reportlog/api exec vitest run --project db test/db/upgrade-fixture.test.ts`
  on a commit whose code still runs on the baseline schema (see that file's header
  for the worktree-at-`d34ba03` route). Never regenerate to turn a red upgrade
  test green.

## Decisions

- **The data is loaded, not re-created.** Later code (E1's rate-limit table, S1's
  text store) will write to tables the baseline schema lacks, so seeding through
  today's code would break the moment those land. The rows and the expected answers
  were written once on the baseline schema.
- **INSERT into a table the same file created is allowed** by the guard (the
  singleton settings row every settings table starts with). Everything else the
  brief lists is refused. CREATE OR REPLACE is refused too: it changes a function
  the old code relies on. COMMENT ON is allowed.
- **A migration that widens a CHECK constraint (DROP/ADD CONSTRAINT) fails the
  guard.** Several existing migrations did this (role_audit axis, moderation_log
  action). If S1 needs a new permission name in such a constraint it will need an
  entry in `EXCEPTIONS`, visible in review. That is the intent.
- Door routes (`/api/door/*`) hand out a fresh token each time and are left out of
  the upgrade comparison, but are in the sweep. `as_of`, `generated_at`, `built_at`
  readings of the clock are blanked before comparing.
- The chain-file download and archive are off until the owner turns them on; the
  sweep turns them on so those routes answer, and puts the settings back.
- The owner's full archive export (`writeArchive`) is not swept: it is the
  complete private copy and legitimately holds every answer.

## Finding for the integrator: D17 is not true today

A logbook that lists its reports one by one and has a typed question publishes the
typed answer today, on `/api/board/reports`, `/api/board/reports/:ref`, the verify
route and the published chain file. D17 says typed answers are never public unless
the logbook turns it on. The live logbook is counts only and asks no typed question,
so nothing live leaks. The sweep covers this honestly: markers `listedShort` and
`listedLong` carry `publicToday`, are allowed through, and the test requires that
they ARE still public and only on those report pages, so the day D17 is built the
flag has to come off. The typed-question logbook in the sweep that is set to counts
only shows nothing, and passes.

## Not done / limits

- The upgrade comparison is only as strong as the newer migrations are numerous: today
  there are none, so it proves the loader and golden file. It has not yet seen a real
  migration.
- Responses over 2000 characters are kept in the golden file as length and SHA-256
  only.
- `.prettierignore` gained `apps/api/test/upgrade/` (generated JSON).

## Suite totals

See the final report.
