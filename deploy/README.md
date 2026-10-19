# Running ReportLog on a server

The runbook: setting up a Hetzner server, deploying, rolling back,
backups and restoring, and what to look at when something is wrong.

Everything here runs on one machine: PostgreSQL, the API, the scheduled
jobs and Caddy in front, as systemd services. Nothing in the running system
is hosted in the US. Mail goes through Scaleway Transactional Email (Paris)
and off-site backups go to S3-compatible storage in the EU.

## What is where

| Path                           | What                                                   | Owner                      |
| ------------------------------ | ------------------------------------------------------ | -------------------------- |
| `/srv/reportlog/releases/<id>` | One directory per deploy (`<UTC time>-<commit>`)       | root, read-only to the app |
| `/srv/reportlog/current`       | → the release that is running                          | root                       |
| `/srv/reportlog/previous`      | → the release that ran before it (where rollback goes) | root                       |
| `/srv/reportlog/repo.git`      | A mirror of the repository, fetched on deploy          | root                       |
| `/etc/reportlog/reportlog.env` | The application's settings (see `.env.example`)        | root:reportlog, 0640       |
| `/etc/reportlog/deploy.env`    | Where code comes from; the ACME email                  | root                       |
| `/var/lib/reportlog`           | The application's state (`backup.json` for the doctor) | reportlog, 0750            |
| `/var/backups/reportlog`       | Local database dumps                                   | reportlog, 0700            |
| `/usr/local/lib/reportlog`     | The copy of the deploy scripts that root runs          | root                       |
| `/usr/local/bin/reportlog`     | The one command                                        | root                       |

Services: `reportlog-api` (the API, on 127.0.0.1:3000), `reportlog-job@<name>`
(one per scheduled job, started by `reportlog-<name>.timer`),
`reportlog-alert@` (emails `OPS_ALERT_EMAIL` when a job fails), `caddy` and
`postgresql`.

## Setting up a server

You need: a Hetzner server running **Debian 12 or Ubuntu 24.04** (x86 or
Arm), a domain whose DNS you control, a Scaleway project with Transactional
Email, and an EU object storage bucket.

1. **DNS.** Point the domain's A (and AAAA) record at the server. Caddy
   needs this to get a certificate.
2. **Firewall.** In the Hetzner Cloud console, allow inbound 22, 80 and 443
   (443/udp too, for HTTP/3) and nothing else. PostgreSQL listens on no TCP
   port at all, so there is nothing else to protect, but a firewall at the
   edge costs nothing.
3. **Install.**

   ```sh
   git clone https://github.com/munsdev/reportlog.git /root/reportlog
   sudo /root/reportlog/deploy/install.sh
   ```

   It turns on unattended security updates and installs PostgreSQL 16 (from
   the PostgreSQL project's repository, socket only), Node at the exact
   version in `deploy/versions.conf` (refused unless its SHA-256 matches),
   and Caddy. It creates the `reportlog` user, the database and role (peer
   authentication: no password exists to leak), and writes
   `/etc/reportlog/reportlog.env` from `.env.example`. It is safe to run
   again, and never overwrites the settings file.

4. **Settings.** Fill in `/etc/reportlog/reportlog.env`. Every setting is
   explained in the file. At least: `SITE_ORIGIN`, `EMAIL_TRANSPORT=scaleway`
   with `EMAIL_FROM_ADDRESS` and the two `SCALEWAY_` values,
   `OPS_ALERT_EMAIL`, `ADMIN_EMAIL`, and the off-site backup settings
   (below). `install.sh` has already set `TRUST_PROXY=1` (Caddy is one proxy
   in front) and made `CONTACT_KEY`.
5. **Deploy.** `sudo reportlog deploy`
6. **Check.** `sudo reportlog doctor`, then
   `sudo reportlog mail-test you@example.org` and look for the message,
   including in the spam folder.
7. **Copy the settings file off the server**, once, to wherever you keep
   secrets. Backups deliberately do not include it (it holds keys, and a
   backup that carries its own keys protects nothing). Above all
   `CONTACT_KEY`: see below.

### The contact key

Every reporter's address is encrypted under a per-report key, and those
keys are wrapped by `CONTACT_KEY` (`apps/api/src/filing/contactKeys.ts`).
`install.sh` makes it, from 32 random bytes, the first time it writes the
settings file. Nobody chooses or types it.

- **Back it up separately.** It is not in the database backups, on purpose:
  a dump and the key that opens the addresses in it must not travel
  together. Keep a copy off the server and away from the backups, in a
  password manager the operators share, for instance:
  `sudo grep ^CONTACT_KEY= /etc/reportlog/reportlog.env`.
- **Never rotate it.** A different key makes every stored address
  unreadable. The first deploy records the key's fingerprint
  (`/var/lib/reportlog/contact-key.sha256`). From then on, a deploy with a
  different key stops before switching, and the doctor fails. If that
  happens, put the original key back. `install.sh` never makes a new key on
  a server that has recorded one.
- **Lose it and you lose the addresses.** The reports themselves are
  unaffected: they never contain an address.

### Email (Scaleway)

In the Scaleway console: add and verify the sending domain under
Transactional Email, publish the SPF, DKIM and DMARC records it shows you,
and create an API key whose IAM policy allows Transactional Email in that
project. Mail from a domain without those records is usually accepted and
then filed as junk, so `mail-test` succeeding is not the end of it: check the
message arrives.

### Off-site backups

1. **An encryption key, made somewhere that is not the server:**
   `age-keygen -o reportlog-backup-key.txt`. Keep the file (the private key)
   in two safe places. Put the public key it prints (`age1…`) in
   `BACKUP_AGE_RECIPIENTS`. Add a second person's public key, separated by a
   space, if more than one person should be able to restore.
2. **A bucket** in EU object storage: Hetzner Object Storage
   (`https://fsn1.your-objectstorage.com`, region `fsn1`) or Scaleway Object
   Storage (`https://s3.nl-ams.scw.cloud`, region `nl-ams`), for example.
3. **A key for the server that can upload and nothing else**: no read, no
   list, no delete. Somebody who takes over the server can then add files
   to the bucket but cannot empty it, and that is the moment a backup is
   for.
4. **A lifecycle rule on the bucket** that expires objects under
   `reportlog/` after the period you want to keep (90 days, say). The server
   never deletes off-site copies; the bucket does.
5. The five `BACKUP_S3_` settings, then `sudo reportlog backup` and
   `sudo reportlog doctor`.

## Deploying

```sh
sudo reportlog deploy            # DEPLOY_REF from /etc/reportlog/deploy.env (main)
sudo reportlog deploy v1.2.0     # or any branch, tag or commit
```

What happens, in this order. Everything that can fail happens before the
running release is touched:

1. The commit is fetched and unpacked into a new `releases/<id>` directory.
2. Dependencies are installed and the website is built, as the `reportlog`
   user (so no package's install script runs as root). The build tools are
   then removed, and the release is handed to root and made read-only.
3. **Migrations run** against the live database, while the old release is
   still serving.
4. The release's systemd units and Caddyfile are installed. A release that
   adds or removes a timer installs or removes it here. `current` is
   switched and the API restarted.
5. If the API does not answer `/api/health` within 30 seconds, `current` is
   switched back and the old release restarted.

| If this fails           | Then                                                                                                                                                                             |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| fetch or build          | Nothing changed. The release directory is kept as `<id>.failed` to look at.                                                                                                      |
| a migration             | `current` is not switched; the old release keeps running. The failing migration's transaction rolled back. Any migrations before it in the same deploy stay applied (see below). |
| the new release's start | It is switched back automatically. Its migrations stay applied.                                                                                                                  |

The deploy ends by running the doctor.

## Rolling back

```sh
sudo reportlog rollback          # to `previous`
sudo reportlog releases          # what there is
sudo reportlog rollback <id>     # to a named one
```

A rollback switches `current` and restarts. It installs the units and
Caddyfile that release shipped with. **It does not touch the database.**
Rolling back twice returns you to where you started.

### Why rolling back is safe

Migrations in this repository are additive. They add tables, columns,
triggers and constraints; they never rename, drop or change how an existing
column is read (CLAUDE.md, "Migrations are new files only"). So the release
before a migration does not know about what the migration added, and does
not need to: every table and column it uses is still there, unchanged. The
older code runs on the newer schema.

That is also why a deploy can migrate first and switch afterwards: for a
few seconds the old release serves on the new schema, which is exactly the
situation a rollback leaves you in.

After a rollback the doctor says the database has migrations the running
release does not know, as a warning, not a failure. **Deploying an older
commit is refused for the same reason** ("This database has migrations
this code does not"): the migration runner will not run code older than the
database. To go back, use `rollback`, which never migrates. To go forward,
deploy a commit that includes every applied migration.

If a migration ever had to be undone, that would be a new, additive
migration deployed forward, written by a person. There is no "down"
migration and no tool here runs one.

## Scheduled jobs

```sh
sudo reportlog jobs                       # the list and schedules
sudo reportlog job sweep                  # run one now
systemctl list-timers 'reportlog-*'       # when each runs next
journalctl -u reportlog-job@backup        # what one said
```

The schedule lives in `apps/api/src/jobs/registry.ts`, and the timer files
in `deploy/systemd/` are generated from it
(`pnpm --filter @reportlog/api ops timers --write`; a test fails if they
differ). All times are UTC.

| Job               | When          | What                                                                                             |
| ----------------- | ------------- | ------------------------------------------------------------------------------------------------ |
| `backup`          | daily 03:00   | Dump, check, encrypt and send off-site                                                           |
| `sweep`           | daily 03:30   | **Delete** expired credentials from named tables                                                 |
| `lists-sweep`     | daily 03:40   | **Erase** the personal half of expired list entries; the rows stay (workstream E's `sweepLists`) |
| `anchor`          | daily 04:00   | Timestamp the chain heads. Not built yet (workstream D)                                          |
| `digest-hourly`   | hourly        | Not built yet (workstream G)                                                                     |
| `digest-weekly`   | Mondays 07:00 | Not built yet (workstream G)                                                                     |
| `feedback-digest` | Mondays 08:00 | Not built yet (workstream G)                                                                     |

The two sweeps are different jobs on purpose. The first deletes rows; the
second erases columns and must never delete a row. A list table in the
first one's list would delete links that are meant to stay.

What the credential sweep deletes, each under the condition its owner's
code already treats as dead (`SWEPT` in `apps/api/src/jobs/sweep.ts`):

| Table                       | Deleted when                              |
| --------------------------- | ----------------------------------------- |
| `otp_codes`                 | past `expires_at`                         |
| `sessions`                  | past `expires_at`                         |
| `site_access_tokens`        | past `expires_at`                         |
| `ownership_transfers`       | past `expires_at`                         |
| `organization_invites`      | still pending and past `expires_at`       |
| `organization_invite_sends` | older than 14 days                        |
| `report_submissions`        | **never confirmed** and past `expires_at` |

It never touches `contact_keys` or `report_contacts` (deleting a contact
key is a reporter's erasure, and the addresses are append-only), and never
a list table. A database test fails on any table with an `expires_at`
column that is in neither `SWEPT` nor `NOT_SWEPT`.

A job that is not built yet runs, says so and exits successfully; the
doctor lists it. A job that fails starts `reportlog-alert@`, which emails
`OPS_ALERT_EMAIL` the unit's name (never its output, which stays on the
server).

Unattended upgrades reboot the machine at 05:30 when an update needs it,
after the night's jobs (`deploy/apt/52reportlog-unattended-upgrades`). Daily
jobs that were due while it was off run when it comes back.

## Restoring a backup

Local dumps are in `/var/backups/reportlog`, newest 14 kept. Off-site copies
are `reportlog/<name>.dump.age` in the bucket.

**From an off-site copy**, on the machine that holds the private key:

```sh
age -d -i reportlog-backup-key.txt -o restore.dump reportlog-2026-10-19T03-00-00Z.dump.age
```

then copy `restore.dump` to the server.

**Into the server's database** (replacing what is there):

```sh
sudo systemctl stop reportlog-api
sudo -u reportlog pg_restore --clean --if-exists --no-owner \
  -d 'postgresql://reportlog@/reportlog?host=/var/run/postgresql' restore.dump
sudo systemctl start reportlog-api
sudo reportlog doctor
```

**Into a new server**: run `install.sh` **after** putting back the settings
file you copied off the first server, so it does not make a new contact key
(with a new key every restored address would be unreadable). Then restore as
above, and `sudo reportlog deploy` at a commit that includes every migration
in the dump.

An untested backup is a belief. Restore one somewhere that is not
production now and then. The database tests do exactly this on every run:
back up, restore into a fresh database and compare every report's hash.

## When something is wrong

Start with `sudo reportlog doctor`. It checks settings, mail, the database
and its migrations, that PostgreSQL listens on no network port, the API, the
site and its certificate through Caddy, backups local and off-site, every
timer and the last result of every job, unattended updates, disk space and
the Node version. Each line says what to do.

| Symptom           | Look at                                                                     |
| ----------------- | --------------------------------------------------------------------------- |
| The site is down  | `systemctl status reportlog-api caddy`, `journalctl -u reportlog-api -n 50` |
| No certificate    | `journalctl -u caddy`: DNS not pointing here, or 80/443 closed              |
| Mail not arriving | `sudo reportlog mail-test you@example.org`                                  |
| A job failed      | `journalctl -u reportlog-job@<name> -n 50`                                  |
| Disk filling      | `du -sh /srv/reportlog/releases/* /var/backups/reportlog`                   |

Logs never contain an IP address or a full URL: Caddy keeps no access log,
it does not forward the client's address to the API, and the API logs route
patterns.

## Changing a pinned version

Node, the PostgreSQL major version and the repository signing keys are
pinned in `deploy/versions.conf`. To move Node: change `NODE_VERSION` and
both `NODE_SHA256_` values (from `https://nodejs.org/dist/v<version>/SHASUMS256.txt`),
merge, then run `sudo /root/reportlog/deploy/install.sh` from an updated
checkout. The doctor warns while the server runs something other than the
pin. A PostgreSQL major upgrade is a deliberate dump and restore, never
automatic.

## How this was tested

The install, deploy, rollback, failure and backup paths have been run end
to end on fresh Debian 12 and Ubuntu 24.04 machines with systemd, against a
local S3-compatible server. That was everything except a real domain,
Scaleway and real EU object storage. The commit messages on the branch that
added this list what each run found.
