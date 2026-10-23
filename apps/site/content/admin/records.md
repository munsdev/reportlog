---
title: Records, updates and backups
description: The screens that show what the site has done: the transparency log, updates, who opened protected data, backups and exports, and feedback.
---

These screens are under **Records** in the staff menu.

## Transparency log

For administrators. Shows each daily anchor run, the chain heads it timestamped, and whether the transparency log is reaching every place it is pushed to. A run that could not publish is shown as one. From here an administrator can download a logbook's complete chain file, after a second-factor check.

The daily `anchor` job does the work; `anchor-watch` checks later in the day, from outside the job, that it ran, and alerts if it did not. The log itself is never rewritten, not even to correct it: if something is found that invalidates published proofs, that fact is published beside them.

## Updates

For administrators. Shows what the server's last update check found: the version running, how far behind it is, and the release notes in between. Two buttons:

- **Check now** asks the server to check again.
- **Install** deploys exactly the commit the server is configured to follow, the one the check offered. Nothing else can be installed from here.

The website never runs the update itself. It leaves a request that a root service on the server picks up, checks and carries out, with the same checks and automatic switch back as a deploy from the terminal; the end of its output appears on this screen. The [Updates](/docs/operate/updates/) section of the runbook explains how it works and why it is safe.

## Who opened protected data

For administrators. The access log: every time somebody opened a reporter's contact details, a file's original or a copy, used an address to ask for evidence, or viewed the journalist desk, with who, when and the reason they gave. Reading this log is recorded in it too.

Reporters see the entries about their own reports, with the reason and without the staff member's name. See [Reporter details](/docs/moderate/reporter-details/).

## Backups and exports

For the owner only. Start a backup of the database or an export of the archive, then download it. Each needs a second-factor check, and each download is recorded in the role audit. Restoring is never done from the website; the page gives the command, and [Restoring a backup](/docs/operate/restoring-a-backup/) explains it.

The nightly `backup` job runs whether or not anybody uses this screen.

## Feedback

Testers, Access Managers and administrators can report problems and ideas under **Your work › Feedback**. Authors appear under a masked handle, and comments are never edited. Administrators work the queue under **Site settings › Feedback queue**: moving an issue needs a note, which is emailed to the tester. Every Monday the open issues are emailed to `ADMIN_EMAIL`. The tester flag is given under **Your work › Testers**.
