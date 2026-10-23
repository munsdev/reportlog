---
title: ReportLog documentation
nav: Introduction
description: How to install ReportLog, run a site with it, moderate what arrives, and check what it publishes.
---

ReportLog is free software for collecting incident reports and publishing them in a way that can be checked. People file reports through questionnaires you build. A moderator reads every report before anything is published. Every report is sealed into a chain when it is filed, so any later change shows, and once a day an outside authority timestamps the whole record.

You run it yourself, on one server. These pages are for the people who install it, run a site with it, and moderate it. People filing reports and reading what is published will find what concerns them under [Reporters and the public](/docs/public/filing/).

## Where to start

| If you want to                                  | Read                                                                       |
| ----------------------------------------------- | -------------------------------------------------------------------------- |
| Understand what it does and what it promises    | [How it works](/docs/how-it-works/)                                        |
| Install it on a server                          | [Quick start](/docs/quick-start/), then [Running a server](/docs/operate/) |
| Set up a new site after the install             | [The first hour](/docs/first-hour/)                                        |
| Build what people file to                       | [Logbooks](/docs/admin/logbooks/) and [Lists](/docs/admin/lists/)          |
| Review what arrives                             | [The moderation queue](/docs/moderate/the-queue/)                          |
| Decide who may do what                          | [Roles](/docs/people/roles/)                                               |
| Look up a setting, a command or a question kind | [Reference](/docs/reference/commands/)                                     |
| See what changed in a release                   | [Releases](/docs/releases/)                                                |

## The words these pages use

- **Site**: One installation of ReportLog, at one address. Its operator is whoever runs it.
- **Logbook**: A questionnaire whose answers are sealed. Every report filed to it is permanent and checkable.
- **List**: A questionnaire whose answers are not sealed: tips, check-ins, a contact form. An entry in a list is not a report.
- **Report**: What somebody files to a logbook. It is never edited and never deleted. A correction is a new version of it.
- **Board**: The public page of published reports.
- **Moderator**: A person who decides whether each report is published.
- **Owner**: The one person who holds the top seat of a site. There is exactly one.

These pages describe ReportLog as it is in the repository today. Each site runs the version its operator installed, which its pages show in the footer.
