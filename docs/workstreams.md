# Workstreams

The rebuild is split into workstreams that can run at the same time, each in
its own Claude Code session on its own branch. Each one owns a set of folders.
It ports a set of features from `legacy/`, and it is done when that
feature's legacy self-tests have a passing equivalent here.

The foundation (this branch's first commit) is shared by everyone and
changes only by agreement: `packages/fields`, `packages/seal`,
`packages/access`, the core migration, `apps/api/src/chain/`, and the shells
of both apps.

## Rules that keep parallel work mergeable

1. **Your folders are yours.** Anything outside them is a small, stated
   change, mentioned in the commit message.
2. **One contract file per workstream**: `packages/contracts/src/<area>.ts`,
   plus one export line in `packages/contracts/src/index.ts`.
3. **One registration line in `apps/api/src/app.ts`** for your routes.
4. **Migrations are new, timestamped files** for your own tables. Add
   nullable columns to a core table only when you must, and never change how
   an existing column is read into a sealed object.
5. **Regenerate `apps/api/src/db/schema.gen.ts` after a migration and after a
   merge.** Never resolve a conflict in it by hand.
6. **Port the legacy tests first.** For each `legacy/scripts/*-selftest.*`
   you own, write the equivalent here before or with the feature. They are
   the most precise statement of what the old code promised.
7. **Green before merge**: `pnpm check`, `pnpm test:db`, and the browser
   suite for anything with a screen.

## Order

```
Wave 1 (start together)   A Identity & access   B Logbooks & builder   G Look & site   H Operations
Wave 2 (needs B; A for staff screens)   C Filing & confirmation   E Lists
Wave 3 (needs C)          D Board, moderation & publication   F Files & evidence   I Maps
```

A wave-2 or wave-3 stream can start early against the contracts of the one
it needs, but it merges after it.

---

## A · Identity and access

Sign-in by one-time code, sessions, the role ladder and its audit trail, the
owner handover, invitations, organizations and coordinators, the site
password ("the curtain"), and the doors through it.

- **Owns:** `apps/api/src/identity/`, `apps/web/src/routes/(staff)/access/`,
  `apps/web/src/features/identity/`, `packages/contracts/src/identity.ts`.
- **Uses:** `packages/access` for every grant decision. Granting writes the
  change and the audit row in one transaction.
- **Ports:** `otp.js`, `authMiddleware.js`, `roles.js`, `roleRank.js`,
  `ownership.js`, `invitations.js`, `organizations.js`, `siteAccess.js`,
  `doors.js`, `intakeGate.js`, `setup.js` (first-run wizard), routes `auth`,
  `me`, `moderators`, `orgs`, `invitations`, `siteAccess`, `setup`. Web:
  `gate.js`, `session.js`, `roles.js`, `setup.js`.
- **Tests to port:** `identity-`, `ownership-`, `invitations-`, `orgs-`,
  `doors-`, `setup-selftest`.
- **Watch:** the gate is frontend as well as backend. While gated, nothing
  behind it renders and the router does not navigate. What gets past the
  password is named in two places only: a list deciding for itself, and a
  logbook opened outside for filing only.

## B · Logbooks and the builder

Creating logbooks, the question builder, templates, conditions, launching,
and the one-way door after it.

- **Owns:** `apps/api/src/logbooks/`, `apps/web/src/routes/(staff)/logbooks/`,
  `apps/web/src/features/builder/`, `packages/contracts/src/logbooks.ts`.
- **Uses:** `packages/fields` (types, `normalizeCondition`),
  `ensureFormVersion`. The database already refuses changes after launch;
  the module should refuse first, with a sentence (`assertDraft`).
- **Ports:** `logbooks.js`, `templates.js`, `applyTemplate.js`,
  `fieldTypes.js` (done), `conditions.js` (done), `logbookFile.js`,
  `homeButtons.js`, route `logbooks`. Web: `logbook-builder.js`,
  `conditions.js`, `home-buttons.js`.
- **Tests to port:** `logbook-`, `template-`, `conditions-`,
  `home-buttons-selftest`.

## C · Filing and confirmation

The reporter's card form, the spine (address, consent, publication answer),
contact details under a per-report erasable key, the confirmation email and
its link, corrections, coordinator intake, and "my reports".

- **Owns:** `apps/api/src/filing/`, `apps/api/src/permissions/`,
  `apps/web/src/routes/file/`, `apps/web/src/routes/mine/`,
  `apps/web/src/features/form/`, `packages/contracts/src/filing.ts`.
- **Uses:** `buildAnswers`, `normalizeReportFields`, `appendReportVersion`,
  `isKnownDigest`. The card's digest comes from the server.
- **Ports:** `contactKeys.js`, `submissionTokens.js`, `reportPermissions.js`,
  `prompt.js`, `consentText.js` (done), routes `intake`, `reports` (filing
  half), `me`. Web: `form.js`, `form-logbook.js`, `answers.js`, `mine.js`.
- **Tests to port:** `confirm-`, `correction-`, `intake-`,
  `intake-hardening-`, `intake-switch-`, `permissions-`,
  `publication-selftest`.
- **Watch:** the confirmation link is the path nothing reaches by accident.
  Give it a browser test that follows the link from a captured email. One
  card asks one question; no auto-advance.

## D · Board, moderation and publication

Moderation states, review flags and keywords, editorial notes, the public
board with operator-chosen filters, search, the public API, chain file
downloads, the daily anchor, the transparency log, and snapshots.

- **Owns:** `apps/api/src/moderation/`, `apps/api/src/board/`,
  `apps/api/src/anchor/`, `apps/web/src/routes/(staff)/moderate/`,
  `apps/web/src/routes/board/`, `packages/contracts/src/board.ts`,
  `packages/contracts/src/moderation.ts`.
- **Uses:** `report_heads` (extends it), `buildChainFile`, `currentHeads`,
  `contradictions`, `headsDigest`.
- **Ports:** `publication.js`, `reviewFlags.js`, `reviewKeywords.js`,
  `editorialNotes.js`, `reportSearch.js`, `stats.js`, `figures.js`,
  `chainHeads.js` (done), `chainFile.js` (done), `transparencyLog.js`,
  `snapshot.js`, `anchorHealth.js`, scripts `anchor`, `anchor-watch`,
  `snapshot`, `export-archive`, `import-archive`, `check-chain`; routes
  `reports` (board half), `publicApi`, `press`, `stats`. Web: `board.js`,
  `moderate.js`, `contents.js`, `directory.js`, `admin-translog.js`.
- **Tests to port:** `chain-`, `editorial-notes-`, `review-flag-`,
  `review-keywords-`, `translog-`, `archive-roundtrip-selftest`.
- **Watch:** nothing is public until a moderator approves it. Once listed,
  always listed: the anchor refuses a list that contradicts the last one.

## E · Lists

The second format: an editable form whose entries are erased on a timer and
published as counts. The Tip List, check-ins and a contact form.

- **Owns:** `apps/api/src/lists/`, `apps/web/src/routes/lists/`,
  `apps/web/src/routes/(staff)/lists/`, `packages/contracts/src/lists.ts`.
- **Uses:** `packages/fields` only. **Never** `packages/seal` or
  `apps/api/src/chain`: the boundary check fails the build.
- **Ports:** everything in `legacy/src/lists/`, route `lists`, the forget
  link, `legacy/docs/lists.md`. Web: `admin-lists.js`, `list-review.js`,
  `list-form.js`.
- **Tests to port:** `lists-`, `lists-routes-selftest`.
- **Watch:** retention belongs to a field, not a row (`answers` versus
  `erasable_answers`). No `expires_at` on any list table. The erasure link's
  GET never erases, because mail scanners open links.

## F · Files and evidence

Uploads, envelope encryption per file, re-encoding (no camera metadata
survives), renditions, the file permission and taking published files down,
evidence requests.

- **Owns:** `apps/api/src/files/`, `apps/api/src/evidence/`, a worker
  entry point, `apps/web/src/features/files/`, `packages/contracts/src/files.ts`.
- **Uses:** `appendReportVersion` with an `attachments` manifest, then links
  exactly those rows in `report_attachments` in the same transaction.
- **Ports:** `attachments.js`, `media.js`, `mediaCache.js`, `renditions.js`,
  `storage.js`, `evidence.js`, `evidenceRequests.js`, `crypto.js` (the
  encryption half), scripts `media-worker`, `storage-*`, routes `uploads`,
  `evidence`. Web: `attachments.js`, `evidence.js`.
- **Tests to port:** `attachment-settings-`, `evidence-caps-`,
  `evidence-request-`, `upload-limits-selftest`.
- **Storage:** S3-compatible, in the EU. The provider is not chosen yet; code
  against the S3 API only.

## G · Look, site and administration

The operator's palettes and themes, site copy and legal text, the front
page's buttons, the docs pages, feedback, updates, and the shared UI
components (`apps/web/src/components/ui/`, shadcn/ui conventions).

- **Owns:** `apps/web/src/components/ui/`, `apps/web/src/styles.css`,
  `apps/api/src/site/`, `apps/web/src/routes/(staff)/settings/`,
  `packages/contracts/src/site.ts`.
- **Ports:** `look.js`, `siteCopy.js`, `siteIdentity.js`, `legalText.js`,
  `webManifest.js`, `feedback*.js`, `updates.js`, `updateCheck.js`,
  `digest.js`, `notifyTemplates.js`, `public/tokens.css`, routes `home`,
  `legal`, `feedback`, `admin`. Web: `admin-look.js`, `admin-settings.js`,
  `admin-editors.js`, `admin-updates.js`, `feedback.js`, `docs-page.js`.
- **Tests to port:** `legal-`, `home-buttons-` (with B), `alliance-selftest`.
- **Watch:** colour is exclusive. Status colours are never on a button, and
  a theme never sets a colour. Build shared components early, because every
  other stream with a screen uses them.

## H · Operations

Running it on a Hetzner server: the container image or systemd units, Caddy
in front, backups, migrations on deploy, email through Scaleway's
transactional email, error tracking (Bugsink), the scheduled jobs (anchor,
sweeps, digests), and a doctor command.

- **Owns:** `deploy/`, `apps/api/src/jobs/`, `apps/api/src/email/`,
  `.github/workflows/` (with care: everyone's checks run there).
- **Ports:** `doctor.js`, `backup.js`, `sweep.js`, `email.js`,
  `requestLog.js`, `accessLog.js`, `installConfig.js`, `contrib/`,
  `install.sh`, scripts `backup`, `sweep`, `doctor`, `mail-test`,
  `hourly-notify`, `weekly-notify`, `feedback-digest`.
- **Watch:** there are two sweeps and they do different things. One deletes
  expired credential rows from named tables; the lists sweep erases columns
  and leaves the row. Neither finds its tables by scanning for a column.

## I · Maps

Heat maps from `location` answers: no tile layer, ever. A threshold below
which an area is sent without its count. Several maps per page, nothing
found by id.

- **Owns:** `apps/api/src/maps/`, `apps/web/src/features/maps/`, `tools/geo/`,
  `packages/contracts/src/maps.ts`.
- **Ports:** `mapData.js`, `heatMaps.js`, `mapSlots.js`, `gazetteer.js`
  (the read half is done in `packages/fields`), `tools/build-geo.mjs`,
  `tools/build-gazetteer.mjs`, `legacy/docs/map.md`. Web: `map.js`,
  `admin-maps.js`.
- **Tests to port:** `heat-map-selftest`. Keep the check that fails if the
  map code names a tile layer.
