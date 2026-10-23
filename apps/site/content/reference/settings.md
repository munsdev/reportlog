---
title: Settings
description: Every setting a ReportLog server reads, with what it does, read from the settings file the installer starts from.
---

A server's settings live in `/etc/reportlog/reportlog.env` (owned by root, readable by the `reportlog` group) and nowhere else. The installer writes it from `.env.example` in the repository, makes the keys a machine can make, and asks for the rest. Nobody edits it by hand to set up a site; to change one value later, edit it there and restart (`sudo systemctl restart reportlog-api`) or deploy. The application checks every value when it starts and names anything wrong, and `sudo reportlog doctor` says what is still missing.

Keys, passwords and tokens are never in the repository: every one is blank in `.env.example`. **Keep a copy of the settings file off the server.** Backups deliberately leave it out, because it holds the keys.

This page is read from `.env.example` itself, so it lists exactly what the code reads. "Example" values are placeholders or defaults, not recommendations.

{{settings}}
