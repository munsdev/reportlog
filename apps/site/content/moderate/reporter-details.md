---
title: Reporter details
description: When staff may open the address of the person who filed a report, what it costs them to do so, and what the reporter sees.
---

A report never contains its reporter's address. When a form asks for one, it is stored apart from the report, encrypted under a key that belongs to that report alone, and that key is itself encrypted under the site's contact key. Erasing the report's key makes the address unreadable for good.

## Who may open it, and how

Moderators and administrators may open a reporter's details, from the report's page. Every look costs the same:

1. **A second-factor check**, again, even in a session that already proved one.
2. **A written reason.**
3. **A record in the access log, written before anything is shown.** If the record cannot be written, nothing is shown.

The record holds who opened it, when, and the reason. Administrators read the log under **Records › Who opened protected data**, and reading it is recorded too.

## What the reporter sees

Under **My reports**, the reporter sees every time their details were opened, when, and the reason given, without the staff member's name. They are not emailed when it happens; they see it when they look.

## What the reporter allowed

Separately from publication, a reporter controls three permissions on each report, and can change them at any time under My reports:

| Permission                 | What it allows                                                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Passing contact details on | A moderator may pass the reporter's details to somebody who asks to follow up, a journalist or a lawyer for example |
| Publishing files           | The files the reporter attached may be published. Switching it off takes published files down.                      |
| Being asked for evidence   | An editor may contact the reporter to ask for evidence they said they have                                          |

Each is **off until the reporter switches it on**. Nothing in a report grants one.

Only the reporter changes these. No staff screen can, and the code that records them refuses any change not made by the reporter. Each is kept as a log of every change, with the current value read from it.
