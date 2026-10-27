# FT-N1: free text is an attached note, behind a logbook toggle

Branch `claude/ft-n1-notes`. Lean checks only (tsc api/web/fields, eslint, prettier, unit tests for
`logbooks.test.ts`, fields, builder-switches, settings). No db, e2e or `pnpm check` run.

## Built

1. **Server refuses** plain `short_text`, `long_text`, `url`, `email` and an open `place` (no list, or
   typing allowed) on a logbook, from `addField` (so create, import via logbookFile and templates all
   pass it) and from `updateField` (a place cannot become open). Sentence: "Free text on a logbook is an
   attached note that is never published. Use an attached note or link." Rule is
   `isPublishedFreeText` in `packages/fields/src/email.ts`. Lists untouched. Stored questions keep
   working; rewording one is still allowed.
2. **Staff logbook page**: Alert on such a question ("This question is published as typed and cannot
   be changed."). **Builder** picker: "Attached note (never published)", "Attached link (never
   published)", "Place (pick from your list)"; plain kinds not offered; default kind is the note; a new
   place is always a closed list (the "let people type" tick is gone). Lists have their own form.
3. **Templates** elections, general, workplace: short_text and long_text became `private_text`, and the
   one required (account) is now optional so a note never forces an address. `how-voting-went.json`
   untouched. Unit test: no shipped template asks published free text.
4. **Toggle**: nullable `logbooks.accepts_notes` (migration `20261027085714_accepts_notes.sql`, types
   regenerated), NULL/false = off. Settings panel "Notes and links from reporters" (SettingPanels,
   closed summary + Edit). Off: public logbook omits the held questions, filing ignores them for the
   address rules and refuses a value sent for one ("This logbook does not take an attached note or
   link. Reload the page and send it again."). The launch trigger does not guard this column, so it
   can change after launch. Contract: `accepts_notes` on detail and update.

## Decisions

- Form version/`logbook_form` still lists all questions (held ones included); the toggle changes who is
  asked, not the sealed definition, so no existing report or form hash changes.
- Reporter corrections (`filing/mine.ts`) are not gated by the toggle (a reporter who already holds a
  note can still correct it).
- Template note questions have no `maxLength` set (default 5000).

## Not done / integrator must run

- ~40 db tests add `short_text`/`long_text` questions through `L.addField` or the admin route (e.g.
  logbooks, logbooks-http, templates, conditions, logbook-freeze, deploy-templates, home-buttons,
  logbook-file-switches, helpers). They now get `free-text`. Fix: insert those fixture questions with
  SQL in the helper, or switch to choice kinds. Not touched (lean order, unrun).
- No new db or browser test for the refusal or the toggle; the P1 sweep was not checked.
