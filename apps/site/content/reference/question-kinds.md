---
title: Question kinds
description: Every kind of question a logbook or list can ask, read from the code, with which ones make the form ask for an email address.
---

Logbooks and lists are built from the same kinds of question. This table is read from `packages/fields`, so it always matches what the builder offers.

{{question-kinds}}

**Asks the reporter for an address**: a form containing any question marked Yes asks every reporter for an email address, and files the report only after it is confirmed. A form whose questions are all marked No files each report the moment it is sent, with no address at all. See [Logbooks](/docs/admin/logbooks/#whether-reporters-are-asked-for-an-email-address).

**Can be a board filter**: the site's administrators choose which of these questions readers may filter the board by. Nothing is a filter by default.

**Can trigger a follow-up**: a later question can be asked only when this question had a particular answer.

## A few details

- **Location on a map** answers with a code from a fixed list (`DE`, `US-AZ`, or a US county such as `US-AZ-04013`), so the answers can be counted on a heat map. A US question can ask for the county; "not sure which county" stays an answer for the state.
- **Date**, **Time of day** and **Date and time** can be limited to a range; the picker offers nothing outside it.
- **Photos, video or documents** are not sealed themselves: their fingerprints are. So a file can be erased without breaking the chain.
- **Evidence they have but are not uploading** records that a reporter has something they are not uploading, so a moderator can ask for it later. What they said is sealed; whether they want to be asked is their permission to change.
