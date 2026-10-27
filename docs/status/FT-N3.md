# FT-N3: journalists see only a note a moderator writes

Branch `claude/ft-n3-jnotes`. Lean checks: tsc (api, web), eslint, prettier, and the two rewritten db files run singly (written-accounts 16, journalist-desk 39 passing). `pnpm check`, whole `test:db` and e2e NOT run.

## Built
- Text outcomes are now: Keep internal (stored `withheld`), Write a note for journalists (stored `redacted`, no data migration), Illegal. "Checked as written" is removed from the API, contracts, queue, report page and the approval step (`written[]` takes `note` for a text decided `redacted`).
- Old `checked` rows read as waiting and never reach the desk (`clearance.ts` matches only `redacted` with a saved note and never opens an original).
- Note: required, must not equal the original, no bracket-marker rule. Needs the reporter's journalist_sharing. Same reason (10 to 500), encryption, review by another moderator or the owner.
- Note page: editor starts blank; original shown after the logged Show click; "Quote selection" inserts the selection in quotation marks at the cursor.
- Desk: only the note; lede and notice say it is written by a moderator and the reporter's words appear only where quoted. Access log before decrypt and sharing check unchanged.
- Reporter's own page says a note was written and their words are not passed on.
- Report links keep their existing check path (checked/withheld/illegal on Links, and in the approval step): a link is not prose.

## Decisions
- Kept the stored value `redacted` and the `/redact` route to avoid a migration; the words changed.
- Not enforced: that a note only contains reporter text inside quotes (cannot be told apart from the moderator's own words); only the whole-account paste is refused.

## Wording differs from the mock-up
- Mock-up s-redact "Edit the copy" with a prefilled copy and "Saving marks it Checked with redaction"; s-desk-texts "Checked" / "Checked with redaction" labels. Ours: blank note, "Note by a moderator".

## Also fixed
- written-accounts.test.ts N2 assertion used `statusCode` on an HttpError (`status`).
