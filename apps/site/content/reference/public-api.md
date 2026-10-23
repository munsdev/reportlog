---
title: Public API
description: The counts and wordings a site offers to other software, their licence, and what is not in them.
---

Every ReportLog site serves a small read-only API under `/api/v1`. It needs no key. While a site has a password, the API is behind it too: it is not a way past it.

| Address                     | What it returns                                                                                                                                                                                                                                                 |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1`               | What the API offers, on what terms, and its promise about stability.                                                                                                                                                                                            |
| `GET /api/v1/stats`         | Counts over the published record: for each logbook, its number of published reports and, per question, the count of each answer and of unanswered. Cached for 60 seconds.                                                                                       |
| `GET /api/v1/consent-texts` | Every wording of the publication question the site has shown, by digest. A published report seals the digest of the exact sentence its reporter answered; this is how that digest is read back. The digest is the SHA-256 of the wording, so it can be checked. |

**Only published reports are counted.** Nothing under review is counted, and declined reports are counted only by reason, on the board's activity page. Counts the site withholds (a place under a map's threshold, or a small place in a counts-only logbook) are marked as withheld, never given. When a site does not publish an archive, `/api/v1/stats` says so and returns no counts.

**Licence.** The counts and the wordings are offered under CC BY 4.0, attributed to the site. The reports themselves are not: each is its own author's account, published with their permission, which is not the site's to pass on.

**Stability.** Fields may be added. Existing fields will not be renamed, retyped or removed without a new version at `/api/v2`.

## Other public addresses

The website reads other public addresses, for the board, maps, checking a report and the site's own wording. They are not part of the API and may change between releases without notice. Where a site allows it, `/api/board/reports.csv` downloads the published reports and `/api/chain/<logbook>` a logbook's published chain file.
