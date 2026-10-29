# Moderation in two queues

29 October 2026 · branch `claude/moderation-unified` · the owner's decision of
the same day:

> A moderator needs to look at the reports that come in, and they need to look
> at the lists that come in. These are two things… what goes to the journalist
> desk… should be irrelevant to a moderator. They should be able to just
> filter that.

## What a moderator sees

Two queues in the sidebar's Review group, nothing else:

| Queue            | Address         | Hub (where everything about one item is decided)                              |
| ---------------- | --------------- | ----------------------------------------------------------------------------- |
| **Reports**      | `/moderate`     | the report page, `/moderate/$threadId` (`features/moderation/Item.tsx`)       |
| **List entries** | `/lists/review` | one list's review page, `/lists/review/$id` (`features/lists/ListReview.tsx`) |

The sidebar and the page title keep the name **Reports queue**: the public
board is called "Reports" too, and two links with one name on one menu would
send people to the wrong place.

A hub holds the answers, the written account, its links, its files, the
decision and the row actions (severity, threat, incident, second read,
evidence, note, board, who filed it). Nothing about an item has to be decided
on another page.

## Filters instead of tabs

Every tab that used to be its own page becomes a filter on a queue. They
narrow whichever state is showing (Waiting, Approved, …), and the state
buttons count under them, as the second-read toggle always did.

**Reports** (`listQueue`, new query keys, all `'true'` or absent):

| Filter                | Key       | Means                                                                              |
| --------------------- | --------- | ---------------------------------------------------------------------------------- |
| Has a written account | `written` | the newest version holds a written account                                         |
| Has links to check    | `links`   | the newest version holds a link nobody has judged yet                              |
| Has files to check    | `files`   | the newest version holds a file nobody has decided on (the old Files waiting rule) |
| Can go to journalists | `sharing` | the reporter allows journalists now (`journalist_sharing`, newest row wins)        |
| Needs a second read   | `flagged` | as before                                                                          |

**List entries** (`getReviewBatch`, new query keys `links` and `written`):

| Filter                | Key       | Means                                                           |
| --------------------- | --------- | --------------------------------------------------------------- |
| Has links to check    | `links`   | the entry holds a link nobody has judged yet                    |
| Has a written account | `written` | the entry holds a tip description (a long answer on a tip list) |

"Can go to journalists" and "Needs a second read" are not offered on list
entries: a tip always allows journalists, and entries have no second read.
The list overview (`/lists/review`) says per list how many waiting entries
have links to check or a written account, each a link to the filtered page.

CLAUDE.md says nothing is filterable unless an operator said so. These are
filters on staff work queues, not on public data, and the owner asked for
them (29 October 2026). The code says so where they are defined.

## Journalist sharing is part of the decision

- Shown only when the reporter allowed it. In the Decide form, when approving
  a report whose written account has no decision yet, each such account gets
  three choices: **Leave it with the report (staff only)** (chosen already),
  **Write a note for journalists** (a box for the note), **Illegal: erase it
  now** (a category, a tick, and a reason). Ignoring it is leaving it.
- When the reporter did not allow sharing, nothing waits on the moderator: the
  Decide form does not ask, and the account is left with the report when the
  report is approved. Its panel on the report page offers **Erase as illegal…**
  and nothing else.
- Only "Illegal" asks for a reason. The server still records a reason with
  every decision on a written account (`whyOf`, 10 to 500 characters), and
  that check stays: for "Leave it" and "Write a note" the page sends a fixed
  sentence that says what was done ("Left with the report, for staff only.",
  "Wrote a note for journalists."). The server is not changed.
- Links keep their own verdict (passes, withheld, illegal). A link still
  unjudged when its report is approved is judged in the Decide form, with no
  reason asked (the same fixed sentence goes on the record).
- The note editor (the original beside the note, "Quote selection") and the
  second moderator's review of a note move from `/moderate/texts/$ref` into the
  written account's panel, so they appear in both hubs.

## Links: check once, without a tab

A link is judged by its group, one per address, as the Links page did. The
report page and the list-entry page show each link's verdict wherever it
appears, and judging it there calls the same `checkLinkGroup`: it applies to
every copy, in every report and tip, now and later. The comment for
journalists is edited beside it once it passes. The hotline guidance shows
beside "Illegal". A link is text, never an anchor.

The blocklist moves to its own page (below).

## What each old page becomes

| Old page                                   | Becomes                                                                     |
| ------------------------------------------ | --------------------------------------------------------------------------- |
| Reports queue `/moderate`                  | **Reports**, with the new filters                                           |
| Written accounts `/moderate/texts`         | redirects to `/moderate?written=true`; page removed                         |
| A note `/moderate/texts/$ref`              | redirects to the report's page (a tip's: to List entries); page removed     |
| Links `/lists/links`                       | redirects to `/moderate?links=true`; page removed, blocklist moved          |
| List entries `/lists/review`               | **List entries**: each list with what waits, and links to the filtered page |
| A list's review `/lists/review/$id`        | the entries hub, with state and filters                                     |
| Files waiting `/files`                     | redirects to `/moderate?files=true`; page removed                           |
| A report's files `/files/$ref`             | redirects to the report's page, where its files and evidence already are    |
| Illegal content notices, Flood screen      | out of Review, into a new **Safety** group                                  |
| (new) Link blocklist `/moderate/blocklist` | the blocklist from the Links page, in Safety                                |
| Erasing a file `/files/erase`              | was a tab of Files waiting; now its own line in Safety (administrators)     |

`menu.ts` `FOLDED` names every redirect, so the sidebar marks Reports as
"where you are" on them.

## Server changes

Additive only. No migration.

1. `listQueue` takes `written`, `links`, `files`, `sharing`
   (`packages/contracts/src/moderation.ts`, `apps/api/src/moderation/queue.ts`).
   The status counts honour them, as they honour every other filter.
2. `getReviewBatch` takes `links` and `written`, and each `ReviewEntry`
   carries its tip descriptions as `texts` (ref, question, outcome), so the
   hub can open, note and erase them through the existing text routes
   (`packages/contracts/src/lists.ts`, `apps/api/src/lists/review.ts`).
3. `listReviewQueues` says per list how many waiting entries have links to
   check and a written account.

Every guard stays: the consent ceiling (`NOT_SHARED`, the desk's live read of
`journalist_sharing`), the illegal erasure's category, the logged opening of
words, the agreement gate, the moderator scope and its second factor.

## Open questions for the owner

- Batch approval still skips a report holding a written account or link with
  no decision ("needs its own look"). Approving those in a batch would need
  the server to treat "left with the report" as the default; not done here.
- Should the server stop asking a reason for "Leave it" and "Write a note",
  instead of the page sending a fixed sentence?
