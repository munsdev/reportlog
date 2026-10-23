---
title: Journalists
description: Alerts for reporters of the news, the vetted journalist desk, and how the owner approves access.
---

Journalists can follow a site in two separate ways. A person can have either, or both.

## Alerts

On the public sign-up page for journalists (`/journalists/alerts`), anybody can ask for alerts: a daily email of **how many** new reports were approved in the US states they chose. Counts only, never the reports. One confirmation email confirms the address; the page gives the same answer whether or not the address was already on the list, so it cannot be used to find out who is.

Every alert carries a link to a page where the person changes their states, turns alerts off, or removes themselves from the list entirely. Turning alerts off keeps their desk access, if they have it; removing themselves from the list entirely ends it too. The `journalist-alerts` job sends the alerts every morning.

## The journalist desk

The **desk** is a read-only view for journalists the owner has vetted:

- tip links moderators have checked, with how many tips sent each one, the moderator's comment, and the tips' answers to fixed questions;
- the source links moderators attached to published reports, which are never public;
- the journalist's own alert settings.

Links are shown as text, never as clickable links, and every view of the desk is recorded in the access log.

## Asking for access, and approving it

The same sign-up page has a box to also ask for desk access, with the person's role, who they are, and optionally a press card. A request reaches the owner's queue only once its address is confirmed. `/journalists/access` takes a request from somebody who only has an address.

Only the **owner** approves, rejects or revokes journalist access, under **People and access › Journalists**, each with a second-factor check. Nothing is approved automatically. A journalist accepts the journalist agreement, which the owner publishes, before they see the desk, and proves a second factor like every role holder.
