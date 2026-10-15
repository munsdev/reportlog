# ReportLog — notes for an assistant

Read `CONTRIBUTING.md` first. This is the short version.

**Every report is filed through a logbook, and every logbook is its own
chain.** There is no built-in questionnaire and no second form: a report is a
logbook's answers plus what every report has (`src/reportCore.js` says
exactly what). Read `docs/logbooks.md` before touching reports, logbooks,
templates, the anchor or the chain. New reports' contact details sit under a
per-report key in `contact_keys` so a reporter can erase them —
`src/contactKeys.js`; never work around it by writing to
`reports_restricted`.

## Two formats, and a form is neither of them

**A form is the question set. Logbook or list is what happens to the
answers.** A logbook has a form; a list has a form. Same field types, same
card engine. The container is the whole decision, and it is one question:
does this need to be permanent and verifiable?

A **logbook** seals, chains, is append-only and permanent, asks the spine of
every report, and publishes nothing until a moderator approves it one by
one. A **list** seals nothing, keeps an editable form, erases the personal
half of its entries on a timer, is approved in bulk, and publishes counts
rather than content. Three templates ship: the Tip List, check-ins and a
contact form, differing only by their questions.

**Read `docs/lists.md` before touching anything under `src/lists/`,** the
seven list tables, migration 046, `templates/lists/`, `src/routes/lists.js`,
or the three list screens (`admin-lists.js`, `list-review.js`,
`list-form.js`). The erasure link lands on `/api/forget/:token`, in front of
the site password, and its GET must never erase — mail scanners open links.

**Nothing under `src/lists/` may import `reportCore.js`, and nothing in it
writes to a chain.** `npm test` walks the import graph transitively to keep
that true — a per-file grep passes while the reach exists one hop away. It
is also why `src/lists/values.js` duplicates part of `src/answers.js`
instead of sharing it: `answers.js` imports the sealing code, and the
duplication is the price of the guarantee. **An entry is not a report** — it
has no spine, so if a list entry is ever called a report, that invariant
reads as broken and somebody will try to fix it.

**On a list, retention belongs to a FIELD and not to a row.** An entry's
answers sit in two columns: `answers` is durable, `erasable_answers` is what
the sweep blanks. The links stay; the text and the contact details go. It is
two columns rather than one with a convention precisely so that a count
cannot reach anything erasable. There is no `expires_at` on any list row —
`src/sweep.js` deletes whole rows keyed on that name, so a list table
carrying one would be one edit away from deleting the links.

## The rule that breaks everything if you get it wrong

**A key is written into the hashed object ONLY when it applies.**

An absent key and a `null` one serialize differently under RFC 8785, so
making an optional field unconditional changes the fingerprint of every
report ever filed. `answers`, every key inside it, `attachments` and the
third-party provenance block are all conditional for this reason. It looks
like untidy code. **Do not tidy it.**

`scripts/selftest.js` asserts this. If that goes red, stop and say so.

## The other invariants

- **`reports` is append-only.** Never UPDATE, never DELETE. A database
  trigger refuses both. A correction is a new row.
- **`src/verify.js` and `src/reportCore.js` must produce byte-identical
  objects.** Write side and read side of the same promise.
- **Migrations are additive.** Nothing changes how an existing report
  hashes. The one exception, `029_logbooks_only.sql`, refuses to run on an
  archive that holds a single report; nothing after it may do anything of
  the kind.
- **One chain per logbook.** A report links to the newest row in ITS
  logbook, and a logbook's first report links to `chainGenesis(slug)`. A
  report never moves between logbooks, and the slug is never editable.
- **A report seals the questions it was answered against.** `logbook_form`
  is a hash of the form's definition, sealed only when there is one, and it is
  the version the reporter was actually asked, not the one at confirmation.
  Anything that rebuilds a report's hashed object must join `logbook_forms`
  (`FORM_JOIN` in `src/verify.js`); `immutableFieldsFor` throws on a row that
  has a `form_id` and no hash rather than rebuild a different object.
- **Once listed, always listed.** The daily anchor timestamps the list of
  every launched logbook's head (`src/chainHeads.js`). A logbook on a
  published list stays on every later one and its count only grows; the
  anchor script refuses to publish a list that breaks that. Do not weaken
  it — it is the only thing that notices a whole logbook disappearing.
- **Nothing is public until a moderator approves it.** There is no
  auto-publish path and there must not be one.
- **Permanence decides where a value lives.** Hash what must never change;
  put what may change where changing it is recorded. The publication answer a
  reporter gives at filing is `may_publish` and is sealed into the report. The
  two permissions they can take back afterwards are an append-only log with
  the current value as a projection — `src/reportPermissions.js`, never
  imported by `reportCore.js`, `verify.js`, `chainFile.js` or `snapshot.js`,
  and `npm test` fails if it ever is. A revocable value in the fingerprint
  would make a report verify differently because somebody changed their mind.
- **Consent is the ceiling, moderation is the floor.** A moderator may
  publish the report's text and not its photographs. Never the reverse. The
  files are a second layer the reporter permits separately, read at the moment
  of publishing rather than trusted from earlier, and taking it back takes
  published files down — `src/renditions.js`, shared with the moderator's own
  withhold path so the two cannot drift.
- **Only the reporter changes a reporter's permission.** There is no
  moderator route that writes that log, the table's own CHECK says
  `actor = 'reporter'`, and the suite asserts both. A moderator granting one
  on somebody's behalf would record the operator's decision under the
  reporter's name.
- **The transparency log is never rewritten**, not even to correct it. If
  something invalidates published proofs, publish that fact beside them.
- **There are two sweeps and they do different things.** `src/sweep.js`
  DELETEs whole rows from four named tables of expired credentials.
  `src/lists/sweep.js` ERASES COLUMNS and leaves the row standing. Neither
  list is discovered by scanning for a column, so a new table is never swept
  by accident — and a list table must never be added to the first one.
- **The role ceiling**, which is now two rungs. An Access Manager can mint
  Moderators and cannot mint Access Managers. **Only the owner can appoint or
  remove an administrator, and the owner's own seat is ungrantable** — it
  appears in no row of `MAY_GRANT`, so `setSystemRole` cannot produce one;
  it moves only by the two-party handover in `src/ownership.js` or the setup
  wizard. There is exactly one owner, enforced by a partial unique index
  rather than by a check. Asserted in `src/roles.js`, tested, checked again
  at the route. Any new granting path goes through it.
- **Rank lives in `src/roleRank.js`, once.** Owner satisfies admin; nothing
  else outranks anything. `requireRole` consults it, so a route asking for
  `admin` admits the owner without seventeen guards having to agree. It is
  deliberately not a general hierarchy — admin does not imply moderator.
- **The gate is frontend as well as backend.** Every pane is in the DOM from
  the first byte, so the lock screen is all that stands between a visitor and
  the site's writing. While gated, `popstate` must never route.
- **What gets past the password is named in two places and nowhere else.**
  A list decides for itself (`pastCurtain`, `src/routes/lists.js`); a logbook
  opened outside is FILING ONLY, through the allow-list `outsidePass` in
  `src/doors.js`, which only marks a request for the unchanged gate to read.
  Never widen it to the board, the list of logbooks or a staff route —
  `scripts/doors-selftest.mjs` turns the password on and checks both sides.
- **One card asks one question**, and nothing on the card in front of
  somebody changes underneath them. No auto-advance on selection.
- **The spine is asked of every report.** An address to reach the reporter,
  their consent, and whether it may be published — however it was filed,
  coordinator entry included. Everything else is the logbook's. A written
  account is not in the spine: it is a question a logbook asks.
- **Launching a logbook is a one-way door.** Afterwards it may gain a new
  OPTIONAL question and nothing else — no rewording, removing, reordering
  or promoting to required. `assertDraft` in `src/logbooks.js` is the guard
  and it lives in the module rather than in a route, so every path goes
  through it. Adding an optional question is safe only because of the
  absent-key rule above; if that rule ever changes, this opening closes.
- **Nothing is filterable unless an operator said so.** There is no built-in
  date or location filter on the board and there must not be one. Where and
  when are field types, not fixed parts of a report.
- **Heat maps draw no tiles, and a threshold is the server's.** There are as
  many maps as an operator makes (`heat_maps`, migration 049), each off until
  they turn it on, each with its own threshold, feeds and slot. No map ever
  fetches a tile layer: a tile request tells a third party which states the
  readers of an incident archive are looking at, and every deployment would
  make it on behalf of an operator who never chose it — `npm test` fails if
  `public/js/map.js` names `L.tileLayer`. An area under the threshold is sent
  **without its count**, because a payload carrying "Wyoming: 1" has
  published the number whatever the page draws; the floor of 2 is a database
  CHECK. Place codes are hierarchical strings, so rolling one up is a prefix
  and never a join. **The `location` field type that seals them is built**,
  and its gazetteer is derived from the map's own outlines so a form can
  never offer a place no map can draw. **Nothing inside a map may be found
  by id** — several can be on one page. Read `docs/map.md` before touching
  any of it, or `tools/build-geo.mjs`, `tools/build-gazetteer.mjs`,
  `src/mapData.js`, `src/heatMaps.js` or `src/mapSlots.js`.
- **The front page's buttons are an order, and the first one is the accent.**
  Every open logbook is a button there, the way a list is — a generic
  "Submit a Report" leading to a page that asked which logbook was the
  front door for one format and not the other. The order is the only thing
  stored (`site_settings.home_buttons`, migration 050): no labels, because a
  logbook button wears the logbook's own title, and no colours, because one
  screen has one main action and a second way to say which is a second thing
  to disagree. A logbook made after the page was arranged is **appended**, or
  arranging it once would quietly opt the operator out of every logbook they
  make afterwards. `src/homeButtons.js`.

## Running things

`src/db.js` reads `DATABASE_URL` at import time. Anything you run with
`node -e` must `await import("dotenv/config")` before importing anything that
pulls in `db.js`, or you get a SASL error that reads like a permissions
problem and is not.

**THREE suites before anything ships**, and none of them covers another.
This said "both suites" for as long as there have been three, which is how
a third one nobody ran stayed that way.

**A path that only runs when somebody clicks a link in an email is the path
nothing reaches by accident.** Report confirmation was broken in production
for three days under three green suites, because none of them walked a
confirmation link. `scripts/confirm-selftest.mjs` exists for that; if you
add another such path, aim something at it deliberately.

```
npm test
npm run test:db
cd tools/browser-tests && \
  CHROMIUM_PATH=$(ls -d /opt/pw-browsers/chromium-*/chrome-linux/chrome | head -1) \
  node run.js --base=http://localhost:3000
```

`CHROMIUM_PATH` is in the documented command because without it the browser
suite does not fail, it **dies** — Playwright looks for one exact build and
claims none is installed when a different one is right there, behind a
banner that names nothing relevant.

`npm run test:db` creates a throwaway database beside the one in
`DATABASE_URL`, migrates it, runs every database-backed selftest against it
and drops it at the end. The database you point it at is never written to.

**Its total is the SUM of its scripts, not the last line it prints.** The
runner ends on the last script's count, that number was mistaken for the
total, and three documents carried a figure six times too small for a day.

**SUM BOTH FIELDS.** The obvious version of this greps `'^[0-9]* passed'`,
which also matches the first half of `24 passed, 1 failed` — so it reports a
clean-looking total over a real failure. That happened on 30 September and the
failure was found by reading the scroll, not by the command:

```
npm run test:db 2>&1 | grep -o '^[0-9]* passed, [0-9]* failed' \
  | awk -F'[ ,]' '{p+=$1; f+=$4} END {print p" passed, "f" failed"}'
```

**AND COUNT THE SCRIPTS, because a script that DIES prints no count at all** —
not even `0 failed` — so the sum above simply comes out smaller and still says
zero failed. That is how a `TypeError` in one script read as green on
30 September. These two numbers must match:

```
npm run test:db 2>&1 | grep -c '^───── '
npm run test:db 2>&1 | grep -cE '^[0-9]+ passed, [0-9]+ failed'
```

A total that dropped since last time is the tell, so **write the total down**
when it changes. If it fell and nothing says failed, one script crashed: find
it by pairing each `─────` header with the count under it.

## Style

Plain language in anything a person reads — the site, emails, the changelog.
Not jargon, and not commit-message English.

Report what actually happened. If a test failed, show it. If something was
assumed rather than verified, say which.
