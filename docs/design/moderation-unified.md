# Moderation in two queues

## Where this stands

**Built, to decision 83** (3 November 2026, branch `claude/moderation-83`,
commit `1fc1f78`). The paused branch was merged onto `alpha` and then changed
where decision 83 (`docs/decisions.md`, row 83) differs from what follows.
Decision 83 wins wherever the two disagree; the sections below say so where
they were rewritten.

**What decision 83 changed here.**

- Approving a report puts it on the counts, the board and the maps, and
  nothing more. Its attachments (a written account, a link, a file) each
  carry their own status: **Waiting**, **Shown to journalists** (a file:
  **Published**) or **Kept back**. Approving never decides one. Declining a
  report keeps all of them back.
- Batch approval approves every report, those holding attachments included.
  The "needs its own look" skip is gone, and so is the rule that every link
  is judged before approval (`texts/approval.ts` removed; `decideReport`
  takes no `written` list).
- The Reports queue has one work filter, **Has attachments to review**
  (`attachments=true`), beside "Needs a second read" and "Not rated". It
  replaced "Has a written account", "Has links to check", "Has files to
  check" and "Can go to journalists".
- "Leave it" and "Write a note" ask for no reason, and the server no longer
  requires one (`optionalWhyOf` in `moderation/texts/items.ts`). "Illegal"
  still does.

Screens: `docs/screens/moderation-83/`.

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

**Reports** (`listQueue`, query keys `'true'` or absent). Decision 83: one
work filter, as the owner asked.

| Filter                    | Key           | Means                                                                                                                                                                              |
| ------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Has attachments to review | `attachments` | the newest version holds a written account or link nobody has decided, while the reporter allows journalists (`journalist_sharing`, newest row wins), or a file nobody has decided |
| Needs a second read       | `flagged`     | as before                                                                                                                                                                          |

Each queue row also says how many attachments it holds to review
(`attachments_waiting`). A written account or link the reporter did not share
waits on nobody: no journalist will read it, so there is nothing to decide.
If the reporter allows it later, it waits from then.

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

## Attachments are decided on their own (decision 83)

The report page has an **Attachments** section under what the reporter said:
each written account, each link and the files, each with its status chip.
Nothing about them is in the Decide form; approving says, in one line, that
the attachments still waiting stay hidden until they are reviewed.

- A written account the reporter allowed journalists to read offers
  **Write a note for journalists** and **Leave it with the report (staff
  only)**, neither asking a reason, and **Erase as illegal…**, which asks a
  category, a reason and a tick. One the reporter did not allow shows
  "Kept back" and offers only erasing.
- A link keeps its own verdict (passes, withheld, illegal), judged once for
  every copy, with no reason asked.
- A file keeps workstream F's decision (published, kept unpublished,
  refused), under the reporter's own permission.
- An attachment reaches journalists only where the reporter allowed it
  (`reportValues/onDesk.ts`), and never from a declined or withdrawn report.
  Nothing reaches anybody without a moderator's decision on it.
- The note editor (the original beside the note, "Quote selection") and the
  second moderator's review of a note are in the written account's panel,
  so they appear in both hubs.

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
| Written accounts `/moderate/texts`         | redirects to `/moderate?attachments=true`; page removed                     |
| A note `/moderate/texts/$ref`              | redirects to the report's page (a tip's: to List entries); page removed     |
| Links `/lists/links`                       | redirects to `/moderate?attachments=true`; page removed, blocklist moved    |
| List entries `/lists/review`               | **List entries**: each list with what waits, and links to the filtered page |
| A list's review `/lists/review/$id`        | the entries hub, with state and filters                                     |
| Files waiting `/files`                     | redirects to `/moderate?attachments=true`; page removed                     |
| A report's files `/files/$ref`             | redirects to the report's page, where its files and evidence already are    |
| Illegal content notices, Flood screen      | out of Review, into a new **Safety** group                                  |
| (new) Link blocklist `/moderate/blocklist` | the blocklist from the Links page, in Safety                                |
| Erasing a file `/files/erase`              | was a tab of Files waiting; now its own line in Safety (administrators)     |

`menu.ts` `FOLDED` names every redirect, so the sidebar marks Reports as
"where you are" on them.

## Server changes

No migration.

1. `listQueue` takes `attachments`, and each item carries
   `attachments_waiting` (`packages/contracts/src/moderation.ts`,
   `apps/api/src/moderation/queue.ts`). The status counts honour it, as they
   honour every other filter. `decideReport` no longer takes `written`, and
   `decideBatch` no longer skips a report holding attachments.
2. `getReviewBatch` takes `links` and `written`, and each `ReviewEntry`
   carries its tip descriptions as `texts` (ref, question, outcome), so the
   hub can open, note and erase them through the existing text routes
   (`packages/contracts/src/lists.ts`, `apps/api/src/lists/review.ts`).
3. `listReviewQueues` says per list how many waiting entries have links to
   check and a written account.

Every guard stays: the consent ceiling (`NOT_SHARED`, the desk's live read of
`journalist_sharing`), the illegal erasure's category, the logged opening of
words, the agreement gate, the moderator scope and its second factor.

## The owner's answers (decision 83, 1 November 2026)

- Batch approval of reports holding attachments: yes. Approving decides no
  attachment, so there is nothing to skip.
- A reason for "Leave it" and "Write a note": no longer asked, by the page
  or the server.
- An unjudged link at approval: no longer judged then. It waits for its own
  verdict.
