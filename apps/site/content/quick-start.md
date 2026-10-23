---
title: Quick start
description: The shortest path from an empty server to a site that takes reports. Each step links to the full instructions.
---

## What you need

- A server running **Debian 12 or Ubuntu 24.04** (x86 or Arm). The installer refuses anything else. The runbook is written for a Hetzner Cloud server; any provider with those systems works.
- **A domain** whose DNS you control, pointed at the server.
- **A way to send email**: a Scaleway project with Transactional Email, or an SMTP account (Proton Mail, say). Staff sign in with codes sent by email, so nothing works without it.
- **EU object storage** for off-site backups, and optionally for reporters' files.
- **Somewhere safe to keep two keys** off the server: the contact key and the files key. Losing the contact key loses every reporter's address.

## Install

```sh
git clone https://github.com/munsdev/reportlog.git /root/reportlog
sudo /root/reportlog/deploy/install.sh   # installs everything, makes the keys, asks for your settings
sudo reportlog deploy                    # builds and starts the site
sudo reportlog site-password             # the password that keeps the site closed while you set it up
sudo reportlog doctor                    # checks everything it can, and says what to fix
sudo reportlog mail-test you@example.org # sends one real message: check it arrives
```

Then copy the settings file, `/etc/reportlog/reportlog.env`, somewhere that is not the server. Backups deliberately leave it out, because it holds the keys.

The [install guide](/docs/operate/setting-up-a-server/) explains each step and what the installer asks.

## Set up the site

Open the site, enter the site password, and the setup wizard makes you the owner. Then build a logbook, launch it, appoint a moderator and file a test report. [The first hour](/docs/first-hour/) walks through it.

## Keep it running

| Task                                                   | How                                                       |
| ------------------------------------------------------ | --------------------------------------------------------- |
| See whether the server is healthy                      | `sudo reportlog doctor`                                   |
| Install an update                                      | Records › Updates on the site, or `sudo reportlog deploy` |
| Go back to the previous release                        | `sudo reportlog rollback`                                 |
| Take a backup now                                      | `sudo reportlog backup`                                   |
| Let the owner back in after losing their second factor | `sudo reportlog reset-2fa owner@example.org`              |

Every command is listed under [Commands](/docs/reference/commands/), every setting under [Settings](/docs/reference/settings/).
