# FT-D: staff, account, desk and organization pages to the mock-up

Branch `claude/ft-d-staff`. Built inside U3's shell; no U1 token was needed
beyond the existing `--rl-*` / Tailwind names (no new token added).

## Built

- **Shared pieces**: `components/ui/rows.tsx` (the mock-up's bordered `.rows`
  list: `Rows`, `RowItem`, `rowLink('end'|'ref')`), `.data-table` in
  `styles.css` (header row in mono, rules between rows) used by every staff
  table, `Chip` tones `wait` / `off` / `flag` (and `open` now dashed), `Card`
  variant `danger`, `KeyValueList` drawn as the mock-up's `.dl`.
- **Content**: Logbooks and Lists as rows with state chips; a logbook's page in
  the mock-up's order (back link, chips, address, the three buttons, a
  two-column grid of settings, Questions); a list's page (back link, address,
  two columns, Counts so far, danger panel to delete); Maps, Front page,
  Find somebody's entries, Report and tip forms, Starting points: titles and
  ledes to the mock-up.
- **Site / Rules**: Site settings, Name, Wording, Legal notices, Development
  notice, both agreements (published version, new version, a table of who
  accepted).
- **People / Logs**: People and roles (title), Organizations as rows, Journalist
  requests (title, lede), Who is doing what, Testers, Transparency log, Who
  granted what, Who opened protected data, Backups, Updates: ledes and tables.
- **Account**: My reports as rows; a report's page in two columns (answers,
  allowances, who opened your details | correct, withdraw, danger erase, print
  declaration button); declaration, Email updates (two panels), Signing in:
  all in the shell with the Account eyebrow.
- **Desk / organization / help**: desk pages use the staff head with the
  Journalist desk eyebrow; Filing for an organization lists batches as rows;
  Volunteer links in a panel; Guides as cards with a contents panel at the
  right; Feedback and Feedback queue titles and ledes.

## Wording that differs from the mock-up

- Front page: page title is "Front page" (mock-up "Front page and pages"; no
  pages screen exists), no "Pages and blocks" tab.
- Find somebody's entries: lede does not say "Every search is recorded"
  (the code does not record searches). Button is "Find", as the mock-up.
- Files: "Files: the site", "Files: each logbook" keep the code's titles
  (mock-up "File limits"); not touched, they are the files workstream's.
- Starting points panel is headed with the chosen starting point's name (a
  test and a screen reader rely on it); the mock-up's "What it changes" is the
  line under it.
- Audit lede also mentions copies of the archive taken off the server (the
  page lists those).
- Moderator/journalist agreement lede keeps the second sentence about asking
  everybody to accept again.
- Journalist desk "Checked links" lede is the mock-up's; the page still shows
  the tip count per link.

## Not done / needs the API

- `s-forms.html` settings with no API yet: written-account length, most links
  per report, report-email deletion date, reports per address per day, and
  "Ask for an email on tips". Only the minimum time on a form is rendered.
- Settings and logbook panels that are open forms with their own Save (logbook
  title, cover, email rule, publishing, front page, list settings) were not
  turned into the mock-up's closed "summary + Change" panels: that changes
  their Save flow and the browser tests that drive it. They sit in the
  mock-up's two-column grid with the same panel look.
- Accepting reports / Development notice keep the code's two-step choice cards
  rather than the mock-up's instant switch (closing intake mid-filing should
  take two acts).
- Slots for the written account and sharing switch on My reports are marked
  with a comment under the answers; nothing wired (E/M workers).
- Not checked in a browser (no e2e run, per the lean rules); 390 px layouts
  rely on the single-column fallbacks below 820/960 px.

## Tests

`tsc --noEmit` (web) clean; eslint and prettier on changed files; vitest for
the unit files that touch these screens. Browser specs updated for renamed
labels: builder (Front page heading), builder-switches (Site settings link),
lists-walk (Find button). None run.
