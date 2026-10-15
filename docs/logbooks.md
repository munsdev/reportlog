# Logbooks, and one chain per logbook

Every report is filed through a **logbook**: a title and a set of questions
an administrator built. There is no other form. The software asks nothing of
its own beyond the few things every report has, and each logbook is its own
hash chain.

## What a report is

The hashed object, in full:

| Key | When it is there |
|---|---|
| `public_ref`, `received_at`, `thread_id`, `corrects_id` | always |
| `logbook` — the logbook's slug | always |
| `logbook_form` — SHA-256 of the questions it was answered against | when the report has a form version (every report filed since migration 031) |
| `may_publish`, `may_publish_digest` | always — every report is asked |
| `answers` | when anything was answered |
| `third_party`, `filed_via`, `intake_method`, `attested_at`, `collected_on` | when a coordinator filed it |
| `attachments` | when files were sealed |

Nothing else. Where, when, what kind, who saw it, an account in the
reporter's own words — each is a question a logbook asks or does not. Inside
`answers`, a question nobody answered has no key: the absent-key rule, one
level down. That is what lets a launched logbook gain a new optional question
without changing a single report already filed.

**The spine** — what is asked of every report whichever logbook asked the
rest — is an address to reach the reporter, their consent, and whether it may
be published. The address is never part of the report (it is encrypted
beside it, under a key of its own that the reporter can have destroyed; see
`src/contactKeys.js`). There is no built-in written account: a logbook that
wants one adds a long-text question.

## The questions, sealed

The seal over an answer is worth exactly as much as the fixity of the
question, so each report also seals **which questions it was answered
against**: `logbook_form`, the SHA-256 of that logbook's form definition
(`src/formText.js`), exactly as stored in `logbook_forms` (migration 031).

- **Forms have versions.** Launch freezes the questions, but a new optional
  question may still be added, so a logbook's form changes over its life. A
  version row is written the first time a report is filed against a question
  set that has none. The set only grows, so a hash never returns after a
  different one.
- **What a report seals is what its reporter was asked.** Every route that
  files one reads the questions, checks the answers against that reading, and
  hands the same reading's version to `insertReportVersion` (`formId`). For a
  reporter that is the moment they submit, not the moment they click the
  emailed link; a question added in between is one they never saw. A
  correction seals the questions as they are when it is made.
- **The definition is `text`, not `jsonb`**, because its bytes are hashed and
  published. A CHECK makes the database refuse a hash that is not the SHA-256
  of the text beside it, and the table is append-only.
- **What is in it:** slug and, in order, each question's key, kind, label,
  help, required, `shown_when` and settings. Not the title, the blurb, file
  acceptance, or whether a question is a board filter — none of those change
  what an answer means.
- **Reports from before it have no form and no key**, as always for a
  conditional key, and verify untouched. `formId: null` is how the archive
  replay restores one; leaving `formId` out resolves the current questions, so
  no path files a report without its form by accident.
- **Checkable with no database.** A chain file and a snapshot carry the form
  definitions their reports name, and `checkChainFile` confirms each text
  hashes to its name, is this logbook's, and that every answer is to a question
  it asks and every required question is answered.

Not built yet, and in the ops repository's queue: publishing a form
definition to the transparency log at launch, and the freeze as a database
trigger rather than only a module guard.

## Questions asked only sometimes

A question may carry `shown_when` and be put only when an earlier answer
calls for it. Empty — which is every question that existed before migration
034 — means everybody is asked.

```json
{ "key": "clip_of", "kind": "short_text", "label": "What is it of?",
  "shown_when": { "field": "has_files", "in": ["yes"] } }
```

- **It is part of what the question means, so it is sealed.** A report with no
  answer to question 7 means one thing if question 7 was put to that reporter
  and another if it was not, and somebody checking an old report has to be able
  to tell which. So the condition travels in the form definition rather than as
  a setting that might have changed since.
- **A condition can only look back.** The question it names must come earlier
  in the operator's order. That is what makes a single forward pass correct,
  and it is also what makes a cycle impossible to write.
- **Only about a yes/no question or a list of choices.** A condition over free
  prose would have the question appear and disappear as somebody typed, and
  would put keyword-guessing in front of the reporter rather than in front of a
  moderator. `place` is excluded too: `allowOther` means the set is not fixed.
- **An unanswered controlling question means not asked.** Showing a dependent
  question by default would put it in front of the people its condition was
  written to spare.
- **A question nobody was asked seals nothing, and its `required` does not
  apply.** Demanding an answer to a hidden question would make the card
  unpassable for exactly those people. An answer that arrives for one anyway —
  a stale value from before somebody changed their mind — is dropped rather
  than rejected, the same trade an unknown key takes.
- **An upload question cannot carry one, and is refused rather than
  ignored.** Its card is not one of the cards built from the questions: a
  logbook takes files if it asks for them at all, and the two evidence cards
  are drawn from that rather than from where the question sits. A condition
  here would be sealed into the definition and applied to nobody, which is
  worse than a setting that merely does nothing. `CANNOT_CARRY_CONDITION` in
  `src/conditions.js` is the set that would have to be emptied, deliberately,
  if the evidence cards ever learn to consult it.
- **Drafts only**, like every other edit to a question. The one thing a
  launched logbook may still do — gain a new optional question — may give that
  question a condition, because nobody has been asked it yet.
- **The logic exists twice and the suite is what makes that acceptable.**
  There is no build step and nginx serves `public/` directly, so the browser
  cannot import `src/conditions.js`; `public/js/conditions.js` is a second
  copy, and `scripts/selftest.js` runs one table of cases through both and
  asserts they agree answer for answer. The server decides what gets sealed;
  the browser decides what somebody is shown.

A logbook with no conditions hashes **exactly** as it did before any of this
existed — `shown_when` is written into the definition only when there is one.
Getting that wrong would break the `logbook_form` seal of every report ever
filed, and both `npm test` and `scripts/conditions-selftest.mjs` assert it,
the second over rows that came back out of the database.

## Editorial notes

A logbook may let a moderator attach **one editorial note** to a report:
the archive's own written statement about an account it published, under a
house byline. Off unless the logbook turns it on, because what a note is for
varies — an election logbook publishing accounts that name officials needs
one, an internal safety log that publishes nothing does not.

It travels in the logbook file as `"editorial_notes": true`, written only
when it is on, so a file from a logbook that does not use notes is
byte-identical to one written before migration 036.

Nothing about a note is hashed, and `docs/reference.md` §11.2 has the whole
of it — including why a withdrawn report does not take its note down with
it.

## Files

**A logbook takes files if, and only if, it asks for them** — if it has a
question of kind `file`. There is no switch beside the questions and no
site-wide one saying whether a form asks; both existed until migration 032 and
between them made one decision have two controls, neither of them among the
questions the operator was building.

`accepts_files` still exists as a name and is **derived** — `SHAPE` in
`src/logbooks.js` computes it from the questions, so no caller can read a stale
one. The column of that name survives, unread, as the thing migration 032
backfilled the upload questions from.

**The upload question is the one question whose answer is not in `answers`.**
A report's files are sealed in a top-level `attachments` key computed from the
manifest of what was actually stored, present only when there were any. That
was true before this existed and is untouched by it. `normalizeAnswer` returns
null for the type on purpose. **Sealing a file answer in `answers` as well
would record the same fact twice and change the fingerprint of every report
ever filed.** It looks like a gap. Do not close it.

Two rules follow, both in `addField`: **at most one** upload question per
logbook (two would be two places for the same files, and the manifest says
nothing about which one a file came from), and **never required** (it seals no
answer, so nothing here could tell whether it was satisfied).

Three gates decide whether an upload is actually offered, and
`GET /api/logbooks/:slug` resolves all three into one `acceptsFiles` so the
browser never ands them together itself:

1. the logbook asks for files — it has the question;
2. nobody has frozen it — `logbooks.files_frozen_at`;
3. the site has somewhere to put them — `attachmentsEnabled()`.

### The freeze

`files_frozen_at` is **not** "does this logbook ask for files". It is a
protective handle, and it exists because of the one-way door: after launch a
question cannot be removed, so a running logbook that must stop taking files
has no other way to. It works both ways, before and after launch, because it is
not a question and nothing about it is sealed. It refuses new uploads and hides
nothing already filed or published. There is a site-wide equivalent on the
admin page, written as the blunter instrument it is.

## The logbook file

A logbook's title and questions as one JSON document — what an administrator
downloads, what they upload to start a new logbook, and what a template ships
as. See `src/logbookFile.js` for the shape. **An upload always makes a draft**:
nothing arrives launched, so a file can be as wrong as it likes without
anything reaching a reporter. A slug that is taken gets a number on the end,
so an upload can never join an existing logbook's chain.

## Making one

A logbook is created through a two-step wizard on the Logbooks tab: **the
question set first, the name second**. That is the order the decisions come in,
and only the first one is hard. It used to be a title field and an address
field sitting open above the list, which asked for the trivial decision first
and offered no help at all with the other one.

Choosing a **starting point** fills in a shipped question set — the same
`templates/*.json` files, read by `logbookStartingPoints()` and described from
the file so a count cannot go stale. `POST /api/admin/logbooks` takes an
optional `startingPoint` and everything arrives as a draft, so a starting point
can be wrong for somebody without a reporter ever seeing it.

**A starting point supplies questions and nothing else.** It writes no site
setting, and `npm test` asserts that none of them carries one. That is the
whole difference between it and a template below: a deployment makes logbooks
for years, so adding one must never rewrite the settings of a site that has
been running for months.

## Filing without the site password

A logbook can be set (Admin → Logbooks → the logbook → *Without the site
password*) to take reports from people who do not have the site password:
`link` for anybody with its own form address, `/file/<slug>`, or `door` to
also link it from the password page. **Filing only** — the form, the report,
its files and the confirmation link. The board, the other logbooks and the
rest of the site stay behind the password. The whole allow-list is
`outsidePass` in `src/doors.js`, run in front of the unchanged gate. Not
behind the one-way door: it changes who can reach the form, not what it asks
or what is sealed.

`/file/<slug>` also works for anybody past the password, as a link to one
logbook's form with no chooser.

## Templates

A template is a bundle of ordinary settings plus one logbook file from
`templates/`. It is how a DEPLOYMENT begins, and it is offered once, by the
first-run wizard — not from the admin page, where applying one over a running
deployment would overwrite settings somebody chose one at a time.

Applying it writes the settings and creates that logbook **as a draft**; the
operator reads it, changes anything, and launches it themselves. It never
touches a logbook that already exists. "Election incidents, no files
or free text" is not a mode: it is a logbook file whose questions are all
choices and which takes no files, on a site with file storage off. An
administrator can add a written question or turn files on before launch, or
add an optional question after it, like on any other logbook.

## One chain per logbook

Each logbook is its own chain, so a fault in one breaks that one and no
other, and each can be downloaded and checked on its own.

- **Where a chain starts.** The first report of a logbook links to
  `SHA-256("reportlog-chain:" + slug)` rather than to zeros, so a report cannot
  be lifted from one chain into another without it showing. `chainGenesis` in
  `src/crypto.js`.
- **The link.** `insertReportVersion` takes a lock per logbook and links to
  the newest row *in that logbook*. Two logbooks never wait on each other.
- **Checking a position.** `verify.js` compares a report's recorded previous
  link with the row before it in the same logbook.
- **Corrections** stay in their report's logbook and chain. A report never
  moves.

## The daily timestamp

Once a day `scripts/anchor.js` writes the list of every launched logbook —
its latest link and how many reports it holds — and gets one RFC 3161
timestamp over the list's digest (`src/chainHeads.js`). The list is published
beside the token and recorded in `chain_anchor_heads`. Each chain is checked
against its own line of the list; nobody needs another logbook to do it.

**Once listed, always listed, and never shorter.** With separate chains, a
whole logbook could be deleted and every other chain would still check out.
The list is what notices: a logbook named in the last published anchor must be
named in every later one, and its count can only grow. The anchor script
refuses to publish a list that breaks either rule and exits non-zero, before
anything is timestamped.

## Downloading and checking one logbook

- **Administrators** download a logbook's *complete* chain from its page under
  Admin → Forms: every version of every report, published or not, in chain
  order. Every link can be checked from the start to the head.
- **Anybody** can download a logbook's *published* reports at
  `/api/logbooks/<slug>/chain`. Each report's own fingerprint and link can be
  checked; the run from start to head has gaps where unpublished reports sit.

Either file carries the anchors that covered the logbook. Check one with no
database and no network:

```
node scripts/check-chain.js chain-election-day.json [path/to/transparency-log/anchors]
```

## Migration 029

`029_logbooks_only.sql` is the one migration that is not additive. It drops
the old questionnaire's columns, which changes what a report is, so it refuses
to run on any archive that holds reports — before it touches a table. It is
safe for exactly one archive: an empty one. Every migration after it is
additive again.
