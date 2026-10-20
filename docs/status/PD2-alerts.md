# Plan D session 2 · Journalist alert list (J1 to J6): status

- **Branch:** `claude/plan-d-alerts`, from `ccr-c9c93698-ev856l` (nothing newer to merge at the time)
- **State:** built; suite totals below are filled in from the runs before the PR.

## What was built

- **Signup** (`/journalists/alerts`, `apps/web/src/features/journalists/`): name, outlet, email and
  states covered, nothing else. Links the legal notice and privacy policy (`/legal`) and says
  being listed gives no access. The answer is the same for a new, pending or already-listed address.
- **Double opt-in:** a signup makes a `pending` row and emails a link. The link's page
  (`/journalists/confirm/:token`) changes nothing on GET; only its button joins the list.
  Unconfirmed signups are deleted after 8 days by the alert job.
- **Alert** (`apps/api/src/journalists/alerts.ts`), job `journalist-alerts`, daily 08:00 UTC
  (registry entry, `deploy/systemd` timer, README line). One email per subscriber with a count per
  state, from `publishedReportIds` (`board/published.ts`) and the digest's clock rules
  (`SETTLE_MS`, never backwards, a failed send retries). A report is "in" a state when an answer
  to a `location` question of its logbook is that state's code. **Counts only:** no reference,
  logbook, answer, tip or board link; the only link is the unsubscribe one.
- **Unsubscribe** (`/journalists/stop/:token`): same pattern as the digest stop link (random,
  stored as a hash, 90 days, GET changes nothing). The button deletes the subscriber and its links.
- **Stored encrypted:** name, outlet and address under a per-row key wrapped by `CONTACT_KEY`
  (`filing/contactKeys.ts`), found by the keyed digest of the address. Never logged; no route returns
  one in full (the pages show it partly hidden) and no moderator route reads the table.
- **Grants nothing (J5):** no user, session or role is created; a boundary rule
  (`journalists-never-reach-the-chain`) keeps the folder away from the seal and chain.

## Outside my folders (kept minimal)

- `apps/api/src/identity/gate.ts`: four routes added to `IN_FRONT` (confirm and stop, GET and POST).
- `apps/web/src/features/identity/gate.tsx`: one `DOOR_PATHS` entry; `door-quiet` and
  `staff-guards` tests list the new pages.
- `apps/api/src/filing/rotateContactKey.ts`: the rotation also moves the alert list's rows
  (`journalists/rotate.ts`), inside the same transaction, or a rotation would strand every address.
- `apps/api/src/jobs/registry.ts`, `deploy/` (timer, README), `.dependency-cruiser.cjs`,
  `docs/plan-d.md` (J1 to J6 marked done), `packages/contracts/src/index.ts` (one line).
- Migration `20261020164745_journalist_alerts.sql`; generated types refreshed.

## Tests

- `apps/api/test/db/journalist-alerts.test.ts`: pending until the button; GET changes nothing;
  nothing readable stored; same answer for a listed address; alert counts approved reports in the
  subscriber's states only, with no content and one link; not repeated; stop works in front of the
  site password and signup does not; no user is created; stop deletes; key rotation moves rows.
- `apps/web/e2e/journalists.spec.ts`: signs up in the browser, follows the confirmation link and the
  unsubscribe link from the captured emails, with a third-party request check and an axe check on
  each page. The route-tree walks (`third-party.spec.ts`, `accessibility.spec.ts`) pick the three
  new pages up on their own.

## Not done, or to decide

- **No link to the signup page yet** from the header or footer; those are shared components. The
  address is `/journalists/alerts`.
- `ops timers --write` could not run in this container (`@sentry/core` missing from the install),
  so the timer file was written by hand in the generated format; the registry test compares them.
- Alerts say nothing of which logbook a report is in, by design (J3); only the state.
