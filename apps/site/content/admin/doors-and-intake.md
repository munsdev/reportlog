---
title: Doors and intake
description: The site password, the forms that can be reached without it, the checks every form runs, and the switches that stop new reports.
---

## The site password

A site can sit behind a password. While it is on, a visitor without it sees only the password page: the site's name, an optional paragraph you write (Wording, the password page), and links to any forms you offer as doors. Entering the password lets that browser in for 30 days.

The password is first set on the server, with `sudo reportlog site-password`; the setup wizard refuses to run until there is one. Afterwards administrators turn it on or off and change it under **People and access › Site password**. The command on the server is also the way back in if it is ever lost.

## Doors

A **door** is a page somebody can reach without the site password. Each launched logbook and each listed list says who may file to it without the password: nobody, anybody with its address, or anybody, with the password page offering it as a way in (see [Logbooks](/docs/admin/logbooks/#without-the-site-password) and [Lists](/docs/admin/lists/#settings)).

A door opens one form and nothing else. Behind it, the board, the other logbooks and the rest of the site stay behind the password. The pages a door reaches through links in emails (confirming a report, erasing an address, sending evidence, stopping a digest, following an illegal-content notice, and the journalists' links) work without the password too, and nothing else does: the server refuses every other call from a door page and sends the visitor back to the password page.

## What every form checks

Every report and every list entry passes through the same checks before it is accepted:

- **A start token**, given when the form is opened.
- **A minimum time** the form must have been open, set under **Site settings › Report and tip forms**. A person takes longer than a script.
- **A small puzzle** the visitor's browser solves in the background while they fill in the form, usually in under a second. Send works once it is done. Each solution is used once.
- **A hidden box** people never see and scripts fill in.
- **Limits per visitor**, counted in memory under keyed hashes whose key changes every day. No address is written down. The limits are settings: `DOOR_SUBMITS_PER_MINUTE`, `DOOR_SUBMITS_PER_HOUR` and `DOOR_REQUESTS_PER_MINUTE`.

Whatever fails, the visitor sees the same one sentence (yours, under Wording, or the shipped one), which never says which check it was. Sending again is all it takes for a person.

Separately, a visitor may send only so many reports for confirmation, and use only so many confirmation links, in 15 minutes (`FILING_SENDS_PER_CLIENT`, `FILING_CONFIRMS_PER_CLIENT`), because anybody can make a site email any address they type.

## Stopping new reports

| Switch             | Where                     | Who                           | What it does                                                                                                                       |
| ------------------ | ------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Accepting reports  | Site settings › Overview  | Administrators                | Opens or closes the whole site to new reports. Corrections and everything already filed are untouched.                             |
| Pause intake       | Moderation › Flood screen | Moderators and administrators | Pauses new reports during a flood, with a notice you write. Every use is recorded and shown publicly on the board's activity page. |
| Harder puzzle      | Moderation › Flood screen | Moderators and administrators | Makes the background puzzle harder for everybody. Recorded and shown publicly, like the pause.                                     |
| Close this logbook | The logbook's page        | Administrators                | Stops one logbook. Reversible.                                                                                                     |

Closing the whole site and pausing intake ask for your second factor again. See [Floods](/docs/moderate/floods/).
