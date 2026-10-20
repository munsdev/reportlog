# Decisions

The owner's rulings on questions the code could not settle. Each one names
where it is built. `docs/parity.md` §8 listed the open questions; this file
answers them. Decided 2026-10-20 unless a line says otherwise.

| #   | Question                                                                        | Decision                                                                                                       |
| --- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 1   | Verifying a report that is not published                                        | Fingerprints only (hashes, link, position). Never its text until a moderator publishes it.                     |
| 2   | `/api/v1` when the site has a password                                          | Behind the password, like the rest of the site. Not a way past it.                                             |
| 3   | The lock screen                                                                 | The site's name, plus an optional paragraph the operator writes. Nothing else.                                 |
| 4   | The evidence-request link                                                       | In front of the password, like the confirmation link. Its token is what guards it.                             |
| 5   | The confirmation page while the public archive is off                           | Says "may be published", never "public".                                                                       |
| 6   | A heat map and the board asking the same place question                         | The board hides an area's count below the map's threshold, the way the map does.                               |
| 7   | `report_attachments` ordinal                                                    | Stays UNIQUE. A correction copies the order from the archive, so the bug legacy guarded against cannot happen. |
| 8   | Severity, incidents, anchor-watch (dropped, then built)                         | Built. The earlier drops are overruled.                                                                        |
| 9   | The installable app (service worker, "Get the app")                             | Left out for now.                                                                                              |
| 10  | Archive export and backups                                                      | Both: on the command line, and in the administration screens for the owner.                                    |
| 11  | The distribution switch                                                         | It governs exports too.                                                                                        |
| 12  | Accessibility                                                                   | An automated check in the browser suite, on every page, with the checker bundled (no third-party request).     |
| 13  | Where Bugsink runs                                                              | On the same Hetzner server to start.                                                                           |
| 14  | The daily update check contacts GitHub (US)                                     | Allowed until there is an EU mirror.                                                                           |
| 15  | A changelog and version numbers                                                 | Yes: `CHANGELOG.md` and a version in the root `package.json`.                                                  |
| 16  | Severity and corroboration in public                                            | Staff only. A severity label shown publicly reads as the site's verdict on a report.                           |
| 17  | Files staged before a logbook's uploads were frozen                             | Dropped when the report is sent, as legacy did.                                                                |
| 18  | Coordinator intake files                                                        | Kept 30 days; no per-coordinator quota.                                                                        |
| 19  | Frozen-file drop for coordinator intake and evidence answers                    | Yes, the same as decision 17: dropped at filing, and the screen says which.                                    |
| 20  | Place codes in the board's search                                               | Stay searchable. Each published report already shows its place; the threshold protects counts.                 |
| 21  | A thin area's count by subtraction from a logbook's total                       | Accepted and documented, for the same reason as 20.                                                            |
| 22  | The style guide (`/styleguide`)                                                 | Dropped.                                                                                                       |
| 23  | A white page when the site fails to load (`boot-guard`)                         | A small plain fallback message is built.                                                                       |
| 24  | Legacy features the new design replaced (parity R0 f)                           | Recorded as dropped.                                                                                           |
| 25  | `legal_hold`                                                                    | Dropped.                                                                                                       |
| 26  | The staff portal's content                                                      | Dropped; G2's staff guides cover it.                                                                           |
| 27  | Editors' extras (edit mode, panel summaries, extra policies, live look preview) | Dropped for now.                                                                                               |
| 28  | About page extras                                                               | A link to the changelog; the contents strip and map slot are dropped.                                          |
| 29  | `/print`                                                                        | Dropped; browsers print the pages.                                                                             |
| 30  | Clicking a board map to filter the board                                        | Dropped for now.                                                                                               |
| 31  | An over-long reason for opening a file original                                 | Refused, like the contact route.                                                                               |
| 32  | Refused, infected or unreadable files                                           | Logged for moderators, as legacy did.                                                                          |
| 33  | The door rule's wording in `CLAUDE.md`                                          | "Only the calls named in front of the password for that door."                                                 |
| 34  | Downloading the complete chain file                                             | Recorded in the access log.                                                                                    |
| 35  | An audio-only MP4 under an isom or mp42 brand                                   | Stays refused, as legacy did.                                                                                  |
| 38  | A filing that carries a file while uploads are off | Refused with a plain message, not filed with the file dropped. `ATTACHMENTS_ENABLED=false` is the deploy default (`install.sh`). |
| 42  | Question kinds in a logbook | ReportLog stays general: a logbook keeps every kind, text included. ElectionLog simply asks no text question and no link. No site-wide ban on kinds; L3 is met by setup, L7 and choice validation, each tested. |

Rows 19 to 35 decided 2026-10-20, answering `docs/parity.md` §7 R0 and R2's question.

## Keys and secrets

Keys, passwords and tokens are part of setting up a server, never part of
this repository. They live in `/etc/reportlog/reportlog.env` on the server
(root:reportlog, 0640; see `deploy/README.md`). The repository carries only
`.env.example`, with every secret blank, and the development `.env` that a
cloud session writes is ignored by git. CI refuses a commit that contains a
secret.
