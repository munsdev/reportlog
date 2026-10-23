---
title: Trust model
description: What ReportLog protects against, what it relies on, and where it stops, for anybody deciding whether to rely on it.
---

## What it protects against

| Threat                                                        | What stops it                                                                                                                                                                                                         |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Somebody edits or deletes an old report in the database       | Triggers in the database refuse updates and deletes on the tables that hold reports. If the triggers themselves were removed, the change breaks the report's fingerprint and every link after it.                     |
| Somebody rebuilds a whole chain to hide a change              | The daily anchor: each logbook's newest fingerprint is timestamped by an independent authority and published to a transparency log other people hold copies of. A rebuilt chain does not lead to the published heads. |
| A whole logbook is removed                                    | Once listed, a logbook stays on every daily list and its count only grows. The daily job refuses to publish a list that drops one.                                                                                    |
| A report is moved to another logbook                          | Each logbook's chain starts from a value made from its web address, which can never change.                                                                                                                           |
| A launched form is changed so old answers mean something else | The database refuses changes to a launched logbook's questions other than new optional ones and clearer wording, and every report seals the version of the questions it was answered against.                         |
| Something is published without review                         | There is no code path that publishes without a moderator's approval.                                                                                                                                                  |
| More is published than the reporter allowed                   | The reporter's answer to the publication question is sealed with the exact wording they saw; files need a separate permission only the reporter can give.                                                             |
| Staff read reporters' addresses at will                       | Addresses are encrypted per report; every opening needs a second factor, a reason and a record written first, which the reporter can see.                                                                             |
| One administrator takes over a site                           | No role can appoint its own kind; only the owner appoints administrators; the owner's seat can only be handed over.                                                                                                   |
| A stolen password                                             | There are none: sign-in is an emailed code plus a second factor for every role holder.                                                                                                                                |
| A web request runs code as root                               | The website can only leave a request file for updates; a root service accepts a check or the one commit the server is configured to follow, and nothing else.                                                         |
| Visitors are tracked                                          | No third-party requests from any page; no IP address in any log.                                                                                                                                                      |

## What it relies on

- **The server's operator.** Whoever holds the server holds the keys, can read reporters' addresses, and can stop the site. The software makes changes to the record visible; it cannot make a dishonest operator honest. What it guarantees is that their changes show.
- **The timestamp authority and the copies of the transparency log.** The anchor is only as good as the authority's signature and the existence of copies the operator does not control. Keep a copy of a site's transparency log if you rely on it.
- **The contact key staying secret, and backed up.** Lose it and every address is gone; leak it and anybody with a database copy can read them.
- **Email.** Sign-in and confirmation go through email; whoever controls a staff member's mailbox can get their emailed code, though not their second factor.

## Where it stops

It cannot tell you a report is true, prove nothing was left out, or protect somebody who names themselves in their own answers. See [How it works](/docs/how-it-works/#what-it-cannot-promise).
