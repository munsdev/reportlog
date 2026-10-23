---
title: Lists
description: Questionnaires whose answers are not sealed, for tips, check-ins and contact forms, and how long they keep what people send.
---

A list collects the same kinds of answer as a logbook, without sealing them. An entry in a list is not a report: it is never chained, it can be reviewed in batches, its form can change at any time, and the personal half of what it collects is erased after a while. Nothing a person writes in a list is ever published. At most, counts of its fixed-answer questions are, and only if an administrator publishes them.

Use a list for things that do not need protecting from silent change: links to published material, a tally of how a day went, a way to get in touch. When you make a list, the first question is whether what people send must be permanent. If it must, you are sent to make a logbook instead.

Lists are managed under **Logbooks and lists › Lists**, by administrators and the owner. The code keeps lists apart from sealing: nothing under lists can reach the sealing code or the chain.

## Starting points

The lists that ship are listed under [Logbooks](/docs/admin/logbooks/#making-one). The tips lists take links rather than accounts; the check-in list is two taps, because reports that went fine are what make a count of problems mean something; the contact list is a message to whoever runs the site.

## Settings

| Setting                   | Choices                                                                                                                                                                                                           |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Visibility                | **Hidden**: only administrators can open it, to see what the form looks like. **Team only**: anybody signed in. **Listed**: anybody who can reach the site, and it is on the front page while it takes entries.   |
| Without the site password | **Behind the site password**, **Anybody with the link** (not offered anywhere), or **Offered on the password page**. Only a listed list can be opened outside.                                                    |
| Email address             | **Only from somebody who writes something**, so they can have what they wrote deleted; somebody who only picks answers is not asked. Or **From everybody**, for a form people use to reach you, so you can reply. |
| Notify                    | An address emailed when an entry arrives. It is confirmed first, by a link sent to it, valid for seven days. When a list names nobody, entries go to `ADMIN_EMAIL`.                                               |
| Publish the counts        | Only for a listed list, and only over questions ticked as countable. Received and approved are always shown together.                                                                                             |
| Closed, schedule          | Stop taking entries, now or at a set time.                                                                                                                                                                        |

The questions are edited freely and saved as a whole set. A list nobody has used can be deleted; one with entries is closed instead.

## How long a list keeps things

Each question has a retention class:

| Class                | What happens                                                                                        |
| -------------------- | --------------------------------------------------------------------------------------------------- |
| Deleted on the timer | Erased after the retention period, or sooner if the person asks. The default for anything personal. |
| Kept                 | Never erased. Right for links, choices and counts.                                                  |
| Not asked            | Kept on the form but not shown or collected.                                                        |

The retention period is `LIST_PERSONAL_DAYS` (365 days unless the operator sets another, or `never`). The `lists-sweep` job erases the expired personal half every night; the rest of the entry stays.

Somebody who gave an address gets an **erasure link** with their entry, valid for `LIST_ERASURE_LINK_DAYS`. Following it erases the personal half of what they sent, at once. Addresses are stored as keyed hashes for matching, with secrets that rotate and are themselves erased once spent.

## Reviewing entries

Entries are reviewed under **Moderation › List review**, in batches: approve or reject only the entries named on the screen. Rejecting deletes nothing. Links whose host is not in `LIST_KNOWN_HOSTS` are marked for a closer look. A separate triage state (new, looked at, acted on, closed) tracks what has been dealt with. Tip links have their own screen. See [Tips, lists and notices](/docs/moderate/tips-lists-and-notices/).

## Finding somebody's entries

**Logbooks and lists › Find entries** searches the personal half of every list, for a request from somebody who wants to know what you hold about them, or to have it erased. The search terms are sent in the body of the request, so they are not kept in any address or log.
