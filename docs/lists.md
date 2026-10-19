# Lists

The second format, beside logbooks. Read this before touching
`apps/api/src/lists/`, the lists migration (`apps/api/migrations/*_lists.sql`),
the three templates in `apps/api/src/lists/templates/`, or the screens in
`apps/web/src/features/lists/`.

Ported from `legacy/docs/lists.md`. Where the rebuild differs, it says so.

## A form is the question set. Logbook or list is what happens to the answers

|                              | Logbook                 | List                  |
| ---------------------------- | ----------------------- | --------------------- |
| Sealed and chained           | yes                     | no                    |
| Append-only                  | yes, by trigger         | no, by design         |
| The spine asked of every one | yes                     | no                    |
| Form editable after launch   | no: one-way door        | yes                   |
| Review                       | one by one              | in bulk               |
| What is published            | approved content        | counts, never content |
| Personal data                | kept under erasable key | erased on a timer     |

Three templates ship: the **Tip List**, **check-ins** and a **contact form**.
They differ only by their questions. **Nothing records which template made a
list, and nothing may**: link handling happens because a list has a `url`
question, not because it is "a tip list". A unit test checks the migration has
no such column and that the engine names no template.

## The rule the whole design exists to hold

**Nothing under `apps/api/src/lists/` may reach `packages/seal` or
`apps/api/src/chain`, even indirectly.** Two checks hold it, and both were
seen to fail on a planted two-hop import (lists → logbooks → chain):

- the boundary check (`lists-never-reach-the-chain` in
  `.dependency-cruiser.cjs`), in `pnpm check`;
- `apps/api/test/unit/lists.test.ts`, which walks the import graph from every
  file in the folder, workspace packages included, and also bans the chain's
  names (`appendReportVersion`, `chainHash`, `report_heads`, `logbook_form`…).

Answers are normalized by `@reportlog/fields`, the package kept apart from the
sealing code for exactly this reason. (Legacy had to duplicate its normalizer
in `src/lists/values.js` to keep the same guarantee; the rebuild does not.)
`values.ts` adds only what a list needs and a logbook does not: a refusal with
a reason, stricter links, and text refused rather than cut.

**An entry is not a report.** It has no spine. If a list entry is ever called a
report, that invariant reads as broken and somebody will try to fix it.

## The two halves of an entry

- **`answers`**: durable. Links, states, verdicts, categories. Never erased.
- **`erasable_answers`**: transient. Free text and anything else about a
  person. Blanked by the sweep, never counted. NULL when empty, never `{}`.

Plus `email`, `email_consent` and `ip_hash` as the entry's own columns.

The split is **two columns**, not a convention, so a count physically cannot
reach anything erasable. `aggregates.ts` never names the erasable column, and a
unit test fails if it does.

**The row survives the sweep and the pieces do not.** `erased_at` records it,
and the table's CHECK refuses a row marked erased that still holds any of the
erasable half.

**There is no `expires_at` on any list row.** The credentials sweep (operations)
DELETEs whole rows keyed on that name. The column is `personal_expires_at`; the
two credential tables here (`list_erasures`, `list_notify_confirmations`) carry
`expires_at` because they are credentials. A unit test checks both halves, and
another fails if any code outside `lists/` deletes rows from a list table.

Three retention classes (`retention.ts`): `absent`, `transient`, `durable`.
`list_fields.retention` is **NOT NULL with no default**: there is no safe
blanket value, so a writer that forgets fails loudly.

## The countable box, and the gate

Two properties that look like one (`fields.ts`):

1. **Is this question personal?** Derived from its kind. **Unknown kinds count
   as personal.** `location` is impersonal (a code from a closed list); `place`
   is personal (prose names streets).
2. **May its answers be counted?** An operator's tick, off by default.

Only a closed vocabulary can be counted (`AGGREGATABLE_KINDS`, which a unit test
checks against the migration's CHECK). The module is stricter than the CHECK: a
`place` with `allowOther` is refused, a question not collected cannot be
counted, and a counted question the sweep erases is refused.

**The gate**: a form that may collect anything personal must ask for an
address, so it can erase on request. It is derived from the questions, never
ticked. **Requiring an address of the FORM is not requiring one of every
submission**: `fileEntry` refuses only `prepared.erasable && !email`, so
somebody sending a link and two choices is never asked for an address.

`lists.email_mode`: `auto` (the gate) or `required` (everybody: a form for
reaching the site). `required` only adds; there is no "never".

`file` and `evidence_declaration` are refused outright, by the module and by a
CHECK.

## Counting

`summaryFor` returns the definition, the totals and a breakdown per countable
question. **Received and approved are both reported, always.** Asking for a
question nobody ticked is an error. A contact form ticks nothing, so a tool
that asks finds nothing: that is the answer.

**A count carries the definition it was computed under**, because a list's form
is editable.

`snapshotDocument` is the publication boundary (listed **and** published). It is
built and tested but **not yet published anywhere**: legacy wrote it daily as
`counts/<date>.json` beside the anchor, with its own digest and timestamp. That
is the board and anchor workstream's to wire.

## Review, in bulk

`reviewBatch` shows the host of every link, unfamiliar ones marked
(`LIST_KNOWN_HOSTS`), and clusters: one hashed address sending many, and the
busiest minutes. The hash never leaves the function.

`review_state` (received / approved / rejected) and `triage_state` (new /
triaged / actioned / closed) are different columns on purpose. A reviewer
approves **the ids ticked on screen**, never "everything waiting". An entry
cannot be un-reviewed, and rejecting is not deleting.

## Addresses: an HMAC under a secret that is then destroyed

The raw address is never written. `ip_hash` is HMAC-SHA256 under a random
32-byte secret per UTC day (`salt.ts`); the sweep destroys secrets older than
`LIST_SALT_DAYS`. **Never derive the day's secret from a long-lived key and the
date**: that looks like rotation and destroys nothing.

## Links

Accept broadly, sort afterwards. Refused: non-http(s), a bare address as host
(all four spellings), credentials before the host, known shorteners.
**`youtu.be` is not a shortener and must never become one.** Normalizing
lowercases the host, strips a trailing dot, punycodes, strips trackers (not `v`,
not `t`), sorts the remaining parameters and drops a fragment unless it names a
post. `url_key` is sha256 of that, so **changing the normalization is a decision
about every row already written.** The server never requests a submitted URL.

One person pasting the same link twice is one link.

## The erasure link and the list-mail link

`/api/forget/:token` (delete what you sent) and `/api/list-mail/:token` (agree
to receive a list's entries) are served by the server as plain HTML, **in front
of the site password**, with their own strict content security policy. **A GET
shows a button and changes nothing**: mail scanners open every link. Only the
POST acts. Tokens are random, stored hashed, work once, and unknown, used and
expired all answer alike.

An erasure link lives as long as there is something to erase: the entry's own
`personal_expires_at`, or `LIST_ERASURE_LINK_DAYS` when that is NULL.

Naming an address other than `ADMIN_EMAIL` to receive a list's entries holds it
as pending and emails it a link; it receives nothing until the link is used,
and naming another address makes the earlier link worthless.

Both links are reached in the browser suite by **following them out of the
email the server wrote** (`apps/web/e2e/lists.spec.ts`).

## Visibility and the site password

`hidden` (administrators only, as a preview), `password` ("team only": anybody
signed in), `listed` (anybody past the site password; on the front page while
it takes entries). **A list somebody may not see is 404, never 403.**

`outside_access`: `closed` (default), `link` (works without the password),
`door` (also offered on the password page via `doors()`). Only a listed list may
be open outside (a CHECK); making a list hidden or team-only closes the door
with it. List routes carry `config: { curtain: 'decides-itself' }` and call
`hasSiteAccess` themselves; a list not open outside answers exactly what the
gate would.

## Configuration

| Setting                  | Default | Meaning                                                        |
| ------------------------ | ------- | -------------------------------------------------------------- |
| `LIST_PERSONAL_DAYS`     | 90      | Days the personal half is kept, or `never`. A typo stops start |
| `LIST_SALT_DAYS`         | 2       | Days a day's address secret is kept                            |
| `LIST_ERASURE_LINK_DAYS` | 365     | An erasure link's life where nothing expires on its own        |
| `LIST_KNOWN_HOSTS`       | (none)  | Link hosts a reviewer knows, comma-separated                   |
| `ADMIN_EMAIL`            | (none)  | Where entries go when a list names no address                  |

## The sweep

`sweepLists` (`sweep.ts`) erases expired personal halves, destroys old secrets,
and deletes spent and expired links. `pnpm --filter @reportlog/api lists:sweep`
runs it once and prints one line per table. **The operations workstream
schedules it**; until it does, `LIST_PERSONAL_DAYS` is a sentence only.

Its last step rebuilds the text index (below) whenever anything was erased in
the last 31 days, by the clock or by an erasure link.

## Finding somebody: the subject access search

"What do you hold about me" is answered at **`/lists/search`**, for
administrators only (`POST /api/admin/lists/search`, `search.ts`). It searches
every list's personal half, the string answers in `erasable_answers` and the
address in `email`, through one GIN index (`list_entries_text_idx`, legacy
046's). The durable half is links and choices, with nobody in it, so it is not
searched. The words go in a POST body, never an address, so a name typed there
is in no history or access log.

- **`simple`, not `english`.** It finds a person, and English drops stop words:
  "Will" and "May" are names. No stemming: it looks for what was written.
- **`websearch_to_tsquery`**, so quotes, `or`, `-word` and stray punctuation
  all parse. Up to 200 characters, up to 200 entries, newest first.
- **The expression is written twice**, in the migration and in `search.ts`,
  character for character; Postgres uses an expression index only for the same
  expression. `test/db/lists-search.test.ts` checks the plan and both texts.

**What has been erased is not found, and is not in the index.** A blanked entry
stops matching at once, because the index covers only columns the sweep
empties. That alone is not enough: a GIN index keeps an erased word's bytes in
its pages after the UPDATE, and `VACUUM` does not remove them. So the sweep
rebuilds the index (`REINDEX … CONCURRENTLY`, entries keep arriving), and first
drops any half-built copy a failed rebuild left behind, which would hold the
same words. The database test reads the index's raw pages with `pageinspect`
to see the word there before the sweep and gone after it.

## Lists are not in the archive export

An entry is a lead or a tally whose personal half is about to be erased, so
writing it into a permanent export (or importing it back) would undo erasure.
When the board workstream builds the export, it should name its tables
explicitly and leave the list tables out.

## The screens

- **`/lists`**: every list, and making one. The first question is whether what
  people send has to be permanent and checkable; a yes points at the logbooks.
  A new list starts hidden.
- **`/lists/:id`**: switches, questions (saved as a whole set; a question's key
  is fixed once saved), counts so far, and deleting a list nobody has used.
- **`/lists/review`** and **`/lists/review/:id`**: bulk review, for moderators
  and administrators.
- **`/lists/search`**: finding somebody's entries, for administrators.
- **`/list/:slug`**: the form, one question per card.

## Not ported

- **Volunteering as a list** (legacy migration 047 made `/list/volunteer` from
  that deployment's volunteer roles). There are no volunteer roles here.
- **Cross-tabulation and link counts over HTTP.** `crossTabFor` and
  `linkCounts` exist and are tested; nothing calls them from a route yet, as in
  legacy.
