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

Nothing yet.

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
