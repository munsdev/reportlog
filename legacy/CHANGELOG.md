# Changelog

Release notes for the software. **This is the upstream changelog** — what
changed in ReportLog itself. A deployment's own changelog, written for the
people who use that site, is a separate thing and lives on its About page.

**The admin Updates pane parses this file**, so the shape matters:

- one `## vX.Y.Z — D Month YYYY` heading per release, newest first
- everything under a heading, until the next one, is that release's notes
- plain language, for an operator deciding whether to apply it, not a list
  of commits — the pane shows the commits separately and they are in the
  git log already

`src/updates.js` reads it and `scripts/selftest.js` asserts the shape. A
release with no entry here shows in the pane as "no release notes", which is
worse than it sounds: it is the one screen where somebody decides whether to
run new code on an archive.

---

## v0.0.4

**Not released yet, and deliberately dated by the release rather than by
today.** `package.json` still says 0.0.3: the standing decision is that
the version stays there until an install has actually been proved on a real
server, and the tag moves once at the end. This entry is written now so
nothing is owed when it does — and the pane cannot show it meanwhile,
because `updateState` only reads release notes when the offered version is
newer than the running one.

**Lists, the second format.** A list has a form like a logbook does, and
everything else about it is the opposite: it seals nothing, keeps an
editable form, erases the personal half of its entries on a timer, is
approved in bulk, and publishes counts rather than content. Three to start
from — a tip list, check-ins and a contact form — differing only by their
questions. Volunteering became one.

**Retention belongs to a question, not to a row.** On a list, one column of
answers is durable and the other is what the sweep blanks. The links stay;
the text and the contact details go.

**Heat maps, as many as you want.** Where published reports came from, drawn
as shaded areas. Each map has its own threshold, its own logbooks, its own
views and its own place on the site, so two maps of one archive can answer
two different questions. **An area is shaded only once enough reports have
come from it, and an area under that threshold is sent to the reader without
its count at all** — so the number cannot be read off the page or out of the
network. The floor is 2, in the database. Several maps can sit on one page.

**A new question type, "Location on a map".** It stores a place as a code
chosen from a list rather than as typed words, which is what lets answers
add up. The list comes from the map's own outlines, so a form can never
offer somewhere no map can draw. The free-text Place question stays, for
when prose is what you want.

**The front page names your logbooks.** Every open logbook is a button on
it, the way a list already was, instead of one "Submit a Report" leading to
a page that asked which. The order is yours, set on the page itself, and the
first button is the accent one. A logbook you make later is added to it
rather than left off.

**And a button can say something other than the title.** A button wears its
logbook's or list's name unless you give it other wording — "Report a
problem at your polling place" where the archive itself is called "Election
incidents 2026". Leave the box empty and the title comes back, so renaming a
logbook renames its button. The site's own buttons keep their own wording.

**One thing open at a time on the settings screens.** They were several
cards you could edit at once, so there were several Save buttons, none of
them said what it saved, and the one you wanted had scrolled away. Now you
open one, edit it, and save or cancel from a bar that names what it is
about to save. A closed panel shows what it is set to, so you can read the
screen without opening everything on it. Switches have not changed: they
still apply the moment you touch them, and now they say so.

**Back goes to the last tab you were on.** On the admin and team screens,
changing tab is somewhere your phone's Back button can return to, instead
of leaving the screen altogether. If you have unsaved changes, it asks
first.

**A deploy no longer ends with a command to type.** `deploy.sh` restarts
the service itself. It needed permission for that one command and never had
it, so every deploy finished with a line to copy; `install-units.sh` now
grants exactly that command and nothing else.

**Links can carry a filter.** `/board?logbook=…` opens the board already
narrowed, and clicking an area on a map hands over that address — so a
prepared view is something you can send someone. A link can reach nothing a
reader could not reach from the filter panel by hand.

**The Updates panel tells you the truth about itself.** "Check now" says it
is checking, and the panel says how old its answer is — it caches for ten
minutes, so "Up to date" could be nine minutes old with nothing saying so.
If the timer that applies updates was never installed, the panel says which
one command finishes the setup instead of offering a button that reports
success and does nothing. **And `contrib/deploy.sh` now installs systemd
units**, so a release that adds a timer cannot leave an upgraded box without
it — which is what had happened to the update timer itself. **A release that
changes the updater no longer has to be applied by hand either**: root
renews its own copy from the commit it has just verified and re-runs it.

**No more white page after an update.** A browser holding one old module
beside new ones used to stop every script. `contrib/nginx/cache.conf` tells
a browser to revalidate, the service worker no longer prefers a stale copy,
and the page recovers by itself if it ever happens again. `npm run doctor`
checks for the include. **It is one line to add to an existing server
block** — deploying never edits nginx — and the doctor prints it.

**The install guide is a site now**, built from the repository so it cannot
drift from the software, and it asks what you have rather than making you
read every branch. It also no longer ends at a deployment that cannot take a
report: there is a section on making your first logbook, because a finished
wizard with no logbook accepts nothing.

**Fixes worth naming.** A private clone needs one credential and the guide
now says whose. "The remote was unreachable" was a guess and was wrong for
the case that actually happens — a deployment with no credential is told so.
The panel reports the commit **and** the schema, which are two different
answers: a deploy that pulled without migrating ran new code against an old
database with nothing reporting a fault. The install prompt no longer saves
arrow keys into your deployment's name, and the doctor no longer suggests
the broken value as the fix when it finds one that was.

**The install guide was checked against the software, line by line, and
corrected where they disagreed.** The ones that mattered most:

- **Restoring a backup.** The command the guide printed could not open the
  file: backups sit in a folder only the service account can read, and the
  command ran as a different one. The guide, the rendered guide and the
  Backups panel now give a command that works, and the guide shows how to
  prove a backup into a scratch database without touching the real one.
- **The transparency log.** Nothing told you to set it up, and the
  daily anchor had nowhere to publish. There is now a step for the
  repository, the key and the checkout, and the unit installer makes the
  folder the anchor needs.
- **A test-box reset could empty the database while the site was still
  running**, and left the daily anchor switched off afterwards. It now
  refuses to go on if it cannot stop the site, and starts again everything
  it stopped.
- **Mail.** With no mail set up, the sign-in code is written to the server's
  log so you can finish setting up. Six places said it was thrown away.
- **Setup asks better questions.** The storage region is filled in from a
  Hetzner address instead of defaulting to Amazon's name for Frankfurt; it
  asks where staff mail should go; and it leaves attachments off until you
  have tested your buckets.
- **The site refuses to start on Node older than 22**, as the guide always
  said it did. Only the doctor used to check.
- **The installer adds certbot**, which its own last instructions use.
- The setup wizard has eight screens, not six; there are seven proxy blocks
  to copy, not five; a draft logbook cannot be tried out before launch,
  and a test report cannot be deleted afterwards, so the guide says to
  rehearse on a test box; and the step-by-step unit install has gone in
  favour of the one script, which is the list that never fell behind.

---

## v0.0.3 — 5 October 2026

**The first release anybody else is meant to install.** `v0.0.2` predates
logbooks entirely, so this is effectively a different application.

**Logbooks.** Every report is filed through a logbook, and every logbook is
its own hash chain. There is no built-in questionnaire: an operator builds
the questions, and launching a logbook is a one-way door — afterwards it may
gain a new optional question and nothing else.

**An install guide that works.** `INSTALL.md` is canonical and written for
somebody who has not run a production server before, with the same install
rendered at `/docs`. `install.sh` and `contrib/install-units.sh` do the
mechanical half.

**Backups.** `npm run backup` takes a `pg_dump`, reads it back with
`pg_restore --list` before giving it its real name, and prunes to the newest
`BACKUP_KEEP`. `reportlog-backup.timer` runs it daily and the doctor faults a
dump older than 48 hours — because a backup that quietly stopped looks
exactly like one that is working.

**A doctor that asks the deployment**, not the repository: which of the five
proxied paths the app actually answered, and whether the timers are enabled.

**Evidence by request**, editorial notes, a review flag, and every upload
limit as something an operator sets rather than a constant.

## v0.0.2 — 16 September 2026

The archive core: an append-only `reports` table, RFC 8785 canonicalisation,
the hash chain, the daily RFC 3161 anchor and the transparency log. Stops at
migration 026.

**Do not install this.** It has no logbooks, no install guide and none of the
operator tooling above. It is kept as a marker of where the chain format
settled, nothing more.
