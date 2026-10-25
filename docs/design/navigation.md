# REPORTLOG DESIGN

## N A V I G A T I O N

**Model B: wordmark left, Menu right, one panel that reaches every screen**

21 October 2026 · canvas boards "B · Desktop" and "B · Phone" · replaces `SessionNav`, `StaffNav` and every section link row

---

### 01

### T H E H E A D E R

**One sticky bar, the same at every width**

**LAYOUT**

`position: sticky; top: 0`, `deep` fill, a 6px bottom rule in `brand-on-deep`, 64px high on desktop and 56px on a phone. Inside the page's widest container (1216px, gutters as everywhere): the `Wordmark` on the left, linking home; the `MenuButton` on the right. Nothing else. The header never wraps and never scrolls sideways.

**WORDMARK**

The site's two-tone name (`BrandName`, kept), set in the label face, uppercase, 16px desktop and 15px phone, letter-spacing 0.08em. On the deep bar the first accent is `brand-on-deep`. It truncates with an ellipsis before it ever pushes the Menu button; below 360px it drops to 13px.

**MENU BUTTON**

A real `<button>`, `aria-expanded`, `aria-controls` naming the panel, label face: "Menu" and three bars, or "Close" and a cross when open. 44px tall. When the person has work waiting (moderation queue, list review, tip links, for their roles), a `Count` in `action` tone sits before the word, with the `aria-label` "7 reports waiting for a moderator". No count for signed-out visitors.

**PROGRESS RULE**

On a filing card the 6px bottom rule becomes the progress track: `brand-on-deep` fill over `line-on-deep`, width by the share of cards still possible that are done. Hidden on the intro card. Never shows numbers; the total only falls. The page keeps the rebuild's in-page `role="progressbar"` for screen readers, visually hidden.

**ON A DOOR**

On a filing door the header shows the wordmark and no Menu button, and calls nothing (the `useSite` rule). On the lock screen there is no header.

---

### 02

### T H E M E N U O N A D E S K T O P

**A panel under the bar, everything one click away**

**OPENING**

The panel drops from under the bar, `deeper` fill, full width with its content in the 1216px container, a 6px `brand-on-deep` bottom rule. The page behind it gets a `deeper` scrim at 55%. It closes on Close, Escape, a click on the scrim, and choosing any link. Focus moves to the first link on open and back to the Menu button on close. Focus is kept inside while open.

**ROW 1, THIS SITE**

The page's main action as a primary button: "Submit a report" (or the operator's first front-page button, if they renamed it). Then public links as outlined tiles: Board (with the published count), Check a report, How to use, About, Organizations, Home.

**ROW 2, STAFF** (only for people with staff entries)

A grid of up to five columns, one per area the person may open. Each column has a heading link (label face, a 2px `brand-on-deep` rule under it) to the area's first page, then a link to each page in it. A page with work waiting shows a neutral `Count`. The current page has a `brand-on-deep` 3px inset edge and `aria-current="page"`. Never teal.

**ROW 3, YOU**

Your account links (My reports, Email updates, Account and security), tester links (Feedback with the open-issue count, Testers, Report a bug on this page), Guides, then on the right "Signed in as" with the email in mono and a Sign out button. Signed out, this row is "Sign in" only.

**EASIER READING**

A switch at the end of row 3 for everybody, signed in or not ("Easier reading: Off"). See the look system spec, section 07.

---

### 03

### T H E M E N U O N A P H O N E

**A full-height sheet with folding staff areas**

Below 768px the panel is a sheet that fills the screen under the bar and scrolls. Order:

1. "Submit a report", primary, full width, 52px.
2. Public links as tiles, two per row.
3. "Staff": one row per area. The area holding the current page is open, showing its pages indented; the others are closed rows with a chevron (`<button aria-expanded>`). Opening one does not close another.
4. Guides, Feedback.
5. Your account.
6. "Signed in as", Sign out, Easier reading.

The Menu button moves to the right of the bar on phones too, where a thumb reaches it.

---

### 04

### T H E S T A F F A R E A S

**Five areas replace the flat list; each area has its own tabs**

`STAFF_ENTRIES` in `features/staff-nav/entries.ts` becomes a list of areas, each with its pages. A page that has an entry today keeps its `for` exactly. A page with no entry today takes its `for` from its route's own guard (`StaffOnly needs=` or `OnlyFor`): agreement admin; organizations, roster and audit admin and access manager; maps admin; illegal content notices moderator and admin; every `/settings/*` page admin; `/files/logbooks` as `/files`. An area shows if the person may open any page in it, and only those pages show.

| Area                   | Pages (route)                                                                                                                                                                                                                                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Moderation**         | Queue `/moderate` · Flood screen `/moderate/flood` · Tip links `/lists/links` · List review `/lists/review` · Illegal content notices `/moderate/illegal-content` · Files `/files` · Agreement `/moderate/agreement` · Moderation settings `/moderate/settings`                                              |
| **Logbooks and lists** | Logbooks `/logbooks` · Front page `/logbooks/front-page` · Lists `/lists` · Maps `/maps` · Find entries `/lists/search` · File limits `/files/settings`                                                                                                                                                      |
| **Site settings**      | Overview `/settings` · Look `/settings/look` · Name `/settings/name` · Wording `/settings/words` · Legal notices `/settings/legal` · Report and tip forms `/settings/forms` · Starting points `/settings/starting-points` · Development notice `/settings/development` · Feedback queue `/settings/feedback` |
| **People and access**  | Roles `/access` · Organizations `/access/orgs` · Journalists `/access/journalists` · Who is doing what `/access/roster` · Who granted what `/access/audit`                                                                                                                                                   |
| **Records**            | Transparency log `/transparency-log` · Backups and exports `/backups` · Who opened protected data (the access log, in `/moderate/settings` today)                                                                                                                                                            |

Outside the areas, by audience, in row 3: Journalist desk `/desk` (journalists), Intake `/intake` and Volunteer links `/intake/links` (organization coordinators and managers, shown as their own "Your organization" group), Feedback `/feedback` (testers, admins, access managers), Testers `/feedback/testers` (admins and access managers; it has no menu entry today), Guides `/docs`.

`/maps` gets its entry here; today nothing links to it. `/files/logbooks` and `/files/erase` stay reached from the Files page, and `/access/security` from Account and security.

---

### 05

### A R E A T A B S

**`AreaTabs`: the second level, on the page, under the title**

Every page in an area shows the area's pages as a tab row under the H1 and lede: label face, 13px, `ink-alt`, the current one `ink` with a 3px `brand` underline and `aria-current="page"`. Not `action`: action colour is for buttons only, and a tab is a link. These are links with addresses, not ARIA tabs: Back works, each page can be bookmarked.

On a phone the row scrolls sideways inside the page gutter, with a fade on the right edge while there is more, and scrolls the current tab into view on load. It never wraps.

The tabs replace the link rows in `settings/route.tsx` and `moderate/route.tsx`, and the board's header buttons (Board, By the numbers, Maps, Arrivals and declines, Press pack) become the board's own `AreaTabs`, public.

---

### 06

### T H E F O O T E R

**Kept, shorter**

The rebuild's footer stays: About · How to use · Moderation standard · Imprint and privacy · Terms · Report illegal content · Organizations · Public API · For journalists, the version link, "Powered by ReportLog" with source and licence (AGPL attribution, required). Add "Easier reading" at the end. The DevBadge stays bottom right and must never cover the Save bar: it lifts above it.

---

### 07

### K N O W N L I M I T A T I O N S , P R E C I S E L Y

- Five staff columns fit at 1216px. An owner who is also a journalist and an organization manager would need a sixth group; the panel then wraps to a second row of columns. Not drawn.
- The count on the Menu button needs one cheap call that returns waiting totals for the person's roles. It does not exist yet; it must stay quiet on a door like every other call.
- Which pages carry a `Count` inside the panel (Queue, Tip links, List review, Feedback) is decided here; their numbers come from calls that exist on those pages today and would need a summary endpoint.
- "Who opened protected data" is listed under Records but today lives inside Moderation settings. Moving it is a route change, not only a menu change.
- Sixteen pages in Moderation plus Site settings make long tab rows on a phone. They scroll; whether any should merge is not decided.

---

### 07

### T H E A P P F R A M E F O R E V E R Y O N E ( 2 3 O C T O B E R 2 0 2 6 )

Decision 71 amends 66. Anyone signed in gets the app frame (top bar and sidebar, a drawer behind "Menu" on a phone) on `/home`, `/mine`, `/notifications`, `/access`, `/access/security`, `/desk` and `/intake/*`, as well as on the staff pages. Never on a door page. The public menu has one link into it, "Your dashboard", and "Your account" for everybody.

`/home` is the dashboard: one card per thing the person has, one column on a phone, two or three on wider screens. Always "Your reports" and "Your account"; "Review" (with the waiting totals the header already fetches), "Journalist desk", "Your organization" and "Site administration" only for those who hold them. After sign-in, with no `next`, a person lands there.

The sidebar, top to bottom: **You** (Overview, My reports, Email updates, Account, and Account and security for anyone holding a role), **Journalist desk**, **Your organization**, then the staff areas sorted by job:

- **Review** (moderators): Reports queue, Tip links, List entries, Files, Illegal content notices, Flood screen.
- **Content** (administrators): Logbooks, Lists, Maps, Find entries, Report and tip forms, Starting points, Front page.
- **Site** (administrators): Name, Look, Wording, Social media, Legal notices, Development notice.
- **Rules** (administrators): Moderation settings, File limits, Moderator agreement, Journalist agreement (owner), Site password.
- **People** (those who grant access): People and roles, Organizations, Journalist requests (owner), Testers, Who is doing what.
- **Logs and system**: Transparency log, Who granted what, Who opened protected data, Backups and exports (owner), Updates.
- **Help**: Guides, Feedback, Feedback queue (administrators; a different screen from Feedback).

The old `/settings` overview keeps its route but has no menu entry; the dashboard took its place.
