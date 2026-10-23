---
title: Data and privacy
description: Everything a ReportLog site stores, how it is protected, how long it is kept and how it is removed, for operators writing a privacy policy.
---

This page describes what the software does. Which providers a site uses, and how its operator set it up, decides the rest; a site's own privacy policy is its operator's to write. See [Legal notices and privacy](/docs/admin/legal-and-privacy/).

## What is stored

| Data                                                | Stored as                                                                                                     | Kept                                                       | Removed by                                                                                |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| A report's answers                                  | Sealed, in the database; published only when approved and allowed                                             | For good: it is the record                                 | Never deleted. Can be withdrawn from public view.                                         |
| A reporter's email address                          | Encrypted under a key of the report's own, itself encrypted under `CONTACT_KEY`; stored apart from the report | Until erased                                               | The reporter, from My reports or the confirmation email's link: destroys the report's key |
| A report filed before its address was confirmed     | A pending submission                                                                                          | Until the confirmation link expires (24 hours)             | The nightly `sweep` job                                                                   |
| Files: the original                                 | Encrypted under a key of the file's own, itself encrypted under `FILES_KEY`, in object storage                | Until erased                                               | An administrator, by destroying the file's key                                            |
| Files: the published copy                           | Re-encoded, with metadata removed                                                                             | While published                                            | Withholding or refusing it, or the reporter switching off publishing their files          |
| Reporter permissions                                | A log of every change                                                                                         | For good, as history                                       | Not removed: it records the reporter's own choices                                        |
| List entries: the personal half                     | In the database, with addresses as keyed hashes                                                               | `LIST_PERSONAL_DAYS` (365 days unless changed, or `never`) | The nightly `lists-sweep` job, or the person's erasure link                               |
| List entries: the rest                              | In the database                                                                                               | For good                                                   | Not removed                                                                               |
| Accounts                                            | Email address, role, second factor, memberships                                                               | Until deleted                                              | The person, from their account                                                            |
| Sign-in codes, sessions, invitations, unlock tokens | Hashed                                                                                                        | Until they expire                                          | The nightly `sweep` job                                                                   |
| Journalist alert subscriptions                      | Address and chosen states                                                                                     | Until removed                                              | The person, from the link in every alert                                                  |
| Email update subscriptions                          | Address, frequency, logbooks                                                                                  | Until stopped                                              | The person, from the link in every email                                                  |
| Illegal content notices                             | The notice and the decision                                                                                   | For good                                                   | The sender's name and address are blanked once the decision is sent                       |
| Evidence requests                                   | The request and the files it brought                                                                          | For good                                                   | The moderator's message is replaced with a fixed sentence a year after it was sent        |
| Staff records                                       | Who decided what, who opened what and why, who granted what                                                   | For good                                                   | Not removed: they are the audit trail                                                     |

## What is not stored

- **IP addresses.** The web server keeps no access log. The application logs each request's route pattern (`/api/reports/:ref`), never the address or the full URL, which can carry tokens. Visitors' addresses are used only in memory, under keyed hashes whose key changes every day, to count rate limits at the forms and at sign-in.
- **Browsing.** No analytics, no tracking, nothing loaded from another site: fonts, scripts and maps are all served by the site itself.
- **Cookies beyond two**: one that keeps a person signed in, and one that remembers a browser got past the site password (30 days). A few conveniences live in the visitor's own browser storage and never leave it.

## Where data leaves the server

| To                                              | What                                                                  | When                                     |
| ----------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------- |
| The email provider (Scaleway or an SMTP server) | Every email: confirmation links, sign-in codes, notifications, alerts | Whenever the site sends one              |
| The object storage provider                     | Encrypted backups; files, if the site takes them                      | Nightly, and as files arrive             |
| The timestamp authority (DFN by default)        | The day's list of chain heads: fingerprints only                      | Daily                                    |
| The transparency log's git hosts                | The same list and its timestamp, public by design                     | Daily                                    |
| GitHub                                          | Nothing about anybody: the server fetches code from it                | At deploy, and in the daily update check |
| Error tracking, if turned on                    | Errors, scrubbed to an allowed list of fields                         | Only to Bugsink on the same server       |

## Backups

The nightly backup is the whole database, encrypted with `age` to the public keys in `BACKUP_AGE_RECIPIENTS` before it leaves the server, sent to a bucket with an upload-only key. Reporters' addresses in it are still encrypted under the contact key, which is **not** in the backup. Expiry of old copies is set on the bucket.

## Requests from people

- **Access**: a reporter sees their own reports, permissions and the record of every opening of their details, under My reports. For lists, administrators search every list's personal half under **Find entries**.
- **Erasure**: see [what can and cannot be erased](/docs/admin/legal-and-privacy/#requests-from-the-people-in-your-records).
