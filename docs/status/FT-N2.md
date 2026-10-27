# FT-N2: moderator rules for written accounts

Branch `claude/ft-n2-mod`. Lean checks only (tsc api and web, eslint, prettier, migration-guard and moderation unit tests). `pnpm check`, `test:db` and e2e were NOT run; the new db tests in `apps/api/test/db/written-accounts.test.ts` (describe "N2") are written but unrun.

## Built

1. **Batch approval** (`decideBatch`): a report whose newest version holds a written account or link with no decision yet is skipped with "It has a written account, which needs its own look." The queue row shows a disabled box with that sentence visible. Nothing typed batches as before. `QueueItem.has_undecided_written` carries it.
2. **Single approval** (`decideReport`, status valid): `written: [{ref, outcome, why, reason?}]` must cover each undecided text and link, else 409 `written_needs_decision`. Applied before the approval, each as its own record (`moderation/texts/approval.ts`). `DecideForm` shows a decision and a reason per item when approving such a report.
3. **Reason on every text decision** (checked, withheld, illegal, redaction save): 10 to 500 characters, `why_needed` sentence otherwise. New nullable `text_checks.reason` and `link_checks.reason`. Shown in the history of `getText` (staff scope only). Reporter (`myWritten`) and desk (`clearedTexts`/`readCleared`) never select it; test added.
4. **Reading is logged**: `POST /api/moderation/texts/:ref/open` (`openText`) writes a `contact_access_log` row, kind `text_read`, new `read_ref`, BEFORE decrypting; no reason. Lists, detail and the report panel no longer carry the words (`text` is null, panel links give `ref` not `url`); the UI shows them only after "Show the written account" / "Show the link". One press, one row; every moderator gets their own. "Who opened protected data" lists them (who, what, when, report).
5. **Guard**: the new open route, the check/redact routes and `decideReport` all sit in scopes with `moderatorGuard(db)` (agreement accepted); the batch route was already behind it.

Migration `20261027085705_text_reasons_and_reads.sql` (additive; listed in EXCEPTIONS for the widened CHECKs). Types regenerated.

## Decisions

- `why` is a new field beside the existing `reason` (the erase category), so the contract stays compatible.
- Link decisions made on the Links page (`links/routes.ts`) are NOT forced to carry a reason, and that scope is `roleGuard(['moderator','admin'])`, not `moderatorGuard`. Not changed (another workstream's); worth a look. Reasons are only required for links on the approval path.
- Reading a link on the Links page (`links/reads.ts`) is not logged `text_read` yet.
- The page still decrypts a text to count its characters (`length`), server side only; nothing is sent.
- `link_checks` is in the archive's table list, so the archive export now includes link reasons (internal).
- A link with no group (`group_id` null) cannot be decided and is ignored by both rules.
