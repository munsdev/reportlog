# R7 · Identity: tests (A4): status

For the coordinating session and the other workstreams. Brief: R7 in `docs/parity.md` §7.

- **Branch:** `claude/r7-identity-tests`, based on `ccr-c9c93698-ev856l` at `6bd963a`
- **Pull request:** PR_LINK, into `ccr-c9c93698-ev856l`
- **State:** finished, waiting for review. Not merged.
- **Last updated:** 2026-10-20

## Checks, as last run before pushing

Against the base at `6bd963a` (the latest when this was written).

| Suite                                   | Result                                                               |
| --------------------------------------- | -------------------------------------------------------------------- |
| `pnpm check`                            | passes (unit tests: api 386 + 17 skipped, web 477, fields 69, seal 31, access 6) |
| `pnpm test:db`                          | 68 files, 1023 tests, all passed (29 in `invitations.test.ts`, 7 of them new)     |
| Browser suite (`CHROMIUM_PATH`, `CI=1`) | E2E_RESULT                                                           |

## What was tested, in the order asked

1. **Every role an invitation can grant says what it grants**
   (`apps/api/test/db/invitations.test.ts`, "an invitation says what it grants"). For each role in
   `ORG_ROLES` (from `@reportlog/access`, so a role added there is checked without anybody
   remembering): a name, at least one thing it can do and one it cannot, and no blank line. The
   manager's "cannot" says "outside this organization", and a manager invitation opened by a
   stranger carries exactly that wording.
2. **The seven-day lifetime** (same file, "an invitation lasts seven days"). `INVITE_TTL_MS` is
   seven days; a sent invitation's stored end is seven days after it was sent; it is shown a
   minute before its end; a second after, the link answers 404 like one that never existed, and
   accepting it is refused and joins nobody.
3. **The sign-in code step** (`apps/web/e2e/identity/access.spec.ts`, "a refused code is
   announced and tied to its field, and both steps pass axe on a phone"). At Pixel 7 size, behind
   the site password: axe (WCAG 2.0 to 2.2, A and AA, run in the page from `node_modules` the way
   `accessibility.spec.ts` runs it, so nothing is fetched) on the address step, the code step and
   the code step showing a refusal; no sideways scroll on any of them; a wrong code (the real one
   plus one) answered by an alert with the server's sentence, the field marked invalid and
   described by that sentence; the step stays put; "Use a different address" clears it; no
   script errors.
4. **The digest-stop door's calls** (same file, the existing "a digest is stopped…" test, now
   recording every `/api/` call by method and route). The door may make only these, all named
   in `IN_FRONT` (`apps/api/src/identity/gate.ts`):
   - `GET /api/site-access/status` and `GET /api/doors` (the gate deciding what to show),
   - `GET /api/telemetry` (whether error tracking is on),
   - `GET /api/notifications/stop/:token`, twice (opened, then reloaded as a mail scanner would),
   - `POST /api/notifications/stop/:token`, exactly once (the button).

   Any other call fails the test.

## The fix a test showed

**A refused sign-in code was announced, but the field never said so.** The refusal was already a
`role="alert"` paragraph, so it was read out as it appeared. But the code field was not marked
`aria-invalid` and did not point at the sentence, so somebody who went back to the field heard
the field and not why it had been refused. `SignInForm.tsx` now marks the field it is about
(address or code) invalid and describes it by the refusal while one is showing. `ErrorText`
(`ui.tsx`) takes an optional `id` for this. No wording changed.

## Parity rows

- §4b "an invitation says what it grants": Equivalent.
- §4b "limits that stop invitations being a mail cannon": Equivalent.
- §4c `login.test.js`: Equivalent.
- §1b, the door row: **still Partial**, on purpose. The stop door's calls are now listed by a
  test, which was R7's half. The other half is the wording of the rule in `CLAUDE.md`, R0 p, the
  coordinator's to change.

The totals table: `selftest.js` groups 54 Equivalent, 21 Partial; browser tests 11 and 11;
Partial rows 49.
