# ReportLog — the whole of it

A complete reference: what this software does, what it refuses to do, how it
works, what constrains it, what is built, and what is planned, parked or
ruled out.

Written to be read cold. `README.md` is the introduction and
`CONTRIBUTING.md` is the short version of the rules; this is the long version
of everything.

## How to read this document

Every claim here was checked against the source on 1 October 2026, at
`v0.0.2`. Where a claim could not be checked that way it is marked:

- **(unverified)** — stated by a project document, not confirmed in code.
- **(drift)** — a project document and the code disagree, and the code wins.

Nothing in this file describes any particular deployment's server, settings
or data. It describes the software.

**The authority for a moving fact is never this file.** What is true of the
code is the code; what is true of a deployment is that deployment. This
document is the map, and a map that claims to be current starts lying the
moment it is written.

## Contents

**The design**
 1. [What ReportLog is](#1--what-reportlog-is) — and what it is not
 2. [The one promise](#2--the-one-promise-and-the-rule-that-implements-it) — the absent-key rule, and permanence
 3. [What a report is](#3--what-a-report-is) — the hashed object, in full
 4. [Logbooks](#4--logbooks) — the fourteen field types, the one-way door, sealed questions, conditions, files
 5. [The chain](#5--the-chain) — the anchor, the snapshot, verification, checking it yourself
 6. [Identity, and the two tiers](#6--identity-and-the-two-tiers) — encryption, erasure, the logs
 7. [What a reporter controls](#7--what-a-reporter-controls) — the sealed answer and the three revocable permissions
 8. [Roles, and the ceiling](#8--roles-and-the-ceiling) — the owner's seat, flags, organizations

**The behaviour**
 9. [How a report gets in](#9--how-a-report-gets-in) — the form, and coordinator intake
10. [Attachments](#10--attachments) — end to end
11. [Moderation](#11--moderation) — the two axes and the three publish gates
12. [What the public sees](#12--what-the-public-sees) — board, statistics, CSV, the public API
13. [Notifications and email](#13--notifications-and-email)
14. [The frontend](#14--the-frontend) — the gate, the CSP, the look system, copy, legal text

**Running it**
15. [Installing](#15--installing) — the reasoning; the procedure is in [INSTALL.md](../INSTALL.md)
16. [Operating it](#16--operating-it) — services, deploying, the three suites
17. [The data model](#17--the-data-model)
18. [Configuration](#18--configuration)
19. [Limits, in one place](#19--limits-in-one-place)

**The edges**
20. [Decided, and not built](#20--decided-and-not-built)
21. [Parked, and refused](#21--parked-and-refused)
22. [Known gaps, and documents that have drifted](#22--known-gaps-and-documents-that-have-drifted)
23. [Appendix — the API surface](#23--appendix--the-api-surface)
24. [Where the authority for a fact lives](#24--where-the-authority-for-a-fact-lives)

---

# 1 · What ReportLog is

A tamper-evident intake and record system for incident reports.

People file reports through a questionnaire an operator built. Moderators
review them. Nothing becomes public without a moderator approving it. And
once a report is filed, **it cannot be silently altered or removed —
including by the operator running the archive.**

That last sentence is the product. Everything else in this document is that
sentence restated somewhere specific.

It is subject-agnostic by construction. It was built for election-incident
reporting and generalised deliberately: there is no built-in questionnaire,
and no code anywhere branches on what kind of archive a deployment is.

- **Licence:** AGPL-3.0-or-later. The network clause is the point — if you
  run a modified ReportLog as a service, the people filing reports into it
  are entitled to the source of the thing they are trusting.
- **Runtime:** Node ≥ 22, PostgreSQL, Express 4, seven production
  dependencies (`canonicalize`, `cookie-parser`, `dotenv`, `express`,
  `express-rate-limit`, `nodemailer`, `pg`).
- **Size:** ~9,900 lines across 65 modules in `src/`, 19 route modules, 32
  migrations, 22 frontend ES modules, and three test suites.
- **Status:** early. Running and in real use by its author; the installer and
  operator documentation are incomplete. Not recommended for production use
  by anyone else yet.

## 1.1 · What it is not

Each of these is a decision with reasoning behind it, not a gap waiting to be
filled.

| It is not | Because |
|---|---|
| A form builder with a built-in incident form | A report is a logbook's answers plus the spine. Where and when are field types an operator adds, not fixed parts of a report. |
| A publishing platform | Nothing is public until a moderator approves it. There is no auto-publish path and there must not be one. |
| A content management system | An operator changes what a page *says*, through ten plain-text copy slots. They do not change what a page *is*. |
| Deletable | `reports` is append-only by database trigger. A correction is a new row; a withdrawal flips a pointer. |
| A backup system | `export-archive.js` moves the archive's *meaning* across a schema change. It re-encodes. Take a `pg_dump` for bytes. |
| A moderation queue with an SLA | Media moderation is the structural bottleneck and the project says so in writing rather than pretending otherwise. |
| Multi-tenant | One deployment, one archive, one owner. Logbooks are many; the archive is one. |
| Billable | ReportLog bills nobody and is not to learn how. |
| A tier system for press | Explicitly not decided; see §21.3. |

---

# 2 · The one promise, and the rule that implements it

## 2.1 · The promise

A report, once filed, cannot be silently altered or removed, including by the
operator.

Four mechanisms, each independently checkable:

1. **The row is immutable.** A trigger refuses `UPDATE` and `DELETE` on
   `reports`, and a second refuses `TRUNCATE`.
2. **The row is fingerprinted.** Its contents are canonicalised under
   RFC 8785 (JCS) and SHA-256'd into `content_hash`.
3. **The row is chained.** `chain_hash = SHA-256(content_hash ‖
   prev_chain_hash)`, linking it to the row before it in the same logbook.
4. **The chain is anchored outside.** Once a day the list of every launched
   logbook's head is timestamped by an RFC 3161 authority and published to a
   git repository that can be mirrored anywhere.

The fourth is what makes the first three worth anything. Hashes a server
computes about itself prove nothing; a timestamp from a party that is not the
operator, over a value published somewhere the operator does not control, is
the claim.

## 2.2 · The rule that breaks everything if you get it wrong

> **A key is written into the hashed object ONLY when it applies.**

An absent key and a key set to `null` serialise differently under RFC 8785.
So making an optional field unconditional changes the fingerprint of every
report ever filed, by every deployment.

Conditional for this reason: `answers`, every key inside `answers`,
`logbook_form`, `attachments`, the whole third-party provenance block, and
`recipe` above 1.

It looks like untidy code in `src/reportCore.js`, `src/verify.js` and
`scripts/import-archive.js`. It is load-bearing. `scripts/selftest.js`
asserts it; if that goes red, stop.

Two features exist *only* because of this rule:

- A launched logbook may gain a new optional question without changing any
  report already filed.
- A new sealed key (a future `may_distribute`, for instance) can ship years
  later with no backfill, no rehash and no recipe bump.

## 2.3 · Where a value lives is decided by permanence

The single design principle the rest of the system falls out of:

**Hash what must never change. Put what may change where changing it is
recorded.**

| Kind of fact | Where it lives | Example |
|---|---|---|
| Must never change | Inside the hashed object | the answers; `may_publish` |
| May change, and the change matters | An append-only log, current value as a projection | the three revocable reporter permissions |
| May change, and is a judgement | A mutable pointer row beside the frozen one | `report_heads.moderation_status` |
| May change, and is presentation | `site_settings` | the site's name, the look, the legal text |

A revocable value inside a fingerprint would make a report verify differently
because somebody changed their mind. That is the failure this principle
exists to prevent.

---

# 3 · What a report is

## 3.1 · The hashed object, in full

| Key | Present when |
|---|---|
| `public_ref` | always |
| `received_at` | always |
| `thread_id` | always |
| `corrects_id` | always (null on a first version) |
| `logbook` | always — the logbook's **slug** |
| `logbook_form` | when the report has a form version (every report since migration 031) |
| `may_publish` | always — every report is asked |
| `may_publish_digest` | always — alongside `may_publish` |
| `answers` | when anything was answered |
| `third_party`, `filed_via`, `intake_method`, `attested_at` | when a coordinator filed it |
| `collected_on` | when a coordinator filed it *and* knew the collection date |
| `attachments` | when files were sealed |
| `recipe` | only above 1 — recipe 1 writes no key, so its absence identifies it |

Nothing else. No report body, no date, no location, no category — each of
those is a question a logbook asks or does not.

`corrects_id` is coerced to a number in one place, because `pg` hands bigints
back as strings and a correction that hashed `"1"` where the verifier
rebuilds `1` would never verify again.

## 3.2 · The spine

What is asked of every report however it was filed, coordinator entry
included:

1. **An address to reach the reporter.** Never part of the hashed object —
   it is encrypted beside it under a key of its own the reporter can have
   destroyed.
2. **Their consent** to the report being processed and stored.
3. **Whether it may be published** — `may_publish`, sealed, plus the digest
   of the exact wording they were shown.

A written account is **not** in the spine. A logbook that wants one adds a
long-text question.

## 3.3 · What is deliberately outside the fingerprint

None of the following may ever be read by `reportCore.js` or `verify.js`:

- Whether this deployment publishes an archive, or distributes
  (`src/publication.js`).
- Whether intake is open (`src/intakeGate.js`).
- The site's name, look, copy, imprint or privacy policy.
- The three revocable reporter permissions (`src/reportPermissions.js` —
  `npm test` fails if it is ever imported by `reportCore.js`, `verify.js`,
  `chainFile.js` or `snapshot.js`).
- Every moderation judgement: status, severity, incident grouping.
- Which organization row a coordinator filed under, and the coordinator's own
  private reference to their paper file. The *name* of the organization at
  filing time is sealed as `filed_via`; the row id is bookkeeping.
- The coordinator's identity. It is Tier B like any reporter's, so the public
  record shows which organization an account came through without naming who
  typed it in.

A report must not verify differently because an operator switched the board
off, renamed the site, corrected their privacy policy, or because a moderator
reached a conclusion.

## 3.4 · Recipes

`RECIPE = 1` today. The recipe rides *inside* the hashed object rather than
being implied by a date, so the hashing promise is self-describing. Recipe 1
writes no `recipe` key at all — the absence is the identifier — which is the
absent-key rule applied to its own version number.

## 3.5 · The public reference

`RL-` + base-36 milliseconds + six characters from a 32-symbol alphabet
(Crockford-style, no I/L/O/U). The prefix identifies the deployment and is
fixed for the life of an archive, because `public_ref` is inside the
fingerprint: a reference cannot be reissued under a new prefix without
breaking the seal on the report it belongs to.

Nothing anywhere may parse the prefix to decide how to treat a report.
Lookups are exact matches on the whole string, which is what lets several
prefixes coexist in one archive. A deployment that renames itself keeps
issuing the old prefix or lives with two forever; both are correct.

**(drift)** `src/crypto.js` carries a `TODO` to read the prefix from
deployment settings once first-run setup exists. First-run setup now exists;
the prefix is still a constant.

---

# 4 · Logbooks

**Every report is filed through a logbook, and every logbook is its own
chain.** There is no other form.

A logbook is a title, an optional blurb, a slug, and a set of questions in
the operator's order.

## 4.1 · Lifecycle

State is **computed, never stored** — it is a question about the clock, and
the clock is authoritative. A timer is only as punctual as its last run, and
computing survives the box being down over a boundary.

| State | Meaning |
|---|---|
| `draft` | never launched. The field set is still editable. Not served to reporters at all, gate or no gate: a questionnaire still being written is not discoverable by guessing a slug. |
| `scheduled` | launched, opening time not yet arrived |
| `open` | accepting reports |
| `closed` | not accepting. Reports already filed stay published and stay verifiable — closing an intake is not retiring a record. |

Two different lists exist and the difference matters:

- **`openLogbooks()`** feeds the reporting form — only what is taking reports
  right now.
- **`launchedLogbooks()`** feeds the board — everything anybody could ever
  have filed to, because closing a logbook is what happens when its work is
  *done* and its reports are exactly the ones somebody will want to read
  afterwards.

A draft is in neither.

## 4.2 · The one-way door

**Launching is irreversible.** There is no unlaunch, because the only thing
unlaunching could mean is "let me edit the questions again", and by then
somebody may have answered them.

A logbook with no fields cannot launch: a logbook that asks nothing would
file reports that say nothing.

After launch, the field set may do **exactly one thing**: gain a new
**optional** question. It may never lose one, rename one, reorder them, make
one required, or change what one means.

- Adding an optional question is safe *only* because of the absent-key rule.
  If that rule ever changes, this opening closes.
- Making a field required retroactively claims the archive holds an answer it
  does not.
- Removing one orphans every answer under that key.
- Editing a label leaves the seal pointing at a question whose words have
  changed.
- Changing **when** a question is asked (`shown_when`) is the same kind of
  change as rewording it, and is refused on the same ground: it would alter
  what a missing answer means for every report already filed. A question
  added after launch may carry a condition, because nobody has been asked it
  yet.

The guard is `assertDraft` in `src/logbooks.js`, and it lives in the module
rather than in a route, so every path that could touch a field goes through
it. **(planned)** The freeze as a database trigger as well — see §20.

The **slug is never editable**, because it is what the chain's starting value
is computed from and what the seal carries. A **field key** is never editable
for the same reason, and `updateField` does not accept one.

## 4.3 · The fourteen field types

`src/fieldTypes.js` is the only list of questions the software knows, and it
is a list of *types*. Each normalises to exactly one shape, because a report
that hashed `3 Nov 2026` could never be checked against one that hashed
`2026-11-03`.

| Type | Sealed shape | Settings | Filterable |
|---|---|---|---|
| `short_text` | string, truncated | `maxLength` (200) | yes |
| `long_text` | string, truncated | `maxLength` (5000) | no — free-prose filtering is what the search box is |
| `date` | `YYYY-MM-DD`, real calendar day | — | yes |
| `time` | `HH:MM:SS`, zero-padded | — | no |
| `datetime` | UTC ISO 8601 | — | yes |
| `place` | string ≤ 200, or one of a supplied list | `options`, `allowOther` | yes |
| `choice_one` | one option, exactly as offered | `options` | yes |
| `choice_many` | array, deduplicated, **sorted into the operator's option order** | `options` | yes |
| `yes_no` | boolean | — | yes |
| `evidence_declaration` | boolean | — | yes |
| `number` | finite number within bounds | `min`, `max` | yes |
| `email` | lowercased, shape-checked | — | no |
| `url` | `http:`/`https:` only, normalised | — | no |
| `file` | **nothing** — see §4.6 | — | no |

Notes that matter:

- **`evidence_declaration` asks what exists, not for it.** Whether the
  reporter has photographs, video, audio or documents of this — without
  asking them to upload anything. A moderator may ask later, and only if the
  reporter separately permitted being asked. The two are deliberately not one
  checkbox: folding "I have footage" together with "ask me about it" would put
  a revocable value inside the fingerprint, and a report would verify
  differently because somebody changed their mind about being contacted. The
  declaration is sealed; the permission to be asked is not. Pair it with a
  short-text question conditioned on `yes` for what the material is of.
- **`choice_many` order is the operator's, not the reporter's.** Two people
  ticking the same boxes in a different order must produce the same seal.
- **An answer outside the offered list is not an answer.** The list is frozen
  at launch, so this can never fail for a reason the reporter could fix.
- **`url` rejects every scheme but http and https.** A `javascript:` or
  `data:` URL in an archive that renders links is an attack, not an address.
- **Adding a type is additive.** A row in the list, a card in the builder, a
  control in the form. Existing logbooks are untouched, and a sealed answer is
  unaffected because the seal holds the answer, not the type's definition.
- **An absent time stays absent.** "No time given" is a real answer; turning
  it into midnight would be inventing one.

### Asked only sometimes

Any question may carry `shown_when` (migration 034) and be put only when an
earlier answer calls for it; empty means everybody is asked, which is every
question that existed before it. `docs/logbooks.md` has the whole of it. The
short version:

| | |
|---|---|
| **Shape** | `{"field": "<earlier question's key>", "in": ["value", …]}` |
| **Satisfied when** | that answer is one of those values, or for a choose-any question includes one |
| **Can be asked about** | `yes_no`, `choice_one`, `choice_many` — nothing whose answer is typed |
| **Sealed** | **yes**, in the form definition: being asked is part of what a question means |
| **Editable** | drafts only, like every other edit to a question |
| **Where the logic lives** | `src/conditions.js`, and a second copy in `public/js/conditions.js` because there is no build step — one table of cases is run through both in `npm test` |

A logbook with no conditions hashes exactly as it did before they existed,
because `shown_when` is written into the definition only when there is one.
That is the absent-key rule, in the place where breaking it would be worst:
the sealed `logbook_form` of every report ever filed.

## 4.4 · Answers, and the absent-key rule one level down

`buildAnswers` in `src/answers.js` checks a submission against one field set
and returns `{ answers, errors }`.

- A question nobody answered has **no key at all** — not a key whose value is
  null.
- `answers` comes back **undefined, not `{}`**, when nothing was answered, so
  a report with no answers carries no `answers` key in the seal.
- **Fields the logbook does not have are dropped silently, not rejected.** A
  form left open in a tab across a relaunch would otherwise fail on a key
  nobody can see.
- The column `reports.answers` is written from the same object that was
  hashed, never from the request, so it cannot drift from the seal. Absent is
  SQL `NULL`, never `{}`.

## 4.5 · The questions are sealed too

A seal over an answer is worth exactly as much as the fixity of the question.
So every report also seals **which questions it was answered against**:
`logbook_form`, the SHA-256 of that logbook's form definition.

- **Forms have versions.** A version row is written the first time a report
  is filed against a question set that has none. The set only grows, so a
  hash never returns after a different one.
- **What a report seals is what its reporter was actually asked.** Every route
  that files a report reads the questions, checks the answers against *that*
  reading, and hands the same reading's version to `insertReportVersion`. For
  a reporter that is the moment they submit, not the moment they click the
  emailed link — a question added in between is one they never saw. A
  correction seals the questions as they are when it is made.
- **The definition is `text`, not `jsonb`**, because its bytes are hashed and
  published. A database `CHECK` refuses a hash that is not the SHA-256 of the
  text beside it, and `logbook_forms` is append-only.
- **What is in a definition:** the slug and, in order, each question's `key`,
  `kind`, `label`, `help` (only when there is some), `required` and
  `settings`. **Not** the title, the blurb, file acceptance, or whether a
  question is a board filter — none of those change what an answer means.
- **Never re-serialise a stored definition to hash it.** Hash the string.
- **Reports from before migration 031 have no form and no key**, as always for
  a conditional key, and verify untouched. `formId: null` restores that state
  on an archive replay; leaving `formId` out resolves the current questions,
  so no path can file a report without its form by accident.
- `immutableFieldsFor` **throws** on a row that has a `form_id` and no hash,
  rather than rebuild a different object. Every query feeding it must carry
  `FORM_JOIN`.

## 4.6 · Files are a question, and the answer is not in `answers`

**A logbook takes files if it asks for them** — if it has a question of kind
`file` — **and the site has attachments on**, which needs object storage
(`attachmentsEnabled()`, `src/routes/reports.js`). Before migration 032 there
was also a per-logbook switch, which made one decision have two controls in
the logbook, neither of them among the questions the operator was building.
The site-wide switch stayed, because it answers a different question —
whether this deployment has anywhere to put a file at all — and a logbook can
still be frozen on its own (`setFilesFrozen`).

**The upload question is the one question whose answer is not in `answers`.**
A report's files are sealed in the top-level `attachments` key, computed from
the manifest of what was actually stored, present only when there were any.
`normalizeAnswer` returns null for the type on purpose.

> Sealing a file answer in `answers` as well would record the same fact twice,
> in two shapes, and would change the fingerprint of every report ever filed.
> It looks like a gap. Do not close it.

Two rules follow, both enforced in `addField`:

- **At most one upload question per logbook.** Two would be two places for the
  same files, and the manifest says nothing about which question a file came
  from — so the second would be a question the archive cannot answer.
- **Never required.** It seals no answer, so nothing could tell whether it was
  satisfied. `buildAnswers` also skips the type outright, so a row written
  before that guard existed cannot brick a logbook.

`accepts_files` survives as a **derived** name — computed from the questions
in `SHAPE`, so no caller can read a stale one. The physical column of that
name still exists, read by nothing, as the thing migration 032 backfilled
from. Do not read it.

### Three gates on an upload

`GET /api/logbooks/:slug` resolves all three into one `acceptsFiles` so the
browser never ands them together itself:

1. The logbook asks for files — it has the question.
2. Nobody has frozen it — `logbooks.files_frozen_at`.
3. The site has somewhere to put them — `attachmentsEnabled()`.

### The freeze

`files_frozen_at` is **not** "does this logbook ask for files". It is a
protective handle, and it exists because of the one-way door: after launch a
question cannot be removed, so a running logbook that must stop taking files
has no other way to.

It works **both ways, before and after launch**, because it is not a question
and nothing about it is sealed. It refuses new uploads and hides nothing
already filed or published. A time is stored rather than a boolean, because
"somebody pulled this handle, and when" is the useful fact about a protective
act. There is a blunter site-wide equivalent on the admin page.

## 4.7 · The logbook file, starting points, templates

A **logbook file** is one plain JSON document: `reportlog_logbook: 1`, title,
optional slug and blurb, and the questions in order. It is what an
administrator downloads, what they upload to make a new one, and what a
template ships as — one shape for all three.

- **An upload always makes a draft.** Nothing arrives launched, so a file can
  be as wrong as it likes without anything reaching a reporter.
- **A taken slug gets a number on the end**, so an upload can never join an
  existing logbook's chain.

A **starting point** fills in a shipped question set when creating a logbook.
Three ship: `elections`, `elections-choices`, `workplace`. They are described
*from the file* so a count cannot go stale.

> **A starting point supplies questions and nothing else.** It writes no site
> setting, and `npm test` asserts that none of them carries one. A deployment
> makes logbooks for years, so adding one must never rewrite the settings of a
> site that has been running for months.

A **template** is a bundle of ordinary settings *plus* one logbook file. It is
how a **deployment** begins, offered **once**, by the first-run wizard — never
from the admin page, where applying one over a running deployment would
overwrite settings somebody chose one at a time.

Four templates: `elections`, `elections-choices` ("Election incidents, no
files or free text"), `workplace`, `blank`.

> **A template is not a mode the software runs in.** Applying one writes the
> ordinary settings rows an administrator could have typed by hand, and then
> it is over. Nothing reads "which template is this" to decide anything. The
> test of that: this feature and its routes could be deleted and no deployment
> would change behaviour.

Applying is **one transaction**, and every value goes through the same
validator an admin route would use — `validateSiteName`, `validateLook`,
`validateCopy`, `validateLogbookFile`. A template carrying anything they
refuse is refused **whole**, before a single row is written. It never touches
the imprint, the privacy policy, a logbook that already exists, or anything
hashed.

## 4.8 · Making one

A two-step wizard on the Logbooks tab: **the question set first, the name
second.** That is the order the decisions come in, and only the first one is
hard.

---

# 5 · The chain

## 5.1 · One chain per logbook

Each logbook is its own chain, so a fault in one breaks that one and no
other, and each can be downloaded and checked on its own.

- **Where a chain starts.** The first report of a logbook links to
  `SHA-256("reportlog-chain:" + slug)` rather than to zeros, so a report
  cannot be lifted from one chain into another without it showing — its link
  would name the wrong start. Anybody can recompute this by hand.
- **The slug, not the id**, because the slug is what the seal carries and what
  somebody checking a downloaded logbook has in front of them. This is why it
  is never editable.
- **The link.** `insertReportVersion` takes `pg_advisory_xact_lock` **per
  logbook** and links to the newest row *in that logbook*. Two logbooks never
  wait on each other.
- **Corrections stay in their report's logbook and chain.** A report never
  moves between logbooks.

## 5.2 · Threads, versions, corrections, withdrawal

| Concept | Where |
|---|---|
| A report's lineage | `thread_id`, stable across every version |
| Every version | a `reports` row, frozen, chained |
| Which version is current | `report_heads.current_report_id`, a mutable pointer |
| Every judgement about it | `report_heads` — no append-only trigger |

The codebase solved "immutable record with mutable judgement attached" once,
here, and every later feature reuses the shape rather than inventing a second
idiom. Attachments do exactly the same thing (`attachments` /
`attachment_heads`).

- **A correction is a new row** with `corrects_id` set, which advances the
  head and resets `moderation_status` to `pending` — pulling a live report off
  the public board until it is re-approved. That is correct behaviour: the
  version that was published did not contain the change, and the archive
  should say so. It is also a surprising outcome, so the interface says it out
  loud before the change starts.
- **A withdrawal flips a pointer** (`report_heads.withdrawn`). Nothing is
  deleted.
- **Withdrawal is forward-only.** A withdrawn report stops appearing in the
  next day's snapshot. It does not vanish from yesterday's, which is already
  published in a public git repository and is not the operator's to unpublish.
  That is the honest bargain of a tamper-evident archive, and it is stated in
  the snapshot file itself rather than left for somebody to discover.

## 5.3 · The daily anchor

Once a day `scripts/anchor.js`:

1. Builds the list of **every launched logbook** — its latest link and how
   many reports it holds (`src/chainHeads.js`). A logbook with no reports yet
   is still listed, at its starting value with a count of 0: it exists from
   the moment it launches, and listing it from then on is what makes its later
   disappearance visible.
2. Computes `headsDigest` — SHA-256 of `{anchor_format, date, chains}`
   canonicalised under RFC 8785, lowercase hex. Anybody holding the published
   list can recompute it. `ANCHOR_FORMAT = 2`.
3. Gets **one RFC 3161 timestamp token** over that digest from an outside
   authority. One timestamp covers every chain, and each chain is checked
   against its own line of the list without needing any other.
4. Publishes the list, the token and the day's snapshot to the transparency
   log, and records the heads in `chain_anchor_heads` (append-only).
5. Pushes to **every** configured remote.

The log is mirrored across git hosts under **different operators**. That is
not redundancy for its own sake: a record only one company holds is a record
one company can be compelled to remove, and the whole claim this exists to
support is that nobody — the operator included — can quietly alter or suppress
the archive.

### Once listed, always listed, and never shorter

With separate chains, a whole logbook could be deleted and every other chain
would still check out. **The list is what notices.**

A logbook named in the last published anchor must be named in every later
one, and its count can only grow. `contradictions()` finds `dropped` and
`shrunk` chains, and the anchor script **refuses to publish and exits
non-zero, before anything is timestamped.**

> This is the only thing in the system that notices a whole logbook
> disappearing. Do not weaken it.

## 5.4 · The daily snapshot

The anchor alone proves the archive has not been altered. It does not prove
what the archive **said** — a hash is only checkable against content you
already have. The snapshot closes that gap: every published report, in full,
as text, beside the anchor.

- Each entry carries the fields that were hashed and the hash that was
  recorded, so a reader can check any single report alone.
- Grouped by logbook, in chain order within each.
- **Only Tier A.** Reporter identity and contact details have never been part
  of the fingerprint and are not here. The snapshot is exactly what is already
  public on the board, in a form that can be checked.
- Carries the form definitions its reports name.
- Carries **no** attachment publication state, which is what makes a reporter
  revoking the attachment permission unable to strand a published proof.
- `SNAPSHOT_FORMAT = 2`.

`SNAPSHOT_SELECT` is `r.*` plus the joins, deliberately **not** a column list.
A hand-kept list drifted once and the consequence was severe: a commit added
`r.may_publish = true` to a `WHERE` clause without adding `may_publish` to the
`SELECT`, so the rebuilder saw the column as absent, read that as "the
question was never asked", and left both publication keys out. Every report in
every snapshot for days was published with the wrong `hashed_fields` and
flagged as not matching its own hash. There is no version of that list that is
safe to maintain by hand, so it is not maintained by hand. The same drift was
deleted from `verify.js` for the same reason.

## 5.5 · Verification

`GET /api/reports/:publicRef/verify` reports **four separate things**, because
they fail for different reasons and a reader deserves to know which:

| Check | What it says |
|---|---|
| `content` | the report's own contents still hash to the recorded value — the text has not been edited |
| `link` | `chain_hash` really is this content hash combined with the one before it |
| `position` | the report before it in the chain is the one this row claims follows — this is what makes an insertion or deletion visible rather than just an edit |
| `anchor` | an outside timestamp covers this report, so the chain could not have been rebuilt after the fact |

The response also returns `hashed_fields` **and** `canonical_json` — the exact
bytes that were hashed — so anyone can run SHA-256 over that string themselves
and compare, without using this code or taking the result on trust.

Notes:

- **An unanchored report is not a failure.** The chain is anchored once a day,
  so a report filed this morning is genuinely not covered yet, and saying so
  plainly beats implying something is wrong with it.
- The anchor reported is the **earliest** one covering the report — the
  tightest claim about when it demonstrably existed.
- The verifier is built out of the **same functions that wrote the hash**
  (`buildImmutableFields`, `contentHash`), not a second implementation. A
  verifier that reimplements the recipe can be wrong in the same direction as
  the bug it is meant to catch.
- **Nothing here reads Tier B**, so verification never becomes an unaudited
  route to identity.
- **Reachable for any report in the archive, not only a published one.**
  Verification answers a different question from "may this be published", and
  a withdrawn or declined report is exactly where somebody most wants an
  independent answer.
- Rate-limited: 120 per 15 minutes, because it hashes and runs three queries
  per call.

## 5.6 · Chain files — checking with no database and no network

Two kinds, and the checker says which it was given:

| Kind | Contents | Who | What can be checked |
|---|---|---|---|
| `complete` | every version of every report in the logbook, published or not, in chain order | administrators | everything, start to head — an insertion, removal or alteration anywhere shows |
| `published` | only what the public board shows | anybody, at `GET /api/logbooks/:slug/chain` | each report's own fingerprint and link; the run from start to head has gaps where unpublished reports sit |

A complete file carries the answers of reports that were never published, so
it is administrators only. It is still **only Tier A** — nothing in it names
or reaches a reporter.

Either kind carries the anchors that covered the logbook, every form
definition its reports name, a `chain_length`, and a `how_to_check` sentence
describing the recipe in prose.

`src/chainCheck.js` is **pure** — no database, no network, no import of
anything that has either — so it runs anywhere somebody has the file and Node:

```
node scripts/check-chain.js chain-election-day.json [path/to/transparency-log/anchors]
```

It checks: the file format; that the starting value is the one the slug gives;
that each report is sealed as belonging to this logbook; each content hash;
each link; on a complete file, that each `prev_chain_hash` is the one before
it; that the entry count matches `chain_length`; that every form's text hashes
to the name it is filed under and is this logbook's; that every answer is to a
question its form asks and every required question is answered; and that each
anchor names a head at the position its report count claims.

`CHAIN_FILE_FORMAT = 1`.

## 5.7 · Resetting a chain, and why it must be announced

`scripts/import-archive.js` replays an exported archive into an empty
database, **building a new chain**. The reports come back with their original
text, references and dates, but every hash is computed afresh, because the
hashed object's shape is whatever the current code says it is. The result is a
valid archive that is **not** the archive it came from. It refuses to run
against a database that already holds reports.

That is why `scripts/chain-reset-marker.js` exists and must be run straight
after, before the site takes any new report. Anchors already published name a
head that no longer exists anywhere; an archive that quietly stops reconciling
with its own published proofs is indistinguishable from one that has been
tampered with, and "it was fine, we rebuilt it" said afterwards is worth
nothing.

So the reset is published: both chains' boundary values, the reports carried
across, and the reason. **The old anchors stay exactly where they are.**
Nothing in the log is rewritten to match the new chain, because a log that
gets tidied to agree with the present is not a log.

## 5.8 · The transparency log is never rewritten

Not even to correct it. If something invalidates published proofs, publish
that fact beside them.

---

# 6 · Identity, and the two tiers

## 6.1 · The split

**Tier A** is what a report says. It is what gets hashed, what the board
shows, what the snapshot publishes.

**Tier B** is who filed it — an organization they stated, an observer id, and
a contact address. Encrypted, readable only by a moderator, and only with a
written reason that is logged and shown to the reporter.

The fingerprint has **never** covered Tier B. That is what lets verification,
chain files and snapshots exist without any of them becoming a route to
identity.

## 6.2 · Encryption

Two keys, both 32 bytes, both generated by `npm run configure` and never
prompted for or displayed:

| Key | For |
|---|---|
| `TIER_B_ENCRYPTION_KEY` | AES-256-GCM over Tier B fields and as the wrapping key for every per-object data key |
| `CONTACT_HMAC_KEY` | a keyed, non-reversible digest of an email address, so "which threads did this address file" is answerable without decrypting every restricted row |

Packed format everywhere, so there is one format to document:
`iv(12) ‖ authTag(16) ‖ ciphertext`.

**Lose either key and the data behind it is unreadable forever, with the
ciphertext intact in every backup.** They exist only in `.env`.

Streaming variants exist for files too large to hold in memory: a 150 MB video
buffered as plaintext and ciphertext at once is 300 MB resident per file.
Encryption writes ciphertext to a file and hands back the header for the
caller to prepend, because GCM only knows the tag once the last byte is
encrypted. GCM verifies the tag at `final()`, so a truncated or altered file
throws mid-stream rather than yielding partial plaintext.

## 6.3 · Erasure, on an archive that cannot delete

The hardest question in the design, and per-object keys dissolve it.

`reports_restricted` is append-only by trigger and stays that way. A new
report's contact details are encrypted under a **key of their own**; that key
is wrapped by the master key and kept in `contact_keys`, **which may delete.**

Erasing is deleting the key. The ciphertext is never touched and can never be
read again. The keyed digest of the email lives beside the key for the same
reason, so after an erasure nothing links the report to an address. The
confirmation-link rows that still hold the address in the clear are deleted
too.

The same mechanism covers files: null `dek_wrapped`, stamp
`dek_destroyed_at`, and the content is gone beyond recovery while the archive
still says — provably, to a third party holding only the public transparency
log — that a file with that digest was submitted on that date and later
erased.

**An erasure never looks like tampering.** That is the property that lets an
append-only archive honour a deletion request at all.

Rows filed before migration 029 have `key_scheme NULL` and are under the
master key directly. They read exactly as before and **cannot be erased**
without breaking the append-only rule; withdrawal still works for them.
`isErasable()` is how a caller finds out.

## 6.4 · The access log

Who opened the protected parts of a report, when, and why.

| Kind | What | Shown to the reporter |
|---|---|---|
| `identity` | a moderator opened Tier B | **yes** |
| `attachment_original` | a moderator opened the unstripped original of a file | **yes** |
| `attachment_preview` | a moderator viewed the cleaned copy during review | no — workflow, not a disclosure |
| `audit_log` | somebody read the audit log | no — about staff, not about any reporter's data |

**Deliberately not logged:** ordinary moderator browsing of the report queue.
That is Tier A, already public or about to be, and recording every glance at
it would bury the entries that matter under thousands that do not. The log
means "somebody opened something protected", and it can only keep meaning
that if it stays narrow.

A reason is **required and checked** — minimum 10 characters, maximum 500. A
reason that is required but never checked becomes `"."` within a week.

Append-only by trigger. Viewing an original goes through a short-lived grant
(`attachment_view_grants`) whose row references the `access_log` row, so the
audit entry cannot exist without the view or the view without the entry.

## 6.5 · The request log

Written after a 100 MB upload reached the bucket byte-for-byte and its
completion call never took effect, with nothing in the journal about any
request at all. One line per request, and an error handler that makes a 500
say so.

**The privacy rules are the point, not an afterthought.** This is an archive
whose promise is that a person can report something without being identified
for it, and a request log is the classic way that promise gets broken by
accident. So:

- **No IP addresses.** Not truncated, not hashed. The debugging value is small
  and the value to anyone who compels or steals the logs is not.
- **No query strings and no bodies.** Sign-in codes, email addresses and the
  site password all travel in those.

A reverse proxy in front has its own opinion and is the operator's to
configure.

---

# 7 · What a reporter controls

Three things, and they live in three different places because they have three
different permanences.

## 7.1 · `may_publish` — sealed, permanent

The publication answer given at filing. Inside the fingerprint. Required —
true or false, never absent on a new report, because every report is asked and
a report sealed without its answer would be a statement that nobody asked.

A reporter who reaches the card and moves past it without choosing records
`false`, never absent. **They were asked.** Absent is a statement about the
deployment, not about the person.

Three permanent states, all distinguishable forever:

| Written | Meaning |
|---|---|
| `true` | asked, and permitted |
| `false` | asked, and not permitted |
| *key absent* | the deployment never put the question in front of anybody |

## 7.2 · `may_publish_digest` — what, exactly, they answered

Filing time alone does not tell you which wording was in force. So a second
sealed key holds the SHA-256 of the **exact visible card text**.

**The server owns the text.** The digest has to be computed from what the
reporter actually read, and the server cannot digest text that lives only in
`public/index.html` — a reverse proxy serves that file directly and the app
has never seen it. The remaining option, letting the browser send the digest,
would let a client seal a claim about a sentence it never displayed: a false
statement inside the fingerprint, which is worse than no digest at all.

So the text lives in `src/consentText.js`, the form fetches it from
`GET /api/reports/consent-text`, and the digest is computed from the same
string that was sent. One copy, nothing to drift from. A submission whose
digest names no wording this deployment has ever shown is **refused at the
route**.

**The normalisation, stated where it cannot quietly change:** trim each line,
join with a single newline, Unicode NFC, UTF-8, SHA-256, lowercase hex, all 64
characters. Not truncated — a short digest saves nothing and invites an
argument about collisions on a value sealed forever.

**What gets digested:** the question, every body paragraph (including the
coordinator sentence when shown), the optionality line, and **both option
labels**. The labels are part of what was answered; leaving them out would let
"Yes, it may be published" become something else without the digest noticing.

Two variants, `general` and `coordinator`, producing different digests, which
is correct — a different sentence was answered. The coordinator variant adds
one sentence, because `filed_via` is in the hashed object and is public, while
an organization a reporter states about *themselves* is Tier B and encrypted:
two different things sharing one word, and the general card's sentence would be
false on that path if it named organizations at all.

`consent_texts` maps digest to text, is **insert-only** and append-only by
trigger, and is written at boot so the row a report's digest names already
exists before any report can name it. A changed sentence is a new row with a
new digest; old reports keep pointing at the old text; nothing is retroactive.
Every wording is readable at `GET /api/v1/consent-texts`.

### Why it is not called consent

The archive's lawful basis is deliberately **not** Article 6(1)(a) consent.
That is the worst available fit for an archive that cannot delete, because it
drags in the Article 7(3) withdrawal right and makes the Article 17 erasure
obligation hardest to resist — 17(1)(b) fires the moment consent is withdrawn.

The card therefore asks a question *about the report* rather than soliciting
permission in the legal sense. Calling it consent while not honouring
withdrawal is the pattern regulators treat as deceptive. The file is named for
the card, the key is `may_publish`, and the word consent appears in neither.

Sealing the word "consent" into a fingerprint displayed on the verify page
would embed a framing the design rejects, in the one place it can never be
edited.

**The intended route** is legitimate interests under 6(1)(f) plus the
archiving and journalism derogations — Article 17(3)(d) for archiving in the
public interest under 89(1), and Article 85 for journalistic purposes. That is
what makes "publication is permanent" an honest sentence rather than a
contradiction. **(unverified — a design position, not a legal conclusion;
whether it holds is a question for counsel, and §22.3 lists the questions.)**

## 7.3 · The three revocable permissions

`src/reportPermissions.js`. **Nothing here is hashed or chained**, and
`reportCore.js`, `verify.js`, `chainFile.js` and `snapshot.js` may never
import it — `npm test` fails if one does.

| Permission | Means |
|---|---|
| `contact_passing` | may a moderator pass the reporter's contact details to somebody asking to follow up |
| `attachment_publication` | may the files attached to this report be published — a second layer on top of `may_publish`, which covers the report itself |
| `evidence_request` | may a moderator ask the reporter for evidence they declared but did not upload. The ceiling on the `evidence_declaration` answer: the declaration is sealed and permanent, being asked about it is not. |

**An append-only log, never a mutable flag.** The current value is a
**projection**: the newest row for a thread and a permission wins. A mutable
column was not the worse of two options — it was impossible, because its
natural home (`reports_restricted`) refuses `UPDATE` by trigger.

- **No rows means not granted.** Every thread that existed before migration
  030 reads as neither permission given, which is the safe direction and needs
  no backfill.
- **Only the reporter changes a reporter's permission.** There is no moderator
  route that writes this log, the table's own `CHECK` says `actor =
  'reporter'`, and the suite asserts both. A moderator granting one on
  somebody's behalf would record the operator's decision under the reporter's
  name.
- `actor_email` is NULL on a thread whose contact details can be erased — the
  table is append-only, so an address written into it would outlive the
  erasure it was meant to honour.
- The reporter is shown the whole history, so the permission is not a switch
  with no memory.
- **Revoking `attachment_publication` takes published files down**, through
  the same code path the moderator's own withhold uses, so the two cannot
  drift. Files move to `withheld`, not `refused` — refused is a moderator's
  judgement about the file, and this is the reporter changing their mind.

## 7.4 · Consent is the ceiling, moderation is the floor

A moderator may publish the report's text and not its photographs. **Never the
reverse.**

The files are a second layer the reporter permits separately, read **at the
moment of publishing** rather than trusted from earlier. With two permissions
there are now two ceilings.

## 7.5 · Self-service

Signed in with a one-time code, through My Reports:

- See every report filed from their address (found by the keyed email digest).
- **Correct** one — appends a version, resets moderation to pending.
- **Withdraw** one — flips the pointer.
- **Erase** their contact details — destroys the key, if the thread is
  erasable.
- Grant or revoke the two permissions, with the full history.
- Read the access log entries that concern them.
- Set notification preferences, per logbook.

---

# 8 · Roles, and the ceiling

## 8.1 · Five system roles

`user`, `moderator`, `access_manager`, `admin`, `owner`.

Granting is funnelled through `src/roles.js` rather than done inline in
routes, for one reason: **the audit row and the change must be impossible to
separate.** A route that can update a role directly is a route that can forget
to write the trail, and the trail is only worth anything if it is complete.
Both happen in one transaction or neither happens.

## 8.2 · Who may grant what

```
owner:          ['user', 'moderator', 'access_manager', 'admin']
admin:          ['user', 'moderator', 'access_manager']
access_manager: ['user', 'moderator']
moderator:      []
user:           []
```

**The load-bearing line is Access Manager's.** It can make Moderators and it
cannot make Access Managers — not even by demoting and re-granting, because
the value simply is not in its list. If Access Managers could mint each other,
one grant would eventually become every grant.

**The owner's seat appears in no row, its own included.** `setSystemRole`
cannot produce an owner by any argument. That is the same trick one rung up,
and it is what stops a rank above admin from reopening the problem the ceiling
below exists to prevent.

`MAY_GRANT` is **exported** so the suite reads the real thing. A test that
restated the table would be asserting its own copy.

## 8.3 · Who may change somebody who already holds a role

| Subject | Who may change them |
|---|---|
| `owner` | **nobody**, including themselves |
| `admin` | the owner only |
| `access_manager` | anybody with admin authority |
| anything else | anybody who may grant the target role |

Nobody may change their own role — that is how somebody either locks
themselves out or promotes themselves.

Admin used to be untouchable by anybody. Half of that reasoning still holds
(an Access Manager who could demote an admin could decapitate the system) and
is why this is owner-only. The other half — that an admin demoting the last
admin locks everyone out — **dissolves under an owner**, who can always mint
another administrator. That is the strongest evidence the ladder is the right
shape.

## 8.4 · Rank lives in one place

`src/roleRank.js` is the only module that knows owner outranks admin. It
imports nothing, because `authMiddleware.js` needs it and `roles.js` reaches
the database — a guard that had to pull in a connection pool to decide whether
somebody may see a page would be the wrong dependency in the wrong direction.

`requireRole` consults it, so a route asking for `admin` admits the owner
without seventeen guards having to agree.

**It is deliberately not a general hierarchy.** Admin does **not** imply
moderator: every route that wants both already says both, and inventing a full
ladder would silently widen those routes. The only claim made is that owner is
one level above admin and holds what admin holds.

## 8.5 · The owner's seat

**Exactly one owner**, enforced by a partial unique index rather than a check.
A second owner could remove the first.

The seat is **ungrantable**. It moves only two ways:

1. The setup wizard mints the first one.
2. The **two-party handover** in `src/ownership.js`.

### Why the handover is two-party when appointments are not

Every other role change is one-sided, and that is right: an appointment nobody
accepts simply sits there costing nothing, and pre-authorising by email is a
deliberate feature — somebody can be made a moderator before they have ever
signed in.

Ownership is the one move whose failure is **permanent**. Only the owner mints
administrators and only the owner transfers, so handing the seat to a typo, a
dead mailbox or somebody who has left leaves the deployment with no way back
that does not involve a shell and hand-written SQL. Consent belongs where the
failure cannot be undone, and nowhere else.

Mechanics:

- At most one pending proposal, replaced rather than refused when the owner
  changes their mind. 7-day TTL. An expired proposal is not pending.
- The account is **not** created on proposal: unlike an appointment, this
  confers nothing until accepted, so there is nothing to pre-authorise.
- Acceptance is **one transaction**, and the order inside it is forced by the
  database: the partial unique index permits one owner, so the outgoing owner
  must be stepped down before the incoming one is raised. A half-applied swap
  would leave two owners or none, and "none" is unrecoverable.
- The seat is re-read **inside the lock**, not trusted from the proposal — the
  owner may have changed since it was written.
- **The outgoing owner becomes an admin, not a user.** Dropping the person who
  installed the deployment to `user` mid-handover would strand them outside
  the pages they were using a second ago. Demoting them further is the new
  owner's call, deliberately, in a second act.
- Both halves are written to the audit trail on an `owner` axis, so "revoked
  owner, granted owner" reads as one handover rather than two unrelated
  events.
- The one-time code is keyed on **both addresses**, so a code is bound to the
  pair it was minted for. Keying it on the owner's address alone proved only
  that the owner was at the keyboard: a code requested meaning to hand the
  seat to one person would hand it to anybody typed in afterwards, and the
  email announcing it could name nobody at all. The point of emailing the
  owner is the **record** it leaves, and that record is only true if the seat
  cannot then go somewhere else on the same code. NUL separates the pair,
  because it cannot occur in either address.

## 8.6 · Flags, which are not roles

Two, both modelled on each other to the letter — same shape, same two
granters (admin or access manager), same audit row. They are flags and not
roles because the role ceiling is a load-bearing invariant with tests behind
it and a second check at the route, and **every new grantable role is a new
way to get that wrong.**

| Flag | Grants access to |
|---|---|
| `is_tester` | the bug form and the issues list. **No report, ever.** |
| `is_team_member` | the staff portal. **No report, ever.** |

Both compose with whatever system role somebody already holds.

**Desks** sit beside the team-member flag: which portal tab opens first and
what is highlighted. **Display only** — a desk never hides a tab, grants
nothing, and no route consults it. Somebody may hold several or none. They are
**declared in `src/desks.js`**. They were derived from the volunteering
form's list of functions until that form became a list (migration 047); the
ids did not change, so nobody's stored desk changed meaning.
Unknown desk ids are dropped rather than refused: a desk is not a permission,
and failing somebody's whole update because a list changed under them would be
the wrong trade. Revoking the flag clears the desks, because a revoked person
should not quietly keep a job title.

## 8.7 · Organizations — the second axis

`manager` and `coordinator`, held per organization. An organization role
grants nothing outside that organization.

Three constraints, each from a specific failure rather than tidiness:

- **Managers cannot promote Managers.** Only admin or access manager does
  that. Otherwise a compromised Manager account entrenches itself.
- **An organization always has at least one Manager.** A removal that would
  empty it is refused — an organization nobody can administer needs an admin
  to rescue it, which is exactly the work delegation was meant to avoid.
- **Removal is forward-looking only.** A coordinator removed from an
  organization keeps every submission already attributed to it. A departure
  must never retroactively strip provenance from records in the public log —
  that would be an edit to the record, made by leaving.

### Invitations

A **new door into role granting**, so the ceiling is checked here and again at
the route:

> An organization manager may hand out organization roles and nothing else.
> Never `moderator`, never `access_manager`, never `admin`.

- Inviting a **coordinator** is a manager's own business — the whole point of
  the role is that one person is not the bottleneck for every volunteer.
- Inviting another **manager** is a leadership grant and waits for an admin.
  Such an invitation is created `awaiting_approval` and **no email is sent
  until it is approved**, because an approval that arrives after the person
  has been told they are invited is not an approval of anything.
- **There is no decline button**, deliberately — "ignore it if you didn't want
  it" is the honest instruction, and a decline button invites a reply to a
  message nobody needs to answer.
- 7-day TTL; at most 50 outstanding per organization; at most 2 sends per day
  per address.

### The Alliance directory

Organizations that have opted in to being listed. **Not chained**, and that is
the design: participation is mutable state about a living relationship, and
sealing it would make membership permanently unremovable — the wrong promise
for something that can end.

**Every surface that renders the directory carries the disclaimer**, and it is
not decoration: listing is not verification, there is no published standard
for verifying an organization, and without the sentence the nav bar makes, on
the project's behalf, exactly the kind of claim the site otherwise refuses to
make. It is served from the API **alongside the rows** rather than living only
in a template, so a client cannot render the directory without the sentence
that qualifies it.

## 8.8 · The audit trail

`role_audit` is append-only, written in the same transaction as every change,
on four axes: `system`, `organization`, `flag`, `owner`.

**Both directions, always.** "Revoked moderator, granted user" reads as two
halves of one change and answers a different question from a single line
saying the end state.

### The second way in, now closed

`ADMIN_EMAIL` once promoted whoever signed in with that address to
administrator, on **every** sign-in. That did not merely mint the first admin
— it **silently reversed any later demotion**, and it wrote no audit row,
against the one rule `src/roles.js` exists to enforce. Whoever could write
`.env` already had a shell, so it was never a hole; it was an **ungoverned
grant that left no trace**, which is worse in an archive that has to be able
to say who granted what.

**Signing in now never changes a role.** Appointing an administrator is the
owner's alone. An existing admin is unaffected: sign-in simply stopped
*setting* a role, so everybody keeps whatever they hold.

`ADMIN_EMAIL` itself stays, as a **notification address and not a privilege** —
it is where volunteer applications and the feedback digest are sent.
`npm run configure` writes it empty into a new `.env` and says what it is for.

> **(drift)** `docs/specs/owner-vs-admin.md` in the operations repository still
> describes this path as live and unconditional, and recommends closing it. It
> was closed. That spec predates the change.

---

# 9 · How a report gets in

Two paths, and exactly two.

## 9.1 · The public form

1. `GET /api/reports/intake` — should the form offer itself at all? Two things
   must be true: the site is taking reports, and at least one logbook is open
   to take them. Somebody who fills in eleven cards and is refused at the end
   has been wasted, and on this form that person is often typing an account of
   something that just happened to them. The switch is enforced regardless of
   what any client does with this; the courtesy is not the rule.
2. `GET /api/logbooks` and `GET /api/logbooks/:slug` — which logbooks are
   open, and what each asks.
3. `GET /api/reports/consent-text` — the publication card's exact wording.
4. Uploads, if the logbook asks for files, begin **while the reporter is still
   typing**, authorised by a server-issued draft token (see §10).
5. `POST /api/reports` — validated against the spine and against that
   logbook's own questions, the form version resolved, the digest checked
   against known wordings. **Nothing enters the chain.** The validated
   submission is staged in `report_submission_tokens` and a confirmation link
   is emailed. 48-hour TTL. Returns `202`.
6. `GET /api/reports/confirm/:token` — the link. This is the only moment a
   report is created.

**Why staging exists:** an unverified email claim must never permanently
consume a chain slot. Anyone can type any address into the form; the chain is
what cannot be filled with somebody else's name.

Inside the confirm transaction:

- The token is re-read **and locked** (`FOR UPDATE`). Two rapid hits on the
  same link — a mail client prefetching the URL, then the reader clicking it —
  would otherwise both pass the check and create two reports, promoting the
  same files twice.
- Cleared files are resolved **inside** the transaction, so the manifest that
  gets hashed and the rows that get written are the same set. Anything still
  scanning, infected or unreadable at that instant is left behind, and the
  response **names what was excluded** rather than dropping it silently.
- The report row, the attachment rows, the `report_heads` row, the sealed
  contact details and the token's `confirmed_at` are all written together or
  not at all.
- Revisiting a confirmed link reports the report's current state, and
  deliberately **does not say which non-public state it is in** —
  pending, unknown, invalid and withdrawn all look identical, because a
  moderator can always revisit a decision and nothing is final.

> **A path that only runs when somebody clicks a link in an email is the path
> nothing reaches by accident.** Report confirmation was broken in production
> for three days under three green suites, because none of them walked a
> confirmation link. `scripts/confirm-selftest.mjs` exists for that. If you
> add another such path, aim something at it deliberately.

## 9.2 · Coordinator batch intake

The second way into the chain, for accounts collected offline — somebody who
filled in a paper form at a polling place cannot click anything and never
will.

**The gate is different, not absent.** What replaces the click is a named,
signed-in, accountable person attesting that they received this account and
transcribed it faithfully, recorded with a timestamp and **sealed into the
report itself**. Without that, a bulk-entered report would be
indistinguishable from a fabricated one.

The sealed provenance block, written only on this path and only when complete:
`third_party: true`, `filed_via` (the organization's **name as it was at
filing**, so a later rename cannot change what a sealed report says),
`intake_method` (one of `paper`, `phone`, `in_person`, `email`, `other`),
`attested_at`, and `collected_on` when the coordinator knew it — the date the
account was collected is not the date it was typed up.

A database `CHECK` enforces that the block is complete or absent entirely.

**Staging exists because bulk entry produces typos.** A coordinator creates a
batch, adds drafts, edits and deletes them freely, reviews the whole batch, and
only then submits. Nothing reaches the chain until they say so explicitly.

A coordinator may only file for organizations they are a coordinator or
manager of.

## 9.3 · What closing intake does and does not do

`intake_enabled` is the other end of the site from the publication switches.
Two independent switches, neither implying the other:

| Intake | Publishing | Use |
|---|---|---|
| open | off | collect now, decide about publishing later |
| closed | on | the window has shut, the record stays readable |
| off | off | a deployment standing by |

That middle arrangement is what this was built for: a deployment used as an
intake system, where something else entirely is responsible for what gets said
publicly.

Closing intake **does not** hide, unpublish or delete anything already filed;
does not stop a moderator working the queue; and **does not stop a reporter
correcting a report they have already filed.** A correction is an amendment to
a record the archive already holds, not a new account of a new thing —
refusing it would leave the archive knowingly holding a version its own author
says is wrong.

Both doors that create **new** reports are closed: the public form and
coordinator batch entry.

**Never hashed.** A report must not verify differently because the form was
closed after it was filed.

---

# 10 · Attachments

## 10.1 · The goal

Not "add file uploads". It is: **extend the existing evidentiary guarantees to
bytes, while extending the existing privacy guarantees to the much sharper
disclosure risk those bytes carry.**

A photo of a polling place contains GPS coordinates, a camera serial number, a
timestamp the reporter did not choose to disclose, and the faces of bystanders
who never consented to anything.

## 10.2 · Nothing is published as the file that was uploaded

Three treatments, by family:

| Family | Types | Treatment |
|---|---|---|
| **Trimmed** | JPEG, PNG, WebP | a stream of labelled segments, so metadata is lifted out **without decoding a single pixel**. Nothing hostile is parsed beyond a length field. |
| **Decoded** | HEIC/HEIF, MP4, MOV, WebM, MP3, M4A, AAC, OGG, WAV, WebM audio | cannot be made safe by trimming — the location data is woven through a box structure whose offsets would all have to be rewritten. **Decoded and re-encoded**, so the published copy is built by our own encoder from pixels or samples alone and can only contain what we put in it. |
| **Rendered** | PDF | the one format where "we removed the metadata" is a claim that cannot be backed: embedded files, JavaScript, external references, the author's identity in half a dozen places, and no safe subset. **Never published as a PDF.** Each page is rendered to an image, and those images are what anyone sees. |

Trimming specifics: JPEG keeps APP0 only when it is JFIF (pixel aspect, not
identity) and drops APP1 (EXIF/XMP), APP2 (ICC/FlashPix), the rest of the APP
range and COM; once SOS is reached the remainder is entropy-coded image data
and is copied verbatim. PNG is an **allow-list** of chunks — tEXt, zTXt, iTXt,
eXIf and tIME all go. WebP drops the EXIF and XMP chunks and rewrites the
outer size.

**Office formats were never built and are not planned.**

## 10.3 · What a file really is

Type is **sniffed server-side from magic bytes**, never taken from the
browser's `Content-Type`, which is attacker-controlled in exactly the case
that matters. HEIC photos and MP4/MOV video share one ISO base media
container, and the brand in the `ftyp` box is what separates them — an iPhone
photo is `heic`, an iPhone video is `qt  `, an M4A voice memo is `M4A `. The
PDF header is accepted anywhere in the first 1024 bytes, as the spec permits
and every reader accepts.

## 10.4 · Three buckets, and what each means

The bucket boundary carries the publication boundary, because a single bucket
with per-object ACLs is one misconfiguration away from publishing an
unreviewed video.

| Bucket | Holds | Public |
|---|---|---|
| `S3_BUCKET_STAGING` | uploads in flight, in the clear, transient | never |
| `S3_BUCKET_EVIDENCE` | **everything before publication, encrypted** — originals and cleaned copies both | **never, ever**. No presigned read is issued to a browser. |
| `S3_BUCKET_RENDITIONS` | **published material, plaintext** | an object appearing here *is* the publication decision |

The two are not "raw" and "cleaned". **The renditions bucket keeps its
meaning: public material only, nothing else, ever.** That is what makes it
safe to reason about.

**No presigned URL to an original, ever** — a presigned URL bypasses every
piece of middleware in the app, including the site-access gate.

## 10.5 · The pipeline

```
Browser ──PUT──▶ staging ──pulls──▶ media worker ──▶ evidence (encrypted)
   ▲            (in the clear)      (child process:        │
   │                                sniff · scan · strip   └──▶ renditions
presigned                           or re-encode · encrypt)      (on publish,
PUT grant                                    │                    plaintext)
   │                                         ▼
Express app ◀──manifest into content_hash── Postgres
(no payload bytes)
```

1. **Request a slot** — `POST /api/uploads`. The app checks the type against
   what the code supports **and** what an administrator has left switched on,
   checks the size against that family's cap, and enforces the per-draft
   quota, **before any URL is issued**. This endpoint is reachable with
   nothing but a draft token — the same unverified position the form itself is
   in — so an attacker who never confirms an email must not be able to park
   bytes in the bucket.
2. **Upload direct to storage.** Large bodies never traverse the app process;
   `express.json`'s 256 kB limit stays exactly where it is.
3. **The worker claims it** — a conditional `UPDATE`, so two overlapping
   passes cannot process the same file twice. It runs from cron, one pass per
   invocation, no daemon to supervise.
4. **Encrypt and promote.** A per-object DEK; **both** the original and the
   cleaned copy encrypted under it into the evidence bucket; the DEK wrapped
   under the master key; the staging object deleted.
5. **Confirm.** The reporter clicks the link, and the manifest of clean files
   lands in `content_hash` in the same transaction as the report.

**Never do any of this in the app process.** ffmpeg, ImageMagick, exiftool and
the HEIC and PDF libraries are memory-unsafe parsers being fed files chosen by
an adversary who would very much like this site down on election day. A
malicious video that segfaults the worker costs one queue item; the same video
inside the app takes the whole site, and anything sharing the box with it.

So: always a child process, always `execFile` with an **argument array** and
never a shell string, a wall-clock timeout with `SIGKILL`, an output size
ceiling, and no network. Everything works through temp files rather than
buffers.

## 10.6 · The manifest, and what it commits to

An ordered list, one entry per file: `{ordinal, sha256, byte_size,
media_type}`. **Null, not `[]`**, when there is nothing — an empty array hashes
differently from an absent key, and that is the single most important line in
`src/attachments.js`.

It commits to **what the files are**, never to whether they are published.
That asymmetry is what lets the reporter's attachment permission and the
moderator's decision both be revocable without touching a fingerprint.

The claim the system can then make is precise: *this exact file, byte for byte,
existed and was associated with this report before this timestamp.* The same
claim the text already makes.

**A moderator refusing to publish a file never removes it from the manifest.**
Refusal is a flag on the mutable head; the digest stays in the chain forever.
The archive records that the file was submitted even when the public never sees
it, and that asymmetry is exactly what makes the published counts trustworthy.

**Adding a file to an existing report is a correction**, with everything that
follows (§5.2).

## 10.7 · Limits

**Every upload limit is something an operator sets**, in three layers, and
the order is the point:

| | |
|---|---|
| **the logbook** | a column there, `NULL` unless somebody set it |
| **the site** | `site_settings`, `NULL` unless somebody set it |
| **the shipped default** | where the old constants went |

> **An environment variable is not an operator control.** It needs shell
> access to a production box, it is invisible from the interface that is
> supposed to describe the deployment, and nothing records who changed it or
> when — so in practice the person who runs the archive could not change
> these, and the person who could was not the operator. Migration 038 moved
> them.

| Limit | Shipped default |
|---|---|
| Image | 25 MB |
| Video | 150 MB |
| Audio | 60 MB |
| Document | 30 MB |
| Document pages | 40 |
| Video/audio duration | 180 s |
| Files per report | 10 |
| Total per report | 400 MB |
| Staged slot TTL | **24 h**, matching the confirmation link |
| Transcode timeout | 5 min (`MEDIA_TRANSCODE_TIMEOUT_MS`) |

A page count as well as a byte count, because a small PDF can still be nine
hundred pages, and every page becomes an image somebody has to store and a
moderator has to look at.

Two refusals are phrased differently on purpose: a type the code cannot handle
is "we do not take that"; a type an administrator has switched off is "we are
not taking that at the moment". Telling somebody their file is unsupported
when it is merely disabled sends them away converting a file for no reason.

## 10.8 · Slot states

`pending → uploaded → processing → clean`, or one of the failures.

| Group | States | Told to |
|---|---|---|
| withdrawn | `withdrawn`, `expired` | nobody — not news to the reporter, not a moderator's business |
| refused | `rejected`, `infected`, `unreadable` | **both** the reporter and the moderator |

## 10.9 · Moderating a file

- **The cleaned copy is the default view.** Logged as a preview for oversight,
  needs no reason, and deliberately **not** shown in the reporter's own
  history, where it would be noise.
- **The original needs a grant** — a written reason, minimum ten characters,
  validated rather than merely required. It writes an `attachment_original`
  row, and that kind **is** shown to the reporter: they are told a moderator
  opened their original, and why.
- **Decide on the rendition, not the original.** What can be published is the
  stripped derivative.
- **Alt text is required to publish.** An accessibility obligation, and it
  doubles as a check that somebody actually looked at the file.
- **Default publication is `withheld`.** The file exists in the archive from
  the moment it is promoted, and is publishable by nobody until a moderator
  says otherwise.
- Admin-only: **erase** a file — null the wrapped DEK and stamp the
  destruction time.

Taking a file down removes it everywhere it exists: the public bucket, its
poster, and the local cache. Every step swallows its own failure deliberately,
because storage being down must not leave the row saying "published" when the
decision was to stop.

## 10.10 · The media cache

Every public view of a photo or video would otherwise pull bytes from object
storage, and a video being scrubbed generates a fresh ranged request per seek.
A local disk cache fixes that — but **what** is cached is the important part.

The obvious approach, a proxy cache in front of the endpoint, would serve
cached responses **without running the app at all**, and the app is what
enforces the publication gate. A withdrawn report's video would keep being
served until the entry expired.

So the split is: the app still answers every request and re-runs every gate (a
cheap indexed query), and **only the bytes** are served locally. Withdrawal,
refusal and erasure take effect on the very next request.

**Only published renditions are eligible.** Moderator views of originals are
never cached: those are audited, unpublished, and often the most sensitive
thing in the system — writing them to disk in the clear to save bandwidth
would be a bad trade.

## 10.11 · Moderation is the real bottleneck, and the project says so

The storage bill is tens of euros a month. The human cost is what can break
the feature, and no amount of infrastructure fixes it.

Worked example from the architecture note, for a busy 72-hour national cycle:
25,000 reports, 40% carrying media at 2.5 files each, ~225 GB ingested, ~€1.40
a month to store — and **≈310 person-hours of review** at 45 seconds a file.
Ten volunteers on six-hour days clear that in five days; the bytes arrive in
three. **The queue is structurally behind from the first hour**, and a
coordinated flood of plausible junk media aimed at exactly this bottleneck is
a cheap and obvious attack.

The design implication, already taken: **publish text on its own schedule and
let media trail it.** A report reaching the board with "2 files submitted,
under review" is honest, is useful to a reader immediately, and decouples the
fast path from the slow one. Holding the whole report until its video clears
converts a media backlog into a reporting blackout.

**(unverified / planned)** Triage beyond chronological — incident grouping of
media review, perceptual-hash duplicate detection, credentialed-observer
ordering — is designed, not built. Incident grouping exists for reports
(§11.3); batching *media* review by it does not.

---

# 11 · Moderation

## 11.1 · Nothing is public until a moderator approves it

There is no auto-publish path and there must not be one.

## 11.2 · One axis, since the verdict was withdrawn

`moderation_status` answers **"should this be published?"** — and that is the
only judgement the software records about a report now.

| `moderation_status` | |
|---|---|
| `pending` | not yet looked at — the default, and where a correction returns a report |
| `valid` | approved for publication |
| `invalid` | declined |
| `unknown` | reviewed, no decision |

### The editorial note

What replaced the verdict. One per report, **off unless a logbook turns it
on** (`logbooks.editorial_notes_enabled`, migration 036).

| | |
|---|---|
| **What it is** | the archive's own written statement about a report it published |
| **Who writes it** | the moderator who made the publication decision |
| **Byline** | a **house** one. The author is recorded and never served: `publicNoteFor` does not select `author_email`, and the suite asserts it |
| **Format** | plain text. A blank line starts a paragraph; there is no other formatting — see below |
| **Hashed** | **no.** Journalistic care includes correcting things, and a note frozen at publication is a mistake nobody can fix |
| **Versions** | append-only at the database. Every one is published, so a change shows as a change; the current note is a projection over them |
| **States** | `published`, `under_review`, `withdrawn` |
| **Citations** | title, publisher, date, URL, beside the note. `removed_at` rather than DELETE |

**A withdrawn report does not take its note.** If a note followed its report
automatically, pressuring a reporter would become a way to erase the
editorial record — the suppression route the chain design exists to close.
Taking a note down is an admin decision that gets logged.
`under_review` is for a note whose author was removed for breaching the
charter: visible as such, not deleted, because silent removal is the thing
this archive exists to prevent and that applies to our own material too.

**It is plain text and not markdown, and that was a dependency decision.**
The design asked for restricted rich text or markdown sanitised on render.
Doing that honestly needs a parser and an HTML sanitiser; this application
has seven dependencies, and an HTML sanitiser is the kind that earns CVEs —
on a surface where the input is staff-authored and the output is public. A
source that needs citing goes in the citations table, where it is checkable,
rather than as a link buried in a sentence. Revisit when a note genuinely
needs one inline.

`src/editorialNotes.js` is under the same import ban as
`src/reportPermissions.js`: `reportCore.js`, `verify.js`, `chainFile.js` and
`snapshot.js` may not see it, or a report would verify differently after an
editor fixed a sentence.

### `veracity` is withdrawn — 4 October 2026

There was a second axis answering **"what do we think is actually true?"**,
with six values from `pending` to `proven_true`, printed on the public board
as a coloured chip.

**It is gone, and the reason is the whole point.** A one-word verdict about a
named third party is the archive publishing its own factual assertion, and it
is the hardest kind to defend — "Likely true" over an account that identifies
a polling official by role, place and time is this deployment asserting
something about that person that no court, no regulator and no editor has
stood behind. The exposure does not disappear with the verdict: it moves to
an **editorial note**, written and signed by the moderator who made the
publication decision, which is a considered statement somebody can defend.

What was removed: the route that set it, the filter on both boards, the chip
on the card, the six-option modal, and the vocabulary in `src/taxonomy.js`.

What stays, and why:

- **`report_heads.veracity`**, written by nothing. Migrations are additive,
  and migration 035 is a `COMMENT ON COLUMN` saying so.
- **`published_reports.by_veracity` in `/api/v1/stats`.** `public/api.html`
  promises that an existing field is not renamed, retyped or removed without
  a `/api/v2`, and breaking that quietly would stop somebody's dashboard with
  no way to tell them. It reads `pending` for everything — not a placeholder
  but the true count, since nothing assesses veracity. api.html says exactly
  that, and says the field goes at v2.
- **The breakdown is still counted from the column** rather than hardcoded to
  zeros, so a deployment that recorded verdicts before the withdrawal goes on
  reporting them honestly. Zeroing it would be this software rewriting a
  deployment's own history on deploy, which is the one thing it exists to
  make impossible.

`assessed_severity` is a third, separate judgement: `note`, `irregularity`,
`serious`, `systemic`. A moderator's judgement, kept on the mutable head,
never inside a report's seal.

## 11.3 · Incident grouping and corroboration

A moderator may group reports under a shared `incident_id`. The board shows a
**corroboration count** — how many *published* accounts describe the same
incident.

Counting only published ones keeps the number the moderator sees identical to
the number a reader sees, **so there is no private inflated figure.**

## 11.4 · The three publish gates

All three must be open for anything to be public:

```
h.withdrawn = false AND h.moderation_status = 'valid' AND r.may_publish = true
```

| Gate | Whose answer | Where it lives | Changeable |
|---|---|---|---|
| The reporter's | the reporter's, at filing | **inside the fingerprint** | never |
| The moderator's | a moderator's judgement | mutable head | yes |
| The operator's | `public_archive_enabled` | `site_settings` | any day |

A reporter permitting publication does not oblige a deployment to publish. A
deployment willing to publish cannot publish what the reporter did not permit.
Neither substitutes for the other, and neither substitutes for a moderator.

Files add a **fourth** gate of their own, per file, plus the reporter's
revocable attachment permission read at the moment of publishing.

The operator's switch resolves `NULL` to **on**, because that is what the
software already did and a migration must not empty a running board.
`distribution_enabled` resolves `NULL` to **off**, because nothing
distributes and no deployment may start because a column defaulted. A database
that cannot answer falls through to those documented defaults rather than
changing what either switch means.

**`PUBLICATION_OFF` answers 200 with `published: false`**, not 404 or 403. A
deployment that has switched publication off has not lost its archive and is
not refusing this particular caller — it is telling anybody who asks that it
does not publish, which is a true, useful and renderable answer. A 404 would
say the route is gone; a 403 would say come back with credentials.

## 11.5 · What a moderator can do

| Action | Notes |
|---|---|
| Read the queue | filterable by status, searchable; `all` is the default, because a moderator opening the page wants the whole picture |
| Open Tier B | written reason, logged, shown to the reporter |
| Set moderation status | |
| Set severity | |
| Group under an incident | |
| Withdraw / restore | |
| Review, publish, withhold or refuse a file | alt text required to publish |
| Read the audit log | admin only, and the read is itself logged |
| Erase a file's key | admin only |

Every action that changes a judgement writes `self_service_log` (append-only)
with a mandatory written reason.

## 11.6 · What a moderator cannot do

- Publish files whose reporter did not permit it.
- Grant a reporter's permission on their behalf.
- Edit or delete a report.
- Change an owner's or an admin's role.
- Publish Tier B. The standing position is that Tier B stays moderator-only
  regardless, and publishing identity on the public board **is not offered at
  all** — it would reopen the two-tier promise for everyone who already filed,
  and it is the highest-harm act in the system.

**(unverified / not built)** A documented escalation route out of the normal
queue for CSAM and credible violent threats — a hard publication block and a
preserved encrypted original — is called for in the architecture note and does
not exist as a mechanism. Also not built: a face-blur tool in the review UI.

---

# 12 · What the public sees

## 12.1 · The board

Published reports, newest first by default, **limit 500**.

### Nothing is filterable unless an operator said so

There is **no built-in date or location filter**, and there must not be. Where
and when are field types, not fixed parts of a report.

A filter exists on the board only when the operator marked that question
`filterable` in the builder **and** its type can carry one (8 of the 13 can).
A `filterable` flag on a type with no filter control would be a setting that
silently does nothing.

### Search

Full-text, over **every string in a report's answers** plus its public
reference, through a GIN index on exactly that expression.
`websearch_to_tsquery` rather than `to_tsquery`, because it accepts whatever a
human types — quoted phrases, OR, exclusions and stray punctuation all parse
instead of throwing a syntax error at the user. 200-character cap.

> The expression in `src/reportSearch.js` must stay **character-for-character**
> in step with the index in migration 029. Postgres matches an expression index
> by its expression tree, so a drifted column list silently falls back to a
> sequential scan rather than erroring.

## 12.2 · Statistics, and two rules

`/api/stats`, `/api/v1/stats`, and the Numbers view.

**1 · No bare total.** Every count arrives already broken out — by
disposition, logbook, and within a logbook by the questions its
maker marked as filters. A number quoted from this endpoint carries its own
qualification, **because there is no unqualified number available to quote.**
A live counter of "election incidents" stripped of context is a
misinformation vector, and the structural fix is to not publish one.

**2 · The denominator is visible.** Counts of declined, still-under-review and
withdrawn reports are published alongside the approved ones, with no content
and no identity. Every confirmed report occupies a chain slot regardless of
outcome, so this exposes what the chain already records. **It converts "trust
our moderation" into "audit our moderation":** anyone can compute the approval
rate over time.

A report whose reporter did not permit publication **still contributes** a
fingerprint, a chain position and a number to the public figure. Deliberate,
and the card's wording promises no more than that.

**Never-confirmed submissions are absent by design** — they never entered the
chain, precisely so nobody can burn chain slots in somebody else's name. That
asymmetry is stated rather than left silent.

## 12.3 · CSV export

Published reports only. Carries the corroboration count, `recipe` and
`chain_hash`.

**One column per question, but only when the export is narrowed to a single
logbook** — only then is there one field set to name. Across several, the
questions are different questions that happen to share a key, and a column
meaning one thing in some rows and another in the rest is worse than a column
of JSON that means exactly what it says.

The header is the field **key**, not its label, because the key is what the
seal carries, so a reader can line the CSV up against a verified report. An
absent answer is an empty cell, which is all a spreadsheet can say either way.

**(unverified / not built)** The architecture note argues the export should
carry attachment counts and digests but **not** URLs — a digest is verifiable
forever, a URL is a promise about hosting this project should not be making to
a journalist re-publishing a spreadsheet. The current export carries neither.

## 12.4 · The public API, v1

In front of the site password, which nothing else under `/api` is. **An
endpoint other people build against is not public if it is behind a password
only testers have.**

| Route | |
|---|---|
| `GET /api/v1/` | a self-describing index, so somebody who finds the address without the documentation still knows what they have |
| `GET /api/v1/stats` | aggregate counts, cached 60 s |
| `GET /api/v1/consent-texts` | every wording of the publication question this site has shown, by digest — how a sealed digest is read back |

**The shape under `/api/v1` is a promise.** Fields may be added; existing ones
are not renamed, retyped or removed without a `/api/v2`. Somebody's dashboard
should still work in a year, and there is no way to tell them it broke.

CORS is wide open for reads: public data, no cookies accepted or sent, nothing
here is a write, so there is nothing for a hostile page to forge. 120 requests
a minute, generous because it is meant to be used, and the cache behind it
means most never reach the database.

Data licence stated in the index: CC BY 4.0, with attribution — **scoped to the
counts and the consent wordings these endpoints actually serve**, and explicitly
not to report content. A blanket "the data is CC BY 4.0" was a licence the
operator cannot grant: a report is its author's account, published with their
permission, and that permission is not the operator's to pass on. Nothing under
`/api/v1` serves report text, so the scoping restricts nothing that worked
before; it stops the index claiming a power it never had.

## 12.5 · Other ungated surfaces

| Path | Why it is outside the gate |
|---|---|
| `/api/health` | so a deploy check can ask |
| `/api/site-access/*` | the gate itself |
| `/api/lists/*` | each list decides: one an administrator set to work without the password (`outside_access` link or door, migration 047) is usable by anybody; every other one answers exactly what the gate would. The volunteer form is such a list. |
| `/api/forget/:token`, `/api/list-mail/:token` | the pages emailed links land on — deleting what you wrote, and agreeing to receive a list's entries. A right is not behind a password, and a GET on either changes nothing. |
| `/api/doors` | the titles and addresses of what is open without the password, for the password page |
| a narrow allow-list for logbooks opened without the password | filing only: the form, the report POST, uploads while such a logbook takes files, and the confirmation link. `outsidePass` in `src/doors.js` is the whole list; the board and everything else stay shut. |
| `/api/v1/*` | see above |
| `/app` | install instructions somebody followed a link to see |
| `/docs` | how to stand one of these up — the link you hand to somebody *not* let past the curtain |
| `/styleguide` | a page about the design, holding no reports and no settings |
| `/manifest.webmanifest` | a locked deployment still has to be installable from its lock screen |

Everything else under `/api` sits behind `requireSiteAccess`.

`/api/logbooks` is **behind** the gate, deliberately. It was briefly in front,
on the reasoning that a form must render before anybody signs in — but
`/api/reports` is gated, so a reporter is already past the curtain by the time
a form is any use, and serving it in front would hand every passer-by the
titles of a deployment's intakes and the shape of their questionnaires.

**(known gap)** `/api/site-access/status` exposes `devMode` before the
password. Deliberate, and still build state given away free.

## 12.6 · Printing

A reporter can print a report under 28 U.S.C. § 1746 as an unsworn
declaration. The print sheets have their own stylesheet rules.

## 12.7 · The press kit

`/api/press` serves a small set of fixed descriptive texts about the software.

---

# 13 · Notifications and email

**Mail is not optional in practice.** Without it no reporter can confirm a
report. With no mail set up at all, the one-time sign-in and setup codes are
printed to the service log on purpose — enough to finish setup from a shell,
and nothing more. With mail set up and failing, the code goes nowhere and
nobody can sign in.

Two transports. **SMTP is the portable one** — any provider, a relay you
already run, or your own host — and is what `npm run configure` offers first.
Scaleway's HTTP API remains because a deployment already uses it. `log` can be
forced on a staging box that must never send real mail.

`sendEmail` returns `{ sent, reason }`, and `reason === 'no-api-key'` is
load-bearing in six callers: it means "this deployment cannot send mail at
all" and must keep meaning exactly that whatever transport is chosen.

## 13.1 · Digests

Hourly and weekly, one email per subscriber, new published reports since their
last send.

**People follow logbooks.** `notify_logbooks` is a list of slugs, or NULL for
every logbook. There is no built-in "state" to follow — a state is a question
some logbook asks.

**Only what the board would show.** A subscriber is a member of the public, so
a digest carries exactly what the public board carries: approved, not
withdrawn, the reporter **permitted publication**, and this site publishes an
archive at all. The digest once checked only the first two, and so emailed
reports whose reporters had said no.

Each report prints its answers in the logbook's order and in the words the
reporter read. A key with no question left to name it is shown under its key
rather than dropped.

---

# 14 · The frontend

## 14.1 · No build step, and there must not be one

Nothing is compiled, bundled or minified. What is in the file is what the
browser runs, which is why you can read a stack trace and land on the line
that threw.

## 14.2 · Every pane is in the DOM from the first byte

That is **not** a performance choice. While the site is gated, the lock screen
is the only thing between a visitor and the site's writing, and a pane fetched
on demand would be a pane the gate has to be trusted never to fetch. So the
markup stays in one file (~2,570 lines) and only the rules and the code came
out.

**While gated, `popstate` must never route.**

23 panes: home, submit, dash (the board, with reports / numbers / check
views), about, how, standards, alliance, impressum, privacy, login, mine,
notify, issues, intake, org, portal, mods, admin, access, confirm, invitation,
report, list (a list's form, at /list/:slug). The volunteer pane is gone:
/volunteer, /involve and old confirmation links land on /list/volunteer.

Client-side routes are real URLs. Several old addresses are kept resolving
deliberately — `/stats`, `/verify`, `/about/technical`, `/about/using`,
`/involve`, `/updatenotes`, `/press` — because **a link somebody saved six
weeks ago arriving somewhere sensible costs one comment; a 404 costs their
trust in every other link we gave them.**

## 14.3 · The Content-Security-Policy

```
script-src 'self'; style-src 'self'; object-src 'none';
base-uri 'self'; form-action 'self'; frame-ancestors 'none'
```

`script-src 'self'` with **no** `'unsafe-inline'` is only possible because no
page in `public/` carries inline script. The usual escape — a per-request
nonce — is not available, because in production a reverse proxy serves
`public/` straight off disk and most pages are never rendered by this process.
A policy that had to allow `'unsafe-inline'` would be most of the way to no
policy at all, and **this app writes other people's words into the DOM in over
a hundred places.**

`style-src 'self'` likewise: four inline `<style>` blocks moved into files,
and all **44 inline `style` attributes** were removed. Static ones became
classes; eighteen `display:none` became the `hidden` attribute with the
JavaScript changed to set `.hidden`; the three a script must compute are set
**through the CSSOM**, which the directive does not govern. `npm test` fails on
a `style=` in any page or script string.

**What is deliberately not there:** no `default-src`, so images, media and
fetches are unrestricted. Uploads go browser-to-bucket and attachments come
back from that bucket, whose origin is a per-deployment setting — a directive
naming it cannot be written once and shipped, and one guessed here would break
somebody else's installation in a way no test here would catch. The four
directives beside `script-src` cost nothing and were each checked against the
markup first: there is no `<object>`, no `<base>`, no iframe and no
cross-origin form anywhere in `public/`.

**Set twice** — in `server.js` and in the shipped proxy config — because in
production the proxy answers for `public/` and the app never sees those
requests. `npm test` reads both and fails if they disagree. Inside a proxy
`location` block, one header declaration replaces every header inherited from
the server block, so a location that sets its own `Cache-Control` has to carry
its own copy of the policy; the suite checks there are at least two.

## 14.4 · Escaping

The old code was one closure, so its 336 names were private. In modules,
**`esc` is the name that matters**: every one of the 135 places this app writes
somebody else's words into the DOM goes through it, and a global `esc` is a
function that page-level code could replace with `s => s`. In a module it has
no name from outside.

Exactly two things are deliberately on `window` (`STEPS`, `howtocLabel`), and
the suite fails on a third.

## 14.5 · Modules

22 ES modules, all listed in `index.html` rather than reached through one
entry point — a module whose only job is to wire a listener would never be
reached, and the browser would discover files one waterfall at a time instead
of fetching them all at once.

The import graph **has cycles**, because the real thing does: a screen calls
the router and the router shows screens. That works because nothing reads an
imported value while its own module is still being evaluated. **Do not read an
imported variable at the top level of a module** — call a function that reads
it instead.

Mutable state lives where it is written, because a module cannot assign to a
binding it imported.

## 14.6 · Stylesheets, in load order

| File | Decides |
|---|---|
| `fonts/fonts.css` | the typefaces, served from this server rather than Google |
| `tokens.css` | **the look** — every palette and every theme |
| `css/page.css` … `css/numbers.css` (11 files) | this app's own components, by subject |
| `client-first.css` | **the layer** — structure, spacing, the type scale. No colour, no shape. Loaded last so a utility class beats a component's own rule. |

The middle files are **one contiguous slice each** of the single `<style>`
block they came out of, in the order they were in. That is the whole reason
the split was safe: no rule moved past any other rule, so the cascade is what
it was. **Moving a rule between them can change a screen.** Add rules to the
file whose subject they are; do not reorder.

`public/index.html` was 10,455 lines — markup, a 1,374-line style block, and a
6,540-line script holding every screen.

## 14.7 · The Client-First layer

`client-first.css` is written to Finsweet's Client-First naming conventions
(the ones Relume is built on), so a layout copied out of Relume lands with its
class names already meaning something. **It holds no design decisions of its
own**: every colour is a palette token and every shape is a theme token, and
the suite asserts both.

Four structure classes, in this order, always: `page-wrapper`,
`main-wrapper`, `padding-global` (the gutter, set in one place, carrying the
safe-area inset), `container-small|medium|large` (the measure — large is the
**theme's** width), `padding-section-*` (air above and below a band), and
`section_<name>`.

Rules:

- **Never type a colour.** Not a hex, not `red`. If the colour you want is not
  a token, it belongs in the palette.
- **Never type a radius, a font family or a page width.** Those are the
  theme's, and a theme that could be overridden here would stop being a
  finished opinion.
- **Never add a value between two steps of a scale.** A `1.25rem` where the
  scale offers `1rem` and `1.5rem` is a value somebody typed by eye, and the
  next one will be `1.3rem`.
- **Never style a bare element.** Every selector is a class, which is the only
  reason it was safe to load before a single screen used it. The one fenced
  exception is prose inside `.text-rich-text`.
- **Never remove a focus outline.** Make it legible instead.
- Spacing takes **two** classes, a direction and a size; the direction class
  zeroes the three sides you did not name.
- Type says *how*, the tag says *what*. A screen often needs an `h2` that
  reads quietly, and the wrong fix is to make it an `h4` and break the outline
  a screen reader announces.

`/styleguide` draws every colour, size and component on one page, with the
class names that made each one, and a bar that changes the palette and the
theme so the whole thing can be watched following.

## 14.8 · The look system — two axes

| Axis | Owns |
|---|---|
| **Palette** | every colour |
| **Theme** | type, borders, shadows, radii, spacing **and width**. No colour at all. |

**18 palettes × 6 themes = 108 combinations, none of which had to be drawn.**
Nine light palettes, nine dark. Six themes, each stating its own `--page-max`
(720–1080px).

- **A theme may not name a colour.** `npm test` reads every `[data-theme=…]`
  block and fails on a hex, an `rgb(`, or any mention of `--color--`. A theme
  that reached for colour would make the two axes fight.
- **Status colour is meaning, not brand.** Crimson is serious or an error;
  teal is *a moderator confirmed this*. Every palette restates the same three
  values rather than inventing its own, because a confirmation that changed
  colour with the decor would stop being a signal. The suite asserts it by
  reading the CSS.
- **No colour maths, here or in the browser.** The palettes are hand-authored
  and were checked for contrast where they were written. Nothing computes a
  shade at runtime, so nothing can compute an unreadable one.
- Palettes and themes are **plain attribute selectors**, not
  `:root[data-palette=…]`, so any element can carry one and everything inside
  inherits the tokens — which is what makes a real live preview possible with
  no iframe, no second copy of the stylesheet and no gate problem.
- **There was a third axis, `layout`, and it is retired.** Width belongs to the
  theme. Three axes made 216 combinations, twelve of them theme-and-width
  pairs nobody had authored, one of which — a typewritten record at 1140px —
  was a bad idea an operator could simply pick. The answer to "I wanted
  Docket wider" is **another theme, not another axis**, and adding one is
  additive. `site_settings.layout` still exists, read by nothing; migration
  021 is a `COMMENT ON COLUMN` and nothing else, because the next person to
  read the schema will find the column and reasonably assume something
  honours it.

## 14.9 · One card asks one question

And **nothing on the card in front of somebody changes underneath them.** No
auto-advance on selection. If an answer changes what gets asked, that happens
on the next card.

This is the rule most likely to be quietly broken by somebody tidying up the
form later, which is why it is in the card's own comment as well as in
`CONTRIBUTING.md`.

## 14.10 · A deployment's own name

An administrator sets it; `SITE_NAME` is the fallback; the software's own name
is the last resort. It appears on every page, in the browser tab, on the lock
screen and in the mail the site sends.

**The software stays called ReportLog and the footer says so** — the ordinary
arrangement for self-hosted AGPL software, and it keeps attribution where a
reader can see it. A deployment naming itself is not a deployment claiming to
have written this.

Two things a static file server cannot give a deployment, so they are rendered
or built per request:

- **`/` is rendered, not sent from disk**, so the browser tab carries the
  operator's name in the **first frame** instead of flashing the software's and
  being corrected by script. `express.static` is configured with
  `index: false` so it cannot answer `/` from disk — otherwise the one route
  that matters most would be the one route still saying ReportLog.
- **The web app manifest is built per deployment.** It was a static file, so
  installed to a phone's home screen **every** deployment's icon was labelled
  ReportLog — the one branding surface no amount of client-side painting can
  reach, because the browser reads the manifest itself. Its two colours are
  **parsed out of the stylesheet** rather than restated, so a palette edit
  cannot leave the phone's status bar painted the old colour.

`assertAnchors()` runs at boot and **fails the process** if the substitution
points it needs are missing. Substitution that silently matches nothing is the
failure mode this whole arrangement exists to avoid, so it is checked once,
loudly, on the way up.

## 14.11 · Site copy

Nine plain-text slots: `home_headline`, `home_lede`, `home_intro`,
`about_archive`, `submit_intro`, `board_intro`, `how_intro`,
`alliance_intro`, `standards`. (`volunteer_intro` went with the volunteer
pane; the volunteer list's description does that job now.)

**Numbers in the wording.** `{{ [figure.id] }}` in any slot becomes a figure
when the page is served, and the braces take arithmetic: `+ - * /`, brackets,
`round(x, places)` and `percent(part, whole)`. Parsed, never evaluated —
`src/figures.js`. Only figures already public are offered: reports filed and
published (as `src/stats.js` counts them), per logbook, and the counts of
lists whose counts are published and that are listed. The editor's "Insert a
number" menu lists them; a slot that names one that does not exist is
refused on save, and renders as "?" if it stops existing later.

**Not a page builder and not HTML.** Each slot is one piece of plain text,
published exactly as typed, in a place the design already put it. An operator
changes what the page **says**; they do not change what the page **is**. That
keeps the layout, the contrast and the print rules intact — the parts a person
writing their front page at midnight should not be able to break.

Adding a slot is a line in the list and an attribute in the markup. **No
migration**: the table is key/value precisely so another editable paragraph
never needs one. The suite checks the two agree, because a slot offered in the
editor with nothing on the page reading it is a text box that does nothing.

`NULL` means "use what ships" — which is **not** what the legal text does.

## 14.12 · The imprint and the privacy policy

Free text, and nothing else. A structured version was designed first — a mode
flag, a field list, include checkboxes, the notice assembled from parts — and
was **reversed deliberately**.

> What a legal notice must contain is decided by the jurisdiction the
> deployment is run from, and a field list is this software asserting that it
> knows which fields those are. It does not, it cannot, and being confidently
> wrong about it is worse than being silent.

So: no validation, no completeness check, no warning that something is
missing. There is nothing this software could check against.

**`NULL` is not an empty string.** `NULL` means nobody has written one yet,
and the public page says exactly that. A labelled outline is served to the
**admin editor** as prefilled text and is never published by itself — an
operator who opens the editor, reads the outline and never finishes must not
have published a dummy as their own legal notice.

100,000-character ceiling. Not a rule about content: a bound so the column
cannot be used as storage.

## 14.13 · The PWA

A service worker precaches the shell. **Bump `CACHE` in `public/sw.js` when
you change a precached file**, or a reader with the app installed keeps the old
one. `sw.js` is always revalidated.

**Not built.** The architecture note describes an offline IndexedDB upload
queue — photograph an incident with no signal, walk away, have the upload
complete when connectivity returns. There is no IndexedDB anywhere in
`public/`, so the service worker caches the shell and queues nothing. For a
poll observer in a precinct with no signal this is the difference between
capturing evidence and not, and it remains the strongest unbuilt item on the
reporter's side.

---

# 15 · Installing

## 15.1 · The procedure is not here

**[`INSTALL.md`](../INSTALL.md) is the canonical install guide** — the
prerequisites, the database, the certificate and the proxy, the service files,
backups, upgrading, and what to do when a step fails. It is written for
somebody who has not run a production server before, and on a running
deployment the same guide is at `/docs`.

This section covers the *reasoning*: why the install is split the way it is,
what each step is defending against, and what an operator can change
afterwards. For the order of operations, read that file.

A single-command installer is in progress and is not here yet.

## 15.2 · The two halves of an install

**`.env` is the developer's half. The setup wizard is the operator's half.**
That split is deliberate and it is in the right place.

What was wrong before `npm run configure` existed is that the developer's half
was a human copying values out of a documentation table into a file by hand —
which is how two irreplaceable keys get generated twice, pasted into a chat,
or quietly left the same on two deployments.

## 15.3 · `npm run doctor` — run it first, and after every step

Checks Node, the configuration, the database, the migrations, the media tools,
mail and object storage. For anything missing it prints the command for **your
system**, because a README does not know your distribution and the package
names differ in ways that matter — four of the six binaries come from a
package with a different name (`libheif-examples` on Debian,
`libheif-tools` on Fedora, `libheif` on Arch and macOS).

**It installs nothing and changes no files.** It is somebody else's server; a
script that installs packages and creates database roles without being asked
is exactly what a developer should distrust from security software, and being
right about the package names does not make it less rude. It detects, it
explains, and it prints a command the operator can read before they run it.

Besides the configuration, it asks the **running deployment** three questions
nothing in this repository can answer:

- whether the live proxy serves a Content-Security-Policy at all;
- **which of the five proxied paths the app actually answered, and which the
  proxy answered instead.** This is the check for the failure that returns a
  `200`: a path that exists both as a file in `public/` and as a route does
  not 404 when the proxy forgets it, so the deployment goes on serving a stale
  copy of something the app was supposed to build. The markers are deliberate
  properties of each route — `/api/health` answers JSON, the manifest route
  sets `Cache-Control: no-cache`, and the three `sendFile` routes are checked
  by the *absence* of the single-page app's own markup, since a missing block
  falls through to `index.html`. `whoAnswered` returns `unknown` as a distinct
  answer from `app`, because a green tick somebody relies on is worse than an
  honest "cannot tell".
- whether the timers are enabled, and whether there is a recent backup. A
  deployment that is not anchoring, or not backing up, **looks completely
  healthy**; those were each a timer somebody had to remember to enable from a
  list, and the anchor was once missing from that list.

It asks systemd `list-unit-files`, which changes nothing. The suite asserts
that it never calls a mutating `systemctl` verb, and that every unit it
expects is one that actually ships — in both directions, so a new timer cannot
be added without something checking whether it is enabled.

**(known gap)** `npm run doctor` checks `script-src` only, so it will not
catch a stale `style-src` directive in a hand-maintained proxy config. An
`include` of the shipped policy file is what keeps the two level.

## 15.4 · `npm run configure`

Writes `.env`. Asks only for what a person can **know** — the site's address,
the database, the email and object-storage credentials — and **generates the
two encryption keys itself.**

> Those two are irreplaceable: lose either and the data behind it is
> unreadable forever, with the ciphertext intact in every backup. They are
> **never prompted for, never displayed**, and exist only in that file. Back
> it up somewhere you trust.

A prompt invites a memorable answer, a paste into a password manager, or a
value reused from the last install. So the software never lets a human choose,
see or type them.

- It **refuses to overwrite** an existing `.env`.
- `npm run configure -- --check` reports what an existing one is missing
  without changing anything — including the case that matters most, **a
  half-filled section**, which looks configured in the file and behaves
  exactly as unset.
- `SITE_ORIGIN` has **no default and throws at boot** if unset. A wrong origin
  sends every reporter's confirmation link to somebody else's site, and does
  it silently, so this fails at the one moment an operator is looking. A
  trailing slash or a missing scheme is corrected rather than accepted.

## 15.5 · `npm run set-curtain-password`

**A fresh install is password-gated, and the gate comes up with no password
set — which means nothing matches it and nobody gets in, not even you.** That
is why this is a step and not an optional extra.

It asks for a password, twice, and refuses to finish without one (minimum 8
characters). **It never generates one for you:** a password nobody chose is a
password nobody read carefully, and this one is the only thing in front of the
deployment until the rest of it exists.

Failing closed is the deliberate choice throughout the gate. A missing
`site_settings` row reads as **gated**, not open — a missing row once read as
`access_enabled: false`, which took the gate off an entire deployment with
nothing on screen to say so. Failing closed costs an operator one confusing
password prompt; failing open costs them the whole site. The null password
hash is what makes that safe: no password can match it, so an unconfigured
deployment refuses everyone rather than admitting anyone.

**The gate is not authentication and is not a substitute for it.** It keeps an
unfinished deployment off the open internet; the archive is protected by
everything else.

## 15.6 · The setup wizard — eight screens

Hand over the URL and the curtain password. Opening the site and entering it
starts the wizard:

1. the owner's email address
2. a one-time code sent to it
3. what this archive is called — required, no default
4. what kind of archive this is — a starting point, which also makes a draft
   logbook; or Skip
5. whether it publishes an archive
6. whether people can attach files to a report
7. how it looks — palette and theme
8. **the curtain password itself** — keep it, or set a new one

Screens five and six **arrive set to what the software does if nobody
chooses, and say so**; seven starts on the default look. They can be read and
passed through.

**Screen eight has no default and no skip, deliberately:** otherwise a password
the installer chose stays live in somebody else's deployment and neither of
them notices.

**Every screen saves before the next is shown**, so a tab closed halfway keeps
what was already answered.

The account minted is the **owner** — one per deployment, the only one who can
appoint or remove an administrator, and a seat that cannot be granted.

The wizard runs **once**. Afterwards `/api/setup` refuses every change (its
status route still answers), and everything it set stays editable in Admin —
Site settings, Reports, Logbooks and Operations → Site access.

### The flag, and the bug that defined it

"Needs setup" is `setup_completed_at IS NULL` **and nothing else**. It was
first written as "has no admin", and running it is what showed why that cannot
work: minting the owner is step two of three, so the moment it succeeded the
wizard decided it was no longer needed and **refused its own last screen** —
the curtain-password decision, the screen the whole feature exists for.

The admin check still matters in the two places where it is the right
question: migration 008 marks an existing deployment complete so a wizard can
never open on a live archive, and the route that mints the account refuses if
one already exists. That check counts an **owner** as well as an admin,
because a deployment set up after migration 023 has no row with role `admin`
at all — and a check that missed that would reopen the wizard on a live
archive, which is the one dangerous thing here.

## 15.7 · Everything an administrator can change afterwards

| Setting | Notes |
|---|---|
| The site's name | 60 characters |
| The look | palette + theme, with a live preview |
| Ten copy slots | plain text |
| The imprint and privacy policy | free text, operator-owned |
| Publishes an archive | `NULL` → on |
| Distributes | `NULL` → off; **has always governed nothing** |
| Accepts reports | the intake switch |
| Attachments on/off, and which families | photo, video, audio, document |
| Site-wide upload freeze | the blunt instrument |
| Site access: gate on/off, password | |
| Logbooks | create, build, launch, schedule, close, freeze files, download, upload, chain |
| Lists | make from a template, switches (visibility, without the password, new-entry email, publish counts), questions, delete an unused one — `/api/admin/lists` |
| Roles, flags, desks | |
| Organizations, memberships, invitations, Alliance listing | |
| The owner's seat | propose, cancel, accept a handover |
| Dev-mode notice | an expiry, not a boolean |
| Feedback tracker | statuses, comments |

The attachment setting is **tri-state**: `true` and `false` are an admin's
decision, `NULL` means they have not made one so the environment answers.
**Storage being configured is never negotiable** — nothing an admin can press
conjures somewhere to put the files. A half-configured deploy that accepted
uploads it could not store would lose evidence silently, which is worse than
not offering the feature.

Attachment **families** are chosen rather than media types, because "photos,
video, audio, documents?" is the question somebody actually has, and picking
media types by hand invites allowing JPEG and forgetting that half of all
iPhone photos are HEIC. `NULL` means every family the code supports; an empty
array is a real answer meaning none, and is not the same thing.

Narrowing the list only ever affects **new** uploads. Turning documents off
tomorrow does not hide the PDF somebody filed today.

The dev-mode notice is stored as an **expiry** because a boolean left on by
accident quietly trains testers to ignore the notice, which is worse than
never showing it. An expiry switches itself off. It arms itself for 6 hours
when the build id changes at boot, since a deploy here is a pull and a
restart.

---

# 16 · Operating it

## 16.1 · Services

| Unit | Required? |
|---|---|
| the app | yes |
| media worker, every minute | **yes, if attachments are on** — without it an upload sits at "checking" forever |
| the daily anchor | yes, if you want the thing the project is for |
| the anchor watch | **yes** — a timer being *enabled* is not the same as the job *working*, and an anchor that fails every night looks identical to one that does not |
| the daily backup | **yes** — this archive cannot delete a row, which protects it from being edited and not at all from the disk dying |
| the hourly digest | **yes, once anybody subscribes** — they chose it in their own settings, and without the timer nothing is ever sent |
| the weekly digest | the same, with a week's window |
| the sweep | no — nothing breaks without it; the tables just grow |

**Eight units: one service and seven timers.** `install-units.sh` installs
whatever ships in `contrib/systemd/`, so a release that adds one is picked up
by running it again rather than by anybody noticing.

One command installs and enables all of them, substituting the path, user,
node binary and backup directory together: `contrib/install-units.sh`, with
`--dry-run` to read it first. It exists because the hand-typed list it
replaces was once missing the anchor timer, and a deployment that followed
that list never anchored.

**The anchor timer has been missing from an instructions list before**, so a
deployment that followed them exactly never anchored. Check rather than
assume.

The anchor needs two things the other units do not: it writes outside the
checkout and it pushes over ssh, so it needs a sandbox exception for both
paths and a deploy key with **write** access. A sandbox failure here happens
*after* the timestamp authority has been called, so it costs a real request
each time.

> **A systemd unit's sandbox is where ops bugs hide, and they are invisible by
> hand.** Two were found this way: the anchor could not write to one of the
> two directories it uses, and could not read its deploy key under
> `ProtectHome`; and the media cache defaulted under `PrivateTmp`, so it was
> discarded every invocation and shared with nobody. **Run the unit, not the
> command** — a hand-run proves nothing about the timer.

The media cache consults `CACHE_DIRECTORY` before any temp-dir fallback, for
exactly that reason.

## 16.2 · The sweep

Four tables hold short-lived secrets: sign-in codes, sessions, report
submission tokens, site-access tokens. **Every one is checked against its own
`expires_at` at the moment it is used**, so an expired row has never been
accepted and this is not a security fix.

What it fixes is that they were never deleted. A table of dead credentials
that only grows is a thing to hand an adversary who gets a copy of the
database, and a thing to explain to anybody asking what is retained and for
how long.

**None of the four is append-only**, and that is not an accident of which
tables got triggers: the archive is append-only because the record must be
permanent, and an expired sign-in code is not the record. The append-only
tables are not touched. `sweepExpired` **names its four tables explicitly**
rather than scanning for an `expires_at` column, so a future table cannot be
swept merely because it happens to have one.

## 16.2a · Backups

`npm run backup` takes a `pg_dump`, **reads it back with `pg_restore --list`
before giving it its real name**, and prunes to the newest `BACKUP_KEEP`
(default 14). `reportlog-backup.timer` runs it daily.

Three decisions worth knowing:

- **A dump in progress never has the real name.** One interrupted half way is
  a plausible-looking file of the wrong length, and the one moment nobody
  checks a backup is while taking it. Anything the directory lists has been
  read back at least once.
- **Pruning only ever touches files the script wrote.** A backup directory is
  somewhere a person also puts things by hand, and a retention job that
  deleted whatever it found would eventually take one of those. A `keep` of
  zero still keeps one, because a typo that deleted the dump it had just taken
  would have no recovery.
- **`.env` is deliberately not backed up.** Writing it beside the ciphertext
  it opens, on the same disk, turns two secrets into one and defeats the
  reason Tier B is encrypted at all. That copy is a human act, done once, to
  somewhere that is not the machine.

`BACKUP_DIR` must be outside the checkout and the script refuses otherwise:
git would offer to commit the archive, and under `public/` nginx would serve
it to anybody who guessed the name.

**The check that matters is not "is a backup configured" but "is the newest
one recent",** because a backup that quietly stopped looks exactly like one
that is working. `npm run doctor` faults a newest dump older than
`BACKUP_MAX_AGE_HOURS` (48) — and only on a deployment with a reachable
database, so a developer's checkout is not reported as failing.

## 16.3 · Deploying

`contrib/deploy.sh`: pull, install from the lockfile, migrate, restart, check
it came back. Refuses to run over uncommitted changes, fast-forwards only, and
prints the rollback command if the service does not return.

> **The checkout being current is not the same as the deployment being
> current.** A checkout can reach a commit without going through the deploy
> script — which is what runs the install, the migrations and the restart — so
> the service goes on running the previous code. "Already up to date" said of
> the **checkout** is easy to read as nothing to do.
>
> **Confirm a deploy by asking the running service, not the git log.** Call a
> route that only exists in the new release and see whether it answers.

`deploy.sh` cannot perform the deploy that installs `deploy.sh`. On a box
checked out before it existed, bash says `No such file or directory` — that is
the file missing, not the box being broken. Pull once by hand.

`contrib/reset-to-fresh.sh` **destroys the archive on that box** and puts it
back to the state a stranger's install starts in, so the wizard runs again.
Test deployments only. It never touches `.env`. It makes you type the
deployment's own `SITE_ORIGIN` to confirm, after printing the real counts of
what it is about to delete — **the only confirmation that cannot be given by
reflex, and the only one that catches the mistake that matters: running it on
the wrong box.**

## 16.4 · Three suites, and none of them covers another

```
npm test
npm run test:db
cd tools/browser-tests && \
  CHROMIUM_PATH=$(ls -d /opt/pw-browsers/chromium-*/chrome-linux/chrome | head -1) \
  node run.js --base=http://localhost:3000
```

This said "both suites" for as long as there have been three, which is how a
third one nobody ran stayed that way.

| Suite | What it is |
|---|---|
| `npm test` | **pure** — no database, no network, no server, so it runs on a box with nothing provisioned. ~4,800 lines. |
| `npm run test:db` | creates a **throwaway database beside** the one in `DATABASE_URL`, migrates it, runs every database-backed selftest against it, drops it. **The database you point it at is never written to.** |
| browser | drives a real browser against a running app, with `axe-core` over the prose screens. ~9,500 lines across 16 files. Catches a class of bug the unit tests structurally cannot. |

### `CHROMIUM_PATH` is in the documented command for a reason

Without it the browser suite does not fail, it **dies**. Playwright looks for
one exact build and claims none is installed when a different one is right
there, behind a banner that names nothing relevant.

### Counting `test:db` correctly — three separate traps

**1 · The total is the SUM of its scripts, not the last line it prints.** The
runner ends on the last script's count, that number was mistaken for the
total, and three documents carried a figure six times too small for a day.

**2 · Sum both fields.** The obvious version greps `'^[0-9]* passed'`, which
also matches the first half of `24 passed, 1 failed` — so it reports a
clean-looking total over a real failure.

```
npm run test:db 2>&1 | grep -o '^[0-9]* passed, [0-9]* failed' \
  | awk -F'[ ,]' '{p+=$1; f+=$4} END {print p" passed, "f" failed"}'
```

**3 · Count the scripts, because a script that DIES prints no count at all** —
not even `0 failed` — so the sum above simply comes out smaller and still says
zero failed. That is how a `TypeError` in one script read as green. These two
numbers must match:

```
npm run test:db 2>&1 | grep -c '^───── '
npm run test:db 2>&1 | grep -cE '^[0-9]+ passed, [0-9]+ failed'
```

**A total that dropped since last time is the tell**, so write the total down
when it changes. If it fell and nothing says failed, one script crashed: find
it by pairing each header with the count under it.

### A trap inside the unit suite itself

**It could not fail an async test** until it was fixed: `test()` called `fn()`
and moved on, so a returned promise was dropped — every async test printed
`ok` and counted as passed before its assertions ran. Two real checks sat in
that state, including one guarding the absent-key rule.

Async tests are now queued as **thunks and run one at a time**, not started at
call time, because several set `process.env` and read it back through a dynamic
import — started concurrently they read each other's values, which is how the
first version of that fix failed. **If you add an async test, confirm it can
FAIL before trusting it.**

### What the suites assert mechanically, rather than leaving to reviewers

- The absent-key rule, in several places.
- No row of `MAY_GRANT` contains `owner`.
- `reportPermissions.js` is not imported by the four modules that must not
  import it.
- Every async handler in `src/routes/` goes through `asyncRoute`.
- The two CSP declarations agree, and there are at least two of them.
- No page, module or script string carries a `style` attribute.
- An element the markup hides with `hidden` is never "shown" by setting
  `style.display = ''`, which would do nothing and throw nothing.
- No theme block names a colour.
- Every copy slot the editor offers is read by the markup.
- No starting point carries a site setting.
- `.env` renders `ADMIN_EMAIL` empty.

### What they cannot see

A `style=` assembled from pieces; a screen that is merely ugly. `axe-core` is
a floor rather than a ceiling. **Look at it** — in a browser, at phone width
and desktop, in a light palette and a dark one.

## 16.5 · Running things by hand

`src/db.js` reads `DATABASE_URL` **at import time**. Anything run with
`node -e` must `await import("dotenv/config")` before importing anything that
pulls in `db.js`, or you get a SASL error that reads like a permissions
problem and is not.

## 16.6 · Error handling

Express 4 does not turn a rejected promise into `next(err)`. An async handler
that rejects produces an unhandled rejection, and Node has terminated the
process on those since v15: the client gets a dropped connection with **no
status code**, the service dies, and the only trace is a stack on stderr. For
an archive whose whole promise is that a report does not get lost, that is the
worst available failure mode — **silent at both ends.**

So `asyncRoute` wraps every async handler, and the suite asserts it
mechanically, because this is a rule that fails by omission.

**Express 5 catches async rejections natively and is the real fix. It is
deliberately not being taken yet** — a framework bump on an app this close to
going live is a bigger risk than a wrapper, and the wrapper comes out in one
commit on the day it lands. Recorded as a decision, not left as an oversight.

---

# 17 · The data model

## 17.1 · Tables

**The record**

| Table | Append-only | Holds |
|---|---|---|
| `reports` | **yes** | every version of every report, frozen, chained |
| `report_heads` | no | the current version pointer and every judgement |
| `reports_restricted` | **yes** | Tier B ciphertext |
| `contact_keys` | no — **deletable by design** | the per-thread wrapped key and the email digest. Deleting a row is the erasure. |
| `logbooks` | no | slug, title, blurb, the lifecycle timestamps, `files_frozen_at` |
| `logbook_fields` | no | the questions |
| `logbook_forms` | **yes** | every version of a logbook's questions, as hashed text |
| `report_permissions_log` | **yes** | the three revocable permissions |
| `consent_texts` | **yes** | digest → card wording |
| `chain_anchors` | **yes** | the daily timestamp |
| `chain_anchor_heads` | **yes** | each logbook's head in each anchor |
| `attachments` | **yes** | what a file is |
| `report_attachments` | **yes** | which versions of a report carry which files |
| `editorial_notes` | no | the archive's own statement about a report, and its state |
| `editorial_note_versions` | **yes** | every version of every note — a change shows as a change |
| `editorial_note_links` | **yes** | sources cited beside a note |
| `attachment_heads` | no | what we decided about it, and the wrapped key |
| `access_log` | **yes** | who opened something protected, and why |
| `self_service_log` | **yes** | every correction, withdrawal and moderator action |
| `role_audit` | **yes** | every grant and revocation |

**Working tables**

`users`, `organizations`, `organization_memberships`, `organization_invites`,
`organization_invite_sends`, `ownership_transfers`, `intake_batches`,
`intake_drafts`, `upload_slots`, `attachment_view_grants`, `otp_codes`,
`self_sessions`, `report_submission_tokens`, `site_access_tokens`,
`site_settings`, `site_copy`, `involvement_groups`, `involvement_kinds`,
`feedback`, `feedback_events`, `feedback_comments`, `schema_migrations`.

`site_settings` is a **single row** — `id boolean PRIMARY KEY DEFAULT true
CHECK (id)` — so there can only ever be one.

## 17.2 · How append-only is enforced

One function, `reject_modification()`, raising an exception, attached twice to
each protected table: once `BEFORE DELETE OR UPDATE ... FOR EACH ROW`, and
once `BEFORE TRUNCATE ... FOR EACH STATEMENT`.

**It is the database refusing, not the application.** A route that forgot would
still be refused.

## 17.3 · Migrations are additive

Nothing after `001_init.sql` may change how an existing report hashes. 36
migrations.

**The one exception is `029_logbooks_only.sql`**, which drops the old
questionnaire's columns and so changes what a report *is*. It **refuses to run
on any archive that holds a single report** — before it touches a table — and
says what to do instead. It is safe for exactly one archive: an empty one.
Every migration after it is additive again, and nothing after it may do
anything of the kind.

Two migrations exist to leave a note where somebody will look:

- **021** is a `COMMENT ON COLUMN` and nothing else, saying
  `site_settings.layout` is read by nothing.
- **032** comments `logbooks.accepts_files` as superseded and says not to read
  it, because a logbook built since will disagree with it.
- **033** does the same for `attachments.report_id`, which names the version a
  file FIRST arrived with and was being joined against the current one — so a
  corrected report appeared to have no files at all. See below.
- **034** adds `logbook_fields.shown_when`, and is the migration where the
  absent-key rule is most load-bearing: the column is sealed into the form
  definition, so writing the key unconditionally would break the
  `logbook_form` of every report ever filed. Nullable, written only when set,
  asserted in both suites.

A migration must not drop and restore an append-only trigger. **Backfilling is
the only acceptable reason to touch one.**

### 033 and the files a correction used to lose

`attachments.report_id` names **one version** of a report, and every read of a
report's files joined it against `report_heads.current_report_id`. A correction
mints a new version and moves the head, so from that instant the published
photographs vanished from the report, the rows became reachable by nothing, and
— the reason no suite caught it for weeks — `manifestFor` returned null, the new
version's hashed object carried no `attachments` key, and **it verified
cleanly**. A reporter fixing a typo in their own account lost their video,
silently, on a deployment whose whole promise is that nothing disappears
quietly. `chain-selftest.mjs` exercised corrections; it had always done so on
reports with no files.

`report_attachments` now records which versions commit to which files. A
correction carries a file forward by **linking** it, never by copying the
attachment row: a copy sharing the storage key would survive the crypto-shred
of the original and hold a live key to a deleted object, which is an erasure
that only half happened. One file is one row for as long as it exists, so
destroying its key destroys it everywhere — which is the only thing erasure can
honestly mean.

Ordinals became per **thread** rather than per version in the same migration.
They were numbered from zero within one report, which was indistinguishable
while a file could only arrive at confirmation; once a correction can also bring
files, a second batch starting at zero again would collide and two files would
claim one position in a hashed manifest. `buildManifest` takes `ordinalFrom` for
the same reason, and `nextOrdinal` is the only thing that computes it.

Two selftests came with it, and both have been checked against the bug
reintroduced rather than only against the fix:
`scripts/correction-selftest.mjs`, and `scripts/archive-roundtrip-selftest.mjs`
— which exports the whole archive, replays it into a fresh database and
compares every content hash, because a replay that rebuilds a hashed object
even slightly differently voids every proof over it and neither script would
have said so.

## 17.4 · Notable constraints

- `users_single_owner_idx` — a partial unique index on `WHERE role = 'owner'`.
  Exactly one owner, enforced by an index rather than a check.
- `logbook_forms_hash_check` — the database refuses a `form_hash` that is not
  `encode(sha256(convert_to(definition,'UTF8')),'hex')`.
- `report_permissions_log_actor_check` — `actor = 'reporter'`, so the rule is
  stated where a new route cannot forget it.
- `reports_may_publish_digest_together` — the answer and the digest travel
  together or not at all. A permission with no record of what was permitted is
  not interpretable, and a record with no permission is noise.
- `reports_third_party_complete_check` — the provenance block is complete or
  absent.
- `logbooks_slug_check`, `logbook_fields_key_check` — the slug and key shapes,
  in the database as well as the module.
- `UNIQUE (logbook_id, key)` on fields; `UNIQUE (logbook_id, form_hash)` on
  forms, which is what makes `ensureFormVersion` idempotent and lock-free.
- `reports.chain_hash` is `UNIQUE`.
- `reports.logbook_id` references `logbooks(id)` **with no cascade**, so a
  logbook row can never be deleted out from under a report.

---

# 18 · Configuration

Everything is an environment variable in `.env`. `npm run configure` writes
it.

## 18.1 · Required

| | |
|---|---|
| `DATABASE_URL` | read at import time |
| `SITE_ORIGIN` | **no default; throws at boot** |
| `TIER_B_ENCRYPTION_KEY` | 32 bytes, base64. Generated, never prompted. |
| `CONTACT_HMAC_KEY` | 32 bytes, base64. Generated, never prompted. Must differ from the above — checked, as a guard against a future refactor computing one from the other. |

Mail is required in practice; one of the transports below must work.

## 18.2 · Mail

`EMAIL_TRANSPORT` (`smtp` \| `scaleway` \| `log`, or inferred — SMTP first,
because it is what somebody self-hosting is most likely to have),
`ALERT_FROM_EMAIL`, `ALERT_FROM_NAME`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`,
`SMTP_PASS`, `SMTP_SECURE`, `SCALEWAY_SECRET_KEY`, `SCALEWAY_PROJECT_ID`,
`SCALEWAY_REGION`.

## 18.3 · Object storage

`S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`,
`S3_BUCKET_STAGING`, `S3_BUCKET_EVIDENCE`, `S3_BUCKET_RENDITIONS`, and
`S3_ADDRESSING`.

**The first seven, or the feature is off.** `isConfigured()` is
all-or-nothing, and callers disable the feature rather than throwing.
`S3_ADDRESSING` is not part of that count: it has a default and does not
gate the feature.

### Addressing, which decides which providers work

`S3_ADDRESSING` is `path` (the default) or `virtual`, and it is the one
thing an SDK would have decided silently:

| | request | endpoints |
|---|---|---|
| `path` | `endpoint/bucket/key` | Hetzner (what this has run on), Backblaze B2, MinIO, Ceph/RGW, Scaleway, DigitalOcean Spaces, Cloudflare R2 (with `S3_REGION=auto`) |
| `virtual` | `bucket.endpoint/key` | AWS S3 proper, where path-style is deprecated and a bucket in a newer region may refuse it |

**The bucket is part of the canonical request either way**, so this is not
cosmetic: the `host` header is signed, and under `virtual` the host
*contains the bucket*. Both forms are therefore signed inside `presign()`
rather than rewritten by a caller afterwards, which would invalidate the
signature. The wrong mode fails as `SignatureDoesNotMatch` and mentions
nothing about addressing — which is why `INSTALL.md` §2 carries the table
too, and why `npm run storage-smoke` exists to settle it against a real
endpoint.

**An unknown value throws rather than falling back.** A typo that quietly
became path-style would fail against a virtual-hosted-only endpoint as a
signature mismatch, naming nothing useful.

**Under `virtual`, a bucket name must be a legal DNS label** — lowercase,
no dots. A dot means a `*.s3.example.com` certificate does not cover
`my.bucket.s3.example.com`, so the browser's upload dies with a certificate
error unrelated on its face to S3. `presign()` refuses such a bucket rather
than signing a request that cannot work. Path-style has no such constraint.

> **The signing is cross-checked against botocore, not just against
> itself.** `scripts/selftest.js` carries two known-answer vectors — one per
> addressing mode — produced by AWS's own `S3SigV4QueryAuth` for the same
> request at the same frozen instant. Everything else in the suite only
> proves the implementation agrees with itself; these prove it agrees with
> the thing it is imitating. Both modes matched byte for byte on
> 6 October 2026, path-style included, which is the first time the
> hand-rolled SigV4 had been checked against a reference at all.

> **No AWS SDK, deliberately.** `@aws-sdk/client-s3` pulls in ~80 transitive
> packages for what this app needs: presign a PUT, GET an object, DELETE an
> object. SigV4 is about sixty lines of `node:crypto`, with nothing to audit
> or update on a box that also runs something else, and it keeps
> `npm install --omit=dev` on the server as small as it is.
>
> Everything is query-string (presigned) signing rather than header signing,
> because presigned URLs are the one form genuinely needed — the browser
> uploads straight to storage — and reusing the same code path for the app's
> own reads means there is only **one signing implementation to get right.**

## 18.4 · Attachments and media

`ATTACHMENTS_ENABLED`, `MEDIA_TRANSCODE_TIMEOUT_MS`, `CLAMAV_ENABLED`,
`MEDIA_WORKER_BATCH`, `MEDIA_WORKER_STALE_MINUTES` (15), `MEDIA_CACHE_DIR`,
`MEDIA_CACHE_MAX_BYTES` (2 GB default), `MEDIA_CACHE_ENABLED`.

`STAGING_QUOTA_REPORTS` (3) and `CONFIRM_WAIT_MS` (30 min) belong to intake
hardening, and the two are the same mechanism seen from either end.

> **`npm run handout` builds the install guide as one self-contained file**,
> from `public/docs.html`, with the stylesheet and the script inlined and
> nothing left pointing at a server. It is for handing to somebody who is not
> reading it on a deployment. The live page at `/docs` stays canonical, and
> the file says which version it is a snapshot of — `tools/make-handout.mjs`,
> whose header carries the one thing worth keeping about it: why every
> replacement in it is a function and not a string.

**Nothing is processed while somebody fills the form in.** A staged upload
becomes work when the reporter presses Send — `released_at`, migration 045 —
and the media worker claims released rows only. So the form no longer makes
anybody wait for a transcode before it will send, and nothing is transcoded
for a draft that is abandoned. It waits for the UPLOAD still, because Send is
what hands those files to the worker and a file whose bytes never arrived is
one the worker refuses.

The wait moved to the confirmation instead, where `CONFIRM_WAIT_MS` bounds
it: confirming is the last moment a file can join the report, so a link
clicked mid-transcode answers `preparing` and spends nothing. Keep it longer
than `MEDIA_WORKER_STALE_MINUTES`, or the wait gives up exactly as an
interrupted attempt is requeued.

`STAGING_QUOTA_REPORTS` is how much one email address may have staged across
every draft it has open, in reports' worth of `MAX_TOTAL_BYTES`. The
per-report limits bound a report and a draft token is free, so they bounded a
draft rather than a caller; this is what closes that, and it is why the form
asks for the address before the files on a logbook that takes them. **The
address is unverified there and the quota does not pretend otherwise** — only
a keyed digest of it is stored, it identifies nobody, and it buys a bucket to
count in. `0` switches it off.

## 18.5 · The transparency log

`TSA_URL` (an RFC 3161 authority), `TRANSPARENCY_LOG_DIR`,
`TRANSPARENCY_LOG_REMOTES` (comma-separated; **more than one is the point**).

Since migration 052 all of these can be set in the owner's transparency-log
pane instead, and **the environment wins where it is set**. The pane lists
each mirror as a name and an address, and the nightly push goes to those
addresses — the same ones its Test button tries (`pushTargets` in
`src/transparencyLog.js`). `TRANSPARENCY_LOG_REMOTES` is different in kind:
it names remotes configured in the log checkout. With neither, the push goes
to the checkout's `origin`.

## 18.6 · Other

`PORT` (default 5000; the app binds `127.0.0.1` only, so a reverse proxy is
assumed), `SITE_NAME`, `APP_VERSION`, `LIST_KNOWN_HOSTS`,
`FEEDBACK_STALE_DAYS`, `ADMIN_EMAIL` (**legacy — see §8.8**), and three
cache-TTL overrides that exist only so the database suite can watch a switch
take effect without waiting out a cache: `PUBLICATION_SETTINGS_TTL_MS`,
`INTAKE_SETTINGS_TTL_MS`. They are not tuning knobs and nothing in a
deployment should set them.

---

# 19 · Limits, in one place

| | |
|---|---|
| Request body | 256 kB |
| Board page | 500 reports |
| Search term | 200 characters |
| Site name | 60 characters |
| Legal text | 100,000 characters |
| Copy slot | 20,000 characters, 300 per line |
| Logbook title | 1–120 characters |
| Logbook slug | ≤ 63, `^[a-z0-9][a-z0-9-]*$` |
| Field label | 1–160 characters |
| Field key | ≤ 39, `^[a-z0-9][a-z0-9_]*$` |
| `short_text` answer | 200 characters |
| `long_text` answer | 5,000 characters |
| `place` answer | 200 characters |
| Access-log reason | 10–500 characters |
| Curtain password | ≥ 8 characters |
| One-time code | 6 digits, 10 minutes, single use |
| Session | 24 hours |
| Submission token | 24 hours |
| Upload slot | 24 hours |
| Invitation | 7 days |
| Ownership proposal | 7 days |
| Dev-mode notice | 6 hours |
| Volunteer form minimum fill time | 2 seconds |

Rate limits: submit 20 / 15 min; confirm 60 / 15 min; verify 120 / 15 min;
public API 120 / min; plus limiters on sign-in, unlock, uploads, invitations
and the handover code.

The POSTs reachable without the password are a list's entries (only for a
list opened outside), a report to a logbook opened outside, and the two
emailed-link pages. The list form carries the same honeypot, timing check and
rate limit the volunteer form had, and they are load-bearing rather than
belt-and-braces.

---

# 20 · Decided, and not built

These are decisions on record. None is speculation, and none is a commitment
to a date.

| | Status |
|---|---|
| **Publishing a form definition to the transparency log at launch** | the definitions are stored text with a hash the database checks, so this is publishing rows that already exist |
| **The launch freeze as a database trigger**, not only a module guard | the module guard exists and every path goes through it; the database does not yet refuse independently |
| **`may_distribute`** — the second sealed permission | blocked on **wording**, not on code: distribution cannot yet be described plainly enough to ask somebody to agree to it. See §21.2. |
| **A fourth publication state, `released`** | the restricted-distribution design; see §21.2 |
| **A documented escalation route** for CSAM and credible threats | hard publication block, preserved encrypted original |
| **Face blurring** in the review UI | at minimum a tool; realistically a default posture of publish the report, withhold the photo |
| **Media review triage** — incident batching, perceptual-hash dedup, credentialed-observer ordering | report-level incident grouping exists; media batching does not |
| **Offline upload queue** in the service worker | nothing in `public/` uses IndexedDB |
| **Attachment counts and digests in the CSV**, never URLs | |
| **Offsite replication of encrypted originals** | described as done in the architecture note's build-order update; **not verifiable from this repository** |
| **Browser-side encryption of uploads** | would close the minutes-long window where plaintext sits in staging — but the worker must decrypt before it can scan, so it buys less than it first appears. A later hardening step, not a launch blocker. |
| **Split key custody** (HSM or Shamir) | `wrapDek` is the only function that would have to change |
| ~~**A single-command installer**~~ | **shipped** — `install.sh` does the mechanical half on Debian and Ubuntu and stops where a person is needed |
| **Reading the `public_ref` prefix from settings** | a `TODO` in `src/crypto.js`; must be settable once and never after |

Unbuilt and not obviously needed: editing a logbook's title or blurb after
launch (the slug is sealed and must never move); a logbook reachable by direct
URL rather than from the list; a CSV export whose columns are a logbook's
questions **across** logbooks.

---

# 21 · Parked, and refused

## 21.1 · Campaigns — superseded

A "campaign" was to be one named intake with its own frozen questionnaire,
many per deployment, each report sealing which campaign it belonged to.

**Checked line by line: campaigns and logbooks are the same feature, and
logbooks shipped.** Do not build campaigns.

What survives from the spec is live in logbooks: the lifecycle, the launch
freeze, one chain per intake, the slug in the seal. Three items from its queue
are in §20.

Two things in that spec were **never** logbooks and remain unbuilt:
**per-campaign look** (deliberately three plain strings and no behaviour — a
row carrying its own three would override a deployment's without the look
resolver changing, because it takes a settings object rather than a global),
and **campaign announcements as a standing invitation list, never
auto-enrolment.**

## 21.2 · Restricted distribution — parked on wording

Releasing an approved report and its files to **a named list of recipients who
have agreed to terms**, without making them public.

The design is settled and is not being built:

- **The rule it is built on: restricted material never exists as plaintext at
  rest.** The moment a file is copied into the public bucket it is one leaked
  storage credential away from being fully public, and no contract with a
  recipient repairs that. **A distribution tier that writes to the plaintext
  bucket is a public archive with a politeness notice attached.** So
  restricted material stays encrypted in the evidence bucket and is decrypted
  per request, in the app, for an authenticated recipient, and logged — which
  is exactly what the moderator preview path already does. What changes is who
  is allowed to ask.
- **A fourth `publication` value, `released`.** Withheld → released →
  published is a widening sequence, each step a moderator decision. Released
  is **not** a stop on the way to published; a report may stay released
  forever. The renditions bucket keeps its meaning: public material only,
  nothing else, ever.
- **A new system role, `recipient`**, below moderator, grantable by admin and
  access manager, granting nothing itself. A role rather than a flag for one
  reason that pays for itself immediately: every grant already writes
  `role_audit` in the same transaction as the change, so the record of who was
  given access to restricted material comes free, complete, and impossible to
  separate from the change.
- **Scoping is a second layer.** The role says "may receive restricted
  material at all"; a separate table says which intakes, from when, until
  when.
- **The agreement is recorded, not assumed** — who accepted, when, and the
  SHA-256 of the terms text they accepted, so "which terms did they sign" is
  answerable in three years when the terms have been revised twice.
- **Two log events, and conflating them makes both useless.** The *release
  decision* is one row whatever the list length, and is reporter-visible — a
  release is a real disclosure of their material. A *recipient view* is
  oversight only and **not** reporter-visible, or a reporter with a widely
  distributed report reads forty near-identical lines and stops reading any of
  them.
- **Its own sealed key, `may_distribute`.** `may_publish: true` does not
  authorise release and `may_publish: false` does not forbid it: somebody may
  accept a vetted list of journalists under contract and refuse a permanent
  public record, and somebody else will feel exactly the opposite. **One key
  cannot express either person.**
- **Whether `may_distribute` is real consent is an open and different
  question.** Release to a named list genuinely *can* be stopped, so Article
  6(1)(a) may fit where it does not fit publication. For counsel.
- A distribution card is a **different card**, not a third variant of the
  publication one. `consent_texts.variant` is constrained to `general` and
  `coordinator`; the table wants a `kind` column defaulting to `publication`
  rather than a widened CHECK. Additive either way, and it is an append-only
  table, so worth getting right once.
- **Costs, stated honestly:** streaming through the app is slower and puts
  bytes through the Node process — correct for tens of recipients, wrong for a
  public archive, which is exactly why published material keeps its plaintext
  fast path. Whether released-but-unpublished material may touch the media
  cache **needs an explicit answer; default to no.** And a fourth publication
  state touches every query testing `publication = 'published'` — **grep, do
  not remember.**

Open within it: whether a recipient may download rather than only view, and
whether downloads are watermarked; and what happens to releases when an intake
closes or a report is withdrawn (**withdrawal must revoke access
immediately**, the way the public path already tests `withdrawn = false` on
every request, rather than relying on a cache expiring).

The operator's `distribution_enabled` switch exists and **has always governed
nothing.** That is not a regression.

## 21.3 · A press / researcher credential — explicitly not decided

**Do not build this.** A level above the public and below the moderation team,
for press, officials and researchers.

Why it is hard:

- **Two things get conflated:** *who someone is* (an attribute of a person)
  and *what they can see* (an access level on data). Building it as one thing
  welds them together permanently.
- **A third data tier is expensive**: a second key, a second classification on
  every field, and a decision on every existing report about which bucket each
  field lands in. **And it is not revocable** — once something is Tier C,
  everyone who is ever Tier C has it, including whoever is added next year.
- **The consent problem, which is probably decisive.** Every reporter so far
  agreed to a specific deal: this is public, this is moderators only. Quietly
  widening "moderators only" to include accredited journalists changes that
  deal **retroactively, for people who cannot be asked.**

**The recommendation on record: per-report grants, not a standing tier.** A
moderator shares *this specific report's* restricted detail with *this
specific person*, for a stated reason, for a limited time. It reuses machinery
that already exists — the access log with its written reason, the
reporter-facing history, `role_audit` — and it is revocable and auditable. It
also never forces an answer to "who counts as press" in the abstract, only "do
I trust this person with this report". A mistake then costs one report rather
than the archive.

**The question nobody has answered: what would a journalist actually need?**
Probably not the reporter's identity — the most sensitive thing in Tier B and
the least useful to them. More likely precise location, the unredacted
account, attachments not yet published, or the links between related reports.
If that is right, the cut wanted is not "a bit of Tier B" at all, and defining
it is the actual work. **Writing that down publicly, before any code, is the
cheap way to find out whether the design holds. If the document is hard to
write, that is the design saying something.**

## 21.4 · Cut, and not to be resurrected without asking

- An observer / "I'll be watching" pledge for individuals.
- Pre/post-election reminder emails — a campaign calendar the software keeps.
- A public citizen count — organization-based numbers only.

Cutting these removed a real risk: **a standalone list of individuals who
pledged to watch an election is a political list, Article 9 data under GDPR,
and would have been the softest valuable target on the box.**

> **This list said "mailing lists" until 3 October, while `src/digest.js` had
> shipped one.** The hourly and weekly digests, the logbooks a person follows
> and the settings pane they choose them in have existed since logbooks landed.
> The line was written about the thing above it — a roll of people who pledged
> to watch an election, which is a political list — and it swallowed a
> following-a-logbook digest, which is not: it carries only what the public
> board already carries, to an address that asked for it and can stop.
>
> A document that forbids what the code does teaches a reader to trust
> neither. The risk the cut was protecting is in the sentence above and has
> not moved; what is permitted is a subscription to published material, and
> that is what ships.

## 21.5 · Refused outright

| | |
|---|---|
| **An auto-publish path** | there is none and there must not be one |
| **A built-in date or location filter** | where and when are field types |
| **A built-in questionnaire** | a report is a logbook's answers plus the spine |
| **A `deployment_type` the code consults** | starts as a convenience and ends as a permanent fork in every query |
| **Office document formats** | never built, not planned |
| **Publishing a PDF as a PDF** | page images only |
| **Publishing Tier B** | not offered at all |
| **A moderator route that writes a reporter's permission** | the table's CHECK refuses it |
| **A build step in the frontend** | and there must not be one |
| **Weakening "once listed, always listed"** | the only thing that notices a whole logbook disappearing |
| **Structured legal-notice fields** | designed, then reversed; see §14.12 |
| **A third look axis** | the answer to a missing width is another theme |
| **Multiple owners, or an owner and a deputy** | both reopen the argument the single-owner index closes |
| **Billing** | ReportLog bills nobody and is not to learn how |

---

# 22 · Known gaps, and documents that have drifted

## 22.1 · Open in the software

| | |
|---|---|
| `/api/site-access/status` exposes `devMode` before the password | deliberate, and still build state given away free |
| Express 5 is the real fix for async rejections | deliberately not taken yet; revisit after go-live, the wrapper comes out in one commit |
| `npm run doctor` checks `script-src` only | it will not catch a stale `style-src` in a hand-maintained proxy config |
| The `public_ref` prefix is a constant | the `TODO` to read it from settings predates first-run setup, which now exists |
| `legal_hold` on `reports` | an unused column, reserved for stopping a retention job on a thread. No retention job exists. |
| `site_settings.layout` | read by nothing; migration 021 exists to say so |
| `logbooks.accepts_files` | read by nothing but migration 032; the derived value is the authority |
| Migration 032's backfill | has **never executed anywhere**, because no logbook it would have applied to took files. A test for it was considered and deliberately skipped. |
| `volunteer_*` tables | unread since migration 047 moved volunteering onto a list. Kept because migrations are additive; nothing writes them. /volunteer and /involve still resolve, to /list/volunteer, and the confirmation links the old form emailed land on the form. |
| No standard for verifying an organization | load-bearing for the Alliance directory, because listing implies something. The page says listing is not verification — honest, but not a standard. |

## 22.2 · Documents in this repository that disagree with the code

Listed because the code wins, and because a reader who finds the discrepancy
should not have to work out which way round it goes.

| Document | Drift |
|---|---|
| `README.md` | said **twelve** field types; there are **thirteen** — the `file` type arrived with migration 032. **Corrected 1 October**, in the same pass as this document. |
| ~~`public/docs.html` said the v0.0.2 tag did not exist~~ | **That correction was itself wrong, and is reverted.** `v0.0.2` is a real annotated tag of 18 September, 89 commits behind `main`, stopping at migration 026 — so it genuinely predates logbooks, exactly as the page originally said. The container this was checked in had cloned without tags, so `git tag` came back empty and read as "no release was ever cut". **A clone that fetched no tags is indistinguishable from a repository that has none**, and the only way to tell is to ask the remote: `git ls-remote --tags origin`. |
| `CONTRIBUTING.md` | gave the **naive** `test:db` counting command, `grep -o '^[0-9]* passed'` — precisely the one that reports a clean total over a real failure. **Corrected 1 October** to the two commands in §16.4. |
| `CONTRIBUTING.md` | describes the pull-request template as a Forgejo path question. The repository is on GitHub. |
| `docs/frontend-files.md` | says `public/index.html` is **2,567** lines of markup. It is **2,941**. |
| `docs/attachments-architecture.md` | is a **design note from before logbooks**, kept because the reasoning in it is why the thing is shaped the way it is. It speaks of a `narrative` column, a global chain, `incident_id` as the grouping key, and a version string from a different numbering. Read it for the reasoning, never for the current shape. |
| `docs/attachments-architecture.md` | its header says photos and video are "both built, behind a feature flag" and Phase 4 is "still design"; a later block inside the same file says phases 1–3 all shipped and offsite replication is done. The later block is the newer statement. **Offsite replication is not verifiable from this repository.** |
| `docs/client-first.md` | its conversion log is dated progress, not current state. |

## 22.3 · Questions for counsel, on record and unanswered

The design positions in §7.2 are the project's reasoning, not legal
conclusions. Written answers are wanted:

1. What is the lawful basis for the archive's processing, and is it recorded
   anywhere it can be shown?
2. Does a deployment qualify for the Article 85 journalistic derogation, the
   Article 89 archiving derogation, both, or neither?
3. **Article 9.** Incident reports can carry political opinions, which is
   special category data. Which 9(2) condition applies, and does the
   reporter's publication choice do any work there?
4. **Article 14.** Reports describe third parties — officials, staff — who
   have transparency rights the archive cannot practically serve. Does
   14(5)(b) disproportionate effort apply?
5. Does the card's wording need to change, and does calling the answer a
   permission rather than a consent hold up?
6. Is a tombstone — a row that stays while its content is emptied, with the
   removal itself published — an adequate answer to an erasure request?

There is a **wording trap** worth naming: describing the recipient of passed
contact details as having a *legitimate interest* borrows Article 6(1)(f),
which specifically does **not** rest on consent, and using it to name a
consent toggle invites exactly the confusion question 5 is about.

A moderation standard is also owed, and it blocks taking moderator
applications honestly: asking somebody to volunteer to judge other people's
reports while being unable to tell them what judgement they are being asked to
make is asking them to sign up to an unknown. It has to be **versioned** —
a report judged in 2026 stays judged in 2026, and a reader looking at it needs
the 2026 text to know what the badge meant. Deciding that at the start is much
cheaper than retrofitting it.

---

# 23 · Appendix — the API surface

Everything under `/api` except where noted is behind the site-access gate.
Role requirements are the minimum; the owner satisfies `admin`.

## Public, outside the gate

```
GET    /api/health
GET    /api/site-access/status
POST   /api/site-access/unlock
GET    /api/v1/
GET    /api/v1/stats
GET    /api/v1/consent-texts
GET    /api/lists/:slug             (each list decides about the password)
GET    /api/lists/:slug/counts
POST   /api/lists/:slug/entries
GET    /api/doors
GET/POST /api/forget/:token
GET/POST /api/list-mail/:token
```

## Reporting

```
GET    /api/reports/intake                 should the form offer itself
GET    /api/reports/consent-text           the publication card, by variant
POST   /api/reports/                       stage a submission, email the link
GET    /api/reports/confirm/:token         the only moment a report is created
GET    /api/reports/                       the public board (limit 500)
GET    /api/reports/export.csv
GET    /api/reports/:publicRef
GET    /api/reports/:publicRef/verify      the four checks
GET    /api/reports/:publicRef/attachments
GET    /api/reports/:publicRef/attachments/:id/file
GET    /api/reports/:publicRef/attachments/:id/poster
GET    /api/stats
```

## Logbooks

```
GET    /api/logbooks/                      open logbooks
GET    /api/logbooks/:slug                 its questions, and acceptsFiles
GET    /api/logbooks/:slug/chain           the published chain file
```

## Uploads  *(404s entirely unless attachments are on and storage configured)*

```
GET    /api/uploads/config
POST   /api/uploads/draft
POST   /api/uploads/
POST   /api/uploads/:slotToken/complete
GET    /api/uploads/status
DELETE /api/uploads/:slotToken
```

## Sign-in

```
POST   /api/auth/request-code
POST   /api/auth/verify-code
POST   /api/auth/logout
GET    /api/auth/me
```

## The reporter's own  *(authenticated)*

```
GET    /api/me/reports
GET    /api/me/reports/:threadId/permissions
POST   /api/me/reports/:threadId/permissions
POST   /api/me/reports/:threadId/correct
POST   /api/me/reports/:threadId/withdraw
POST   /api/me/reports/:threadId/erase
GET    /api/me/access-log
GET    /api/me/notifications
POST   /api/me/notifications
```

## Moderation  *(moderator or admin)*

```
GET    /api/moderators/reports
POST   /api/moderators/reports/:publicRef/restricted      Tier B, reason required
POST   /api/moderators/reports/:threadId/status
POST   /api/moderators/reports/:threadId/severity
POST   /api/moderators/reports/:threadId/incident
GET    /api/moderators/reports/:threadId/note            with every version
POST   /api/moderators/reports/:threadId/note            writes or revises
POST   /api/moderators/reports/:threadId/note/state      admin only
POST   /api/moderators/reports/:threadId/note/links
DELETE /api/moderators/reports/:threadId/note/links/:id
POST   /api/moderators/reports/:threadId/withdraw
POST   /api/moderators/reports/:threadId/restore
GET    /api/moderators/reports/:publicRef/attachments
POST   /api/moderators/attachments/:id/view-grant
GET    /api/moderators/attachments/:id/original|rendition|poster
POST   /api/moderators/attachments/:id/publication
POST   /api/moderators/attachments/:id/erase              admin
GET    /api/moderators/access-log                         admin
```

## Coordinator intake  *(authenticated; coordinator or manager of the org)*

```
GET    /api/intake/organizations
POST   /api/intake/batches
GET    /api/intake/batches
GET    /api/intake/batches/:id
POST   /api/intake/batches/:id/drafts
PUT    /api/intake/drafts/:id
DELETE /api/intake/drafts/:id
GET    /api/intake/batches/:id/review
POST   /api/intake/batches/:id/submit
```

## Administration  *(admin)*

```
GET/POST /api/admin/site-access
GET/POST /api/admin/attachments
GET/POST /api/admin/identity
GET/POST /api/admin/publication
GET/POST /api/admin/templates
GET/POST /api/admin/copy
GET/POST /api/admin/look
GET/POST /api/admin/intake
GET/POST /api/admin/legal
GET/POST /api/admin/dev-mode
GET/POST   /api/admin/lists
GET/PATCH/DELETE /api/admin/lists/:id
PUT        /api/admin/lists/:id/fields
GET        /api/admin/figures
POST       /api/admin/logbooks/:id/outside

GET    /api/admin/logbooks/field-types
GET    /api/admin/logbooks/
GET    /api/admin/logbooks/starting-points
POST   /api/admin/logbooks/
POST   /api/admin/logbooks/from-file
GET    /api/admin/logbooks/:id
GET    /api/admin/logbooks/:id/file
POST   /api/admin/logbooks/:id/editorial-notes       per logbook, off by default
POST   /api/admin/logbooks/:id/fields
PUT    /api/admin/logbooks/:id/fields/:fieldId
DELETE /api/admin/logbooks/:id/fields/:fieldId
POST   /api/admin/logbooks/:id/fields/order
POST   /api/admin/logbooks/:id/schedule
POST   /api/admin/logbooks/:id/launch          the one-way door
POST   /api/admin/logbooks/:id/closed
POST   /api/admin/logbooks/:id/files/freeze
GET    /api/admin/logbooks/:id/chain           the complete chain file
```

## Roles, organizations, ownership

```
GET    /api/orgs/me
GET    /api/orgs/
POST   /api/orgs/                              admin | access_manager
GET    /api/orgs/:id/members
POST   /api/orgs/:id/members                   admin | access_manager
DELETE /api/orgs/:id/members/:email
POST   /api/orgs/:id/details
GET/POST /api/orgs/:id/listing
GET    /api/orgs/:id/invitations
POST   /api/orgs/:id/invitations
DELETE /api/orgs/:id/invitations/:email
POST   /api/orgs/:id/invitations/:email/resend
POST   /api/orgs/:id/invitations/:email/approve  admin | access_manager
POST   /api/orgs/system-role                   admin | access_manager
POST   /api/orgs/tester                        admin | access_manager
POST   /api/orgs/team-member                   admin | access_manager
GET    /api/orgs/desks                         admin | access_manager
GET    /api/orgs/roster                        admin | access_manager
GET    /api/orgs/audit                         admin | access_manager
GET    /api/orgs/owner
POST   /api/orgs/owner/transfer/code
POST   /api/orgs/owner/transfer
DELETE /api/orgs/owner/transfer
POST   /api/orgs/owner/accept

GET    /api/invitations/:token
POST   /api/invitations/:token/accept           authenticated
GET    /api/alliance/
```

## First-run setup  *(refuses everything once the deployment has an owner)*

```
GET    /api/setup/status
POST   /api/setup/request-code
POST   /api/setup/verify-code
POST   /api/setup/curtain
```

## Testers, press, legal

```
POST   /api/feedback/                          tester
GET    /api/feedback/mine
GET    /api/feedback/all
GET    /api/feedback/:id/comments
POST   /api/feedback/:id/comments
GET    /api/feedback/queue                     admin
GET    /api/feedback/counts                    admin
POST   /api/feedback/:id/status                admin
GET    /api/press/
GET    /api/press/:key
GET    /api/legal/
GET    /api/legal/copy
```

## Non-API pages the app answers for

```
GET    /                        rendered, so the tab carries the deployment's name
GET    /app                     ungated
GET    /docs                    ungated
GET    /styleguide              ungated
GET    /manifest.webmanifest    built per deployment, ungated
GET    *                        anything that is not a file or an API call
                                returns the app, so deep links work
```

---

# 24 · Where the authority for a fact lives

| Question | Read |
|---|---|
| What is a report? | `src/reportCore.js` |
| Does this report still verify? | `src/verify.js`, and the `/verify` route |
| Can I check it myself? | `src/chainCheck.js` + `scripts/check-chain.js` — no database, no network |
| What may a logbook do? | `src/logbooks.js`, and `docs/logbooks.md` |
| What questions can be asked? | `src/fieldTypes.js` |
| How is an answer normalised? | `src/answers.js` |
| What exactly was the reporter shown? | `src/consentText.js`, and `/api/v1/consent-texts` |
| Who may grant what? | `src/roles.js` (`MAY_GRANT`), `src/roleRank.js` |
| How does the seat move? | `src/ownership.js` |
| What is published? | the three gates in §11.4 |
| What does a file go through? | `src/attachments.js`, `src/media.js`, `scripts/media-worker.js` |
| How is erasure possible at all? | `src/contactKeys.js`, `src/crypto.js` |
| Why is a decision the way it is? | the module's own header comment — they are long on purpose |
| What is true of the running software? | the code, and the three suites |
| What is true of a deployment? | that deployment, asked directly |

The module header comments are the primary source throughout. They were
written to explain the decision, not the mechanism, and nearly every
paragraph of this document is downstream of one.
