# UX overhaul 1 · sign-up fixes, coverage (decision 84), and the stragglers merged: status

- **Branch:** `claude/election-log-ux-overhaul-abycry`, built on `alpha` at `acceee3`.
- **State:** built and checked; pushed to `test` for review on 3 November. Not on `alpha`, `beta`
  or `main`. Moving it to `alpha` is the owner's call once it has been looked at.

## What is in it

- **Everything `alpha` had** over `main`: journalist Phase 1 (decisions 80, 81), the map beside the
  board and click-to-filter (82), decision 83 written down (not built), and the group fixes.
- **The stragglers, merged:**
  - `ccr-b517ea62-w6jfdd`: the severity rating offered at approval, and the queue's "Not rated" list.
  - `ccr-90dad03a-r1c02i`: what to do when a passkey cannot be used on this device.
  - `ccr-16d6b097-a1s17g`: decision 83 again (same text) and a paper copy added and removed; nothing
    left in it.
  - `ccr-bcc3d315-eqsx1a`: the project site's imprint (§ 5 DDG) and privacy (BayLDA) lines;
    `operator.json` keeps the version with the contact email.
- **Not merged, on purpose:**
  - `deploy-www-redirect`: superseded by `SITE_ALIASES` (already on `main`), which does the same
    and more. Merging it would leave two ways to redirect a name.
  - `claude/moderation-unified`: paused half-way (its own doc says so), five conflicts with this
    branch and ten with the severity work above, and decision 83 replaces its central rule (every
    link judged before approval). It is the starting point for building decision 83, to be ported,
    not merged.
  - The `claude/ft-*`, `claude/p*`, `claude/q*`, `claude/r*` and other October workstream branches:
    their work reached `main` through squashed merges; what is left on them is older versions of
    files since changed (dozens to hundreds of conflicts each).
- **Sign-up fixes.** A journalist desk request reaches the people who decide from every path, not
  only when signed in (`journalists/request.ts`, `tellDeciders`). Somebody given a staff role is
  emailed (`identity/accessRoutes.ts`, `roleGrantedEmail`). The pages behind emailed links no
  longer say a request goes "to the owner".
- **Coverage (decision 84).** Tables in `20261102225200_coverage.sql`; contracts in
  `packages/contracts/src/coverage.ts`; server in `apps/api/src/articles/`; pages in
  `apps/web/src/features/articles/`: `/journalists/coverage`, `/moderate/coverage`,
  `/board/coverage`, and the maps' "News coverage" layer. The folders are named `articles`
  because `.gitignore` drops any folder named `coverage/` (test-coverage output); a first commit
  lost both folders that way, caught before it was pushed.

## Tests, 2 to 3 November

- `pnpm typecheck`, `pnpm format:check`, `pnpm boundaries` (three warnings, all there before).
- Lint: every changed file is clean. The whole-repo `pnpm lint` runs out of memory in a cloud
  container (8 GB); give Node more heap or run it in CI.
- Web unit 628 passed. API unit 595 passed, 27 skipped.
- `pnpm test:db`: 1,659 passed, 1 failed: the invariants test wanted the new `/api/coverage`
  prefix declared. Declared; that file then passed 34 of 34. The full suite was not run again.
- Browser: the journalist-desk project, all three tests, including the coverage walk. Of
  `journalists.spec.ts`, `navigation.spec.ts`, `maps.spec.ts`, `third-party.spec.ts` and `board/`,
  302 passed and 4 failed; the same 4 fail on untouched `alpha` (`board/moderate.spec.ts` at 105,
  198 and 299, and `journalists.spec.ts:59`). The whole browser suite was not run.
- The journalist-desk project now runs on one worker: its two files each take the owner's seat,
  and side by side they handed it to each other mid-test.

## What is left

The queue, and what waits on the owner, is in `reportlog-ops` `docs/STATUS.md`.
