# Changelog

What changed in ReportLog, release by release, newest first. Written for the
people who use a ReportLog site and the people who run one: what is
different for them, not which commits did it (`git log` has those).

**`sudo reportlog updates` reads this file**, so its shape matters:

- one `## vX.Y.Z — D Month YYYY` heading per release, newest first, and the
  same number as `"version"` in the root `package.json` for the newest one;
- everything under a heading, up to the next one, is that release's notes;
- changes not released yet go under `## Unreleased`, at the top.

A test (`apps/api/test/unit/release.test.ts`) fails if the newest heading
and `package.json` disagree. How a release is cut is in the README.

## Unreleased

**For somebody filing a report or sending a tip**

- A form that asks only for choices (no box to type in, no files) no longer asks for an email
  address. The report is filed the moment it is sent, and cannot be changed or withdrawn after.
  A form that lets you type, or takes files, asks for an address and sends a confirmation link,
  as before.
- A small check runs in the background while you fill in a form, and Send works once it is done
  (usually in under a second). Nothing about you is collected for it, and nothing is sent to any
  other site.
- If the site turns a form away, it says so in one plain sentence. Sending again is all it takes.
- A date or time question may only take answers between two limits, and the picker offers
  nothing outside them.
- Some logbooks exist to be public: there, the last card tells you that filing means your report
  may be published once a moderator approves it, instead of asking. The wording you saw is sealed
  with your report, as before.
- A location question can ask for the US county as well as the state, from a list that comes with
  the site. "Not sure which county" stays an answer.
- Easier reading, in the menu and the footer, shows the site in high contrast with a plainer
  theme, in your browser only.
- You can delete your own account, at the foot of Your account. Reports you filed stay sealed;
  erase your address on them first if you want it gone.
- If you sign up for journalist alerts, you can ask for access to the journalist desk on the same
  form, turn alerts off without losing the desk, and change your states from the link in every
  alert.

**For somebody running a site**

- Settings › Look offers a new library: 18 palettes and 11 themes, from typewritten to
  broadsheet, among them a High contrast pair for the clearest reading. Themes now differ in
  width, columns, type size and surface, not only type. A site keeps the look it has: one that
  never chose stays on Flint with Signal, and a choice made among the old palettes and themes is
  shown as the nearest new one and saved as it the next time the look is saved. A new site starts
  on Newsdesk.
- Look packs: an administrator can add more looks as a `.zip`, checked by the same rules as the
  built-in ones.
- Page titles grow from a phone to a desktop again, and the monospace type is IBM Plex Mono. Every
  font is still served from your own site.
- The password screen, and a form opened in front of the password, wear the site's colours and
  type rather than the default.
- The builder can require an email address on a form that would not otherwise ask for one, and
  can set the earliest and latest answer a date or time question takes (before launch).
- Reports and tips are checked at the door: a puzzle solved in the visitor's browser (ALTCHA,
  served from your own site), a hidden box, a minimum time on the form, and limits per network
  address per minute and per hour, with a higher limit on reading. Network addresses are kept only
  in memory, as hashes under a key that changes daily. Refusals are counted by check, with nothing
  of what was sent.
- `install.sh` makes a new `DOOR_KEY`. The limits are `DOOR_SUBMITS_PER_MINUTE`,
  `DOOR_SUBMITS_PER_HOUR` and `DOOR_REQUESTS_PER_MINUTE`; the wording of a refusal is a page
  wording slot.
- Everybody with a role proves a second factor after the emailed code: an authenticator app or
  a passkey, with ten recovery codes. Until they do, they act with no role. Some actions ask for
  it again: opening a reporter's details, appointing people, downloads of the whole record, and
  others. The owner's own is reset only on the server, with `sudo reportlog reset-2fa`.
- Records › Updates has an **Install** button again, as well as **Check now**. It installs only
  the commit the server is set to follow, through a root service on the server; the website
  never runs it itself.
- Email can go through any SMTP server (Proton Mail, say) instead of Scaleway. The installer
  asks.
- A launched logbook's wording can be made clearer (labels, help, the labels of coded options),
  as a new version of its questions; every report keeps the version it was answered against.
- A logbook can be published as counts only, with a threshold under which a place is named
  without a number. Heat maps can have a separate threshold for counties. Thresholds may now be
  as low as 1.
- The flood screen: reports and refusals per hour, groups of identical reports, declining them
  in bulk (no email is sent), withholding tip links by time, and two switches, Pause intake and
  Harder puzzle. Using either is shown on the board's activity page, which also counts declined
  reports by reason.
- The front page is simpler, and an administrator can edit it in place. Its buttons can be
  hidden as well as reordered and relabelled.
- The staff screens are one app: a top bar and a sidebar of areas.
- A moderator's note on a decision is optional.
- Tips keep their personal half for a year by default (it was 90 days). An illegal-content
  notice's sender's name is erased with their address once the decision is sent, and the words of
  an evidence request are replaced a year after it was sent.
- The site password is set on the server, with `sudo reportlog site-password`, after the first
  deploy. The setup wizard refuses to run without one, so a stranger who finds a fresh install
  cannot make themselves its owner.
- New starting points: Log how voting went, and an Election tips list.
- A list can be downloaded as a file ("Download as file", on the list) and made again from a file
  ("Or upload a list file", when making a list). The new list is hidden, and an address that is
  already used is refused in a sentence rather than written over. Whether the form asks for an
  email address is worked out from its questions, as it is for any list.
- Settings › Look no longer makes you scroll away from the preview to choose. On a wide screen the
  looks scroll on the left while the previews and the Apply button stay in view on the right.
  On a phone the previews come first and the named looks sit in a bar along the bottom of the
  screen; the full chooser is still on the page. The setup wizard's look step is laid out the
  same way.
- The logbook starting points are fewer: How voting went, Election incidents, Workplace incidents,
  and a new general one, "Reports", that asks what happened, when, about what time, where, whether
  you saw it yourself and whether you have evidence, and takes up to three files. The deployment
  starting points follow: "A general record" is new, and the election choices, internal safety
  log and practitioner complaint ones are gone. A logbook you made from a removed one is
  untouched; to make another like it, upload its file.
- `sudo reportlog contact-key rotate` works. The runbook's steps for rotating the contact key
  named it, but the command answered "unknown command" and changed nothing.

## v0.1.0 — 20 October 2026

The first release of the rebuilt ReportLog. It does what the old
application did, written again from the start, and replaces it. A site
moving from the old application keeps its reports: every fingerprint the
old one made still checks out.

**For somebody filing a report**

- The form asks one question at a time, and nothing on the card in front of
  you changes while you read it. It never moves on by itself.
- You are asked whether your report may be published, in words you can read
  in full before you answer. Your answer is kept with the exact wording you
  saw.
- After you send a report, an email asks you to confirm it. Nothing is
  published before you do, and nothing is published before a moderator has
  read it.
- Photos and other files you attach are re-encoded before anybody sees
  them, so the camera's details (where and when a photo was taken, and on
  what) are not kept.
- "My reports" shows what you have filed, lets you correct a report (the
  original stays, with the correction after it), and lets you change your
  mind about publication.
- Anybody can check a report's reference and see that it has not been
  changed since it was filed.

**For moderators**

- A board of reports waiting to be read, with flags and keywords that bring
  reports needing attention forward, and notes for other moderators.
- You decide what is published. You can publish a report's text without its
  files, never its files without its text, and never more than the person
  who filed it agreed to.

**For the people who run a site**

- A setup wizard on first start: who owns the site, its name, a starting
  point (elections, a workplace, a safety log and others), what is
  published, whether files are accepted, the look, and an optional site
  password.
- Starting points can be applied again later, from Settings → Starting
  points. Each one says beforehand exactly what it will change.
- Logbooks for reports, and lists for things that should not be kept for
  ever (tips, check-ins, a contact form): a list's personal details are
  erased on a timer and only counts are published.
- Heat maps of where published reports came from, with no map service
  behind them: no visitor's browser asks anybody else for anything.
- A daily, public record of every logbook's length, so a report removed
  from the archive afterwards would show.
- Installation, daily backups (encrypted, and copied off the server),
  updates and rollback on one Hetzner server, with one command:
  `reportlog`. The installer asks for every setting it needs.
- Optional error tracking with Bugsink, run on the same server. Visitors'
  browsers never contact it.
- This version number in every page's footer.

**For everybody**

- Every page is checked automatically for accessibility problems (WCAG 2.2,
  levels A and AA) before a release.
- No page asks another website for anything: no fonts, no scripts, no
  analytics, no map tiles.
