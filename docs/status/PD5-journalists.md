# Plan D session 5 · Journalist access (M5, J7a to J13, K7): status

- **Branch:** `claude/plan-d-journalists`, from `ccr-c9c93698-ev856l`, with **PD3 (`claude/plan-d-links`)
  and PD4b (`claude/plan-d-moderation`, PR #41) merged in**, because neither had reached the base yet:
  the desk reads `checkedLinks()` (PD3) and reuses the generic agreement (PD4b, M8). Once both merge,
  this PR's diff is only its own.
- **State:** built; PR into `ccr-c9c93698-ev856l`.

## What was built

- **The role (review item 11).** `journalist` in `SYSTEM_ROLES` and the contract enum; the
  `users.role` CHECK by migration `20261020182835_journalist_access.sql`; only the owner's
  `MAY_GRANT` row lists it; `canChangeSubject` lets only the owner change one; `roleSatisfies`: it
  outranks nothing and nothing outranks it; it sets no flag. The roles page refuses to make a
  journalist even for the owner: the only way in is approving a request.
- **J7a.** `/journalists/access` takes an address and, if it is on the alert list, emails a link
  (same answer either way). The link (`/journalists/access/:token`, a door, 7 days) opens a form:
  outlet, role, one to five links to published work, optional press card number and issuer. Text
  and links only, encrypted under the subscriber's own key. The confirmed alert page links to it.
- **J7b, J7.** `/access/journalists` (owner only; server scope `roleGuard(['owner'])` on
  `/api/owner/`). Approve: the address becomes a `journalist` account, `decided_by`/`decided_at` on
  the request and a `role_audit` grant row, and an email with the desk link. An address that already
  holds a role is refused rather than changed. Reject: the request row is deleted, the person stays
  subscribed and is told so. No automatic path.
- **J8.** PD4b's generic agreement, audience `journalist`; published at
  `/access/journalists/agreement`. **Unlike moderators, no text means no desk** (`desk_closed`):
  J8 says accepted before anything is shown. A new version blocks until accepted again.
- **J9.** `/desk`: checked links, one entry per group (from `checkedLinks`, given a page of group
  ids: a small optional parameter added in `links/reads.ts`), with the number of tips, the
  moderator's comment and each multiple-choice question's answers with counts. Below, Sources links
  and the published note on **published** reports (ruling 37), with a link to the board page.
- **J10.** The desk selects no email, no free-text answer, no erasable answer, no entry id, no
  moderator or author address. Unchecked, withheld and illegal links never leave `checkedLinks`.
- **J11.** Two GET routes, a fixed page of 20, no size parameter, no export.
- **J12.** `contact_access_log` gains kinds `desk_link` (with `link_group_id`) and `desk_report`
  (thread and report), written before anything is decrypted, and labelled on the access log screen.
- **J13.** Revoke sets the account back to no role through `setSystemRole` (so `role_audit` has the
  revoke); the role is read on every request, so the same session is refused next time.
- **Boundaries (item 13).** `journalists-never-reach-the-chain` now covers the desk and vetting
  code too (comment updated); a new rule keeps `apps/web/src/features/journalists/` from the seal.

## Tests

- `packages/access/test/roles.test.ts`: the role's ceiling, rank and flags.
- `apps/api/test/db/journalist-desk.test.ts` (16, its own database: the agreement is global and
  append-only): J7a link only to listed addresses, nothing stored on GET, bad links refused,
  encrypted; **K7** unvetted journalist refused, vetted one sees checked links only; only the owner
  lists or decides (admin, access manager, moderator, user refused); roles page refuses
  `journalist`; approval recorded, twice refused; rejection deletes, still subscribed; J8 closed
  without text, blocked until accepted, blocked again by version two; J9 exact shapes; J10 a sweep
  for the tipster's email, tip comment, unchecked/withheld/illegal URLs, the withheld comment, the
  moderator's address, an unpublished report's source; J11 page size and no other route; J12 log
  rows; J13 same session refused after revoke.
- `links.test.ts` K7 picks up `journalist` from `SYSTEM_ROLES` (refused the check queue).
  `invariants.test.ts` and `links-k4.test.ts` know `/api/owner/` and `/api/desk/` as staff prefixes.
- `apps/web/e2e/journalist-desk/desk.spec.ts` (own project after `owner`; it takes the owner's
  seat): follows the access link and the approval email's desk link, owner approves and revokes in
  the browser, agreement, desk shows the checked link as text and not the unchecked one, axe on each
  page, no third-party request. Web unit tests: door shape, staff guards, staff nav.

## Suites

Each run once on the committed tree (latest `ccr-c9c93698-ev856l` merged: nothing new; types up to date).

| Suite                                   | Result                                                               |
| --------------------------------------- | -------------------------------------------------------------------- |
| `pnpm check`                            | passes (api 407 + 21 skipped, web 588, fields 69, seal 46, access 9) |
| `pnpm test:db`                          | 82 files, 1182 passed                                                |
| Browser suite (`CI=1`, `CHROMIUM_PATH`) | 956 passed, 5 skipped                                                |

`pnpm check` ran before two lines were added (the access log labels in `moderation/Settings.tsx`); that
file was then linted, format-checked and type-checked alone, and both other suites ran after it.

## Outside my folders (kept minimal)

`packages/access` (the role), `packages/contracts/src/identity.ts` (enum), `identity/accessRoutes.ts`
(refuse granting `journalist`), `identity/gate.ts` and web `gate.tsx` (one door each),
`links/reads.ts` (optional `groupIds`), `app.ts` (link keys passed in), `features/platform/Agreement.tsx`
(audience wording, invalidate the desk on accept), `moderation/Settings.tsx` (two log labels), `features/identity/{session.ts,StaffOnly.tsx}`
(labels), `staff-nav/entries.ts` (two entries), `playwright.config.ts` (one project),
`.dependency-cruiser.cjs`, the invariants and K4 prefix lists, `docs/plan-d.md`.

## Not done, or to decide

- **Leaving the alert list deletes the request** (cascade) but not the role: an approved journalist
  who unsubscribes keeps desk access, and the owner then revokes them from the Access roster
  (journalist → no role, owner only), not from the journalist queue.
- The owner sees a requester's address partly hidden, as the alert list shows it everywhere.
