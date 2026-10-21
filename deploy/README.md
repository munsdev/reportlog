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
| `/opt/bugsink`                 | → Bugsink, if this server runs it (`/opt/bugsink-<v>`) | root                       |
| `/etc/bugsink`                 | Bugsink's settings and its own key (`bugsink.env`)     | root:bugsink, 0750         |
| `/var/lib/bugsink`             | Bugsink's database (SQLite) and what it received       | bugsink, 0750              |

Services: `reportlog-api` (the API, on 127.0.0.1:3000), `reportlog-job@<name>`
(one per scheduled job, started by `reportlog-<name>.timer`),
`reportlog-alert@` (emails `OPS_ALERT_EMAIL` when a job fails),
`reportlog-update-check` (root, daily: is there an update?), `caddy` and
`postgresql`. With error tracking: `bugsink` and `bugsink-snappea` (below).

## Setting up a server

You need: a Hetzner server running **Debian 12 or Ubuntu 24.04** (x86 or
Arm), a domain whose DNS you control, a Scaleway project with Transactional
Email, and an EU object storage bucket.

1. **DNS.** Point the domain's A (and AAAA) record at the server. Caddy
   needs this to get a certificate. Check it from your own machine with
   `dig +short reports.example.org`. A fresh Debian has no `dig`
   (`dig: command not found`): use `host reports.example.org` or
   `getent hosts reports.example.org` instead, which every machine has, or
   `sudo apt install dnsutils` to get `dig`. Either way you should see the
   server's address and nothing else.
2. **Firewall.** In the Hetzner Cloud console, allow inbound 22, 80 and 443
   (443/udp too, for HTTP/3) and nothing else. PostgreSQL listens on no TCP
   port at all, so there is nothing else to protect, but a firewall at the
   edge costs nothing.
3. **Install.**

   ```sh
   git clone https://github.com/munsdev/reportlog.git /root/reportlog
   sudo /root/reportlog/deploy/install.sh
   ```

   A private repository needs a credential for that `git clone` and for
   every later `reportlog updates` and `reportlog deploy`. **It is root's
   credential**, set up in root's own git configuration (a deploy key in
   `/root/.ssh`, or a token in `/root/.git-credentials`), because those
   commands run as root. The `reportlog` user, which runs the website, never
   holds it, and a credential that is missing or has expired shows up in the
   doctor as a failed fetch, not as a network fault.

   It turns on unattended security updates and installs PostgreSQL 16 (from
   the PostgreSQL project's repository, socket only), Node at the exact
   version in `deploy/versions.conf` (refused unless its SHA-256 matches),
   and Caddy. It creates the `reportlog` user, the database and role (peer
   authentication: no password exists to leak), and writes
   `/etc/reportlog/reportlog.env` from `.env.example`. It is safe to run
   again, and never overwrites the settings file.

4. **Settings: answer the installer's questions.** Nobody edits the settings
   file by hand. `install.sh` makes the keys a machine can make
   (`CONTACT_KEY`, `FILES_KEY`, `DOOR_KEY`, the transparency log's deploy key), sets
   `TRUST_PROXY=1` (Caddy is one proxy in front), and then asks, one at a
   time, for what only you know: the site's address, the Scaleway email
   account (the sending address, the project ID and the API key's secret
   key), who gets alerts, the off-site backup bucket and its upload-only
   key, storage for reporters' files, and where the transparency log is
   pushed. Keys and passwords are not shown while you type them. Enter
   skips a question; it ends by naming what is still empty, and running it
   again asks only that. Have the accounts below ready (Email, Off-site
   backups) before you start, or come back to them.
5. **Deploy.** `sudo reportlog deploy`
   Then **set the site password**: `sudo reportlog site-password` (it asks
   twice and shows nothing as you type). Open the site, enter that password,
   and the setup wizard makes you the owner and asks whether to keep the
   password. The wizard refuses to run without one, so a stranger who finds
   a fresh install cannot seat themselves as its owner. The same command is
   the way back in if the password is ever lost.
6. **Check.** `sudo reportlog doctor`, then
   `sudo reportlog mail-test you@example.org` and look for the message,
   including in the spam folder.
7. **Copy the settings file off the server**, once, to wherever you keep
   secrets. Backups deliberately do not include it (it holds keys, and a
   backup that carries its own keys protects nothing). Above all
   `CONTACT_KEY` and `FILES_KEY`: see below.
8. **Optional: error tracking**, with Bugsink on this server
   (`sudo /root/reportlog/deploy/install-bugsink.sh`, below).

### Keys and secrets

Keys, passwords and tokens are part of setting up a server, never part of
the repository (`docs/decisions.md`). On a server they are in
`/etc/reportlog/reportlog.env` (root:reportlog, 0640) and nowhere else: the
API, every job and every deploy step read that one file
(`node --env-file=/etc/reportlog/reportlog.env`), and `.env.example` in the
repository has every one of them blank.

| Setting                                                  | Where it comes from                                                 |
| -------------------------------------------------------- | ------------------------------------------------------------------- |
| `CONTACT_KEY`, `FILES_KEY`                               | made by `install.sh` (32 random bytes); never changed, only rotated |
| `DOOR_KEY`                                               | made by `install.sh` (32 random bytes); safe to replace at any time |
| `TWO_FACTOR_KEY`                                         | made by `install.sh` (32 random bytes); a new one resets staff apps |
| `TRANSPARENCY_LOG_SSH_KEY`                               | a key file made by `install.sh`; its public half is shown to add    |
| `SCALEWAY_SECRET_KEY`                                    | asked by `install.sh`, from the Scaleway console                    |
| `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY` | asked by `install.sh`, from the storage provider (upload-only key)  |
| `S3_ACCESS_KEY`, `S3_SECRET_KEY`                         | asked by `install.sh`, once a files provider is chosen              |
| `TRANSPARENCY_LOG_REMOTES`                               | asked by `install.sh` (an https address may carry a token)          |
| `ERROR_TRACKING_DSN`                                     | written by `install-bugsink.sh`                                     |
| `CONTACT_KEY_PREVIOUS`                                   | only while rotating the contact key, by a person (below)            |

`apps/api/test/unit/secrets.test.ts` holds the code to this table. The
one exception to "one file" is Bugsink's own key, which lives in
`/etc/bugsink/bugsink.env`: Bugsink is a second application and must not be
able to read the archive's keys.

CI scans every commit of the repository for keys (gitleaks, pinned by
version and checksum, with `.gitleaks.toml`). If it ever finds one, the key
is leaked whatever happens next: **rotate it first**, then remove it.

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
- **Never change it by accident.** A different key makes every stored
  address unreadable. The first deploy records the key's fingerprint
  (`/var/lib/reportlog/contact-key.sha256`). From then on, a deploy with a
  different key stops before switching, and the doctor fails. If that
  happens, put the original key back. `install.sh` never makes a new key on
  a server that has recorded one. To change it on purpose, rotate it (below).
- **Lose it and you lose the addresses.** The reports themselves are
  unaffected: they never contain an address.

#### Rotating the contact key

For when the key may have been seen by somebody it should not have been, or
an operator who held it leaves. The site keeps running throughout.

1. Make a new key (`openssl rand -base64 32`) and keep a copy off the server.
2. In `/etc/reportlog/reportlog.env`, move the current key to
   `CONTACT_KEY_PREVIOUS=` and put the new one in `CONTACT_KEY=`. Deploy (or
   restart the API). The deploy's check lets this through because the key
   in `CONTACT_KEY_PREVIOUS` is the recorded one; any other change is still
   refused. With both keys the site writes everything new under the new key
   and still reads the old.
3. `sudo reportlog contact-key rotate`. In one transaction it re-wraps every
   report's key under the new key and re-computes the digests that find a
   reporter's reports; then it records the new key's fingerprint. If
   `CONTACT_KEY_PREVIOUS` is not the key the rows are under, it stops and
   changes nothing. It is safe to run again. Erased reports stay erased: their
   keys are gone and nothing brings them back.
4. Remove `CONTACT_KEY_PREVIOUS=` and restart the API. The doctor warns until
   you do. Destroy the old key's copies.

Every rotation is recorded in the database (`contact_key_rotations`, by
fingerprint, never the key). The code is `apps/api/src/filing/rotateContactKey.ts`.

### Two-factor login

Everybody with a role (the owner, administrators, access managers,
moderators, journalists and anybody in an organization) proves a second
factor after the emailed code: an authenticator app or a passkey (plan E,
decision E3). Staff sessions last 12 hours. Authenticator-app secrets are
encrypted under `TWO_FACTOR_KEY`, which `install.sh` makes. It is not the
contact key and has none of its rules: if it is lost or replaced, each
staff member sets their app up again after signing in with a passkey or a
recovery code, or after a reset. Passkeys and recovery codes are not under it.

The owner resets anybody else's second factor from the Access screen. The
owner's own is reset only here, on the server:

    sudo reportlog reset-2fa owner@example.org

It clears that person's authenticator app, passkeys and recovery codes and
signs them out everywhere. Their next sign-in, after the emailed code, sets
a new one up. Each reset is recorded in the role audit, which nobody can
edit. The code is `apps/api/src/identity/reset-two-factor.ts`.

### Email (Scaleway)

In the Scaleway console: add and verify the sending domain under
Transactional Email, publish the SPF, DKIM and DMARC records it shows you,
and create an API key whose IAM policy allows Transactional Email in that
project. Mail from a domain without those records is usually accepted and
then filed as junk, so `mail-test` succeeding is not the end of it: check the
message arrives.

### Error tracking (Bugsink)

Optional, and off until you set it up. With it on, the API's unexpected
errors, a scheduled job that crashes, and errors in visitors' browsers
arrive in [Bugsink](https://www.bugsink.com/), on this same server (the
owner's decision, `docs/decisions.md` item 13).

1. **A domain for it**, such as `bugsink.reports.example.org`, with its DNS
   (A and AAAA) pointed at this server like the site's.
2. **Install it:**

   ```sh
   sudo /root/reportlog/deploy/install-bugsink.sh
   ```

   It asks for the domain (suggesting `bugsink.<the site's domain>`), then
   installs Bugsink at the version in `deploy/versions.conf` into
   `/opt/bugsink-<version>`, from `deploy/bugsink/requirements.txt`, where
   every file pip may install is pinned by SHA-256 (downloaded from PyPI).
   It runs as its own `bugsink` user with its own database (SQLite files in
   `/var/lib/bugsink`, not the archive's PostgreSQL) and its own key
   (`/etc/bugsink/bugsink.env`, made here). It asks for an email address and
   password for Bugsink's own sign-in, makes a project called "ReportLog",
   and writes `ERROR_TRACKING_DSN` into `/etc/reportlog/reportlog.env`,
   pointing at `http://<key>@127.0.0.1:8000/<project>`: the API sends to
   the local port, so its events never leave the machine. It starts the
   services `bugsink` (on 127.0.0.1:8000, no access log) and
   `bugsink-snappea` (its background worker), restarts the API, and adds
   the domain to Caddy, which every later deploy keeps
   (`BUGSINK_DOMAIN` in `/etc/reportlog/deploy.env`).

3. **Sign in** at `https://<the domain>`.

Set `ERROR_TRACKING_ENVIRONMENT=staging` on a server that is not the real
one. Jobs pick up the DSN the next time they run.

Bugsink is a second application with its own login on the archive's
server, so it is kept apart: it cannot read `/etc/reportlog`, its units are
confined like the archive's, it does not record visitors' addresses
(`USE_X_REAL_IP = False`; Caddy keeps no access log for it either), it
sends no email, and its anonymous daily report to bugsink.com is turned
off (`deploy/bugsink/bugsink_conf.py`). An error is kept 30 days. Its
database is not in the backups: it holds errors to fix, not a record.

**Upgrading Bugsink:** change the version in `deploy/bugsink/requirements.in`
and `BUGSINK_VERSION` in `deploy/versions.conf`, regenerate
`requirements.txt` (the command is in `requirements.in`), merge, then run
`install-bugsink.sh` again from an updated checkout. Its services apply
Bugsink's own migrations when they start.

**Moving Bugsink off this server later** needs only a new DSN: run Bugsink
elsewhere, make a project, put its DSN in `ERROR_TRACKING_DSN`, restart the
API, then `systemctl disable --now bugsink bugsink-snappea` here and empty
`BUGSINK_DOMAIN` in `deploy.env`.

What an event carries is an allowlist (`packages/contracts/src/telemetry.ts`):
the error's type and message, its stack, the route's **pattern**
(`/api/reports/:ref`, never the address) and the release. **Never** an IP
address, a page's address (an address can carry a token), a request body,
headers, cookies, who was signed in or what they did before. URLs, email and
IP addresses and anything that looks like a token are cut out of the message
too. Refusals (a 404, a wrong password, a bad form) are not errors and are
not sent.

**Visitors' browsers never talk to Bugsink.** The website loads nothing for
this until an error happens; then it asks this site whether tracking is on,
and if so posts the error to this site (`/api/telemetry/errors`). The server
cleans it again, because a browser is not trusted to have, and passes it on
with its own DSN. At most 30 website errors a minute are passed on, so a
stranger cannot flood your Bugsink through the site. The site's content
security policy still allows no other host.

With `ERROR_TRACKING_DSN` empty, nothing is sent anywhere and the relay
answers that error tracking is off.

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

### Checking file storage

Reporters' files (evidence) live in three buckets, separate from the backup
bucket: staging, evidence and renditions (`FILES_STORAGE=s3` and the `S3_`
settings, explained in the settings file). No provider has been chosen yet.
Once one is, and before the site takes anybody's files, run the check once
against it, on the server:

```sh
cd /srv/reportlog/current
sudo -u reportlog /usr/local/bin/node --env-file=/etc/reportlog/reportlog.env \
  apps/api/src/files/storage-check-cli.ts
```

It writes a small object to each bucket, reads it back whole and as a range,
deletes it, and checks it is gone. It leaves nothing behind. Every line
should start with `ok`:

```
ok    staging: write, read, range, delete, refuses an unsigned read
ok    evidence: write, read, range, delete, refuses an unsigned read
ok    renditions: write, read, range, delete, refuses an unsigned read
```

| It says                                           | Usually                                                        |
| ------------------------------------------------- | -------------------------------------------------------------- |
| `Storage is not configured: …`                    | the setting it names is empty                                  |
| `failed: 404 … NoSuchBucket`                      | that bucket's name is wrong, or it was made in another region  |
| `failed: 403 … SignatureDoesNotMatch` / `…Denied` | the key or secret is wrong, or the key may not use that bucket |
| `fetch failed (ENOTFOUND)`                        | `S3_ENDPOINT` names a host that does not exist                 |
| `fetch failed (ECONNREFUSED)` or a certificate    | the endpoint is wrong, or not reachable from the server        |
| `answers a read with no signature`                | the bucket is public: make it private in the provider's panel  |
| `… is wrapped in quotes` / `… a space`            | `.env` holds the value with quotes or spaces: write it bare    |
| `cannot be used with virtual-hosted addressing`   | rename the bucket without dots or capitals, or use path style  |

The files key needs read, write and delete on these three buckets (unlike
the backup key, which may only upload). The check has been run against
moto, a local S3-compatible server, by `apps/api/test/unit/deploy-storage-check.test.ts`
on every CI run, with path-style addressing. Virtual-hosted addressing
(`S3_ADDRESSING=virtual`) is tested only against the repository's own
stand-in (`apps/api/test/unit/files-storage.test.ts`): if the provider
needs it, this check is the first real thing that will run it.

### Every setting, by name

`.env.example` is the list; this is what each setting is for, so nothing in
the settings file is a mystery. The installer fills in the ones it can and
asks for the ones only you know (above), and `sudo reportlog doctor` names
anything still missing. A server's other settings, the keys, email, error
tracking and backups, are explained in their own sections above.

| Setting                                                                          | What it does                                                                                      |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                                   | The database. The installer writes it (a socket, no password).                                    |
| `TEST_DATABASE_URL`                                                              | Development only: where the test suite makes throwaway databases. Never on a server.              |
| `HOST`, `PORT`                                                                   | Where the API listens. Leave at `127.0.0.1` and `3000`: only Caddy is in front.                   |
| `LOG_LEVEL`                                                                      | How much the API logs. Logs never hold an address or a full link.                                 |
| `PUBLIC_REF_PREFIX`                                                              | The letters every public reference starts with (`RL-`). Sealed into every report: chosen once.    |
| `FILING_SENDS_PER_CLIENT`                                                        | How many confirmation emails one visitor may ask for in 15 minutes.                               |
| `DOOR_SUBMITS_PER_MINUTE`, `DOOR_SUBMITS_PER_HOUR`                               | Reports and tips one network address may send per minute and per hour (6 and 60).                 |
| `DOOR_REQUESTS_PER_MINUTE`                                                       | Requests of any kind one address may make per minute (600), so reading stays fast in a flood.     |
| `FILING_CONFIRMS_PER_CLIENT`                                                     | How many times one visitor may open or use confirmation links in 15 minutes.                      |
| `SITE_ORIGIN`                                                                    | The address people reach the site at. Every email link and Caddy's certificate use it.            |
| `ATTACHMENTS_ENABLED`                                                            | Whether files are taken until an administrator says otherwise. `install.sh` writes `false`.       |
| `CLAMAV_ENABLED`                                                                 | Scan each file with ClamAV first (needs `clamd`).                                                 |
| `FILES_DIR`, `FILES_INLINE_WORKER`                                               | Development only: where disk storage keeps files, and running the media worker inside the server. |
| `FILES_STAGING_QUOTA_REPORTS`                                                    | How many reports' worth of files one address may have waiting. 0 is no limit.                     |
| `S3_REGION`                                                                      | The files storage region. The installer reads it off the endpoint where it can.                   |
| `S3_BUCKET_STAGING`, `S3_BUCKET_EVIDENCE`, `S3_BUCKET_RENDITIONS`                | The three buckets for files not yet sent, files with a report, and re-encoded copies.             |
| `EMAIL_TRANSPORT`                                                                | `off` or `scaleway`. The installer turns it on once it can send.                                  |
| `EMAIL_FROM_ADDRESS`, `EMAIL_FROM_NAME`                                          | The sender, on a domain verified in Scaleway.                                                     |
| `SCALEWAY_PROJECT_ID`, `SCALEWAY_REGION`                                         | The Scaleway project and region (`fr-par`) mail goes through.                                     |
| `MAIL_OUTBOX`                                                                    | Browser tests only: write each email as a file. Never on a server.                                |
| `LIST_PERSONAL_DAYS`, `LIST_ERASURE_LINK_DAYS`                                   | How long a list keeps the personal half of an entry (with its links), and an erasure link.        |
| `LIST_KNOWN_HOSTS`                                                               | Link hosts a moderator knows; others are marked for a look.                                       |
| `BACKUP_DIR`, `BACKUP_KEEP`, `BACKUP_MAX_AGE_HOURS`                              | Where local dumps go, how many to keep, and how old the newest may be before the doctor fails it. |
| `BACKUP_S3_ENDPOINT`, `BACKUP_S3_REGION`, `BACKUP_S3_BUCKET`, `BACKUP_S3_PREFIX` | The off-site bucket. The installer reads the region off the endpoint where it can.                |
| `STATE_DIR`                                                                      | Where jobs record what they last did, for the doctor.                                             |
| `TRANSPARENCY_LOG_DIR`, `TRANSPARENCY_LOG_BRANCH`                                | The checkout of the transparency log on this server, and its branch.                              |
| `TRANSPARENCY_LOG_AUTHOR_NAME`, `TRANSPARENCY_LOG_AUTHOR_EMAIL`                  | Who the log's commits are by.                                                                     |
| `TSA_URL`                                                                        | The RFC 3161 timestamp authority. Unset, DFN's, in Germany.                                       |
| `PRESS_DIR`                                                                      | A folder with a press pack built ahead of time. Unset, the press page says there is none.         |

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

## Updates

```sh
sudo reportlog updates           # is there an update, and what would it change?
sudo reportlog deploy <commit>   # the only way one is installed
```

`reportlog updates` fetches the repository (`REPO_URL` and `DEPLOY_REF` in
`/etc/reportlog/deploy.env`) and says how far the running release is behind
the branch, which releases lie between them, with their notes from the
newest `CHANGELOG.md`, the commits, and the exact deploy command. It
installs nothing. Releases are numbered (`"version"` in the root
`package.json`, shown in every page's footer) and tagged `vX.Y.Z`; the
repository's README says how one is cut. `sudo reportlog deploy v0.2.0`
installs a tagged release.

The same check runs **every morning around 06:00** as root
(`reportlog-update-check.timer`). When it finds a commit it has not told you
about, it emails `OPS_ALERT_EMAIL` once. The doctor warns while the server
is behind, when the repository could not be fetched (and says why: a
credential, DNS, the network), and when the daily check has stopped. To turn
the check off: `sudo systemctl disable --now reportlog-update-check.timer`
(a deploy turns it back on).

**Why there is no update button on the website.** The old application had
one: the website wrote a request and a root process applied it. That is a
path from a web request to code running as root, on a server holding
people's reports, and it needed a great deal of care to be safe. Here the
path does not exist. An update migrates the database and can stop half-way
with something to read, so a person runs it, at a terminal. The check runs as
root only because the repository's address and credentials are root's, as
they are for a deploy; it runs root's own copy of these scripts, never code
from a release, and writes only what it found (`/var/lib/reportlog/updates/`),
which nothing reads to decide what to install.

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

| Job                 | When          | What                                                                                                          |
| ------------------- | ------------- | ------------------------------------------------------------------------------------------------------------- |
| `backup`            | daily 03:00   | Dump, check, encrypt and send off-site                                                                        |
| `sweep`             | daily 03:30   | **Delete** expired credentials from named tables                                                              |
| `lists-sweep`       | daily 03:40   | **Erase** the personal half of expired list entries; the rows stay (workstream E's `sweepLists`)              |
| `anchor`            | daily 04:00   | Timestamp the chain heads (DFN) and publish them to the transparency log (workstream D2's `runAnchorJob`)     |
| `anchor-watch`      | daily 09:00   | Check from outside the anchor that it ran; fails (and alerts) when the archive has not been anchored          |
| `digest-hourly`     | hourly        | Email hourly subscribers what the board published since their last email                                      |
| `digest-weekly`     | Mondays 07:00 | The same, for weekly subscribers                                                                              |
| `journalist-alerts` | daily 08:00   | Email each journalist on the alert list how many new approved reports there are in their states (counts only) |
| `feedback-digest`   | Mondays 08:00 | Email `ADMIN_EMAIL` every open feedback issue, longest-untouched first                                        |

The anchor needs `git` on the server and the `TRANSPARENCY_LOG_*` settings
in `/etc/reportlog/reportlog.env` (see `.env.example`): the checkout under
`/var/lib/reportlog`, and the log's address with a deploy key that has write
access. Without a remote it still timestamps, keeps the day on the server and
fails the unit. A run that **refuses** (a logbook gone from the list, or a
chain shorter than published) exits 2 and keeps refusing every day: that is
what deleting reports looks like, and the doctor puts it first.

`anchor-watch` exists because the alert below fires only when a job runs
and fails. An anchor that never runs (its timer disabled, its unit lost)
fails nothing, and the doctor notices only when somebody runs it. So every
morning this job asks the doctor's own anchor question from outside the
anchor, and fails, which sends the alert, when the newest anchor is over
`ANCHOR_MAX_AGE_HOURS` old, when the last run refused or published nothing,
or when the log has nowhere to go. On a day the anchor itself failed you get
two emails: the anchor's at about 04:00 and this one at about 09:00.

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
| Owner locked out  | `sudo reportlog reset-2fa <the owner's address>` (Two-factor login, above)  |
| A job failed      | `journalctl -u reportlog-job@<name> -n 50`                                  |
| An error, in code | Bugsink, if `ERROR_TRACKING_DSN` is set; otherwise the journal              |
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
to end on fresh Debian 12 and Ubuntu 24.04 machines with systemd. The test
site was `https://localhost` with Caddy's internal certificate authority,
and a local S3-compatible server stood in for object storage. That was
everything except a real domain, Scaleway and real EU object storage. The
commit messages on the branch that added this list what each run found;
`docs/status/H-operations.md` summarizes them.

On every CI run (`docs/status/P7-ops-tests.md` and `Q3-quality-ops.md` list
what each proves):

- `install.sh`, `install-bugsink.sh`, `deploy.sh`, `rollback.sh` and
  `reportlog` run against a pretend server in a temporary directory, with
  systemd, apt, pip, Caddy and the build as stand-ins, answering the
  installers' questions on standard input
  (`apps/api/test/unit/deploy-install.test.ts`, `deploy-release.test.ts`,
  `deploy-bugsink.test.ts`);
- the secret settings against `.env.example`, the units and the installers
  (`secrets.test.ts`), and the secret scan against planted keys
  (`secret-scan.test.ts`);
- this Caddyfile, in a real Caddy (`deploy-caddy.test.ts`), and with
  Bugsink's site added (`deploy-bugsink.test.ts`);
- the storage check, against moto (`deploy-storage-check.test.ts`);
- the doctor's migration check, against real databases in each drift state
  (`apps/api/test/db/deploy-schema-drift.test.ts`).
