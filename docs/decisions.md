# Decisions

The owner's rulings on questions the code could not settle. Each one names
where it is built. `docs/parity.md` §8 listed the open questions; this file
answers them. Decided 2026-10-20 unless a line says otherwise.

| #   | Question                                                | Decision                                                                                                       |
| --- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 1   | Verifying a report that is not published                | Fingerprints only (hashes, link, position). Never its text until a moderator publishes it.                     |
| 2   | `/api/v1` when the site has a password                  | Behind the password, like the rest of the site. Not a way past it.                                             |
| 3   | The lock screen                                         | The site's name, plus an optional paragraph the operator writes. Nothing else.                                 |
| 4   | The evidence-request link                               | In front of the password, like the confirmation link. Its token is what guards it.                             |
| 5   | The confirmation page while the public archive is off   | Says "may be published", never "public".                                                                       |
| 6   | A heat map and the board asking the same place question | The board hides an area's count below the map's threshold, the way the map does.                               |
| 7   | `report_attachments` ordinal                            | Stays UNIQUE. A correction copies the order from the archive, so the bug legacy guarded against cannot happen. |
| 8   | Severity, incidents, anchor-watch (dropped, then built) | Built. The earlier drops are overruled.                                                                        |
| 9   | The installable app (service worker, "Get the app")     | Left out for now.                                                                                              |
| 10  | Archive export and backups                              | Both: on the command line, and in the administration screens for the owner.                                    |
| 11  | The distribution switch                                 | It governs exports too.                                                                                        |
| 12  | Accessibility                                           | An automated check in the browser suite, on every page, with the checker bundled (no third-party request).     |
| 13  | Where Bugsink runs                                      | On the same Hetzner server to start.                                                                           |
| 14  | The daily update check contacts GitHub (US)             | Allowed until there is an EU mirror.                                                                           |
| 15  | A changelog and version numbers                         | Yes: `CHANGELOG.md` and a version in the root `package.json`.                                                  |
| 16  | Severity and corroboration in public                    | Staff only. A severity label shown publicly reads as the site's verdict on a report.                           |
| 17  | Files staged before a logbook's uploads were frozen     | Dropped when the report is sent, as legacy did.                                                                |
| 18  | Coordinator intake files                                | Kept 30 days; no per-coordinator quota.                                                                        |

## Keys and secrets

Keys, passwords and tokens are part of setting up a server, never part of
this repository. They live in `/etc/reportlog/reportlog.env` on the server
(root:reportlog, 0640; see `deploy/README.md`). The repository carries only
`.env.example`, with every secret blank, and the development `.env` that a
cloud session writes is ignored by git. CI refuses a commit that contains a
secret.
