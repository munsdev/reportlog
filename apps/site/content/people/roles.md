---
title: Roles
description: Who may do what on a site, who may appoint whom, and why one kind of administrator cannot make more of itself.
---

A person holds **one** site-wide role, plus any number of organization roles and flags.

| Role                 | What it is for                                                                                                                                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Owner**            | The one person at the top of a site. Everything an administrator can do, and also: appoints and removes administrators, vets journalists, takes backups and exports, resets other people's second factor, hands the seat over. |
| **Administrator**    | Runs the site: logbooks, lists, maps, files, settings, wording, legal notices, records. Can moderate, after accepting the moderator agreement.                                                                                 |
| **Access Manager**   | Appoints and removes moderators, manages organizations and their people.                                                                                                                                                       |
| **Moderator**        | Decides what is published. See [the moderation queue](/docs/moderate/the-queue/).                                                                                                                                              |
| **Journalist**       | Reads the journalist desk. Vetted by the owner. See [Journalists](/docs/admin/journalists/).                                                                                                                                   |
| **Signed-in person** | Anybody with an account: a reporter looking at their reports, a subscriber to email updates.                                                                                                                                   |

## Who may appoint whom

This table is read from the code (`MAY_GRANT` in `packages/access`), so it is always the one the site enforces:

{{roles}}

**The ceiling.** An Access Manager can appoint moderators and cannot appoint Access Managers; an administrator can appoint Access Managers and cannot appoint administrators. So neither role can spread on its own. Only the owner appoints or removes an administrator, and only the owner changes a journalist.

**The owner's seat cannot be granted.** It is in no row of that table, its own included, so no appointment can produce a second owner. It moves only by a **handover**: the owner offers it to somebody by email, with a code; that person accepts; the outgoing owner becomes an administrator. The setup wizard seats the first owner.

**Rank.** The owner counts as an administrator. Nothing else outranks anything: an administrator is not a moderator by rank, but administrators may work in the moderation screens once they have accepted the moderator agreement.

## Organization roles

Inside an [organization](/docs/admin/organizations/), a person is a **manager** or a **coordinator**. These sit beside a site-wide role, not instead of it.

## Flags

Two flags, given by Access Managers, administrators and the owner:

- **Tester**: may use the feedback tracker.
- **Team member**: a person on the operator's team. Their desk only changes which screens they are offered first; it grants nothing.

## Where it is done

- **People and access › Roles**: appoint and remove, within the table above. Each change asks for your second factor again.
- **People and access › Who is doing what**: everybody with a role, flag or organization, how much they filed and when they last acted.
- **People and access › Who granted what**: the role audit, read-only. Every appointment, removal, handover, second-factor reset and backup download is recorded there, and nobody can edit it.
