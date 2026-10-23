---
title: Checking a report
description: How anybody can check that a published report has not been changed, and what the check does and does not prove.
---

## On the site

Every published report has a reference, like `RL-1234`. Its check page, at `/verify/` followed by the reference, rebuilds the report's fingerprint **in your own browser**, with the same code the server sealed it with, and compares it with the fingerprint the report carries and with the link the next report holds. `/verify` on its own takes a reference.

Anybody holding a reference can check its fingerprints, published or not: the reporter's printed declaration carries the reference, and may be handed to anybody. For a report that is not published, the check shows the fingerprints, the link and its position in the chain, and nothing of what it says.

## What the check proves

- **The report you see is the report that was sealed.** Change one word and its fingerprint changes.
- **It sits where it says in its logbook's chain.** Each report carries the fingerprint of the one before it; the first links to a starting value made from the logbook's web address.

## What it needs from outside

A chain proves it is consistent with itself. On its own, it cannot prove the server did not rebuild the whole chain. That is what the **daily anchor** is for: once a day the newest fingerprint of every logbook is timestamped by an independent authority (RFC 3161), and the list with its timestamp is pushed to a public transparency log in git repositories other people keep copies of. A report's fingerprint that the chain leads to from a timestamped head was in the record by that time, and it has not changed since.

A logbook on that list stays on every later one, and its count only grows, so a whole logbook cannot be removed without the next day's list showing it.

## Checking everything yourself

Where a site publishes them, each logbook's **published chain file** can be downloaded and checked from start to end, with the code in `packages/seal` in the source repository, which runs in a browser and needs no server. The transparency log's history shows every daily list since the site began.
