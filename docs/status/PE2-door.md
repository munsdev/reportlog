# Plan E session 2 · At the door: status

- **Branch:** `claude/plan-e-door`, from `ccr-c9c93698-ev856l` at `7bc3059` (PD8), with the base
  merged again at `3fb70a7` (PE1 two-factor, PE3 moderation).
- **State:** built; PR into `ccr-c9c93698-ev856l`.
- **Brief:** `docs/plan-e.md` (E1, E2, E4, "At the door"), `docs/electionlog-spam-prevention.md`
  §01, §02, §07, §08. Ruling 42 holds: every piece is a general capability; nothing reads "is this
  ElectionLog".

## What was built

### E1 · when a form asks for an email

- **The rule** (`packages/fields/src/email.ts`, `formAsksEmail`): a logbook asks for an address
  when a question lets somebody type, or it takes files, or the operator requires one.
  - Typed: `short_text`, `long_text`, `email` (a second address is an address), `url` (typed, and a
    link can name a person's own page), and `place` unless it is a closed list (`allowOther: false`
    with choices).
  - Also asking: `file` (the staging quota is keyed on the address, and a file is the reporter's to
    withdraw) and `evidence_declaration` (it exists so a moderator can ask for the evidence later,
    by email).
  - Not asking: `choice_one`, `choice_many`, `yes_no`, `location`, `number`, `date`, `time`,
    `datetime`: the operator's vocabulary, or a bounded value that cannot carry a sentence.
  - An unknown kind asks: a kind added later that nobody classed fails towards an unnecessary
    address, not towards a report nobody can correct.
- **The operator's switch**: `logbooks.email_required` (migration `20261021131234_the_door.sql`),
  "Ask for an email address anyway" in the builder, `ask_email: "always"` in a logbook file. It can
  only add an address. Not sealed, so it can change after launch. `asks_email` is derived on every
  read (`LogbookSummary`, the public form).
- **Sealed on arrival** (`filing/filing.ts`): a form without email is checked exactly as any other,
  then `appendReportVersion` and `startThread` run inside the request's transaction. No
  `report_submissions` row, no link, no contact row, so no address to sign in with: My reports has
  nothing. An address sent to such a form is refused ("This form does not ask for an email
  address"), not kept. CONTACT_KEY is needed only by forms that keep an address. The response is
  `{ filed: true }`; the page says "Your report to … was received". **No reference is shown**
  ("No receipts", E1): a reporter is not handed a receipt for a report nobody has accepted.
- **The spine's address when absent**: the address was never part of the sealed object
  (`normalizeReportFields` takes no email; it lives under the contact key), so nothing in the seal
  changes and no key is written as null. Legacy vectors green, no fixture touched.
- **Decision 41's "couldn't notify"** (`moderation/rejection.ts`, PE3's folder, three lines): a
  thread with no contact row is not a failure to notify. Nothing is attempted or recorded, and the
  decision route answers `notice: 'none'`. An erased key still records `no_key`, as before.
- **Forms with email keep today's flow exactly**: the confirmation tests are unchanged.
- **Lists** already had E1's rule (`lists/fields.ts`: a personal kind asks, `email_mode:
required` adds). Checked, unchanged: an entry on a no-email list has no erasure token or link, and
  its retention timer (`personal_expires_at`) still applies.
- **PD8's send-card line is now true** for the ElectionLog preset; the flag is removed from
  `docs/status/PD8-electionlog-forms.md`.

### The door (`apps/api/src/door/`)

Every report and tip route runs `door.pass` first: `POST /api/reports` and
`POST /api/lists/:slug/entries`, doors included. Order: rate limits, honeypot, start token, puzzle.

- **ALTCHA, self-hosted.** `altcha-lib@2.5.0` on the server, `altcha@3.2.4` widget in the page,
  both pinned exact (the newest releases at least two weeks old). PBKDF2/SHA-256, non-deterministic
  mode (issuing a challenge costs one HMAC; the library's "deterministic" mode would make fetching a
  challenge cost the server the work the puzzle asks of a visitor). Verified on the server; the
  hash of each accepted challenge's signature is kept in `door_spent_puzzles` until it would have
  expired, and a second use is refused (the insert is the check, so two simultaneous sends cannot
  both win); 30-minute expiry. Only our own challenge shape is accepted: the library's
  "server-verified" payload (a hosted service) is refused.
  - **The widget makes no third-party request**: the external build (the default bundle starts
    workers from inline blobs, which the CSP refuses); its PBKDF2 worker is a Vite-emitted file of
    this site; `humanInteractionSignature` off (it collects pointer movement); logo and footer
    (links to altcha.org) hidden. Checked in the browser: the worker's URL is 127.0.0.1, and no
    request leaves the site.
  - **Difficulty** is PE3's "Harder puzzle" switch: `puzzleLevel(db)` (`moderation/switches.ts`),
    mapped here to `PUZZLE_LEVELS`. Measured in headless Chromium on 4 cores: normal 0.7–0.9 s
    from page load (mostly the widget's half-second minimum), harder 1–14 s.
- **Honeypot**: `website`, hidden by CSS (off-screen), `aria-hidden`, `tabindex=-1`,
  `autocomplete=off`. One shared component for the report and tip forms.
- **Minimum time**: `GET /api/door/start` issues `<ms>.<HMAC>` under a subkey of `DOOR_KEY`:
  nothing else in it. Refused when missing, forged, from the future, or sooner than
  `door_settings.min_form_ms` (3 s shipped). Not single use: the page keeps it, so a refusal on
  another check is answered by sending again at once.
- **`DOOR_KEY`** (32 bytes, base64): made by `install.sh` (always safe to replace: nothing signed
  with it outlives a day), blank in `.env.example`, in the deploy README's table, `secrets.test.ts`
  and the installer's "never shows a key" test, and written by the session hook. Unset, the server
  makes one in memory at start and logs a warning: the door is never off.
- **Both reads are in front of the password** (`IN_FRONT` in `identity/gate.ts`, PE1's folder, two
  lines): a door page needs them, and a signed random puzzle and a signed moment reveal nothing.
  `FILING_CALLS` and the list routes are unchanged and still work on a door (tested).
- **Refusals** (`door/index.ts`): status 400 (429 for a rate limit), code `try_again`, and one
  sentence from the new copy slot `refusal_message` ("Something went wrong. Please try again." until
  the operator words it). Never names the check. Counted by check through PE3's
  `countRefusal(db, check)` (`moderation/refusals.ts`, shown on the flood screen), with no content,
  logbook, list, minute or client. The page shows the sentence and solves a fresh puzzle at once.
- **PE3's `refuseWhilePaused`** stays first in both routes: a paused site says so before the door.
- **The list form's old filters** (a hidden box and a client-reported `elapsed_ms`, both answered
  like success) are replaced by the door: refused plainly, and counted.

### E2 · rate limits

- In the app: per network address, reports and tips per minute (`DOOR_SUBMITS_PER_MINUTE`, 6) and
  per hour (`DOOR_SUBMITS_PER_HOUR`, 60), and requests of any kind per minute
  (`DOOR_REQUESTS_PER_MINUTE`, 600; the health check exempt). A refused attempt still counts.
- **The address only as an HMAC under a key that lives in memory and changes at UTC midnight**
  (`door/clients.ts`). Counters are dropped with the key; a timer makes sure a quiet night still
  drops them. **Why memory, not a table**: the API is one process (`reportlog-api.service`), so a
  limit kept in memory is the site's limit; a table would be a second copy a backup could carry off
  and a sweep would have to remember. A restart forgives a flooder one window.
- **Every other in-memory limiter now hashes its key the same way** (`identity/limiter.ts`, PE1's
  folder, a few lines): sign-in codes, the curtain, erase links, files, evidence, journalists, the
  platform routes and the lists all passed `request.ip`; none keeps a raw address now.
- `TRUST_PROXY` is respected (Fastify's `trustProxy`, one hop behind Caddy); without it a forwarded
  header is not believed (tested).
- Never in report or tip tables, logs or error tracking: tested by searching every row of every
  table, every captured log line and everything the stand-in Bugsink received for both addresses
  and their hashes (`door-privacy.test.ts`; a planted `ip: req.ip` in the serializer makes it fail).
  The request serializer still logs the route pattern only; error tracking's allowlist is
  unchanged.

### E4 · date and time limits

- `earliest` / `latest` on any `date`, `time` or `datetime` question (`packages/fields`,
  `normalizeAnswer`), each in the kind's own written form (`2026-11-03`, `07:00:00`, a UTC moment;
  a moment must be written with its offset). Written only when set (absent-key rule for the form
  definition: a question without limits hashes as before). An answer outside is not an answer, so
  every sealing path refuses it through the strict reading (ruling 49), in a sentence ("… is
  outside the dates or times this form takes"); a list refuses it too (`outside-dates`).
- Authored in the builder (two boxes on a date/time question, draft only like every setting), in
  logbook files and starting points; carried to the page, where they are the picker's `min` and
  `max`.
- **ElectionLog's preset**: the date question has a placeholder window of **2026-09-18 to
  2026-11-10** (the earliest early voting for 3 November 2026 through a week after it). **The
  operator edits it before launch**: like every setting it cannot change after.

## Not built (brief §07, plan E)

No third-party challenge, fingerprinting, datacenter blocking, per-county cap, suspicion scoring,
automatic difficulty, single-use reporter codes, or anything tying a submission to a person.

## Calls I made, for the managing session

- **No receipt** on a sealed-on-arrival report (E1's "No receipts").
- **An address sent to a no-email form is refused**, not silently dropped (the page that sent it
  is not this form).
- **`evidence_declaration` and `url` ask for an email** (reasons above).
- **The request id** Fastify writes in log lines (`req-1`, a per-process counter) is unchanged:
  the managing session's item 4 scoped the rule to IP addresses. Plan E's test line also says "or
  request id … in logs". It is never in a report, tip or error report (tested); dropping it from
  logs is an operations change (H) and a small one if wanted.
- **A refusal at the door spends the puzzle** even when the answers would also have been refused;
  the page re-solves at once.
- **The dev default when `DOOR_KEY` is unset** is a key made in memory, not a refusal to file
  (unlike CONTACT_KEY), because nothing durable depends on it.
- **The coordinator intake and the evidence page** are signed in or token-guarded and do not pass
  the door; the brief names the report and tip forms.

## Known gaps

- Rate limits are tested against the app, not a real Caddy (§08's last line): E2 put them in the
  app.
- Polling hours per state remain a gap (E4).
- (Done since, at the managing session's request.) The minimum time on a form has its screen:
  Settings → Report and tip forms (`settings/forms.tsx`), which also says where the rest of the
  door is set. No step-up: it is not one of plan E's listed actions. And `reportlog doctor` warns
  (never fails) when `DOOR_KEY` or `TWO_FACTOR_KEY` is unset, naming the fix: "run
  /root/reportlog/deploy/install.sh again; it adds missing keys and asks nothing else". The
  installer test checks that a re-run on an older settings file (each key blank, or absent) adds
  both and leaves every other line as it was. Browser test: `e2e/door-settings/` (its own
  project, after the flood's, since the minimum is the whole site's).
- `processHasher.onRotate` keeps one callback per app built; in a test run that is one per test
  app, in production one.

## Tests

Added:

- **Unit, `packages/fields/test/door-rules.test.ts`**: E1 by kind (typed, files, evidence, places,
  the rest, an unknown kind, the switch only adding); E4 for dates, times and moments across
  offsets, no limits as before, the strict reading.
- **Unit, `apps/api/test/unit/door.test.ts`**: limits per minute and hour on a clock, the requests
  limit and its "first", the midnight key change dropping counters; the start token (signed,
  minimum, other key, altered, future, missing); E4 in the builder (written forms, absent keys,
  refusals).
- **Db, `apps/api/test/db/door.test.ts`**: honeypot; minimum time (too soon, missing, forged, the
  setting); puzzle missing, wrong, another key's, garbage, expired, reused, tampered parameters, a
  hosted-service payload, and a real challenge from the route solved as the widget does; the harder
  level; one sentence for every refusal, worded by the operator; rate limits per minute, refused
  attempts counting, the requests limit and health exempt, behind a proxy and without one; E1:
  sealed on arrival with a verifying seal, no submission, no contact row, no email, pending
  moderation; `asks_email` on the public form; an address refused; a text form still mailing; the
  operator's switch through the route; a decline recording no notice; E4 refusals and the edge; the
  limits on the public form; on a door with the password on: both reads, a report, a tip and a
  refused tip; the door settings behind the password; a logbook file round trip; a bad limit; the
  ElectionLog starting point.
- **Db, `apps/api/test/db/door-privacy.test.ts`**: no address or its hash in any table, log line
  or error report, after every kind of submission and refusal; refusals counted with nothing else.
- **Browser, `apps/web/e2e/door.spec.ts`** (chromium and phone): the puzzle solved in the page by a
  same-origin worker, a refusal in one plain sentence, sending again working, filed on arrival;
  date limits as the picker's min and max and named on the card; axe on each; no other host.
- **Browser, `apps/web/e2e/electionlog.spec.ts`**: now filed end to end with the puzzle solving in
  the page (the body carries a start token and a solution, and no address), "Thank you" instead of
  "Check your email"; the tip sends a fresh solution with each send.

Changed to the new behaviour: every test that sends a report or tip through the routes now sends
the door's fields (`test/door-pass.ts`, `e2e/door.ts`); the ElectionLog and L7/L3 tests send no
address (their forms ask none); the list-route test of the old filters now expects the plain
refusal; the copy-slot test knows the one server-read slot; the invariants and sweep tests know the
new prefix and table.

| Suite                                   | Result                                                                                                                                                                           |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check`                            | passes: fields 123, seal 46 (legacy vectors green, no fixture touched), access 9, api 464 passed / 21 skipped, web 600; boundaries 0 errors (the 1 warning predates this branch) |
| `pnpm test:db`                          | 89 files, 1352 passed                                                                                                                                                            |
| Browser suite (`CI=1`, `CHROMIUM_PATH`) | 1035 passed, 5 skipped, 0 failed (15.3 min)                                                                                                                                      |

`pnpm check` and `pnpm test:db` ran on `2a0165c`, before the last two commits, which change only two
browser tests (`doors.spec.ts`, `flood.spec.ts`); those were formatted and linted, and the browser
suite ran on the final commit. Earlier full runs failed, all mine and all fixed: PE3's pause test
and flood test and the door page's list of calls sent nothing for the door; my door test left a
logbook open outside for the next file; the deploy runbook, the installer's key list and the slot
count did not yet know the door.

## Outside my folders (kept minimal)

`identity/gate.ts` (two IN_FRONT lines) and `identity/limiter.ts` (hash the key) — PE1's;
`moderation/rejection.ts` (no address, no notice) — PE3's; `filing/*`, `lists/routes.ts`,
`lists/values.ts`, `lists/refusals.ts`, `logbooks/*` and `templates/electionlog.json`, `site/copy.ts`
(one slot), `jobs/sweep.ts` (one table), `app.ts` (the door, registered first), `config.ts`,
`packages/fields` (email rule, limits), contracts (`door.ts`, and `filing`, `lists`, `logbooks`,
`site`), the web filing and list forms, builder, deploy (`install.sh`, README), `.env.example`, the
session hook, the generated types, and the tests that asserted the old behaviour.
