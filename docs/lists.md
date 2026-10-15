# Lists

The second format. Read this before touching anything under `src/lists/`,
the `lists`, `list_fields`, `list_entries`, `list_entry_links`,
`link_index`, `list_salts` or `list_erasures` tables, migration 046, or
anything in `templates/lists/`.

## A form is the question set. Logbook or list is what happens to the answers

A logbook has a form. A list has a form. Same field types, same card
engine, same builder. **The container is the whole decision**, and it is one
question: does this need to be permanent and verifiable?

| | Logbook | List |
|---|---|---|
| Sealed and chained | yes | no |
| Append-only | yes, by trigger | no, by design |
| The spine asked of every one | yes | no |
| Form editable after launch | no — one-way door | yes |
| Review | one by one | in bulk |
| What is published | approved content | counts, never content |
| Personal data | permanent | erased on a timer |

Three templates ship: the **Tip List**, **check-ins** and a **contact
form**. They differ *only* by their questions.

**Nothing records which template made a list, and nothing may.**
`src/templates.js` states the rule this follows — nothing reads "which
template is this" to decide anything, because that convenience ends as a
permanent fork in every query. So link handling happens because a list *has
a url field*, not because it is "a tip list". `npm test` asserts there is no
such column and that the engine names no template slug.

## The rule the whole design exists to hold

**Nothing under `src/lists/` imports `reportCore.js`, and nothing in it
writes to a chain.** If a file in the intake path can reach the sealing
code, it is the wrong file.

`scripts/selftest.js` asserts it by walking the import graph **transitively**.
A per-file grep for `reportCore` is the obvious version of the test and it is
the wrong one: it passes while the reach exists one hop away, and reach is
what the rule is about. Confirmed red first against a two-hop path through
`src/answers.js` — which imports `reportCore.js`, and which a session
wanting answer normalization would plausibly reach for.

**Which is why `src/lists/values.js` exists.** It normalizes one answer
against the field that asked for it, duplicating part of what `answers.js`
does for reports. The duplication is deliberate and is the price of the
guarantee: sharing the normalizer would mean the intake path could reach the
chain. The two are allowed to diverge — `answers.js` produces bytes that
will be hashed and must therefore never change, and nothing here is hashed
at all.

A second check bans the names `chainHash`, `chainGenesis`, `GENESIS_HASH`,
`report_heads`, `immutableFields` and `logbook_form` from these files,
because `src/crypto.js` is legitimately reachable (it is where `sha256Hex`
lives) and also exports the chain primitives.

**An entry is not a report.** The spine — an address to reach the reporter,
their consent, and whether it may be published — is asked of every *report*.
A list asks none of it. If a list entry is ever called a report, that
invariant reads as broken and somebody will try to fix it.

## The two halves of an entry

**This is the structural heart of the format.** An entry's answers are split
into two columns by lifetime:

- **`answers`** — durable. Links, states, verdicts, categories. Never erased.
- **`erasable_answers`** — transient. Free text, and anything else about a
  person. Blanked by the sweep, and never aggregated.

Plus `email`, `email_consent` and `ip_hash` as the entry's own columns.

**The split is not a convention an aggregate has to remember — it is two
columns.** A query that counts `answers` *cannot* reach anything erasable,
in the same way nothing computing a fingerprint can reach a revocable
permission. The guarantee is in the shape, not in the care of whoever writes
the next query. `npm test` asserts the string `erasable_answers` does not
appear in `aggregates.js` at all.

**The row survives the sweep and the pieces do not.** A tip survives as its
links, its state and its category, with the description, the email and the
hashed address blanked. `erased_at` records it, and the table's CHECK
refuses a row marked erased that still holds any of the erasable half.

**There is no `expires_at` on any list row**, deliberately. `src/sweep.js`
DELETEs whole rows from a hand-written list of tables keyed on exactly that
column name, so a `list_entries` carrying one would be one list edit away
from deleting the links. The column is `personal_expires_at`, and `npm test`
asserts both halves of that.

Three retention classes, in `src/lists/retention.js`: `absent` (never
collected), `transient` (erased after `LIST_PERSONAL_DAYS`) and `durable`
(never erased). `NULL` in `personal_expires_at` means durable — there is no
second spelling of it.

**`list_fields.retention` is NOT NULL with no default.** There is no safe
blanket value: defaulting to `transient` would put a state or a verdict in
the erasable half, so its published count would shrink on its own months
later with nobody connecting it to the sweep; defaulting to `durable` would
keep somebody's words forever because a writer forgot. Every writer states
it, and one that forgets fails loudly. `defaultRetention(kind)` gives the
sensible answer for a kind.

**This collapses three rules into one.** The handed-in spec needed *tips
expire whole*, *the link index is durable* and *check-in counts are
permanent* as three separate decisions. Under field classes all three fall
out of the same mechanism, and check-ins need no special case at all: their
durable columns *are* the count, so what survives the sweep is the count.

## The countable flag, and the gate

Two per-field properties that look like one, and keeping them apart is the
point of `src/lists/fields.js`:

1. **Is this field personal?** Derived from the kind, never an operator's
   choice. **Unknown kinds count as personal** — a field type added next
   year is one nobody remembered to classify, and the failure mode is an
   unnecessary email rather than an unerasable record.
2. **May its values be counted?** An operator's deliberate tick, off by
   default.

They come apart in both directions: an internal triage category is
impersonal and still nobody's business, while a state chosen from a list is
identifying at row level and fine as a count.

**Only a closed vocabulary can be counted.** You cannot aggregate free text,
and a cell of one *is* the sentence somebody typed. The allowed kinds are
stated in both `AGGREGATABLE_KINDS` and migration 046's
`list_fields_aggregatable_check`, and `npm test` asserts the two agree — the
same pair-and-guard as the upload limits. The module is deliberately
stricter: it also requires a real closed option set, so a `place` with
`allow_other` is refused, since counting it would publish whatever people
typed into the escape hatch.

Two more refusals worth knowing: a field that is not collected cannot be
counted, and **a counted field the sweep erases is refused** — its count
would shrink on its own.

### The gate

**A form that may collect free text must require an address, and must
therefore be able to erase on request.** A form that collects a link and two
dropdowns must not ask for one — there is nobody in the row to erase, and
the address would be the only personal thing on the form, collected in order
to protect itself.

It is **derived from the fields**, never ticked beside them, and that is why
it holds: a box an operator ticks is a box an operator can forget, and the
failure is silent.

**Requiring an address of the FORM is not requiring one of every
submission**, and collapsing that distinction either way is a real fault.
The Tip List *offers* a description and does not require one: somebody
sending a link and two dropdowns has handed over nothing personal. So the
form-level flag means "render an address field and explain the erasure
route", and `fileEntry` gates on **what actually arrived** —
`prepared.erasable && !address`. A form with a *required* free-text question
is covered by the same line, because a missing required answer is refused
before it gets there.

Enforced in the module rather than at a route, so every path goes through it
— the same discipline as `assertDraft` in `src/logbooks.js`, and what makes
editing the form in devtools pointless.

`file` and `evidence_declaration` are refused outright: no uploads, and
there is no report here to declare evidence for.

## Counting

`src/lists/aggregates.js` is what a tool asks. `summaryFor(slug)` returns
the definition, the totals and a breakdown per countable field.

**Received and approved are both reported, always and separately.** Counting
only approved understates what was collected; counting everything publishes
a figure about content no moderator cleared. Reporting both is honest about
volume *and* makes the review backlog visible, which is itself
accountability. It also shows a flood as received far exceeding approved —
visible rather than paused, which is what the cut spike freeze was reaching
for.

**Asking for a field nobody ticked is an error, not a silent disclosure.** A
contact form ticks nothing, so a tool that asks it finds nothing there —
which is the answer rather than a failure.

**A snapshot seals the definition it was computed under**, for the same
reason a report seals `logbook_form`. A list's form stays editable, so two
counts taken a week apart may have been computed over different questions.
Without the definition beside the number, a reader seeing the series jump
would conclude something happened in the world when something happened in
the configuration.

`snapshotDocument()` is the publication boundary and reads
`aggregates_published` **and** `visibility = 'listed'` — the same two
conditions as the public counts route — so a hidden list ticked by mistake
never reaches a log that is never rewritten.

**It is published every day beside the anchor**, as
`counts/<date>.json` in the transparency log, in the same commit as the
anchor and the snapshot. **Not folded into the anchor**: the anchor's signed
digest is defined over `{anchor_format, date, chains}`, and every anchor
already published is checked against exactly that. So the counts file has
its own digest — sha256 of `{counts_format, date, lists}` under RFC 8785 —
and its own token from the same timestamp authority. `src/countsFile.js`
builds it; `countsDigestMatches` is anybody's check. A failure to timestamp
the counts never stops the reports being anchored.

> **Ratios.** The numerator of "how many went wrong" can sit on a sealed
> chain while the denominator sits in a list the operator can edit. The daily
> timestamped counts file is what makes the list half checkable after the
> fact, one day coarse. Show the two numbers side by side by default; a
> percentage is available (see the site text figures) and is honest so long
> as both halves are shown somewhere near it. Minimum cell size: none, by
> decision.

## Review, in bulk

**Nothing is counted publicly until a moderator approves it.** The
difference from a logbook is the *unit* of review, not whether there is one.

`reviewBatch` is what a pane reads, and it shows the two things that make
skimming safe rather than a rubber stamp:

- **the host of every link, with unfamiliar ones marked.** A reviewer is not
  going to read fifty URLs; the unfamiliar host is what their eye should go
  to. It sorts, never blocks.
- **clusters.** Fifty check-ins from one state in a minute is usually a
  local radio mention — the system working. Fifty from one hashed address is
  one person pressing a button fifty times. The two are identical in a list
  of timestamps, and the hashed address is the only thing that separates
  them. The *burst* is visible from timestamps alone, which are durable, so
  the shape of a flood survives the sweep.

`review_state` (received / approved / rejected) and `triage_state` (new /
triaged / actioned / closed) are **different columns on purpose**. Review
asks "may this be counted"; triage asks "has an editor dealt with it". One
column answering both is the two-notions-of-approved mistake, and the
failure is a published count that disagrees with the queue.

An entry cannot be un-reviewed, and **rejecting is not deleting** — the row
stays, the retention clock still governs its erasable half, and a subject
access request can still be answered about it.

## Addresses: an HMAC under a secret that is then destroyed

The raw address is never written. What is stored is
`HMAC-SHA256(day's secret, address)`.

**Not a plain salted hash.** The IPv4 space is 2^32, so anybody holding the
table and the salt can enumerate it on a laptop and recover every address.
The secret is a per-day *pepper*, random, 32 bytes, and **the sweep destroys
it** — once that row is gone, every hash taken under it is permanently
uncorrelatable. That is what makes "we do not hold addresses" true
afterwards and not merely at the time.

**What must never happen to `src/lists/salt.js`:** deriving the day's secret
from a long-lived key and the date. It looks like rotation and is not — any
past day's hashes stay recomputable from the key forever, so nothing is ever
destroyed and the whole property above is lost. If that file grows an
`hmac(masterKey, date)`, that is the bug.

## Links

Accept broadly, sort afterwards. **No domain allowlist at the door**: an
allowlist blocks junk domains but not junk tips, and rejects the material
most worth having. Rejected is only what cannot be a link to public material
at all — non-http(s), a bare address as host, credentials in front of the
host, and known shorteners.

**`youtu.be` is not a shortener and must never become one.** It looks exactly
like one and is YouTube's own canonical short form, so a naive list rejects
the clip of a local news segment — the material most worth having. `npm test`
asserts its absence from the list.

A bare address is refused in all four spellings it has: the dotted quad, the
bracketed IPv6 form, and the integer and hexadecimal forms —
`http://2130706433/` and `http://0x7f000001/` both reach 127.0.0.1 and
neither contains a dot.

Normalization lowercases the host, strips a trailing dot, punycodes an
internationalized name, strips tracking parameters, **sorts the parameters
that remain** so two apps produce one key, and drops the fragment unless it
carries a post identifier. `url_key` is the sha256 of that normalized form,
so **changing the normalization is a decision about every row already
written**, not a tidy-up.

Two parameters are deliberately *not* stripped: `v`, YouTube's video
identifier and therefore the content itself, and `t`, a timestamp on some
hosts which would silently change which moment of a clip somebody meant.

**The server never requests a submitted URL.** Not for a preview, not for a
thumbnail, not to check that it resolves. Nothing in `urls.js` performs I/O
and `npm test` asserts it: fetching would turn the form into a way to make
this server visit arbitrary addresses, and would signal to whoever posted
the material that somebody looked.

**One person pasting the same link twice is one link.** Duplicates within a
submission collapse, because the whole value of `submission_count` is that
it counts people.

## Lists are not in the archive export

`npm run export-archive` is the claim that **the record** survives this
operator. An entry is a lead or a tally, is editable, and has its personal
half erased on a timer — so exporting it would write rows into a permanent
artifact that the sweep is about to empty, and an import would resurrect
what somebody asked to have erased.

`scripts/export-archive.js` discovers *columns* dynamically but names
*tables* explicitly, so this holds by construction. `npm test` asserts that
none of the seven list tables has appeared there.

## The risk that runs the other way

A general form builder invites an operator to build the wrong thing — to
collect firsthand accounts in a list, unsealed and sweepable, because the
list builder was right there and did not ask for consent tiers or a
moderator. That is the mirror image of the failure the separation exists to
prevent, arriving by convenience rather than by a switch.

The gate is what stops such a list being anonymous and unerasable. The other
half is presentational: the container is the *first* question the Lists tab
asks, in plain language about what each one guarantees, and a yes sends the
administrator to Logbooks. Nobody should reach a list by default.

## Running the tests

Three suites, and none of them covers another. The rules live in pure
modules (`urls.js`, `retention.js`, `fields.js`, `policy.js`, `values.js`) so
`npm test` can reach them — `src/db.js` reads `DATABASE_URL` at import time,
so a rule in a module that imports the pool is a rule only the database
suite can see.

```
npm test                    # the rules, the separation, the migration, the templates
npm run test:db             # scripts/lists-selftest.mjs
```

`scripts/lists-selftest.mjs` covers what only exists once rows round-trip
through Postgres: that the sweep erases columns and leaves the row, its
links and its durable answers; that **a count is unchanged by the sweep**,
because it never read the erasable half; the CHECKs that refuse a half-erased
row and an uncountable field; deduplication and the submission count; bulk
review moving what is counted and nothing else; destroying a day's secret;
and **the erasure link** — a path nothing reaches by accident, aimed at
deliberately because report confirmation was once broken in production for
three days under three green suites for exactly that reason.

## The screens

**Admin → Lists** makes and changes lists. Making one asks first whether what
people send has to be permanent and checkable, and a yes points at the
Logbooks tab — the container is the first question, in plain words, so
nobody reaches a list by default. Then a starting point (the three shipped
templates), a title and an address. **A new list starts hidden.**

Opening a list gives its switches — visibility, title, description, whether
counts are published, stop/start taking entries — its questions, and its
counts so far. The questions are saved as a whole set through
`replaceFields` in `src/lists/manage.js`, which runs `assertCollectable`
over the set the administrator is about to have; every refusal comes back in
words. **A question's key is fixed once saved** (its answers are filed under
it), and the server keeps an existing key whatever the page sends. A list
that has taken entries **cannot be deleted** — that would cascade to the
links and break every erasure link already emailed — so it is closed
instead.

**Moderators page → List entries** is the bulk review: one list at a time,
the site of every link with unfamiliar ones marked (`LIST_KNOWN_HOSTS`), the
clusters, and approve or reject **the ids ticked on screen**, never
"everything waiting".

**`/list/:slug`** is the form: a card saying nothing sent is published, one
card per question, and — only on a form where people can write — an address
card that says whether it is needed for what this person actually wrote.

**`/api/forget/:token`** is where the emailed erasure link lands. Served by
the server as plain HTML rather than by the app, **in front of the site
password** (a right is not behind a password), and **under `/api/`** because
every installed box's nginx copy proxies `/api/` and nothing added since. A
GET shows a button and **erases nothing** — mail scanners open every link in
an email; only the POST erases.

## Visibility, enforced

`hidden` is seen by administrators only, as a preview. `password` ("team
only") by anybody signed in. `listed` by anybody past the site gate, and
offered on the front page while it is taking entries. **A list somebody may
not see answers 404, never 403**, because 403 confirms it exists. All of it is
behind the site gate, like logbooks.

## Without the site password

`outside_access` on lists and logbooks (migration 047): `closed` (the
default — behind the password like everything else), `link` (anybody with
the address) or `door` (also linked from the password page, via
`GET /api/doors`). It only matters while the site has a password.

**A list may only be open outside if it is listed inside** — the table's
CHECK says so, and making a list hidden or team-only closes the outside door
with it. The list routes are mounted in front of the gate and each one
decides (`pastCurtain` in `src/routes/lists.js`); a list that is not open
answers exactly what the gate would — 401 locked — so a stranger guessing an
address learns nothing.

**A logbook opened outside is open for filing only**: its form at
`/file/<slug>`, the report POST, uploads while such a logbook takes files,
and the confirmation link. `outsidePass` in `src/doors.js` is the whole
allow-list, run in front of the unchanged gate; the board, the list of
logbooks and everything else stay shut. `scripts/doors-selftest.mjs` turns
the password on and walks both sides of every line of it.

## When, and why, an address is asked

`lists.email_mode` (migration 048): `auto` asks only somebody who writes
something — the gate, derived from the questions — and `required` asks
everybody, for a form people use to reach the site. The volunteer and
contact forms are `required`; a template says so with `"ask_email": "always"`.
`required` only ADDS a requirement; nothing turns the gate off.

The form says the TRUE reason (`emailWhen` and `emailReason` from
`GET /api/lists/:slug`): "so whoever runs this site can reply" on a form that
always asks to reply; "so you can have it deleted" where everybody must type
something; and "because you wrote something" only where that is the reason.
On a reply form there is no "you may write back" box — sending it is asking.

## Emailing each new entry

`lists.notify` sends each new entry — every answer, labelled, and the
person's address if they gave one — to `notify_email`, or to `ADMIN_EMAIL`
when that is empty. **Any other address confirms first**: it is held in
`notify_pending_email`, emailed a link (`/api/list-mail/:token`, hashed like
an erasure token, a GET changes nothing), and receives nothing until it is
clicked; meanwhile mail keeps going where it went before. Naming a different
address makes the earlier link worthless. `src/lists/notify.js`.

The email says plainly that its copy is beyond the deletion timer's reach.

## Volunteering is a list

Migration 047 creates `/list/volunteer` on every box from that box's own
volunteer roles: name and note (erased on the timer), the roles ticked
(kept, countable if an administrator ticks it), listed, open without the
password and linked from the password page, each entry emailed to the admin
address. The old form, its catalogue, its confirm-your-address step, its
admin tab and its API are gone. `/volunteer`, `/involve` and the
confirmation links old emails carry all land on the list's form. The old
tables stay, unread.

## Published counts

`GET /api/lists/:slug/counts` answers only for a list that is **listed AND**
has counts published, and only over the fields ticked countable. Received and
approved, always both. It reads `summaryFor`, which never names the erasable
half. The same counts go out daily beside the anchor — see "Counting"
above.

## The routes

`src/routes/lists.js`, four routers for four audiences: `/api/lists` (the
form and counts), `/api/admin/lists` (administrators), `/api/list-review`
(moderators and administrators), `/api/forget` (the erasure page). The
import walker in `npm test` starts from that file as well as from
`src/lists/`, so the HTTP layer is held to the same separation rule.
`scripts/lists-routes-selftest.mjs` drives all of it against a real app,
the erasure link included.

## What is not built

Per-item visibility of an entry's content is not a thing and must not
become one: no route returns what somebody wrote to anybody but a moderator.

The volunteer form moved onto a list on 10 October — see "Volunteering is a list".
