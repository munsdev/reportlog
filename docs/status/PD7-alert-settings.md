# Plan D session 7 · Alert settings, pausing keeps the desk: status

- **Branch:** `claude/plan-d-alert-settings`, from `ccr-c9c93698-ev856l` at `d95d011`.
- **State:** built; PR into `ccr-c9c93698-ev856l`.
- **Rulings:** 47 recorded in `docs/decisions.md`; 46 reworded to "removing yourself from the
  list" (what it does is unchanged).

## What was built

- **The setting.** Migration `20261021052916_journalist_alert_pause.sql` adds
  `journalist_subscribers.alerts_paused_at timestamptz` (NULL means alerts on) and a CHECK that
  only an `active` row can be paused. Types regenerated.
  - **Why a column and not a status.** `status = 'active'` already means "confirmed", and the
    access request link (`vetting.ts`) and, through the approved request, the desk read it as
    that. A third status would make each of those ask "active or paused", and one that forgot would
    quietly end somebody's access. Paused is not pending: `status` never changes on pause.
  - **Why a timestamp.** "Paused since when" is what someone asking about it needs; NULL keeps
    every existing row getting alerts.
- **The alert job** selects only `alerts_paused_at IS NULL`. A paused subscriber's window does not
  move; turning alerts back on sets `last_sent_at` to the database's now (as confirming does), so no
  backlog is sent for the weeks they were off.
- **The alert email** now has two links, both on the same token: "Change your alerts"
  (`/journalists/settings/:token`) and "Stop these alerts" (`/journalists/stop/:token`), and says
  stopping keeps you on the list and any desk access.
  - **One token, not a new link purpose.** The change page can do nothing the stop page did not
    already allow (the stop token could delete the subscription outright), so it accepts the stop
    token. That is also what makes every stop link already emailed open the change page, and it
    needed no change to the `journalist_links.purpose` CHECK. TTL is the stop link's (90 days).
- **The stop link** (`POST /api/journalists/stop/:token`) now pauses, with one POST and no body,
  so a one-click unsubscribe still works; a second press keeps the first time. Its page reads
  "Stop these alerts?" / "Alerts are off" and links to the change page.
  **List-Unsubscribe:** the mailer sends no headers at all (`EmailMessage` is to/subject/text), so
  there was none to repoint; none was added.
- **The change page** (`/journalists/settings/:token`, a door: three calls added to `IN_FRONT`,
  web `DOOR_PATHS`). GET changes nothing. The form: alerts on/off (a radio pair) and the states
  (checkboxes, `checkedStates` as on signup), one save button. Separately, under its own heading,
  "Remove me from the list entirely", which says it deletes the details and ends desk access if
  they have it, and goes through `removeSubscribers` (ruling 46 unchanged on that path).
- **The desk.** `GET`/`POST /api/desk/alerts` inside the desk scope (`deskGuard`: journalist role,
  approved request, accepted agreement), so no other role reaches it. The subscription is found by
  the keyed digest of the signed-in account's own address (`emailDigests`), so a journalist can
  reach only theirs. A "Your alerts" section on `/desk` uses the same form. No removal there.

## Tests

- `apps/api/test/db/journalist-alerts.test.ts` (19): the email's two links share one token; GET of
  stop and change pages changes nothing (row compared before and after); both in front of the
  password; the stop button pauses and keeps the row `active`, twice keeps the first time; **a stop
  token issued directly with `issueLink(…, 'stop')`, as before this change, pauses and opens the
  change page**; the alert job skips a paused subscriber and leaves its window; empty, unknown and
  non-US states and a bad on/off are refused with the row unchanged; resuming with new states
  (deduplicated, upper-cased, sorted) restarts the window and alerts come for the new state; off
  from the change page keeps the row; "remove entirely" deletes it and every link.
- `apps/api/test/db/journalist-desk.test.ts` (22): **decision 47**: an approved journalist who
  pauses by the stop link keeps the role, no new `role_audit` row, desk links and sources 200, the
  J7a access link still says `approved`; desk settings GET twice changes nothing; desk resume and
  state change, refused bad states, off again, role kept, no email sent; moderator, admin and
  access manager get 403 on both desk alert calls, anonymous 401; the change link's GET changes
  nothing, then "remove entirely" gives 403 on the desk in the same session, role `user`,
  `revoke`/`journalist` in `role_audit` with the journalist as actor. The decision 46 stray-role
  guard test stays.
- `apps/web/e2e/journalists.spec.ts`: from the captured alert email, the stop link (heading,
  axe, reload changes nothing, one POST, listed as `paused`), then the "Change your alerts" link
  from the same email (current settings shown, axe, reload changes nothing, back on with one more
  state, removal section's wording, removal, axe, `none`); exactly two POSTs on the change page; no
  request to another host on any page.
- `apps/web/e2e/journalist-desk/desk.spec.ts`: the desk's "Your alerts": off plus a state, saved,
  listed as `paused`, still shown after a reload, the desk still shows the checked link, axe.
- `apps/web/test/door-quiet.test.tsx` knows the new door shape.

## Suites

Each run on the final tree (types regenerated: up to date).

| Suite                                   | Result                                                                     |
| --------------------------------------- | -------------------------------------------------------------------------- |
| `pnpm check`                            | passes (api 408 + 21 skipped, web 589, fields 77, seal 46, access 9)       |
| `pnpm test:db`                          | 84 files, 1202 passed                                                      |
| Browser suite (`CI=1`, `CHROMIUM_PATH`) | 972 passed, 5 skipped (after the flake fix below; `pnpm check` re-run too) |

**A flake that was already there, fixed.** The first two full browser runs each failed one test,
`filing/permissions.spec.ts` "switching off file publication asks first…", with `apiResponse.json:
Response has been disposed` in its route stand-in. Every project chained after chromium and phone
(identity through in-front-of-password, the journalist desk among them) then did not run. It is
not this change: run alone with `--repeat-each=10`, it failed 2 of 60 times on the base tree with
this branch stashed, and 1 of 40 on this branch. The page can drop a request it has replaced, and
Playwright disposes the fetched response under the handler. The stand-in now leaves a response it
cannot read (`.catch(() => null)`, then return). 120 repeated runs (chromium and phone) after that:
no failure. One test file, outside my folders.

## Outside my folders (kept minimal)

`packages/contracts/src/journalists.ts` (shapes), `identity/gate.ts` (three `IN_FRONT` lines),
web `features/identity/gate.tsx` (the door regex), `routeTree.gen.ts` (generated),
`dev/journalists-state.ts` (prints `paused`), `door-quiet.test.tsx`, `staff-guards.test.tsx` (the
new page is open, as the stop page is), `e2e/filing/permissions.spec.ts` (the flake above),
`docs/decisions.md`.

## Not done, or to decide

- The desk offers no "remove me entirely"; that stays on the emailed change page, where the
  wording about losing the desk sits beside the button.
- The removal is one press, not a second confirmation card: the section's heading, its text and
  the button all say the same thing. Worth a look if the owner wants a confirm step.
