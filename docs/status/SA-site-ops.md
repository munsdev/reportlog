# SA · Site shell and operations (parity R5, R6, R10)

Branch `claude/sa-site-ops`. Closes the rows named in `docs/parity.md` §7 R5, R6 and R10.

## Built

- **Front page:** fallback buttons ("Submit a Report", "View Live Report Board") when
  `/api/home-buttons` fails. The example reference no longer names a prefix.
- **Header:** one row at every width (the name is cut short, the links scroll sideways).
- **Tap targets:** buttons, fields, header, footer and contents links are at least 44px.
- **Unsaved-changes warning** on `/logbooks/front-page`, using the settings screens' guard.
- **R6 (decisions 22 to 29):** `public/boot-guard.js`, a plain "This page did not load" message with
  a reload link, if a script fails to load or nothing is drawn in 10 seconds. It is a file, not an
  inline script, so the content security policy is unchanged. About links to `CHANGELOG.md`.
  Everything else in R6 is Dropped in `parity.md`; R0 d, e, f, h, i, j and k are marked.
- **R10:** the installer reads the S3 region off the endpoint (Hetzner, Scaleway, AWS; otherwise it
  asks as before); `deploy/README.md` names every setting, says what to do without `dig`, and whose
  credential a private clone uses; the doctor says so plainly when a list holds entries and the
  lists-sweep timer is off.

## Tests added

- `apps/web/e2e/site-ops.spec.ts`: fallback buttons, the fallback page (with axe and the
  third-party listener), header widths, prose pages at 320px, 44px targets, the name walk over every
  page, the directory and its listing switch, the front-page editor's warning.
- `apps/web/test/ui/client-first.test.ts`: no inline style or colour outside the themes.
- `apps/api/test/db/http.test.ts` (rejecting async handler), `test/unit/deploy-runbook.test.ts`,
  `jobs-guides.test.ts`, `doctor.test.ts`, `deploy-install.test.ts`.

## Changes outside the stated folders

- `Button`, `Input` and the About contents links gained `min-h-11`; `HomeButtonsEditor.tsx` (B) uses
  the settings guard; the `distribution` comment in `api/site/templates.ts` is corrected.
- The staff screens' `RL-…` placeholders (files, R2/R3) still name the default prefix.

## Left

- The form's progress bar (R4) is the one part of `nav.test.js` still open.
- Results of the three suites are in the pull request.
