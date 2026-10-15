# contrib — the bits around the app

Reverse proxy and service templates. None of this is required to *try*
ReportLog — `npm start` runs it on a port — but all of it is required to
leave it running.

These are the files a working deployment actually uses, not sketches.

## The two scripts

| | |
|---|---|
| `./contrib/install-units.sh` | Install and enable every unit below, substituting the path, user, node binary, backup directory and transparency-log directory together; make those two directories; install root's copy of the updater and the one sudoers line `deploy.sh` needs. Idempotent, and `--dry-run` prints every command without running one. |
| `./contrib/deploy.sh` | Pull, install from the lockfile, migrate, restart, then check it came back. Refuses to run over uncommitted changes, fast-forwards only, and prints the rollback command if the service does not return. |
| `./contrib/reset-to-fresh.sh` | **Destroys the archive on this box** and puts it back to the state a stranger's install starts in, so the first-run wizard runs again. For test deployments only. It never touches `.env`. |

The reset makes you type the deployment's own `SITE_ORIGIN` to confirm,
after printing the real counts of what it is about to delete. That is the
only confirmation that cannot be given by reflex, and the only one that
catches the mistake that matters: running it on the wrong box.

## The first deploy is by hand

`deploy.sh` cannot perform the deploy that installs `deploy.sh`. On any box
checked out before `contrib/` existed, `./contrib/deploy.sh` is simply not
there, and bash says `No such file or directory`. That is the file missing,
not the box being broken.

Pull once by hand and the scripts exist from then on:

```
cd /srv/reportlog
git rev-parse --abbrev-ref HEAD          # confirm it is on a branch, not detached
git status --porcelain                   # must be empty apart from ?? lines
git pull --ff-only origin "$(git rev-parse --abbrev-ref HEAD)"   # stable, on an install
npm ci --omit=dev
npm run migrate
sudo systemctl restart reportlog
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:5000/api/health
```

`200` on the last line means it came back. After that, every deploy is
`./contrib/deploy.sh`, which does all of the above and checks the result.

## Order

**The install sequence lives in [`INSTALL.md`](../INSTALL.md), not here.** It
is the canonical guide and it is kept current; a second copy of the order of
operations is how two copies drift.

What this file is for is the part of the install that is *this directory* — the
service files, the proxy, and the handful of ways each goes wrong quietly.
`INSTALL.md` §3.13 and §3.14 walk you into them; everything below is the
detail.

The one line worth repeating anywhere: **`npm run doctor`**, first and after
every step. It installs nothing and changes no files.

## systemd

| File | What it does |
|---|---|
| `reportlog.service` | The app. Required. |
| `reportlog-media-worker.{service,timer}` | Processes uploads, every minute. **Required if attachments are on** — without it an upload sits at "checking" forever. |
| `reportlog-anchor.{service,timer}` | Once a day, timestamps the list of every logbook's chain with an RFC 3161 authority and publishes it. |
| `reportlog-backup.{service,timer}` | Once a day, a verified `pg_dump` into `BACKUP_DIR`, pruned to the newest few. **Required.** This archive cannot delete a row by design, which protects it from being edited and not at all from the disk dying. |
| `reportlog-anchor-watch.{service,timer}` | Once a day, checks the anchor above actually ran. Enabled is not the same as running. |
| `reportlog-sweep.{service,timer}` | Deletes expired sign-in codes and sessions, and erases the personal half of expired list entries. **Required once a list holds entries.** |
| `reportlog-notify-hourly.{service,timer}`, `-weekly` | The digests people subscribe to in their own settings. Required once anybody subscribes. |
| `reportlog-update.{service,timer}` | Once a minute, applies an update an admin asked for in the Updates pane, as root, from `/usr/local/libexec/reportlog/update-apply.sh`. Optional. |

```
sudo ./contrib/install-units.sh --dry-run    # read it first
sudo ./contrib/install-units.sh
```

**That script exists because of this section.** The anchor timer was missing
from the hand-typed list that used to be here, so a deployment that followed
these instructions exactly **never anchored** — and nothing noticed, because a
deployment that is not anchoring looks completely healthy. A list of five
commands is five chances to stop after four.

It also refuses when `node` is inside a home directory, rather than writing a
unit that cannot start, and it substitutes `User`, `Group`,
`WorkingDirectory`, `ExecStart` and `ReadWritePaths` together — the five lines
this file used to ask you to change by hand, which is exactly the kind of
instruction followed four times out of five.

`--dir`, `--user`, `--node`, `--backup-dir` and `--log-dir` say what yours
are.

**There is no by-hand list here any more.** There was, and it drifted from the
script one omission at a time — after the anchor timer, it went on missing the
backup directory, the sudoers line and three timers. `--dry-run` prints every
command the script would run, which is the by-hand version and is always
current. `npm test` fails if a list comes back.

If you are reading this on an instance that has been running a while, check
rather than assume — and `npm run doctor` faults a missing anchor,
anchor-watch or backup timer, and a missing digest timer once anybody has
subscribed to one:

```
systemctl list-timers --all | grep reportlog
```

**The anchor needs two things the other units do not.** It writes into
`TRANSPARENCY_LOG_DIR`, which is not under `/srv/reportlog`, and it pushes
over ssh. `install-units.sh` writes that directory into the unit's
`ReadWritePaths` and creates it; a key made in the owner's transparency-log
pane lives under the checkout. A sandbox failure here happens *after* the
timestamp authority has been called, so it costs a real request each time.
`INSTALL.md` §3.13 walks through the repository, the key and the checkout.

**That deploy key needs write access**, unlike the one the application uses
to pull. On GitHub, write cannot be turned on for an existing deploy key —
it has to be removed and added again.

Each file in the checkout names `/srv/reportlog` and a `reportlog` user. The
script writes yours into the copies it installs; the files here stay as
shipped, so a release that changes one never conflicts with a local edit.

`ProtectSystem=strict` with `ReadWritePaths=/srv/reportlog` means the app
cannot write outside its own checkout. If you point `MEDIA_CACHE_DIR`
somewhere else, add that path or the service fails on its first write.

Check it came up:

```
systemctl is-active reportlog
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:5000/api/health
```

`/api/health` sits outside the site-access gate deliberately, so it answers
`200` even while the instance is locked. It is the cleanest liveness check.

## nginx

| File | What it does |
|---|---|
| `reportlog.conf` | The site. Get a certificate first, then paste this body into the server block certbot wrote. |
| `test-instance.conf` | One `X-Robots-Tag` line for a gated test deployment. |
| `privacy-log.conf` | An access-log format that does not undo what the app is careful about. |

**The one mistake worth warning about:** nginx serves `public/` off disk,
and everything the *app* answers must be proxied. Miss a location block and
nginx 404s the route before Node ever sees it — which looks like the app
being broken rather than the proxy.

**And the worse version of it, which actually happened on 13 September.**
When a path exists BOTH as a file in `public/` and as a route in the app —
`/manifest.webmanifest` is the example — a missing location block does not
404. nginx serves the file, successfully, with a 200. Nothing looks broken
at all; the deployment simply goes on answering with a stale copy of
something the app was supposed to build. It was three days out of date and
naming the wrong deployment before anybody checked.

The tell is in the response headers, not the body:

```
ETag: "6aa2a2d4-370"                     ← strong etag, nginx: a file on disk
Last-Modified: Thu, 10 Sep 2026          ← whenever it was deployed

ETag: W/"2f8-wNeKIN6R…"                  ← weak etag, Express: the app
Cache-Control: no-cache                  ← what npm run doctor looks for
```

The content type differs too, but what nginx sends for a file depends on the
box's `mime.types`, so it is the weaker of the tells.

**`deploy.sh` never edits nginx's configuration**, deliberately — a deploy script that
rewrites a web server's configuration is a deploy script that can take a
site down. It does reload nginx after `nginx -t` passes, so files nginx includes from the checkout take effect — **when the account running it has full sudo**. Run as the service user, whose sudo covers one restart and nothing else, it says it cannot and the reload is yours. So a release that adds a proxied path needs a one-time config
edit on every existing box, by hand. Diff your live config against
`reportlog.conf` after any release that mentions a new location block.

### The Content-Security-Policy is one file, included

The policy is `contrib/nginx/csp.conf`, and `reportlog.conf` includes it twice
(server block and `location = /sw.js`). **Setting that up is a one-time edit;
after it, changing the policy is a `git pull`**, and `deploy.sh` runs
`nginx -t` and reloads nginx, and never reloads if the test fails.

The one-time edit: in the live server block, replace each
`add_header Content-Security-Policy ...` line with

```
include /srv/reportlog/contrib/nginx/csp.conf;
```

then `sudo nginx -t && sudo systemctl reload nginx`. `deploy.sh` warns on every
run until the live config includes the file. A box that still carries a pasted
copy keeps serving that copy, and `npm run doctor` only notices if `script-src`
is wrong. **A box built before the header existed serves no policy and says
nothing.**

It has to be nginx's and not only the app's, because nginx answers for
`public/` off disk. `server.js` sets the same header, so a deployment without
the nginx include still gets it on `/api/*` and on nothing else. `npm test`
checks `csp.conf` and `server.js` agree; it cannot see your box.

Check yours, and expect a policy on every line:

```
for p in / /js/boot.js /sw.js /css/page.css /api/site-access/status; do
  printf '%-26s %s\n' "$p" \
    "$(curl -sI "https://your.deployment$p" | grep -i '^content-security-policy')"
done
```

If only the last line answers, the header is the app's and the include is
missing.

**One `add_header` anywhere in a `location` drops every header inherited from
the server block** - nginx's rule. That is why the include appears inside
`location = /sw.js`. If you add a header to any other location, include
`csp.conf` there too. The same applies to the `X-Robots-Tag` line from
`test-instance.conf`.

### Scripts and styles revalidate: `cache.conf`

`contrib/nginx/cache.conf`, included once in the server block under the
`csp.conf` include, makes `.js`, `.css` and `.html` `no-cache` — kept, but
checked with the server before use. Without it a browser guessed how long a
script was fresh, kept one old module beside new ones after an update, and
showed a white page. It holds a location block and repeats the `csp.conf`
include inside it, for the reason above. `deploy.sh` warns until the live
config includes it, and the Update button reloads nginx after `nginx -t`
passes, so changes to either file arrive with an update from then on.

`script-src 'self'` holds only while **no page in `public/` carries inline
script**. `npm test` fails on one appearing.

### Two ways an nginx edit goes wrong quietly

**Never leave a backup in `sites-enabled/`.** `nginx.conf` includes that
directory with a bare `*` and no extension filter, so `mysite.bak` beside
`mysite` is parsed as a second copy of the same server block. It fails as
`duplicate listen options`, at a line number *inside the backup*, which reads
like a broken config rather than a stray file. Keep backups somewhere nginx
does not look.

**And it fails late, not now.** The running server keeps the config it already
parsed, so everything looks fine until something reloads — a certificate
renewal, weeks later, with nothing to connect it to the edit. Always finish an
edit by testing it.

**`cp -a` of a `sites-enabled` entry usually copies a symlink, not a file.**
Those entries are conventionally links into `sites-available`, and `-a`
preserves links, so the "backup" points at the very file you are about to
change: it holds no content, and restoring from it does nothing while
appearing to succeed. Use `cp -L`, or back up the target of the link.

```
sudo nginx -t && sudo systemctl reload nginx
```

The `&&` matters. A failed test must not reload.

## Not here

**No Dockerfile or compose file**, on purpose. Containers make the first ten
minutes easier — Postgres and five media binaries arrive already installed —
and they make the database one careless `docker compose down -v` away from
deleted. For an append-only archive whose whole value is that the record
survives, that is a bad trade to make the default. `npm run doctor` covers
the same ground: it tells you what is missing and how to install it, without
putting a volume between you and your data.

If you want to containerise it anyway, nothing in the app resists it. Bind-mount
the Postgres data to a path you can see rather than a named volume.
