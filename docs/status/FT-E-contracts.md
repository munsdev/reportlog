# FT-E contracts and routes (for worker F)

Branch `claude/ft-e-freetext`. All shapes are zod contracts in `packages/contracts/src/`; import from `@reportlog/contracts`.
Not for merging as a file. Everything below is already committed unless marked (soon).

## Links page (S2) - `links.ts`, existing routes, `LinkGroup` gained fields

`GET /api/link-checks?filter=unchecked|checked|withheld|illegal` -> `groups[]` now also has:
`from_tips`, `from_reports` (copies = both), `logbooks: {id,title}[]` (the reports' logbooks), beside `lists`.
Mock-up lines "3 from tips / 1 from a report" come from those two numbers. Check, comment, history, blocklist routes are unchanged:
a check of a group covers tip and report copies alike. Illegal now also erases report copies (with tombstones).
Unchecked tab only lists groups with a live copy. Waiting count: `/api/menu/waiting` -> `tip_links` (unchanged key).

## Written accounts (M1) - `texts.ts`

All moderator + admin scope (moderator agreement), under `/api/moderation/texts`:

- `listTexts` GET `/api/moderation/texts?filter=waiting|checked|redacted|withheld&page=` -> `{filter, counts{waiting,checked,redacted,withheld}, items: TextItem[], page, pages}`. Page size `TEXT_PAGE_SIZE` = 20.
- `getText` GET `/api/moderation/texts/:ref` -> `{item, redacted: string|null, history[]}` (the Redact page)
- `checkText` POST `/api/moderation/texts/:ref/check` body `{outcome: 'checked'|'withheld'|'illegal', reason?}`; reason (required for illegal) is one of `TEXT_ERASE_REASONS`. Errors are sentences in the `ApiError` shape; `not_shared` (409) when a report text is checked without the reporter's permission.
- `redactText` POST `.../:ref/redact` body `{body, why}` -> marks "checked with redaction". `body` must differ from the original and carry a `[bracketed]` marker.
- `reviewRedaction` POST `.../:ref/review` body `{verdict: 'approved'|'returned'}`: by a moderator other than the one who redacted, or by the owner. Returned deletes the copy and the item waits again.
  `TextItem`: `ref` (opaque; put in URLs), `source` report|tip, `text`, `length`, `outcome` (null = waiting), `checked_at/by`, `shared` (false => only Withheld/Illegal offered), `reference`, `thread_id`, `place`, `form_title`, `answers_public`, `received_at`, `redaction` (who/when/reviewed, never words).
- Report page panel: `getReportWritten` GET `/api/moderation/reports/:threadId/written` -> `{texts: TextItem[], links: [{group_id,url,outcome,also_tips,also_reports}], erased: [{kind,field_key,erased_at}], shared}`. Links are checked on the Links page ("Checked once, on Links, for every copy").
- Sidebar count: `/api/menu/waiting` gained `texts` (moderators only).
  Reporter (My report page, signed-in owner of the thread):
- `getMyWritten` GET `/api/mine/reports/:threadId/written` -> `{texts[], links[], erased[], shared}` each with `outcome` waiting|checked|...
- `eraseMyWritten` POST `/api/mine/reports/:threadId/written/erase` body `{confirm: true}` -> `{erased}`.
- Toggle "Vetted journalists may read it" is E1's existing `setMyPermission` with permission `journalist_sharing`.

## Desk (J1) - `journalists.ts`

- `deskTexts` GET `/api/desk/texts?page&q&mine` -> `{page,pages,texts: DeskText[]}`; `DeskText = {text, reference|null, place|null, outcome: checked|redacted, source: report|tip, checked_at}`.
- `DeskLink` gained `reports` (reports that shared the link) beside `tips`.
- Access log kinds added: `desk_text`, `desk_tip_text`.
