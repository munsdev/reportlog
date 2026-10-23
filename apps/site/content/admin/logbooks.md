---
title: Logbooks
description: Building the questionnaire people file reports to, launching it, and what may change afterwards.
---

A logbook is a questionnaire whose answers are sealed. Every report filed to it is permanent, chained to the one before it in the same logbook, and checkable by anybody. A site with no open logbook accepts no reports at all.

Logbooks are managed under **Logbooks and lists › Logbooks**, by administrators and the owner.

## Making one

Make a logbook from nothing, from one of the starting points the software ships, or from a logbook file downloaded from another site. Whichever you choose, it arrives as a **draft**, which you can change freely and nobody can file to.

It asks for two things:

- **A title**, which reporters see. A place, a period, a subject: whatever tells somebody they are filing to the right one.
- **A web address** (optional; made from the title if you leave it empty). It is sealed into every report and names the logbook's chain, so it can never be changed. A typo in it is fixed by deleting the draft and making another.

The starting points that ship:

{{starting-points}}

A description is optional and stays editable after launch, as does the title.

## Questions

Add questions one at a time. Each has a [kind](/docs/reference/question-kinds/) (short text, a choice, a date, a location on a map, a file, and others), a label, optional help, and three settings:

- **Required**: whether an answer is needed before the reporter can go on.
- **A filter on the board**: whether readers can filter published reports by it. Nothing is a filter unless you say so. There is no built-in date or place filter, because when and where are questions you ask, not fixed parts of a report.
- **Asked only when**: shown only after a particular earlier answer. The earlier question has to have fixed answers to follow: yes or no, choose one, choose any, or an evidence declaration.

Each question is its own card. One card asks one question, and nothing moves on by itself.

Three things people get wrong:

- **Do not ask for contact details, agreement or permission to publish.** The form already asks for an address when one is needed, and asks the publication question itself. Asking again stores a second copy in the wrong place.
- **A written account is not built in.** If you want one, and most logbooks do, ask for it as a long text question.
- **Read every question aloud** as if you had never seen it. It is the only way to notice a question that is clear to the person who wrote it and ambiguous to everybody else.

## Whether reporters are asked for an email address

This is decided by the questions, not by a switch:

- A form **asks for an address** when a question lets people type (short or long text, an email, a link, or a place that is not a closed list), takes files, or has an evidence declaration. Nothing is filed until the reporter confirms the address from the link sent to it, and they can sign in later to correct or withdraw their report.
- A form of **choices only** does not ask. Each report is filed the moment it is sent, with no link to confirm, and the reporter cannot come back to correct or withdraw it.

On a form of choices only, **Ask for an email address anyway** turns the address back on, for when you still want to be able to reach reporters.

## Publishing as a condition of filing

By default reporters are asked whether their report may be published, and a report whose reporter says no, or does not answer, is never published.

**Publishing is a condition of filing** turns the question into a statement: the last card tells reporters that filing here means the report may be published, once a moderator approves it. It is meant for a logbook that exists to be public and asks for nothing personal. Each report records which of the two it was filed under, so the switch can change after launch without touching reports already filed.

## Launching: the one-way door

Before you launch, read the form through as a reporter would. A draft cannot be filed to, and a report filed to a launched logbook can never be deleted: a test report stays in its chain for good. The safest place to practise is a test site. Download the logbook as a file, upload it there, launch it and file as often as you like.

**Launching cannot be undone.** It opens the logbook to reporters, offers it on the front page, and fixes its questions. Afterwards a logbook may:

- **gain a new optional question**;
- **have its wording clarified**: question labels, help, the labels of options that have codes, help shown for a particular answer, and a card's question. Each rewording is a new version of the form;
- have a question **marked or unmarked as a board filter**;
- have its title and description changed, be closed and reopened, and be given opening and closing times.

Nothing else. No removing a question, no reordering, no changing a kind or a code, no changing a condition, and no making an optional question required. Options without codes cannot be reworded either. The database itself refuses these changes, not just the website.

**Why it is this strict.** Every report seals the version of the questions its reporter was actually asked. If a launched form could change, one logbook would hold reports that cannot be read against one definition. Adding an optional question is safe only because a question nobody answered leaves no trace in a report at all.

A launched logbook can never be deleted. A draft can.

## Opening, closing and pausing

- **Opening and closing times**: a logbook can be given a time it opens and a time it closes.
- **Close this logbook**: stops new reports at once. Closing is reversible: **Reopen** undoes it. Everything already filed stays published and checkable.
- **Freeze uploads**: the logbook keeps asking for files but refuses new ones, so somebody part-way through attaching something is stopped; their report can still be sent without the files. Nothing already filed or published is hidden, and the freeze can be taken off at any time.

To stop reports on the whole site at once, see [Doors and intake](/docs/admin/doors-and-intake/).

## Without the site password

While the site has a password, each launched logbook says who can file to it without knowing it:

| Setting                                  | Who can file                                                         |
| ---------------------------------------- | -------------------------------------------------------------------- |
| Nobody                                   | Only people who know the site password                               |
| Anybody who has its address              | Anybody with the address of its form. Nothing else opens to them.    |
| Anybody, and the password page offers it | As above, and the password page also offers this logbook as a way in |

It opens the form and nothing else: the board, the other logbooks and the rest of the site stay behind the password.

## Logbook files and chain files

- **The logbook file** is the logbook's questions and settings, downloaded as one file. Upload it on another site to make the same logbook there, always as a draft.
- **The complete chain file** is every sealed report of the logbook, for anybody who wants to check the whole chain. Downloading it asks for your second factor again. Whether the public may download a logbook's published chain file is a site-wide setting under Moderation settings.

## Front page buttons

Every open logbook appears on the front page as a button wearing its own title. Under **Logbooks and lists › Front page**, administrators reorder the buttons, relabel them or hide them. The first button is drawn in the accent colour. See [Front page, wording and look](/docs/admin/front-page-and-look/).
