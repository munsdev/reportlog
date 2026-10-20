# PD4a: intake rules and the entry point

Branch `claude/plan-d-intake`. Rulings 38 and 42 are rows in `docs/decisions.md`.

## Done
- **L7** `stageSubmission` refuses an answer key the logbook does not ask, in a sentence. The shared `buildAnswers` still drops (lists rely on it).
- **L7 (choices)** an optional choice answer outside the options is refused.
- **L3** tests: a logbook with only choice questions refuses text under another key or in a choice. No kind allowlist (ruling 42).
- **L6** a filing whose draft holds staged files is refused (409 `files_off`) while the logbook is frozen or the site switch is off. Nothing is stored or emailed. `install.sh` writes `ATTACHMENTS_ENABLED=false` on a new server. The old "drop and name" tests are rewritten; the dropped-files alert is gone from the sent screen.
- **E2** `/submit` is one card: radios (each open logbook, plus "I have a link or tip" when a `tips` list is open) and a Continue button. No redirect, even with one logbook.
- **E4** the "check your email" card and the confirmation receipt say "Have a link, photo or video? Send it as a tip." with a link to `/list/tips`. Not offered on a door.
- **E5** at Send, state, county and time are copied to `localStorage` (`reportlog:tip-prefill`, 24 hours); the tip form reads them as a head start, only for questions it has and offered options, then clears them. No report reference in the tip filing (browser test).
- **Door/no-third-party (item 14)** `/submit` and `/file/confirm/$token` were already in `third-party.spec.ts`; no new page was added. `/submit` is not a door page (it already called `/api/logbooks`).

## Not done / assumed
- `elections.json` still has a `short_text` `place` question. ElectionLog's use of that template was not checked; change it in setup or the template.
- Pre-fill is per browser: a confirmation link opened on another device gets none. The confirm response carries no place or time, on purpose.
- `ListForm.tsx` (tip workstream's folder) has a three-line change for the pre-fill.
- The existing sealing vectors were untouched and stay green.
