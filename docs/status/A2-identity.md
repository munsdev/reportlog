# Workstream A2 · What identity left undone: status

For the coordinating session and the other workstreams. One file per workstream in `docs/status/`.

- **Branch:** `claude/a2-identity-leftovers`, based on `ccr-c9c93698-ev856l` at `81a4c77` (foundation + A–I, C2, D1, G2 merged)
- **Pull request:** into `ccr-c9c93698-ev856l` (linked from the PR itself)
- **State:** finished, waiting for review. Not merged.
- **Last updated:** 2026-10-19

## Checks, as last run before pushing

TOTALS

## What was built, in the order asked

1. **The tester flag, the team-member flag and desks.**
   - The tester flag already existed (G2, `/feedback/testers`). What changed: **who may set a
     flag is now decided in `@reportlog/access`** (`FLAGS`, `canSetFlag`), beside the role
     ladder, so every grant asks that package. Flags are still not roles: no flag is in
     `SYSTEM_ROLES`, none is in `MAY_GRANT`, and the owner's seat is untouched. G2's
     `setTesterFlag` now delegates to `identity/flags.ts`.
   - **Team member** (`POST /api/access/team-member`): a flag on `users`, given and taken by
     administrators and Access Managers. It opens the team's guides (the staff menu's
     "Guides", audience `team`) and nothing else: no report, no role. Each change is a
     `role_audit` row on the `flag` axis, with the desks in its detail.
   - **Desks** (`DESKS` in `packages/contracts/src/identity.ts`, the legacy ids): display only.
     The account page lists your desks and, for each, where to start, offered only if you may
     open that screen (`apps/web/src/features/identity/desks.ts`; every start is a line of the
     staff menu's own list, and a unit test holds them together). A desk hides nothing and grants
     nothing. **The database refuses desks on somebody who is not on the team**, so taking
     somebody off it cannot leave them a job title.
   - `Me` carries `teamMember` and `desks`.
2. **The roster** (`GET /api/access/roster?days=`, `/access/roster`). Everybody with a role, a
   flag or an organization; per person, reports typed up through intake by them, and by anybody
   for the organizations they belong to, over 7, 30, 90 or 365 days; and when they last acted as
   staff (moderation, opening contact details or a file, changing somebody's access). As in
   legacy, nothing flags volume. Putting somebody on the team, and their desks, is done here.
3. **Organization logos and the public directory.**
   - `PUT /api/orgs/:id/logo` (the body is the image), `DELETE /api/orgs/:id/logo`, by the
     organization's managers or those who grant access. An administrator doing it is on the
     record, as a change to the details is.
   - **Through F's code**: the bytes are sniffed (`sniffType`), decoded and re-encoded by
     `buildRendition` (no location, camera or author survives; tested with a JPEG carrying GPS
     and a camera), and kept in F's `renditions` bucket through F's `Storage` interface (S3 API
     only). A replaced or removed logo's object is queued in `storage_deletions` in the same
     transaction and drained after commit. PNG, JPEG or WebP, at most 1 MB.
   - **Storing is not publishing.** `GET /api/directory/logos/:file` serves a logo to anybody
     only while its organization is listed; otherwise only to its managers and those who grant
     access. Behind the site password, like the directory.
   - The directory shows the logo beside the name; the organization's page under Access has the
     upload. With no file storage configured, the upload is refused with a sentence.
4. **Notification settings.** Already built by G2 (`GET`/`PUT /api/notifications`,
   `/notifications`, "Email updates" in the header): the legacy `GET`/`POST /me/notifications`
   ported under a different path. Nothing more was needed.
5. **Stopping the digest without signing in.**
   - Every digest email carries its own link, `/notifications/stop/:token`. The token is random,
     stored only as a hash (`digest_stop_links`), and lasts 90 days.
   - **Its GET changes nothing.** The page says which address (partly hidden) and how often, and
     a button stops every digest. Using a link twice is harmless; an unknown link and an expired
     one get the same answer.
   - **In front of the site password**: both calls are in `IN_FRONT` (`gate.ts`), and the page is
     a door (`DOOR_PATHS`). Stopping email somebody asked for must not depend on a password.
     See "Decisions" below.
   - **Browser test that follows the link from a captured email**
     (`apps/web/e2e/identity/access.spec.ts`): a real hourly digest is run into the outbox, the
     link is followed in a stranger's browser with the site password on, opened twice without
     effect, then stopped by the button.
6. **What of legacy `me` and `moderators` was unported.**
   - `me`: everything was ported already (C: reports, permissions, accesses, correct, erase,
     withdraw; G2: notifications).
   - `moderators`: everything except **`severity`** and **`incident`** (corroboration). Not built
     here; see "Waiting on a decision".

## Legacy tests and their equivalents

Legacy had **no self-test** for the team flag, desks, the roster, logos or the digest. The
checks in `apps/api/test/db/identity-leftovers.test.ts` (32) are what `legacy/src/roles.js`
(`setTeamMemberFlag`), `desks.js`, `routes/orgs.js` (`/team-member`, `/desks`, `/roster`,
`/:id/details` with `logoKey`) promised, plus the rebuild's own rules. Also
`packages/access/test/roles.test.ts` (2 new) and `apps/web/test/team.test.ts` (5).

## Changes outside A's folders (all named in the commit message)

- `packages/access/src/index.ts` (foundation): `FLAGS`, `canSetFlag`. Additive.
- `packages/contracts/src/site.ts` (G): `DirectoryEntry.logo`, and "what appears" names the logo.
- `apps/api/src/site/digest.ts` (G2): **the stop link** — `digestEmail` takes it, `runDigest`
  makes one per email. `apps/api/src/site/directory.ts` (G2): the logo's address.
- `apps/api/src/feedback/testers.ts`, `routes.ts` (G2): the tester flag delegates to identity.
- `apps/api/src/jobs/sweep.ts` (H): `digest_stop_links` is swept past `expires_at`.
- `apps/api/src/app.ts`: one registration line (`logoRoutes`, after the files context).
- `apps/web/src/features/site-pages/Directory.tsx` (G2): the logo.
- `apps/web/src/features/staff-nav/entries.ts` (G2): the `team` audience, on "Guides".
- `apps/web/test/staff-nav.test.tsx` (G2): its `Me` fixture gains the two new fields.
- New route file outside A's folders: `apps/web/src/routes/notifications_.stop.$token.tsx`.
- Migration `20261019200244_identity_leftovers.sql`: `users.is_team_member`, `users.desks`,
  `organizations.logo_key` (A's tables; none read into a sealed object), `digest_stop_links`.
- `schema.gen.ts` and `routeTree.gen.ts` regenerated.

## Waiting on a decision

- **Severity and incidents (corroboration).** The only unported legacy moderator routes. In
  legacy they fed the public board's filter, the heat maps and the corroboration count ("the
  number press is most likely to quote"). D1 listed them as deliberately not ported. They belong
  to D (and I for the maps), and whether a moderator's severity judgement or a corroboration
  count is ever shown publicly is the project owner's call. Not built.
- **The stop link is in front of the site password.** I judged that stopping email somebody
  asked for must not need a password, and the page shows only a partly hidden address and a
  frequency. It is a new entry in `IN_FRONT` and a new door path, so it is listed here rather
  than slipped in.

## Not done

- The legacy staff portal's content (voice and style, comms, release notes), which the team flag
  opened. The rebuild has G2's guides instead; the flag opens those.
- A `List-Unsubscribe` header on digest emails. The `Mailer` interface carries no headers; H
  could add them with the Scaleway mailer, pointing at the same POST.
- The roster counts intake filings only. A coordinator's corrections (`coordinator_actions`) and
  list reviews are not counted.
