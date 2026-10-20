# Plan D · session 4b · moderation and the EU platform items: status

- **Branch:** `claude/plan-d-moderation`, into `ccr-c9c93698-ev856l` (latest origin merged, types regenerated)
- **Pull request:** PR_NUMBER
- **Last updated:** 2026-10-20

## Checks

CHECKS_TABLE

## What was built

| Item                        | What                                                                                                                                                                                                 | Where                                                                        |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Decision 36, A5             | Counts of unapproved reports are on no public surface. `/api/board/stats` counts published reports only. A sweep walks every registered public GET route.                                            | `board/stats.ts`, `test/db/public-leak-sweep.test.ts`                        |
| Decision 37, K4/P2          | Moderators' Sources links are gone from the public page and API (`publicLinksFor` deleted). `linksFor` stays for staff; the journalist desk shows them. The sweep plants one and looks for it.       | `moderation/notes.ts`, `board/board.ts`                                      |
| Decision 39, I5             | Erase no longer withdraws. The confirmation email carries a second link; its page changes nothing until a button is pressed; browser test follows it out of the email.                               | `filing/mine.ts`, `identity/eraseLink.ts`, `e2e/platform/erase-link.spec.ts` |
| Decision 41, M1, D2, D3, I4 | A decline needs a reason from a fixed list and emails it with the terms clause. No key, no email, `no_key` recorded. The server decrypting to send is `decision_notices.sent`, not a person reading. | `moderation/rejection.ts`, `decision_notices`                                |
| M2                          | Batch approval: one transaction and one `moderation_log` row per report; withdrawn or already approved reports are skipped with a reason.                                                            | `moderation/queue.ts` (`decideBatch`), queue screen                          |
| M8                          | Versioned agreement for any audience (`moderator`, `journalist`): append-only texts and acceptances, `agreementGuard` on every moderator scope (queue, files, list review, evidence).                | `moderation/agreement.ts`, `Agreement.tsx`                                   |
| D1                          | Public form, receipt email, staff screen, decision email with its reason, status page by emailed link (a door). The sender's address is blanked once the decision has gone.                          | `moderation/contentNotices.ts`, `IllegalContent.tsx`, `e2e/platform/`        |
| D4                          | `/terms`: the software's own terms (reports, tips and links, illegal content) and three operator slots (own terms, contact for users, contact for authorities). Linked from every footer.            | `routes/terms.tsx`, `site/copy.ts`                                           |
| D5                          | Own flag, not the severity rating. Raising emails the owner at once and is a record; clearing is another row. Reports have a button; tips are flagged through the same API call.                     | `moderation/threats.ts`, `Item.tsx`                                          |
| P3                          | `NOT_A_SAMPLE` in contracts; `not_a_sample` served with board stats, maps, list counts and the press pack, in the digest email; one `NotASample` component.                                          | `contracts/platform.ts`, `components/ui/not-a-sample.tsx`                    |
| I6                          | `platform.test.ts` files, declines, erases and flags, then asserts the captured log holds no address, no 64-hex token and no URL.                                                                    |                                                                              |
| S1, S3, decision 43         | Static test that the Caddyfile asks for no `log` and has one `try_files`; a real Caddy serves the new pages from it and writes no client address, header or token.                                   | `test/unit/deploy-caddy.test.ts`                                             |

New append-only tables (`agreement_texts`, `agreement_acceptances`, `decision_notices`, `content_notice_events`, `threat_events`) have the
trigger pair and a planted row in the I4 sweep. `content_notices` is a projection of its events and says so in the migration.

## Things to know

- **Decision 37, "links and notes".** I removed the Sources links. The archive's own note ("A note from the archive") stays public: it is
  the parity feature, and the ruling names the Sources and their notes, not the note. If the ruling meant the note too, it is one line in
  `board.ts` (`present`).
- **No agreement text, no gate.** Until the owner publishes one for an audience, nobody is asked to accept anything. Publishing is what
  turns it on, for everybody at once.
- **Outside my folders, kept minimal:** `moderatorGuard(db)` replaces `roleGuard(['moderator','admin'])` in `files/`, `lists/` and
  `evidence/` routes (one line each); `confirmEmail` gains the erase link and `stageSubmission` passes it (`filing/filing.ts`);
  `mine.ts` only splits erase from withdraw; `not_a_sample` on the list counts response (`lists/routes.ts`, `contracts/lists.ts`).
  A merge conflict in any of them is these few lines.
- **Tips and D5.** The flag works on a tip by entry id (`POST /api/moderation/threats`, `subject_kind: "tip"`). The tip review screen is
  the links session's, so it has no button yet.
- **D1 rate limits** are in memory by client address (never logged), like the other public forms.
- **Caddy locally.** The Caddy tests need a `caddy` binary (`CADDY_BIN`); CI already installs one. I ran them against v2.10.2 checked
  against CI's hash.
- **Not done:** the digest email's line is tested; list counts have no page, so only the API field is tested; the copy `{{ figures }}`
  on the front page do not carry the line yet.
