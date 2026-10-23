---
title: The first hour
description: From a freshly installed server to a site that has taken, approved and published its first test report.
---

Before you start, email must work: run `sudo reportlog mail-test you@example.org` and check the message arrives, including in the spam folder. The setup wizard signs you in with a code sent by email.

## 1. The setup wizard

A fresh site is closed behind a **site password**, set on the server with `sudo reportlog site-password`. Open the site, enter it, and the setup wizard starts. It refuses to run without a site password, so a stranger who finds a fresh install cannot seat themselves as its owner.

The wizard asks, one card at a time:

1. **Your email address**, and the code sent to it. You become the site's **owner**.
2. **The site's name.**
3. **A starting point**: a set of logbooks and lists to begin from, or nothing.
4. **Whether the site publishes** approved reports on a public board.
5. **Whether reports may include files.**
6. **The look**: a palette and a theme.
7. **Whether to keep the site password** in front of the site, or change it.

Everything here can be changed later under Site settings.

## 2. Your second factor

Everybody who holds a role proves a second factor after the emailed code: an authenticator app or a passkey. You set yours up when you first sign in, and you are given ten recovery codes. Keep them somewhere that is not your phone. Until a session has proved a second factor, the site treats the person as having no role at all. See [Signing in](/docs/people/signing-in/).

## 3. A logbook

A site with no open logbook accepts no reports. Under **Logbooks and lists › Logbooks**, make one from a starting point or from nothing, add and adjust its questions, read it through as a reporter would, and launch it.

**Launching cannot be undone.** Afterwards the logbook may gain new optional questions and have its wording clarified, and nothing else. Read [Logbooks](/docs/admin/logbooks/) before you launch, and practise on a test site if you can.

## 4. Somebody to review what arrives

Nothing is public until a moderator approves it. Under **People and access › Roles**, appoint a moderator with their email address. They sign in with an emailed code, set up their own second factor, and accept the moderator agreement before they see any reports. Administrators can moderate too, once they have accepted it. See [Roles](/docs/people/roles/).

## 5. One report, through the whole path

File a report yourself, from a phone if you can.

- If the form asks for an email address, **follow the confirmation link in the email**. The report is not filed until you do. A path that only runs when somebody clicks a link in an email is the path nothing reaches by accident.
- If the form asks nothing typed and takes no files, it is filed the moment you send it.

Then, as the moderator, approve it under **Moderation › Queue**, and find it on the public board. Open its check page and see the fingerprint match.

## 6. Before you give the address out

- Write the site's **imprint, privacy policy and moderation standard** under Site settings › Legal notices and Wording. The site says they are unpublished until you do. See [Legal notices and privacy](/docs/admin/legal-and-privacy/).
- Decide whether the **site password** stays on. While it is on, only the forms you open as doors can be reached without it. See [Doors and intake](/docs/admin/doors-and-intake/).
- Check that **off-site backups** are set up: the doctor warns until they are.
- Make sure the **transparency log** has somewhere to push to, so the daily timestamps are published.
