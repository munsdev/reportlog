# FT-C2: consolidation and leftovers

Checks run: `tsc --noEmit -p apps/web`, eslint and prettier on changed files. No tests run.

## Consolidated (one component each, imports updated, duplicates deleted)

- Btn (was Btn/StaffBtn/SmBtn): `look` go|ink|ghost|bad, `sm`, `lg`, `flat`, `asChild`, `busy`. Staff buttons are `sm flat`.
- Panel (PanelBox): `title`, `kind` deep|quiet|danger|closed, `head`, `headingLevel`.
- Note (NoteBox, the Note in Panel.tsx): `title`, `warn`, `lock`, `tone`; ErrorNote and Waiting live there. `warn` now says `role=alert` everywhere.
- Dl (DlList), Empty (EmptyBox), Switch (SwitchRow: `label/help/checked`), SaveBar (SaveBarStrip: `name`).
- Field (Field, Fields, FieldWired, Form): prop form and wired form in one file; Input/Select/Textarea/CheckBox/TextField/AreaField/SelectField.
- Choice (Choice, Choices, ChoicesWired): RadioGroup/RadioOption/CheckOption now in Choice.tsx.
- Modal (Modal, Dialog, Dlg): Dialog pieces now use the `dlg-scrim` / `dlg modal` classes.
- Wordmark (Wm, `to` prop), Pager (PagerLinks, via `link`), CopyButton (CopyBtn), PTabs (AreaTabs deleted).
- Removed unused: nav/Menu (kept only mainAction/BugLink), MenuButton, CheckRow, nav/Wordmark, site-pages CopyBox/CopyButton, ui/setting-panel.

## Ported

FileDrop (label.file-drop + vh input) and file list on filing/evidence/Files/AccountFiles; PublishedFiles; door puzzle and honeypot (calls unchanged); secondFactor (recovery codes, set-up first, QR), StepUp dialog; IllegalContent; SignupPage; CheckAReport; toast; setting panel; NotASample; Count/CopyText/type; PublicPage and Terms (band, narrow column, prose); Directory; IntakePaused; gate and not-for-this-account screens; ReportAnswers; HeatMap chrome.
Look screen (taken over from X1): named looks are `.lookcard` cards with a palette colour strip (rules in mockup/panel.css), the pinned phone bar is `.phone-decide` (Apply / Back while previewing), preview frames draw the public header, hero, zone, panel markup. Wizard Look step uses `two-col`.
Sidebar: `sectionsFor` in staff-nav/entries.ts gives You, Review, Content, Site, Rules, People, Logs and system, Journalist desk, Your organization, Help, in the mock-up's order. Added Site settings (/settings) and Front page and pages (/logbooks/pages; the front-page tab belongs to it). Kept "Import and export" (X1, owner only) under Site; the mock-up has no such row.

## Not done / left

- `routes/dev.components.tsx` (dev showcase) still uses the old Tailwind components in `components/ui/` (alert, bars, card, checkbox, dialog, ...). Deleting the route also means editing routeTree.gen.ts and test/staff-guards.test.tsx; not touched. Those files can go with it.
- Still Tailwind-styled and not in the mock-up: `components/ui/follow-button.tsx`, `dev-badge.tsx` (floating buttons, no mock-up page), `__root.tsx` flex shell, `HeaderBackground` doc comment only.
- `St` and `Chip` are still two components for `.st`; not in the brief's list.
- Not verified in a browser: preview frames in the Look screen, file drop drag state, toast layout.
