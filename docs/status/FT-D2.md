# FT-D2: settings panels as closed summary + Change panels

Branch `claude/ft-d2-settings` (from `claude/blissful-gates-7q65uc`, on top of FT-D).

## Built
- Logbook page: Title and description, Cover page, Asking for an email address, Publishing, On the
  front page are `GuardedPanel`s (components/ui/setting-panel.tsx): summary + Edit, one open at a
  time, Save/Cancel in the Save bar, "Leave your changes?" guard (and the settings area's
  leave-the-page warning). Same save calls as before (`updateLogbook`, cover `save`).
- List page: Settings and Cover page the same way. The "link emailed to the new address" notice
  moved out of the form so it shows after the panel closes.
- Email panel is now Never / Optional, can be skipped / Always (E1's `email_optional` with
  `email_required`); a form whose questions need an address shows why and no choice.
- Report and tip forms: new "Email on reports" panel (days a link works, report-email deletion
  date, reports per address per day). This needed a small API: `GET/PUT /api/admin/filing-limits`
  (contracts `door.ts`, route in `apps/api/src/door/index.ts`, admin only, wraps E1's
  `filingLimits`/`setFilingLimits`). No new test written (lean rules); validation: link 1-365
  days, cap 1-1000, date YYYY-MM-DD.
- e2e updated, not run: lists.spec, links.spec, lists-schedule.spec (open "Edit Settings" first,
  Save in the Save bar, no "Saved." text).

## Decisions / differences from the mock-up
- Accepting reports and Development notice keep the two-step choice (documented in
  features/settings/Switches.tsx): closing intake refuses people mid-filing.
- "Email on reports" is a closed Change panel; the mock-up draws open fields. Added a "days a link
  works" field the mock-up lacks.
- Logbook panel summaries add a "Short address" row; email summary reads "Optional, can be skipped".
- Taking reports (Close this logbook) was not converted: it is not on the task list and the
  mock-up shows it as a button too.

## Not done (API lacks it)
- "Ask for a written account", "Longest written account", "Most links on one report": no site
  setting exists (S1 sets these per question in the builder).
- "Ask for an email on tips": no setting.
- Not checked in a browser; no e2e run.

## Tests
tsc (web, api, contracts) clean; eslint and prettier on changed files.
