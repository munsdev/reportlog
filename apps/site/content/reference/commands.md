---
title: Commands
description: Every command for running a ReportLog server, read from the command itself.
---

Everything on a server is done through one command, `reportlog`, run with `sudo`. Everything that runs the application's code runs as the `reportlog` user with the site's settings, never as root.

{{commands}}

`sudo reportlog help` prints the same list on the server.

## Installing and the files they use

|                                |                                                                                                                                                                                                                                                                                             |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deploy/install.sh`            | Installs PostgreSQL, Node at a pinned version (refused unless its checksum matches), Caddy and unattended security updates; makes the `reportlog` user, the database and the keys; asks for the settings. Safe to run again. See [Setting up a server](/docs/operate/setting-up-a-server/). |
| `deploy/install-bugsink.sh`    | Installs Bugsink, for error tracking on the same server. Optional.                                                                                                                                                                                                                          |
| `/etc/reportlog/reportlog.env` | The site's settings. See [Settings](/docs/reference/settings/).                                                                                                                                                                                                                             |
| `/etc/reportlog/deploy.env`    | Where the code comes from (`REPO_URL`), which branch or tag to follow (`DEPLOY_REF`), the address for the certificate authority (`ACME_EMAIL`), and other names sent to the site, such as `www.` (`SITE_ALIASES`).                                                                          |
| `/srv/reportlog/releases/`     | One folder per deploy; `current` and `previous` point at two of them.                                                                                                                                                                                                                       |

The full layout is in [What is where](/docs/operate/what-is-where/).

## Scheduled jobs

Each job runs from a systemd timer of its own; `sudo reportlog jobs` lists them on the server and `sudo reportlog job <name>` runs one now. This list is read from the job registry in the code:

{{jobs}}

Besides these, the server checks for updates every morning around 06:00 as root, and emails `OPS_ALERT_EMAIL` once about each new release. When a job fails, `OPS_ALERT_EMAIL` is emailed its name. What each job writes is in the journal: `journalctl -u reportlog-job@<name>`.
