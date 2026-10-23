# Plan E: anonymous intake and flood prevention

21 October 2026. The owner's decisions on `docs/spam-prevention.md`
(the voting site brief) as they apply to ReportLog as a whole. ReportLog
stays general (decision 42): every item is a capability any site can use,
and nothing here removes a feature from the base software. Where this plan
and the brief differ, this plan wins.

## Owner decisions (2026-10-21)

| #   | Question                                | Decision                                                                                                                                                                                                                                                                                             |
| --- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1  | When a form asks for an email           | Automatically when it asks a free-text question or takes files. The operator may also require it on any other form. A form without it seals on arrival (no confirmation link), and its reporters cannot sign in to correct or withdraw. No receipts: a choice-only form is an advanced contact form. |
| E2  | Rate limiting                           | In the application, not Caddy. IP addresses only as keyed hashes under a key that rotates daily, deleted within a day; never in report or tip tables, logs or error tracking. Named in the privacy notice under legitimate interest.                                                                 |
| E3  | Two-factor login                        | Required for owner, administrators, access managers, moderators, intake coordinators and journalists. Authenticator app (TOTP) and passkeys (WebAuthn), both self-hosted; no SMS. Staff sessions last 12 hours.                                                                                      |
| E4  | Date and time limits                    | Any date or time question may carry an optional earliest and/or latest limit; an answer outside is refused. Polling-hours-per-state remains a known gap.                                                                                                                                             |
| E5  | The emergency email-confirmation switch | Left out.                                                                                                                                                                                                                                                                                            |

## Two-factor login (session PE1)

- Sign-in: email code as today, then the second factor. A role holder who
  has not set one up sees nothing behind the role until they do.
- TOTP: QR code drawn by the site; secrets encrypted under a server key
  (in `/etc/reportlog/reportlog.env`, made by the installer); a code is
  accepted once; a few wrong codes lock that sign-in for a while.
- Passkeys: register several; either factor satisfies a check.
- Recovery: ten single-use codes shown once. The owner resets another
  person's second factor from the Access screen (recorded in `role_audit`);
  the owner's own only on the server: `sudo reportlog reset-2fa <email>`.
- **Step-up**: the second factor again, valid 5 minutes, before: opening a
  reporter's or tipster's email; approving, rejecting or removing a
  journalist; granting or removing a role or resetting a second factor;
  pause intake and the puzzle switch; bulk decline; exports and backups
  from the admin screens; publishing a moderator or journalist agreement.
  Ordinary moderation never asks again.

## At the door (session PE2, after PD8)

- E1's email rule, derived from the form, with the operator override.
- ALTCHA proof of work, self-hosted: verified server-side, single use,
  expires; difficulty a setting.
- Honeypot field (hidden by CSS, skipped by screen readers).
- Minimum time on the form: a signed start token, no personal data.
- Rate limits per IP hash (E2), with a separate higher limit on page loads.
- E4's date/time limits.
- A refusal shows one plain "try again" message, never which check
  failed; refusals are counted by check, without content.

## In the record and on the moderator screen (session PE3, after PD8)

- Sealed on arrival for forms without email (E1); hidden until accepted.
- Public counts, maps, digests and alerts: accepted only (done, decision 36).
- A per-logbook "publish as counts only" setting; reports from an
  organization labelled apart from open-form ones.
- Arrival times visible publicly; declined reports counted publicly by
  reason.
- Organization lane: queue priority for organization reports; intake links
  with a use limit and an off switch; one organization's reports handled
  as a set.
- Flood screen: submissions and refusals per hour (24 h); queue filters by
  time window, state, county and identical answer sets; bulk decline with
  one reason (one decision record per report); batch accept; pause intake
  (forms say so and a public notice appears); harder puzzle; each switch
  use recorded and shown publicly with its time. Tip links: bulk decline by
  time window.

## Not built (from the brief)

Third-party challenges, fingerprinting, datacenter blocking, per-county
caps, suspicion scoring, automatic difficulty, single-use reporter codes,
anything tying a submission to a person.

## Tests

Each rule in the brief's section 08 gets a test that fails if the rule
breaks, plus: two-factor required for every staff role; step-up on each
listed action; reset paths; no IP or request id in reports, tips, logs or
error tracking.

## The test3 bot review (23 October)

A scripted run filed 12 reports and 3 tips on test3 with the password off
and no email. Nothing became public. Outcome:

- Source maps: turned off (`build.sourcemap: false` in `apps/web/vite.config.ts`).
- Unaccepted reports in public numbers: already covered by
  `pe4-counts.test.ts` (counts route, numbers, `/api/v1/stats`, heat maps,
  board, spreadsheet, figures, snapshot).
- Door refusals: already one operator-set sentence for every check.
  Answer-validation messages stay detailed; the same formats are public in
  `/api/logbooks/:slug` anyway.
- Bursts: the flood screen already covers this.
- Email after launch: "Ask for an email address anyway"
  (`logbooks.email_required`) is unsealed and can be turned on at any time.
- Not adopted, per the 21 October decisions: silent holding or suspicion
  flags, network or GeoIP checks, decoy questions, reporter codes.
