# FT-E: free-text back end (S2 report links, M1 text moderation, J1 desk)

Branch `claude/ft-e-freetext` (merged E1 `claude/ft-e1-filing` and S1 final `e9f17da`). API, contracts, migration, tests only. Screens are worker F's: `CONTRACTS.md` has every route and shape.

## Built

- **S2 / W3.** Report links join the link store. `storeHeldRows` (reportValues/store.ts) groups each `private_link` by the link store's matching key (links/reportLinks.ts), so one check covers tips and reports. `LinkGroup` gained `from_tips`, `from_reports`, `logbooks`. Illegal erases report copies too (`eraseHeldGroup`, one tombstone per version), blocklist applies at filing, a domain block can take its host from a report copy. Groups are counted from the newest version of each report only.
- **M1 / W4.** `apps/api/src/moderation/texts/`: queue (report text and tip long-text answers), check (checked / withheld / illegal), redaction (separate copy, encrypted, erasable, must carry a new `[marker]`), review by another moderator or the owner, report-page panel, reporter's own view and erase. Menu count `texts`.
- **J1 / W5.** Desk: `GET /api/desk/texts`, `DeskLink.reports`, report links in `checkedLinks`. Everything logged before decryption (`desk_text`, `desk_tip_text`).
- Tests: `written-accounts.test.ts` (new, 12), `written-helpers.ts`, J10 rewrite plus a W5 block in `journalist-desk.test.ts`, `invariants`/`menu-waiting` updated. I ran only these files plus `held-values`, `links`, `links-k4` (all green); not the suite.

## Decisions taken

1. A text's check is keyed on the report text's sealed fingerprint (tip text: entry and question). So a files-only version keeps it and a correction that re-sends words is unchecked (D2). Even identical re-sent words get a new nonce and re-queue.
2. The desk reads `journalist_sharing` live (reportValues/onDesk.ts: newest version, not withdrawn, not declined, permission granted now). Revoking, withdrawing or declining takes things off at once; re-granting brings back checks that were made. Nothing is copied or cached.
3. Checked needs the permission (409 `not_shared`); redaction too; withheld and illegal do not. Tip text needs none (the tip line asks no permission).
4. A "tip text" is a long-text answer in `erasable_answers` of any list that also has a `url` question (the tip lists; the live tip list has none, so its queue is empty).
5. Redaction rules: the copy must differ from the original and carry a `[bracketed]` mark not in the original; a reason (<=500) is kept for the record. Returned review deletes the copy and the account waits again; moving off "redacted" also deletes it. The copy is deleted when the original is erased (in `reportValues/erase.ts`, by table, because the chain may not reach moderation).
6. Blocklisted report link: kept nowhere, nobody told, tombstone reason `blocklisted` (like a tip: silent). Added to `ERASURE_REASONS`.
7. Moderators reading text are not access-logged (like links, unlike contact details). Only the desk logs. Not behind `stepUpGuard` (links' check is not either); say so if you want it.
8. Desk text search and "My states" filter in the server over all cleared items (fine for the size; would need paging in SQL if cleared text reaches the thousands).
9. `contact_access_log` constraints were widened (kind, thread/report checks, new `text_item_id`), the same kind of change `desk_link` made. No row touched.
10. Small edits outside my folders: `reportValues/store.ts`, `erase.ts` (S1), `menu/waiting.ts`, `permissions/log.ts` came from E1.

## Not done / for others

- Screens (Written accounts, Redact, report panel, desk text tab, Links grouping, reporter panel, sidebar entries): worker F.
- Voting-form questions and cards (W2), public sweep (W7), docs: not mine.
- J10 decision row for `docs/decisions.md` (integrator adds), below.

## Decision row text (amends J10, and D7)

> **J10 amended (27 Oct 2026, with D7).** The journalist desk still never shows an email, an entry or thread id, a moderator's address, a withheld or unchecked item, or the original of a redacted account. It now also shows: a report's written account, only if a moderator checked it (as written, or the redacted copy) and only while the reporter's `journalist_sharing` permission is granted; links from reports under the same two conditions, through the link store's check; and a tip's description a moderator checked. The permission is read on every request, so revoking it, withdrawing the report, or a correction that changes the words takes the item off the desk at once. Every view is logged before anything is decrypted. Test: `journalist-desk.test.ts`, "W5".
