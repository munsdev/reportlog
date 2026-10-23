---
title: Legal notices and privacy
description: The imprint, privacy policy, terms and moderation standard every public site needs, and the facts about ReportLog's data handling to build them from.
---

> **This page is not legal advice.** What a site must publish depends on where it is run from and who runs it. ReportLog gives you the places to publish it and the facts about what the software does; what the notices say is yours to establish, with advice.

## What a site publishes, and where

| Notice                                                                  | Where it is written           | Where it appears                                |
| ----------------------------------------------------------------------- | ----------------------------- | ----------------------------------------------- |
| Imprint                                                                 | Site settings › Legal notices | `/legal`                                        |
| Privacy policy                                                          | Site settings › Legal notices | `/legal`                                        |
| Terms of use, how to contact the operator, how authorities can reach it | Site settings › Wording       | `/terms`, beside the software's own fixed terms |
| Moderation standard                                                     | Site settings › Wording       | `/standards`                                    |
| The first part of the About page: who runs this archive and why         | Site settings › Wording       | `/about`                                        |

A notice nobody has written says plainly that it has not been published. It is never filled with placeholder text, because a placeholder that reads like a legal notice is worse than none. The imprint and privacy editors open with an outline of what such a notice usually covers, with bracketed blanks; the outline itself is never published.

While the site password is on, these pages are behind it like everything else. The obligation usually starts when the site goes public, which is when the password comes off: write them before then.

## The facts to build a privacy policy from

These describe the software. Check them against your own setup: which providers you chose, and which settings you changed. The full list is under [Data and privacy](/docs/reference/data-and-privacy/).

**What a site holds about reporters**

- **The report**: the answers, sealed. If the form asked for an address, it is filed only after the reporter confirms it.
- **The reporter's email address**, only when the form asks for one. It is encrypted under a key belonging to that report alone, which is in turn encrypted under the site's contact key, and stored apart from the report. A report never contains an address.
- **Files**, when the logbook takes them: the original encrypted under a key of its own, and a re-encoded copy with its metadata removed.
- **Permissions** the reporter gave and can take back: passing their contact details on, publishing their files, being asked for evidence. Kept as a log, with the current value derived from it.

**What it holds about other people**

- **Accounts**: an email address, the role, the second factor, and staff audit records. Somebody can delete their own account.
- **List entries**: the answers, with the personal half erased after a set time (`LIST_PERSONAL_DAYS`, 365 days unless changed).
- **Journalist alert subscriptions**: the address and the chosen states.
- **Email digest subscriptions**, for people who asked for them.

**What it does not hold**

- **No IP addresses in any log.** The web server keeps no access log; the application logs the route pattern of each request, never the address or the full URL. Visitors' addresses are used in memory, under keyed hashes whose key changes daily, to count rate limits, and are never written down.
- **Two cookies only**: one that keeps somebody signed in, and one that remembers a browser got past the site password. **No analytics**, and nothing loaded from another site. A few conveniences live in the visitor's own browser storage and never leave it: the Easier reading switch, for instance, and after a report, the place and time offered to a tip.

**Who else sees data, depending on your setup**

- **Your email provider** (Scaleway, or your SMTP provider) carries every email the site sends: confirmation links, sign-in codes, notifications.
- **Your object storage provider** holds encrypted backups and, if you take files, the files.
- **The timestamp authority** (DFN by default) receives the day's list of fingerprints, never a report.
- **The git hosts you push the transparency log to** receive the same list and its timestamps, which are public by design.
- **GitHub** is contacted by the server for the code and the daily update check. No visitor or reporter data goes with it.
- **Error tracking**, if you turn it on, runs on your own server (Bugsink).

## Requests from the people in your records

**"What do you hold about me?"** A reporter signs in with their address and sees every report they filed, under My reports, with the record of every time staff opened their details. For lists, **Logbooks and lists › Find entries** searches every list's personal half.

**"Delete it."** A sealed report cannot be deleted: there is no code path that does it, and the database refuses one, because removing a sealed row would break every proof over it. What can be done, and what to tell somebody who asks:

- **Erase their address.** Destroying the report's own key makes the address unreadable for good, this site included. The reporter can do it themselves, from the confirmation email's link or from My reports.
- **Withdraw the report** from public view. The reporter can do this themselves; a moderator can withdraw a report too. The withdrawal is recorded.
- **Erase a file**, by destroying its key. The report still checks out.
- **Erase a list entry's personal half**, by its erasure link or after its retention period.
- **Delete an account.** The person can do it themselves; reports they filed and staff audit records stay.

Explain this before people file, not after: it belongs in your privacy policy and in your About page. A report filed through a form that asks for no address cannot be withdrawn or corrected by its reporter at all, because nothing ties it to them.

## Illegal content notices

Anybody can tell a site that something it published is illegal, without an account, at `/illegal-content`. An address is optional and gets them a receipt, a link to follow the notice, and the decision by email. Moderators decide notices under **Moderation › Illegal content notices**, each decision with a reason. See [Tips, lists and notices](/docs/moderate/tips-lists-and-notices/).

## Reasons for declining

When a moderator declines a report, they choose one of a fixed list of reasons, and the reporter is emailed it with a link to the terms, if their address is still readable. A bulk decline during a flood sends no email, and a report filed without an address has nobody to email.
