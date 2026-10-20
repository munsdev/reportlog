# Q1 · Doors and the owner's decisions 1 to 5: status

For the coordinating session and the other workstreams. Brief: `docs/decisions.md` 1–5, and two
leftovers from `P2-site-pages.md`.

- **Branch:** `claude/q1-doors-decisions`, based on `ccr-c9c93698-ev856l` (merged again before the
  last run; it had not moved)
- **Pull request:** [#26](https://github.com/munsdev/reportlog/pull/26), into `ccr-c9c93698-ev856l`
- **State:** finished, waiting for review. Not merged.
- **Last updated:** 2026-10-20

## Checks, as last run before pushing

| Suite                                   | Result                                                                                                                                                           |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check`                            | passes: format, lint, types, boundaries (640 modules); unit tests api 342 (11 skipped, not Q1's), web 468, seal 31, fields 69, access 6                          |
| `pnpm test:db`                          | 65 files, 984 passed (Q1's: 20, in `q1-decisions.test.ts`)                                                                                                       |
| Browser suite (`CHROMIUM_PATH`, `CI=1`) | 448 passed, 3 skipped (P2's desktop-only settings tests, skipped on the phone). Q1's: 2 in `in-front/in-front.spec.ts`, 1 new in `verify.spec.ts` on two devices |

## What was built

1. **Verifying a report that is not public** (`apps/api/src/routes/verify.ts`).
   - `GET /api/reports/:ref/verify` sends `hashed_fields` and `canonical_json` only while that
     version is the published one (`publishedReportIds`) **and** the archive switch is on: the two
     gates the board asks. Otherwise both keys are **absent** and the answer is the fingerprint,
     the link, the position and the anchor.
   - Moderators and administrators get it whole, as they read it in the queue anyway. A signed-in
     account without those roles does not.
   - A version a correction replaced is not "the published one": fingerprints only.
   - Decided in the route, not in `chain/verify.ts`: "public" reads moderation and the revocable
     permission, which the chain code may not reach. `chain/verify.ts` still builds the whole
     answer (its many db-test callers are unchanged) and now says so in its type.
   - The page: without the text, "What this report says is not shown", the three hashes, and the
     browser re-check becomes "the fingerprint and the link before it still combine into the
     recorded link" (`lib/recheck.ts`).
   - Tested both ways: `test/db/q1-decisions.test.ts` (unpublished, published, published without
     permission, archive off, a superseded version, a moderator, a plain account),
     `test/verify.test.tsx`, and `e2e/verify.spec.ts`, which files a report, sees its
     fingerprints only, approves it, and sees its words.
2. **`/api/v1` stays behind the password.** It already was. `q1-decisions.test.ts` fails if any
   `/api/v1` pattern is put in `IN_FRONT` or in `DECIDES_ITSELF_PREFIXES`, and checks with the
   password on that `/api/v1`, `/api/v1/stats` and `/api/v1/consent-texts` answer `locked`, even
   with a logbook open outside. With the password they answer.
3. **The lock screen** (`features/identity/LockScreen.tsx`).
   - The site's name (`BrandName`, its two tones) above the heading, and the operator's paragraph
     under it. Nothing else of the site: not the look, not the other wording.
   - The paragraph is a new optional copy slot, **`lock_intro`** ("Your own words on the
     password screen"), empty by default, written on the existing Page wording screen. It refuses
     `{{ }}` figures, and that screen offers no "Insert a number" for it: figures count what the
     password protects.
   - Both come on `GET /api/site-access/status` (`site`, only while locked;
     `apps/api/src/site/lockScreen.ts`), which is already in front of the password. The lock
     screen asks the status and the doors, and nothing else (unit test and browser test both count
     the requests).
4. **The evidence-request link in front of the password** (`identity/doors.ts`).
   - Every call the evidence page makes passes on a token that names a request, open or not
     (`evidenceTokenKnown` in `evidence/requests.ts`), the way the confirmation link passes on a
     known submission. Whether it is still open, and what it may do, stays `evidence/routes.ts`'s.
     A token naming nothing gets `locked`. The moderator's evidence routes stay behind.
   - `/evidence/:token` is in `DOOR_PATHS`, so the page renders as a door.
   - Browser test `e2e/in-front/in-front.spec.ts`: the reporter files, permits, a moderator
     asks, **the password goes on**, and the reporter follows the link from the captured email
     in a fresh browser, sends a photo, sees "Thank you", then the spent link's own refusal, and
     a made-up link's lock screen. No request behind the gate, none to another host.
5. **The confirmation page while the archive is off.** `threadState` (`filing/filing.ts`) asks
   the archive switch: `public` only while it is on. Otherwise `received` with
   `archive_closed: true`, and the page says "This site is not publishing reports at the moment,
   so a report it approves may be published later." No "public" anywhere on it.

**Leftovers.**

- **The development badge on the lock screen and on a door.** The status call now carries
  `dev_mode_until` always. The badge reads `/api/site` while past the password (fresher) and the
  status call while locked or on a door, and never asks `/api/site` there. The lock screen draws
  the badge itself, since the router (and so the root layout) is not mounted under it.
- **`submit_intro` with one logbook open.** `/submit` no longer redirects when an intro is
  written: it shows the intro and the one logbook's link. With no intro it redirects as before.
  It waits for the wording before choosing, so nothing appears after the page is drawn. Not on
  the form's first card: that is C's form, and text arriving after the card is drawn is what "one
  card, nothing changes underneath" forbids (P2 said the same).

## Changes outside Q1's folders (named in the commit messages)

- `packages/contracts`: `verify.ts` (the two text fields optional), `filing.ts`
  (`archive_closed`), `site.ts` (the `lock_intro` key). `identity.ts` is Q1's.
- `apps/api/src/routes/verify.ts`, `chain/verify.ts` (a type only), `filing/filing.ts` (the
  archive switch), `evidence/requests.ts` and `evidence/routes.ts` (one function, one comment).
- `apps/web`: `features/form/ConfirmPage.tsx`, `routes/submit.tsx`,
  `components/ui/dev-badge.tsx`, `lib/recheck.ts`, `playwright.config.ts` (one project,
  `in-front-of-password`, after `board-maps`).
- Tests that read an unpublished report's sealed fields over HTTP now read them as an
  administrator: `e2e/files/attach.spec.ts`, `e2e/files/evidence.spec.ts` (which also checks the
  reporter is shown none of it), `e2e/filing/intake-files.spec.ts`, `e2e/filing/file.spec.ts`
  (which now checks the verify page shows the fingerprints and not the words).
- `test/ui/site.test.tsx` (G's): a slot also counts as read when drawn with its `data-copy`
  marker. `test/unit/site-pages.test.ts` (P2's): ten slots.
- Status mocks in `door-quiet`, `gate`, `filing`, `staff-nav` carry `dev_mode_until`;
  `door-quiet` covers the new door shape.

No migration: the paragraph is a row in the existing copy table.

## Not done

- The lock screen's `<title>` still says nothing of the site; only the page does.
- The evidence link on a gated site is tested end to end; the confirmation page's "may be
  published" wording is tested on the server and by reading the code, not in a browser with the
  archive off.
