---
title: How it works
description: What happens to a report from the moment it is filed, what ReportLog promises about it, and what it deliberately cannot promise.
---

## A report's path

1. **Somebody files a report** through a logbook's form: one question per card, in the order the operator set. The last cards ask whether the report may be published and, when the form needs one, for an email address. See [Filing a report](/docs/public/filing/).
2. **It is sealed.** Its answers, the questions as they were asked, its reference and the time are put into one object, written out in a single canonical form (RFC 8785) and fingerprinted with SHA-256. If the form asked for an address, the report is sealed when the reporter follows the confirmation link in their email. If it asked nothing typed and took no files, it is sealed the moment it is sent, with no address at all.
3. **It joins its logbook's chain.** The report carries the fingerprint of the report before it in the same logbook. The first report of a logbook links to a starting value made from the logbook's web address, so a report cannot be moved from one chain to another without it showing.
4. **A moderator reads it**, and approves it, declines it or marks it unclear. Nothing reaches the public board any other way. See [The moderation queue](/docs/moderate/the-queue/).
5. **It is published**, if it was approved and its reporter allowed publication. What is published is the answers; who filed it never is.
6. **Once a day the record is witnessed.** The newest fingerprint of every logbook is sent to an independent timestamp authority (RFC 3161; by default DFN, in Germany), and the list with its timestamp is pushed to a transparency log kept in git repositories other people can hold copies of.

## What it promises

**A report is never edited and never deleted.** The database refuses it: the tables that hold reports, their questions, their files and the daily anchors have triggers that reject any update or delete. A correction is filed as a new version in the same thread, and both versions are kept. A report can be withdrawn from public view, and the withdrawal is itself recorded.

**Any change to an old report shows.** Changing anything in a sealed report changes its fingerprint, which breaks the link the next report holds.

**A whole logbook cannot quietly disappear.** Once a logbook is on the daily list it stays on every later one, and its count of reports can only grow. The daily job refuses to run if either would go backwards.

**Anybody can check a published report.** Its page shows its fingerprint. The check page rebuilds the fingerprint in the reader's own browser, with the same code the server sealed it with. See [Checking a report](/docs/public/checking-a-report/).

**Nothing is public until a person approves it.** There is no automatic publishing in the software and there must not be.

**The reporter's consent is the ceiling, moderation is the floor.** A moderator can publish less than the reporter allowed (the text without the files, say), never more. Only the reporter can change what they allowed.

**Who filed a report is kept apart.** A reporter's address is encrypted under a key of its own, which is itself encrypted under the site's contact key, and stored apart from the sealed report. Opening it takes a second-factor check and a written reason, the opening is recorded before anything is shown, and the reporter can see when it happened and why, without the staff member's name. See [Reporter details](/docs/moderate/reporter-details/).

**A logbook's questions are fixed once it opens.** After launch a logbook may gain new optional questions and have its wording clarified, and nothing else. Every report seals the version of the questions its reporter was actually asked. See [Launching](/docs/admin/logbooks/#launching-the-one-way-door).

**The pages talk to nobody else.** A ReportLog site loads no fonts, scripts, maps or trackers from any other site, so reading it tells no third party that somebody did.

## What it cannot promise

**That a report is true.** It can show that a report was filed at a certain time, has not changed since, and was reviewed by a person. Whether what it describes happened is a separate question.

**That nothing was left out.** The chain shows that what is there has not been changed. A report that was never filed leaves no trace.

**That the server is honest, on its own.** A chain proves it is consistent with itself and nothing more: whoever holds the database could rebuild the whole thing and it would still agree with itself. What shows it was not rebuilt is the daily timestamp, held by somebody else, and the copies of the transparency log other people keep.

**That a reporter who names themselves stays anonymous.** Addresses are kept apart and encrypted; an answer that names its own author is published as written.

## Logbooks and lists

Both are questionnaires built from the same [question kinds](/docs/reference/question-kinds/). The choice between them is one question: does what people send need to be permanent and checkable?

|                               | Logbook                                          | List                                                                |
| ----------------------------- | ------------------------------------------------ | ------------------------------------------------------------------- |
| Sealed and chained            | Yes                                              | No                                                                  |
| Can be changed after it opens | Only new optional questions and clearer wording  | Yes, freely                                                         |
| Reviewed                      | One report at a time, or in batches of approvals | In batches                                                          |
| What is published             | The approved reports' answers                    | At most counts of fixed answers, if an administrator publishes them |
| Personal details              | Kept, encrypted, until the reporter erases them  | Erased after a set time                                             |

A list is not a logbook with the guarantees switched off. A hard rule with a switch in front of it is not a hard rule.
