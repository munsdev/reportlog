# Plan E session 1 · Two-factor login: status

- **Branch:** `claude/plan-e-two-factor`, from `ccr-c9c93698-ev856l` at `dda02c1`.
- **State:** built; PR into `ccr-c9c93698-ev856l`.
- **Ruling:** E3 recorded as decision 48 in `docs/decisions.md`.

## What was built

### Who needs a second factor, and how nothing behind a role opens without it

- **Everybody holding a role:** every system role but `user` (owner, administrator, access
  manager, moderator, journalist) and anybody with an organization membership (managers and
  intake coordinators). `needsSecondFactor` in `apps/api/src/identity/secondFactor.ts`.
- **Enforced in one place, not per guard.** `userForSession` (`identity/sessions.ts`) resolves a
  role holder whose session has not proved a factor to `role: 'user'` and `memberships: []`.
  Every guard reads `request.user`: `roleGuard`, `requireRole`, `requireGranter`,
  `moderatorGuard`/`agreementGuard`, `deskGuard`, the owner checks written as
  `user.role === 'owner'` (handover, setup's curtain step, the copies scope), and the intake
  scope's `coordinatorOrgs`. None of them changed, and a guard added later cannot forget.
  `SignedIn` gains `heldRole`, `secondFactor` (`not-needed | set-up | verify | done`),
  `stepUpAt` and `sessionHash`; `Me` gains `secondFactor`, `heldRole` and `stepUpUntil`.
  A proof older than 12 hours counts as none, whatever `expires_at` says.
- **Not affected:** plain users, alert subscribers (token links), every door (`IN_FRONT`,
  `FILING_CALLS`): the new routes are behind the site password like `/api/auth/sign-in`. The
  tester and team-member **flags** are not roles under E3 and are left alone (the team flag
  opens guides and no report; the tester flag the feedback tracker).
- **Sessions.** A role holder's sign-in (and the setup wizard's owner claim) makes a 20-minute
  session (`PENDING_SESSION_MS`). Proving the factor **replaces it** with a new token, a
  12-hour staff session (`upgradeSession`): a copy of the cookie taken before the factor was
  proved signs in nobody after. Plain users keep 24 hours.

### Authenticator app (TOTP)

- `identity/totp.ts`: RFC 4226/6238, own code on `node:crypto` (HMAC-SHA-1, 6 digits, 30 s,
  ±1 step), tested against both RFCs' published vectors. No dependency.
- **Encrypted at rest** (`identity/twoFactorKey.ts`): AES-256-GCM under a key derived (HKDF)
  from a **new `TWO_FACTOR_KEY`**, with the person's id as associated data, so a secret moved
  onto another row does not open.
  - **Why its own key and not CONTACT_KEY's keyring.** Their costs differ. Losing CONTACT_KEY
    loses every reporter's address for good, so it is never changed and a deploy pins it.
    Losing or replacing TWO_FACTOR_KEY costs each staff member setting their app up again
    (passkeys and recovery codes are not under it; the owner or `reset-2fa` clears an unusable
    one). Sharing would give each the other's blast radius and rules. So there is no
    `_PREVIOUS` key and no rotation window either: a new key is a cheap reset.
  - `install.sh` makes it whenever the settings file has none, without asking (unlike
    FILES_KEY); `.env.example` has it blank; the `deploy/README.md` table and
    `secrets.test.ts` name it; the session-start hook writes a development one. Without it the
    server runs, passkeys work, and setting up an app says why it cannot.
- **A code is accepted once:** `two_factor_totp.last_step`, advanced by a conditional UPDATE,
  so two requests racing with one code cannot both win, and no step at or before the newest
  accepted is accepted again.
- **Setting up** keeps the new secret as `pending_secret_enc` until a code from it is typed,
  so a phone that never got the secret leaves the old one working.
- **Lockout:** per person (a session costs only an emailed code, so per session would be per
  inbox). A try is spent before it is compared, in one statement, as `otp.ts` does; five
  wrong codes (app or recovery) lock codes for 15 minutes. A passkey still works while locked.
- **QR code** drawn by the page from the server's `otpauth://` address with
  `qrcode-generator@2.0.4` (zero dependencies), as SVG; the key is written out too.

### Passkeys (WebAuthn)

- `@simplewebauthn/server@14.0.3` and `@simplewebauthn/browser@14.0.0`, exact pins.
  Several per person, named; `excludeCredentials` stops one authenticator registering twice.
- **RP ID is SITE_ORIGIN's host**, the origin itself the only one accepted. A browser makes no
  passkey for an IP address, so a SITE_ORIGIN on `127.0.0.1` is answered as `localhost` on the
  same port (only development and the browser suite have such an origin).
- The challenge is kept per session (`two_factor_challenges`, swept by the credential sweep)
  and spent by the answer, right or wrong. A passkey proves only its own person: the
  credential is looked up among the asking account's own.
- Attestation `none`; user verification preferred, not required (not every key has a PIN).

### Recovery codes

- Ten, 16 characters of Crockford base32 (80 bits), shown once when the first factor is set
  up and when made again (step-up); stored as sha256 hashes; each spent by a conditional
  UPDATE. Typing forgives case, spaces, hyphens, and O/I/L for 0/1.

### Step-up

- `identity/stepUp.ts`: `stepUpGuard()` as a per-scope hook, after the scope's role guard, so
  somebody without the role is told that rather than asked for a code. Valid 5 minutes
  (`STEP_UP_MS`). Proving the factor at sign-in counts as one. `403 step_up_required`.
- **Where:** each listed action's routes now sit in a scope of their own with the hook:

  | Action (plan-e.md)                             | Route(s)                                                                                                                                                                                 | File                                       |
  | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
  | Opening a reporter's email                     | `POST /api/moderation/reports/:threadId/contact`                                                                                                                                         | `moderation/routes.ts`                     |
  | Opening a tipster's email                      | none exists: a tip's address is never decrypted for staff (decision 40)                                                                                                                  |                                            |
  | Approving, rejecting, removing a journalist    | `POST /api/owner/journalists/:id/{approve,reject,revoke}`                                                                                                                                | `journalists/routes.ts`                    |
  | Granting or removing a role                    | `POST /api/access/system-role`; `POST /api/orgs`, `POST/DELETE /api/orgs/:id/members…`, `POST /api/orgs/:id/invitations…`, `…/approve`; the owner handover (`handover-code`, `handover`) | `identity/accessRoutes.ts`, `orgRoutes.ts` |
  | Resetting a second factor                      | `POST /api/access/second-factor/reset`                                                                                                                                                   | `identity/secondFactorRoutes.ts`           |
  | Pause intake                                   | `PUT /api/admin/intake-switch`                                                                                                                                                           | `filing/routes.ts`                         |
  | The puzzle switch; bulk decline                | not built yet (PE2, PE3): they take `stepUpGuard()` when they are                                                                                                                        |                                            |
  | Exports and backups                            | `POST /api/admin/copies`, `GET /api/admin/copies/:kind/:name`, `GET /api/admin/chain/:slug`                                                                                              | `anchor/copies.ts`, `anchor/routes.ts`     |
  | Publishing a moderator or journalist agreement | `POST /api/admin/agreement/:audience`                                                                                                                                                    | `moderation/platformRoutes.ts`             |

  Not on the list and left alone: the tester and team flags, the copies list itself (the
  screen polls it while a copy is made, longer than a step-up lasts), batch approve and every
  other moderation action.

- **Website:** `lib/api.ts` answers `step_up_required` by asking the step-up dialog
  (`features/identity/StepUp.tsx`, mounted once in the root layout) and making the call once
  more; closing the dialog leaves the refusal. A download link is no call, so the backups and
  transparency-log screens use `StepUpDownload`, which asks first.
- Changing your own factors once you have one (adding, replacing, removing, new recovery
  codes) also asks for a step-up; the last factor cannot be removed.

### Resets

- **The owner**, from the Access screen ("Reset somebody's second factor"), step-up first, never
  their own: clears the app, passkeys, recovery codes and lock, deletes every session of theirs,
  and writes a `role_audit` row (`axis 'second_factor'`, new in the CHECK; `revoke`, "second
  factor reset, by the owner") in the same transaction. Nobody else may.
- **The owner's own, only on the server:** `sudo reportlog reset-2fa <email>` (in
  `deploy/bin/reportlog`, its help, `deploy/README.md` "Two-factor login" and the "When something
  is wrong" table), running `apps/api/src/identity/reset-two-factor.ts` as the service user in the
  running release, like `site-password`. Same reset, recorded with actor
  `the server (reportlog reset-2fa)`.

### On screen

- `SignInForm`: the emailed code, then, for a role holder, the second factor (or setting the
  first one up) before `onSignedIn`. The setup wizard's owner sets one up before its next step.
- `StaffOnly` and `OnlyFor` show the way to it to somebody who holds the role (not a refusal);
  somebody without the role is still refused. Recovery codes stay on screen until "I have kept
  them", though the server has let the person in.
- `/access/security`: your app, passkeys and recovery codes. "Your account" links to it.

### Migration and logs

- `20261021111901_two_factor.sql`: `sessions.second_factor_at`, `sessions.step_up_at`;
  `two_factor_totp`, `two_factor_passkeys`, `two_factor_recovery_codes`, `two_factor_attempts`,
  `two_factor_challenges`; the `role_audit` axis CHECK gains `second_factor` (keeping
  `archive`). Types regenerated.
- No code, secret, recovery code, token or client address is logged: the request serializer logs
  the route pattern, and a test drives the routes at `trace` level and searches the log for each.

## Tests

(Totals below are from the final runs on this branch.)

TOTALS_PLACEHOLDER

## Assumed, not verified

- Real authenticator apps and real passkeys (a phone, a security key) were not tried: TOTP is
  checked against the RFC vectors and codes computed in the tests; passkeys against a software
  authenticator in the db tests and Chromium's virtual authenticator in the browser.
- The CLI is tested against a real database (db test) and through the deploy sandbox (the
  command line and the service user); not on a real server.

## For later sessions

- **PE2/PE3:** the puzzle switch, pause-intake's new home if it moves, and bulk decline take
  `stepUpGuard()` in a scope of their own, after their role guard; add each to `LISTED` in
  `apps/api/test/db/second-factor.test.ts`.
- A browser test that performs a listed action calls `stepUp(page.request)` from
  `apps/web/e2e/second-factor.ts` first, or meets the dialog.
