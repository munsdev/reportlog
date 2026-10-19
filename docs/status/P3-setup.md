# P3 · The setup wizard and deployment templates (A3 with B): status

For the coordinating session and the other workstreams. Brief: `docs/parity.md` §7, P3.

- **Branch:** `claude/p3-setup-wizard`, based on `ccr-c9c93698-ev856l` at `dc2e2ca` (P2 merged)
- **Pull request:** see the PR into `ccr-c9c93698-ev856l`
- **State:** finished, waiting for review. Not merged.
- **Last updated:** 2026-10-19

## Checks, as last run before pushing

TOTALS

## What was built

1. **The wizard's remaining screens** (`apps/web/src/features/identity/SetupWizard.tsx`). Seven
   screens, in legacy's order: owner, **name, starting point, publishing, files, look**, site
   password.
   - **Each new screen writes through its owner's existing route, as the owner** (who satisfies an
     administrator's guard): `PUT /api/admin/site/name` and `/look` (site),
     `POST /api/admin/templates` (new, below), `PUT /api/admin/moderation/archive` (D),
     `PUT /api/admin/files/settings` (F). No setup-only route writes a setting, so there is no
     second place for one to be wrong.
   - Each screen saves before moving on, and one that cannot save does not move on. Back shows
     what was saved. The owner screen cannot be gone back to (the server refuses it once done).
   - A screen is drawn only once what it shows has loaded, so a preselected answer never moves
     under somebody's cursor. Choosing never advances; the button does.
   - The name is **required here** (legacy's lesson: "leave blank" meant deployments named after
     the software). Settings' name screen still takes blank as "the software's name".
   - The starting point can be skipped. Each option lists, one line each, what it will change.
   - Publishing and files arrive at what the site does now (after the starting point), as a
     choice and not a checkbox. Files says so when storage is not configured, and still records
     the answer.
   - The look previews in a frame with the name just given; the page takes the look when it is
     saved, not while choosing.
   - **Only the password screen ends setup**, as before.
2. **Deployment templates** (`apps/api/src/site/templates.ts`, contracts
   `packages/contracts/src/templates.ts`, migration `20261019220952_template_applied.sql`).
   - Legacy's six (`elections`, `elections-choices`, `workplace`, `safety-log`,
     `professional-complaint`, `blank`), word for word where the words still hold.
   - `GET /api/admin/templates` (each with the plain lines saying what it changes, and which was
     applied last) and `POST /api/admin/templates`, administrators only, guarded per scope.
   - **Settings only, never legal text.** `planTemplate` refuses imprint/privacy keys in so many
     words, and any key that is not already a setting, whole. Every value goes through the
     validator that owns it (`validateSiteName`, `validateLook`, `validateCopy`,
     `validateLogbookFile`, and D1's figure check for placeholders) before a row is written.
   - **One transaction.** Name, look, page text, the archive switch, the file switch, the intake
     switch, the draft logbook and the record all land or none do. The test proves it with a
     template that fails at its very last write.
   - Its logbook is a **draft**, made by B's `createFromFile`. Applying twice makes a second draft.
   - `site_settings.template_applied` / `template_applied_at` record which one and when, **for the
     record only**: nothing reads them to decide anything. A CHECK keeps the pair together.

## The owner's seat

Nothing here grants it. The templates route writes settings and a draft; a test checks that
applying one afterwards leaves exactly one seat holder. The owner step still checks for a seat as
well as the setup flag, and a test clears the flag by hand to show the step stays shut.

## Tests

- `apps/api/test/db/deploy-templates.test.ts`: the site half of `template-selftest`, against a
  report filed first (it still verifies), plus legal text untouched, look and name untouched by
  every shipped template, "start from nothing", refusals, all-or-nothing, and the routes.
- `apps/api/test/db/setup-wizard.test.ts`: the whole wizard over HTTP. **In front of the site
  password every step is refused as locked**, the later ones included; behind it, before an
  owner, the later steps refuse; then all seven steps; then **once done, every setup step refuses
  (409)**.
- `apps/api/test/unit/deploy-templates.test.ts`: the pure rules.
- `apps/web/test/setup-wizard.test.tsx`: each screen writes the right route, in order; a refused
  save keeps the screen; Skip writes nothing; Back shows what was saved; the storage note.
- `apps/web/e2e/identity/access.spec.ts` (A's): the wizard test now walks all seven screens,
  checks the lock screen shows no wizard and `/api/setup/status` is refused before the password,
  that **after finishing a reload shows the site and `POST /api/setup/code` is 409**, that the
  starting point's logbook is a draft, and that the wizard makes no third-party request (it was
  on I1's list of pages with no listener). It puts the name and look back afterwards for the
  projects that run after it.

## Parity rows this closes

- `admin.js` GET/POST `/templates` (deployment templates).
- Migration 019 `019_templates`.
- `setup-selftest`: the site name, publishing and attachments questions (and the look).
- `template-selftest`, and `selftest.js` "deployment templates": the site half.
- `tools/browser-tests/setup.test.js`: the wizard's later steps.
- Screens: `setup.js` (name, starting point, publication, attachments, look).
- I1: the setup wizard now has a request listener.

## Changes outside P3's files (named in the commit message)

- `apps/api/src/logbooks/logbookFile.ts` (B/P4): `createFromFile` keeps a caller's transaction
  instead of opening its own (Kysely refuses a nested one), the same rule `logbooks.ts` already
  follows. Behaviour for every existing caller is unchanged.
- `apps/api/src/app.ts`: one registration line.
- `packages/contracts/src/index.ts`: one export line.
- `apps/web/e2e/identity/access.spec.ts` (A's): the wizard test, as above.
- `schema.gen.ts` regenerated.

## Differences from legacy, on purpose

- `layout` and `distribution` are not template keys: the rebuild has no such settings, and a
  template may only set what already is one.
- Legacy checked for unknown keys before legal ones, so its "may never write legal text" sentence
  could never be reached. Here the legal check comes first.
- Legacy's `setup/status` resume and screen order are kept; the resume point is the name screen.

## Not done

- **No settings screen for templates after setup.** The route exists for administrators (legacy's
  admin panel had one); a screen under Settings is P2's folder and was not asked for.
- Intake (the "takes reports" switch) is set by templates but not asked as its own wizard screen,
  as in legacy.
