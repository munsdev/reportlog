# Installing ReportLog

A tamper-evident archive of incident reports, on your own server.

This is the canonical install guide. If you find install instructions
anywhere else in this repository, they point here.

**Written for somebody who has not run a production server before.** Every
step says what it does, what to type, and what should happen. **If you have
just rented a server and have not connected to it yet, start at §0** — it
begins at the control panel rather than at a command prompt. If you have done
this kind of thing a hundred times, the whole sequence is in §1 and you can
skip the rest.

**Tested on** Debian and Ubuntu. The commands below are apt; `npm run doctor`
prints the right ones for Fedora, RHEL, Arch, Alpine and macOS, so the guide
still works elsewhere — read §3.

---

## Contents

0. [Getting to a command prompt](#0--getting-to-a-command-prompt)
   1. [The server](#01--the-server)
   2. [An SSH key, if you do not have one](#02--an-ssh-key-if-you-do-not-have-one)
   3. [Connecting](#03--connecting)
   4. [The first five minutes on a new box](#04--the-first-five-minutes-on-a-new-box)
1. [The short version](#1--the-short-version)
2. [What you need before you start](#2--what-you-need-before-you-start)
3. [Step by step](#3--step-by-step)
   1. [A user and a place to put it](#31--a-user-and-a-place-to-put-it)
   2. [Node](#32--node)
   3. [PostgreSQL](#33--postgresql)
   4. [Get the code](#34--get-the-code)
   5. [Run the doctor](#35--run-the-doctor)
   6. [Media tools, if you want attachments](#36--media-tools-if-you-want-attachments)
   7. [Configure](#37--configure)
   8. [Back up `.env` now](#38--back-up-env-now)
   9. [Build the schema](#39--build-the-schema)
   10. [Set the curtain password](#310--set-the-curtain-password)
   11. [Prove mail works](#311--prove-mail-works)
   12. [First run, by hand](#312--first-run-by-hand)
   13. [Leave it running](#313--leave-it-running)
   14. [A certificate and the proxy](#314--a-certificate-and-the-proxy)
   15. [Finish setup in the browser](#315--finish-setup-in-the-browser)
4. [Checking it actually works](#4--checking-it-actually-works)
5. [Backups — read this before you take a real report](#5--backups--read-this-before-you-take-a-real-report)
6. [Your first logbook — nothing can be filed until you make one](#6--your-first-logbook--nothing-can-be-filed-until-you-make-one)
   1. [Create the draft](#61--create-the-draft)
   2. [Ask your questions](#62--ask-your-questions)
   3. [Read it as a reporter, before you launch](#63--read-it-as-a-reporter-before-you-launch)
   4. [Launch it — and this is the one-way door](#64--launch-it--and-this-is-the-one-way-door)
   5. [Somebody to review what arrives](#65--somebody-to-review-what-arrives)
   6. [File one for real, through the whole path](#66--file-one-for-real-through-the-whole-path)
7. [Upgrading](#7--upgrading)
8. [When something is wrong](#8--when-something-is-wrong)
9. [Starting over on a test box](#9--starting-over-on-a-test-box)
10. [What is deliberately not here](#10--what-is-deliberately-not-here)

---

# 0 · Getting to a command prompt

**Skip this if you already have a root shell on a server.** It is here
because everything after it starts at a `#` prompt, and nothing in this
guide used to tell you how to get one.

## 0.1 · The server

### Hetzner Cloud

In the Hetzner Cloud console, **Add Server**:

- **Location** — whichever is nearest the people who will use it. For an
  archive of reports about a place, prefer a country whose legal regime you
  are content with; the data lives there.
- **Image** — Ubuntu 24.04.
- **Type** — shared vCPU is fine. The smallest of the CX line — 2 vCPU,
  4 GB, 40 GB; it was called CX22 and is CX23 as of 2026, and Hetzner renames
  these — is comfortably above what this needs; see the measured numbers in
  [§2](#2--what-you-need-before-you-start).
- **SSH keys** — add one if you have one; [§0.2](#02--an-ssh-key-if-you-do-not-have-one)
  if you do not. Without a key Hetzner emails you a root password instead,
  which works and is worse.
- **Leave the rest alone.** No cloud-init, no volumes, no firewall yet —
  there is one in [§0.4](#04--the-first-five-minutes-on-a-new-box).

Create it, wait about fifteen seconds, and **copy the IPv4 address** from the
server's page. That is what you connect to, and it is what the DNS record in
[§2](#a-domain-name-pointed-at-it) points at.

### Any other provider

Whatever the provider calls it, you need three things out of their console
before you can start:

- the server's **public IPv4 address**,
- a **username** to log in as — usually `root`,
- and either an **SSH key** you gave them or a **password** they gave you.

Install **Ubuntu 24.04** or **Debian 12** if you were offered a choice.

## 0.2 · An SSH key, if you do not have one

A key is a pair of files on your own machine. The public half goes to the
server, the private half never leaves you, and together they replace typing
a password.

```
ssh-keygen -t ed25519
```

Press Enter at every prompt to accept the defaults. A passphrase is optional
and worth having. Then print the public half, which is the part you paste
into the provider's console:

```
cat ~/.ssh/id_ed25519.pub
```

On Windows PowerShell that is `type $env:USERPROFILE\.ssh\id_ed25519.pub`.

**The one with `.pub` on the end is the one you share.** The file beside it
without `.pub` is the private key; it never gets pasted anywhere, emailed, or
committed to a repository.

## 0.3 · Connecting

- **Windows** — open PowerShell: press the Start key, type `powershell`,
  press Enter. Windows 10 and 11 have `ssh` built in, so you do not need
  PuTTY or anything else.
- **Mac** — open Terminal: press ⌘-Space, type `terminal`, press Enter.
- **Linux** — open your terminal. On most desktops that is Ctrl-Alt-T.

Then, with your server's address in place of this one:

```
ssh root@203.0.113.10
```

**What you should see.** A warning that the authenticity of the host cannot
be established, and a fingerprint. Type `yes` and press Enter. You get that
once per server; it is your machine saying it has not seen this one before,
not that anything is wrong.

Then either it lets you straight in, or it asks for the root password the
provider emailed you. Hetzner makes you change that password immediately on
first login: it asks for the emailed one, then for a new one twice.
**Nothing is echoed as you type a password** — not even dots. That is
normal; keep typing.

You are in when the prompt ends in `#`, something like
`root@ubuntu-4gb-nbg1-1:~#`.

### It will not connect

- **`Permission denied (publickey)`** — the server has a key you do not
  hold. Check the server was created with the key you think it was; if not,
  use the provider's own web terminal, or rebuild it.
- **`Connection refused`, or it hangs** — usually the wrong address, or the
  server is still booting. Give it a minute, and check the IPv4 in the
  console is the one you typed.
- **`WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED`** — you rebuilt a
  server and your machine remembers the old one. Clear it with
  `ssh-keygen -R 203.0.113.10` and connect again.
- **Nothing works at all** — Hetzner's console has a `>_ Console` button
  that opens a terminal in the browser, straight onto the machine, without
  SSH. Slow to type in, but it gets you in when SSH will not. Most providers
  have an equivalent.

## 0.4 · The first five minutes on a new box

**Everything from here runs on the server, in that SSH window**, not on your
own machine.

Update what is installed. On a fresh image this usually has something to do,
and it is the one command that most often stops to ask a question:

```
apt update && apt upgrade -y
```

**If it asks you something.** A purple screen about restarting services:
press Tab to reach `<Ok>` and Enter. A question about a config file you have
never edited: keep the local version, which is the default.

Set the server's name, so the prompt and the logs say what this machine is:

```
hostnamectl set-hostname reports.example.org
```

Turn on the firewall. **Do the SSH line first** — enabling the firewall
without it locks you out of your own server:

```
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
ufw status
```

**What you should see.** `Status: active`, with OpenSSH, 80 and 443 listed.
Ports 80 and 443 are for the certificate and the website; without them the
certificate step in [§3.14](#314--a-certificate-and-the-proxy) cannot prove
the server is yours.

**Do not close this window until you have opened a second one.** If
anything about SSH or the firewall goes wrong, an already-open session is the
difference between a quick fix and the provider's browser console. Open a new
terminal, connect again, and only then carry on.

### Worth doing, and not required for this guide

Logging in as `root` over SSH is normal on a throwaway box and sloppy on one
that matters. On a deployment you intend to keep: make yourself a user, give
it sudo, put your key on it, then turn off root login and password
authentication entirely.

```
adduser admin
usermod -aG sudo admin
rsync --archive --chown=admin:admin ~/.ssh /home/admin
```

Open a second terminal and prove `ssh admin@203.0.113.10` works **before**
going further. Then, in `/etc/ssh/sshd_config`, set `PermitRootLogin no` and
`PasswordAuthentication no`, and `systemctl restart ssh`.

The rest of this guide assumes root. With a user of your own, put `sudo` in
front of the commands that change the system — the ones in §3 already say
`sudo` where they need it.

---

# 1 · The short version

The repository is public, so the clone below needs no login and no token.

## The scripted path

On Debian or Ubuntu, `install.sh` does every mechanical step — the packages
(certbot included), the user, the directory, the dependencies, the PostgreSQL
role and database — and then stops and prints the three commands that need a
person.

```
git clone --branch stable https://github.com/munsdev/reportlog.git
cd reportlog
sudo ./install.sh --dry-run          # prints every command, changes nothing
sudo ./install.sh                    # or --with-attachments: media tools and ClamAV
```

**Read the dry run first.** There is no `curl | bash` form of this on
purpose: `npm run doctor` installs nothing at all, which is the right posture
for a diagnostic, and an installer has to install — so the least it can do is
be legible before it runs.

`--with-attachments` installs ClamAV too, and leaves it off: scanning
starts only when you set `CLAMAV_ENABLED=true` in `.env`
([§3.6](#36--media-tools-if-you-want-attachments)).

It stops rather than running `npm run configure` for you, because that step
is a conversation **and** it generates two encryption keys that are never
displayed. Automating it would mean inventing answers or printing the keys,
and the keys not being printed is a property worth keeping.

Then `sudo ./contrib/install-units.sh`, a certificate, the proxy, and the
wizard. The rest of this guide is the same install done by hand, and is worth
reading either way — `install.sh` cannot get you a domain, an SMTP account or
a backup you have tested.

## By hand

`npm run doctor` after each step tells you what is missing, and prints the
install command for your distribution for any media tool it cannot find.

```
# as root: a user, a directory, Node 22+, PostgreSQL, nginx, certbot
apt install -y postgresql nginx git certbot python3-certbot-nginx
adduser --system --group --home /srv/reportlog reportlog
sudo -u postgres createuser reportlog --pwprompt
sudo -u postgres createdb reportlog -O reportlog

# as the reportlog user, in /srv/reportlog
git clone --branch stable https://github.com/munsdev/reportlog.git .
npm ci --omit=dev
npm run doctor
npm run configure                      # writes .env, generates the two keys
npm run migrate
npm run set-curtain-password
npm run mail-test -- you@example.org
npm start                              # check it comes up, then Ctrl-C

# back as root: the service, its timers, the updater root runs, the
# backup and transparency-log directories and the one sudoers line
sudo /srv/reportlog/contrib/install-units.sh --dry-run   # read it first
sudo /srv/reportlog/contrib/install-units.sh
# the transparency log's checkout: §3.13
sudo certbot --nginx -d reports.example.org
# then merge contrib/nginx/reportlog.conf into the block certbot wrote
sudo nginx -t && sudo systemctl reload nginx
```

Then open the site, enter the curtain password, and finish the eight-screen
wizard.

**Four things in that sequence bite people, every time.** Read them even if
you skip the rest:

- **`.env` holds two encryption keys that exist nowhere else.** Lose either
  and the data behind it is unreadable forever. [§3.8](#38--back-up-env-now)
- **Without working mail no report can be confirmed**, and the only way to
  sign in is to read the code out of the server's log.
  [§3.11](#311--prove-mail-works)
- **The proxy has to forward five paths**, and the shipped block has seven
  `location`s in all. Miss `/manifest.webmanifest` and it fails *silently*
  with a 200. [§3.14](#314--a-certificate-and-the-proxy)
- **A backup timer is not a backup you can restore from.** `npm run backup`
  and `reportlog-backup.timer` take a verified dump daily and the doctor
  faults a stale one — but **getting a copy off this machine, and proving a
  restore works, is yours** and cannot be automated. Neither can `.env`.
  [§5](#5--backups--read-this-before-you-take-a-real-report)

---

# 2 · What you need before you start

## System requirements

Any Linux box you have root on, **from any host** — Hetzner, DigitalOcean,
Vultr, Linode, OVH, a machine under your desk. Nothing here is specific to
one provider. One Node process, a Postgres database, and nginx in front.

### The software

| | | |
|---|---|---|
| **Node** | **22.0.0 or newer** | hard requirement — the app refuses to start below it |
| **PostgreSQL** | **16 or 17** | what this has run on |
| **nginx** | any current version | the app binds `127.0.0.1` only, so a reverse proxy is assumed, not optional |
| **OS** | **Debian 12**, or **Ubuntu 22.04 / 24.04** | the tested paths. `install.sh` uses apt on anything Debian-family (Debian 13, Mint…), untested |
| **certbot** | | for the certificate, §3.14 |
| `ffmpeg`, `ffprobe`, `heif-convert`, `pdftoppm`, `pdfinfo` | from `ffmpeg`, `libheif-examples`, `poppler-utils` | **only if you want attachments**, §3.6 |
| `clamdscan` | from `clamav-daemon` | optional and **off unless `CLAMAV_ENABLED=true`**; it fails closed, so switching it on without the binary leaves files unprocessed rather than unscanned |

On Fedora, RHEL or Arch the application itself is fine — `install.sh` does
the parts that do not need a package manager and tells you to let
`npm run doctor` name the packages for your system.

### Getting all of it in one go

The steps below install these one at a time, and `install.sh` does the same.
If you would rather have everything in place first, this is the whole list
for Debian and Ubuntu, and running it does not break the steps:

```
sudo apt update
sudo apt install -y postgresql nginx git curl ca-certificates \
                    certbot python3-certbot-nginx \
                    ffmpeg libheif-examples poppler-utils
```

> **Node is deliberately not in that list.** Debian and Ubuntu ship a Node
> older than 22, so `apt install nodejs` gives you a version the app refuses
> to start on. [§3.2](#32--node) adds the NodeSource repository and installs
> 22 from there.

**Which step installs what**, so nothing is a surprise:

| | |
|---|---|
| Node 22 | §3.2 |
| PostgreSQL, the role and the database | §3.3 |
| The five media binaries, and ClamAV if you want scanning | §3.6, skippable |
| nginx and certbot | the list above, or `install.sh` — §3 assumes they are there |
| The certificate and the proxy | §3.14 |
| Object storage | yours to sign up for, §2 above |

### Sizing, measured rather than guessed

Every number below was measured on 6 October 2026, on an idle instance with
an empty archive. **They are a floor, not a forecast** — see the caveat after
the table.

| | text-only | with attachments |
|---|---|---|
| **RAM** | **1 GB works.** 2 GB is comfortable | **2 GB**, and see the transcode note |
| **CPU** | 1 core | **2 cores**, so a transcode does not starve the website |
| **Disk** | **5 GB** | **10 GB**, plus whatever the media cache is set to |

What makes up those figures:

- **The app: ~75 MB resident**, rising to ~92 MB under a few hundred
  requests as V8's heap grows before collection. It does not climb from
  there at this scale.
- **PostgreSQL: ~90 MB resident** on its default configuration, and a
  **freshly migrated database is 10 MB** across 56 tables. The archive grows
  with the reports in it, and text reports are small.
- **The checkout: ~4 MB**, plus ~5 MB of `.git` and **~8 MB of
  `node_modules`** — there are seven production dependencies and no build
  step.
- **Backups: 14 dumps by default** (`BACKUP_KEEP`), so budget fourteen times
  one dump. An almost-empty archive dumps to ~160 KB; yours will be larger,
  and `BACKUP_DIR` must be outside the checkout.
- **The media cache defaults to 2 GB** (`MEDIA_CACHE_MAX_BYTES`) and is only
  used when attachments are on. It is a cache — losing it costs time, not
  data.

> **ATTACHMENTS ARE WHERE CPU GOES, AND IT IS WORTH ONE NUMBER.** Transcoding
> **30 seconds of 1080p video took 21.8 s on one core** with the settings this
> app actually uses (`libx264 -preset veryfast -crf 28`, scaled to 1280 wide)
> — about **1.4× realtime**, with ffmpeg peaking at **148 MB** resident. The
> same job across 4 cores took 7.5 s.
>
> So a single core will keep up with occasional video and will **make the
> website slow while it does it**, because it is the same core. That is the
> whole argument for a second one. Transcoding runs in
> `reportlog-media-worker.timer`, not in the request, so a backlog delays
> publication rather than breaking the site.
>
> **The files themselves do not live on the box** — they go to object
> storage. Disk is for the cache and the staging of a file in flight.

> **These numbers are from an empty archive on an idle box, and nobody knows
> what load this will see.** Nothing here claims a capacity that has been
> measured under real traffic, because none has happened yet. Treat the table
> as "this is not heavy software", not as a capacity plan. If you are sizing
> for something specific, measure it.

### What is not on this list

- **No Docker, no container runtime.** This installs onto the machine.
- **No Redis, no queue, no second service.** The timers in §3.13 are the
  whole of the background work.
- **No build step.** The frontend is served as it sits in `public/`, so there
  is no toolchain, no bundler and nothing to compile.

## A domain name, pointed at it

You need a hostname — `reports.example.org` — pointed at the server's public
address. Do this **first**: a certificate cannot be issued until DNS answers,
and a brand-new domain can take an hour before its nameservers do.

**If you do not have a domain yet,** buy one. Nothing below works without
it, and no certificate authority will issue for a bare IP address. Any
registrar will do — Namecheap, Porkbun, Gandi and Cloudflare are all fine. If
you already own a domain you do not need another: a subdomain,
`reports.yourdomain.org`, costs nothing and is made in the same DNS editor as
everything below.

### The addresses you are pointing at

From your host's console, or on the server itself:

```
curl -4 https://ifconfig.co    # IPv4, e.g. 203.0.113.10
curl -6 https://ifconfig.co    # IPv6, if the server has one
```

### Find the right DNS editor first

**One command, then the rest of this step is in your browser.** DNS is edited wherever the domain's **nameservers** point, which is not
always where you bought it. Ask the domain rather than guessing — this runs
anywhere:

```
dig +short NS example.org
```

**`dig: command not found`?** It is not installed by default on a fresh
server or on Windows. Either install it — `sudo apt install -y dnsutils` on
Debian or Ubuntu — or use what is already there: `host -t NS example.org`, or
`nslookup -type=NS example.org`, which exists everywhere including Windows.

| It prints | Edit DNS here |
|---|---|
| `hydrogen.ns.hetzner.com`, `oxygen.ns.hetzner.com`, `helium.ns.hetzner.de` | **Hetzner DNS Console** — dns.hetzner.com, pick the zone, Records |
| `ns1.your-server.de`, `second-ns.de`, `second-ns.com` | **konsoleH, which is NOT the DNS Console.** Hetzner runs more than one. These nameservers belong to the web-hosting system at konsoleh.hetzner.com — your zone will not be at dns.hetzner.com and the list there will look empty or wrong. Edit it in konsoleH, or move the domain to the DNS Console and change the nameservers to the three above |
| `ns1.first-ns.de`, `robotns2.second-ns.de`, `robotns3.second-ns.com` | **Hetzner's older Robot DNS** — same story: a different panel from the DNS Console |
| anything `.cloudflare.com` | **Cloudflare** — dash.cloudflare.com, the domain, DNS → Records. Read the proxy warning below before you save |
| `.registrar-servers.com`, `.domaincontrol.com`, `.googledomains.com` and similar | **Your registrar.** Namecheap, GoDaddy, Google and the rest each call it "DNS", "Advanced DNS" or "Manage DNS" |
| nothing at all | The domain does not exist or has no nameservers. Buy it, or check the spelling |

### The records

| Type | Name | Value | TTL |
|---|---|---|---|
| `A` | `reports` for `reports.example.org`, or `@` for the bare domain | the IPv4 | 300, or the lowest offered |
| `AAAA` | the same name | the IPv6 — **only if the server has one** | 300 |

An `AAAA` record pointing nowhere makes the site fail for people on IPv6 and
work for everybody else, which is a miserable thing to diagnose.

**Name field conventions differ.** Some editors want just `reports`, some
want the whole `reports.example.org`, and some use `@` for the bare domain. If
yours shows existing records, copy the style they use.

**If your DNS is behind Cloudflare, switch the proxy off for this record** —
the orange cloud icon, set to grey ("DNS only"). While it is on, Cloudflare
answers for your hostname instead of your server, and `certbot` in
[§3.14](#314--a-certificate-and-the-proxy) cannot prove the server is yours.
You can turn it back on afterwards.

**Set a low TTL before you change a record that already exists.** The TTL is
how long the old answer stays cached, and 300 seconds beats waiting out a
day-long one.

### Check it, from your own machine and not from the server

```
dig +short reports.example.org
```

That must print your server's IP, on its own line, and nothing else. If
`dig` is not installed: `host reports.example.org` or
`nslookup reports.example.org`.

- **Nothing at all.** The record has not propagated, or it was created in a
  zone that is not the live one — more common than people expect, and what
  happens when a domain's nameservers point somewhere other than the panel
  you just edited. Check with `dig +short NS example.org` that the service
  you edited is the authoritative one.
- **An old address.** It is cached. Wait out the previous TTL, or ask a
  resolver that will not have it: `dig +short reports.example.org @1.1.1.1`.
- **A Cloudflare address** (104.x, 172.67.x) when you expected your
  server's. The proxy is on — see above.

**Check DNS before you go any further.** If that command prints nothing,
`certbot` in [§3.14](#314--a-certificate-and-the-proxy) will fail.

**Why the hostname matters more than usual here:** it goes into `.env` as
`SITE_ORIGIN`, and every confirmation link, invitation and notification email
is built from it. Get it wrong and you send reporters' confirmation links to
somebody else's site — silently.

## Somewhere to send email from

**Mail is not optional.** Sign-in is a one-time code by email, and a report
is confirmed by a link by email. Without mail, **nobody can confirm a
report**. What happens to the sign-in code depends on how mail is broken:

- **No mail set up at all** — the sign-in and setup codes are printed to the
  service log, on purpose, so a box can be set up before mail works. You can
  finish the wizard by reading them out of `journalctl -u reportlog`, and
  nobody without a shell on the server can sign in.
- **Mail set up and failing** — a wrong password, a blocked port — the code
  goes nowhere at all, and nobody can sign in, you included.

You need four values: an **SMTP host**, a **port**, a **username** and a
**password**. [§3.7](#37--configure) asks for them and
[§3.11](#311--prove-mail-works) sends a real message to prove they work.

**Do not send mail from the server itself.** A new server's own IP has no
reputation, and mail from it is treated as spam by nearly everyone. You would
be debugging deliverability instead of running an archive. Use a provider —
the free tiers are far more than this needs.

| Provider | Free tier | Worth knowing |
|---|---|---|
| **Mailgun** | a few thousand a month | Wants a domain and DNS records. Reliable once set up |
| **Postmark** | 100 a month | Best deliverability of the three, and strict about what it will send. Plenty for a small archive |
| **Amazon SES** | cheapest at volume | Starts in a **sandbox** that only mails addresses you have verified. You must request production access or sign-in codes will not reach anybody |
| **Your own mailbox** | — | Fastmail, Migadu and most hosts give you SMTP details. Fine for a test deployment. Gmail and Outlook need an app password and throttle hard — avoid for anything real |

Whichever you pick:

1. Sign up and add your domain — or verify a single sender address, if you
   are only testing.
2. **Add the SPF and DKIM records it gives you**, in the same DNS editor you
   used for the hostname above. Usually one TXT record each. Without them
   your mail lands in spam, and a confirmation link in a spam folder is a
   report that never gets filed.
3. Find the SMTP credentials page — sometimes "SMTP", sometimes "Sending",
   sometimes "Integration". Copy the host, the port, the username and the
   password.

**Scaleway Transactional Email works without SMTP.** It is the one
provider with its own path here, over Scaleway's API rather than SMTP, and it
needs two values instead of four: `SCALEWAY_SECRET_KEY` and
`SCALEWAY_PROJECT_ID`, plus `SCALEWAY_REGION` if you are not in `fr-par`.
[§3.7](#37--configure) asks which of the two you want and prompts for the
right values; `EMAIL_TRANSPORT` can force the choice afterwards. Everything
else on this page, SPF and DKIM included, still applies.

**Port 587, not 25.** Most providers offer 587 (STARTTLS) and 465 (direct
TLS); either works. **Port 25 is blocked outbound by Hetzner and most other
hosts**, so a configuration using it fails with a timeout that looks like the
provider being down.

## Object storage, only if you want attachments

Photos, video, audio and PDFs are optional. **Skip this and the site runs
fine with attachments off**, and you can turn them on later from the admin
page. Otherwise do it now: [§3.7](#37--configure) asks for the endpoint, the
keys and three bucket names.

### What you are creating

Three buckets, and five values to write down. A bucket is a named place to
put files; making one takes a few seconds.

| Bucket | Holds | Public? |
|---|---|---|
| `reportlog-staging` | files mid-upload, before a report is confirmed | No |
| `reportlog-evidence` | the encrypted originals | **Never** |
| `reportlog-renditions` | published versions, in the clear | No — the app serves them |

**Leave all three private.** Nothing here needs a public bucket; the
application hands out short-lived signed links instead.

### Hetzner Object Storage, step by step

In the Cloud console, left-hand menu, **Object Storage**:

1. **Create bucket.** Name it `reportlog-staging`, pick the same location as
   your server, leave visibility **Private**. Create.
2. Do it twice more, for `reportlog-evidence` and `reportlog-renditions`.
3. Go to **Credentials** → **Generate credentials**. You get an access key
   and a secret key. **The secret is shown once.** Copy both somewhere now.

Your endpoint is the location, in this shape — `fsn1` for Falkenstein,
`nbg1` for Nuremberg, `hel1` for Helsinki:

```
https://fsn1.your-objectstorage.com
```

Bucket names are **global to the region**, so if `reportlog-staging` is
taken, put something of your own in front — the names only have to match
what you type at [§3.7](#37--configure). Keep `S3_ADDRESSING` on its
default, `path`.

**Any other provider:** the same three buckets, all private, plus an access
key and a secret key. The endpoint is whatever the provider calls the S3 API
URL for your region, and the table below says whether you need to change one
setting.

### What to write down

| | |
|---|---|
| `S3_ENDPOINT` | `https://fsn1.your-objectstorage.com` |
| `S3_REGION` | the location code, e.g. `fsn1` — [§3.7](#37--configure) reads it off a Hetzner endpoint for you; it is **not** `eu-central-1`, which is AWS's name |
| `S3_ACCESS_KEY` | the access key |
| `S3_SECRET_KEY` | the secret, shown once |
| three bucket names | staging, evidence, renditions |

**You do not have to get this right first time.** Nothing is destroyed by a
wrong value: `npm run storage-smoke` writes, reads back and deletes one
object in each bucket and tells you exactly which one is wrong.

### Which providers work, and the one setting that decides it

There is no AWS SDK here — the signing is about sixty lines of `node:crypto`,
so that a box running this does not also carry eighty transitive packages.
What that costs you is one decision the SDK would have made silently:
**how the bucket is named in the request.**

| `S3_ADDRESSING` | the request looks like | use it for |
|---|---|---|
| `path` (the default) | `endpoint/bucket/key` | **Hetzner**, Backblaze B2, MinIO, Ceph/RGW, Scaleway, DigitalOcean Spaces, Cloudflare R2 |
| `virtual` | `bucket.endpoint/key` | **AWS S3 proper**, and anything else that refuses path-style |

**Leave it alone unless an upload fails.** Path-style is the default because
it works against the widest range of endpoints and needs no wildcard DNS.

- **Cloudflare R2** also needs `S3_REGION=auto`.
- **AWS S3** is the one that needs `virtual`: path-style addressing is
  deprecated there, and a bucket in a newer region may refuse it outright.
- **With `virtual`, bucket names must be lowercase and contain no dots.** A
  dot means the TLS certificate for `*.s3.example.com` does not cover
  `my.bucket.s3.example.com`, so the browser's upload fails with a
  certificate error that mentions nothing about S3. ReportLog refuses such a
  bucket up front rather than signing a request that cannot work.

**Do not guess — there is a script that settles it.** After filling in the
`S3_*` variables and **before** turning `ATTACHMENTS_ENABLED` on — which is
why [§3.7](#37--configure) suggests answering **no** to "Accept attachments
from the start?":

```
npm run storage-smoke
```

It writes, reads back and deletes one object in **each** of the three
buckets, and checks that **none** of them answers a read without a
signature — the misconfiguration that would matter most. If it fails with a
signature error against a provider in the right-hand column above, try
`S3_ADDRESSING=virtual` and run it again.

> **Getting this wrong is a signature mismatch, not a 404.** The bucket is
> part of what gets signed, so the wrong form fails with `SignatureDoesNotMatch`
> and no mention of addressing. That is why this table is here rather than
> left to be discovered.

> **Three buckets, not one, and it is not fussiness.** The evidence bucket
> holds encrypted originals and must never be public. The renditions bucket
> holds published material in the clear — an object appearing there *is* the
> publication decision. One bucket with per-object permissions is one
> misconfiguration away from publishing an unreviewed video.

## Rough shopping list

The software and the sizing are in
[System requirements](#system-requirements) above. This is the list of
things you have to go and **get**, each from somebody else:

| | | |
|---|---|---|
| A Linux server with root | any host | sizing in §system requirements |
| A domain name | any registrar | DNS pointed at the box **before** certbot |
| Somewhere to send mail from | any SMTP provider, or Scaleway | **not optional in practice** |
| S3-compatible storage, **3 buckets** | any provider | **only** for attachments |
| Somewhere to keep backups | **not this machine** | §5, and not optional for an archive |

The last row is the one people skip. It need not be a service you buy — it
just cannot be the same disk.

---

# 3 · Step by step

Work through these in order. After each one, `npm run doctor` will tell you
where you are.

## 3.1 · A user and a place to put it

Do not run this as root. Make a user that owns the checkout:

```
sudo adduser --system --group --home /srv/reportlog reportlog
```

That creates a system user with no password and no shell login, owning
`/srv/reportlog`. The shipped service files name exactly that user and that
path. If you choose differently, do not edit them: tell
`contrib/install-units.sh` in [§3.13](#313--leave-it-running) with
`--dir` and `--user`, and it rewrites `User`, `Group`, `WorkingDirectory`,
`ExecStart` and `ReadWritePaths` together in the copies it installs.

To run the install commands as that user:

```
sudo -u reportlog -H bash
cd /srv/reportlog
```

## 3.2 · Node

**Check what you have:**

```
node --version
```

If that prints `v22.` or higher, skip ahead. Most distributions ship something
older, so you probably need to add a repository. On Debian or Ubuntu:

```
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

> **Use a system package, not a version manager, and this is the one trap in
> this step.** `nvm`, `fnm` and `asdf` install Node inside a user's home and
> make it available only to interactive shells that read a profile script.
> **systemd does not read your shell profile.** The service file says
> `/usr/bin/node`, and if Node lives in `~/.nvm/...` instead, the service fails
> to start with `No such file or directory` — which reads like a broken
> service file and is a missing interpreter.
>
> Check where yours is before [§3.13](#313--leave-it-running):
> ```
> command -v node
> ```
> If that is a path inside a home directory, install the system package.
> Anywhere else is fine: `contrib/install-units.sh` writes the Node it finds
> into the service files, and refuses outright when that Node is under
> `/home` or `/root`.

## 3.3 · PostgreSQL

**Install it:**

```
sudo apt install -y postgresql
```

**Create a role and a database.** The role owns the database; the app connects
as that role.

```
sudo -u postgres createuser reportlog --pwprompt
sudo -u postgres createdb reportlog -O reportlog
```

The first command asks you to choose a password, twice. Keep it — you type it
into the configure script in [§3.7](#37--configure).

Once `.env` exists ([§3.7](#37--configure)) and the database cannot be
reached, `npm run doctor` prints these two commands with the names from your
connection string filled in. It will not run them for you: creating
a role on somebody else's cluster is not a thing an install script should do
unasked, and the authentication method your cluster uses is a decision only
you can make.

**Your connection string** will look like:

```
postgres://reportlog:the-password-you-chose@localhost:5432/reportlog
```

## 3.4 · Get the code

```
cd /srv/reportlog
git clone --branch stable https://github.com/munsdev/reportlog.git .
npm ci --omit=dev
```

The repository is public, so this needs no login.

### Which branch, and why not a tag

**`stable` is the branch you install from.** It is moved forward only when a
change has been through all three test suites, so it is the newest code
anybody is being asked to run. `main` is where work lands and may be
mid-change; do not install from it.

Check what you got, and what it will do next:

```
git rev-parse --short HEAD        # the commit you are on
git status -sb                    # '## stable...origin/stable'
```

That second line is the one that matters, and it is the reason this is a
branch rather than a tag.

> **A TAG WOULD SILENTLY BREAK UPGRADES.** `git clone --branch <tag>` leaves
> a **detached HEAD** — the checkout is on no branch at all. `contrib/deploy.sh`
> asks `git rev-parse --abbrev-ref HEAD` to find out what to pull, and on a
> detached checkout that returns the literal string `HEAD`, so
> `git pull --ff-only origin HEAD` pulls **the remote's default branch**.
>
> A box installed from a tag would therefore upgrade itself onto `main` the
> first time anybody ran the upgrade, without saying so. Measured on
> 7 October 2026 against a real clone of a tag, not reasoned about.
>
> Cloning a branch gives a checkout that tracks it, so `deploy.sh`
> fast-forwards along the same branch it was installed from.

> **If you want a frozen pointer anyway**, tags still exist and nothing stops
> you installing from one — you simply have to take the upgrade path into
> your own hands, because `deploy.sh` will not do the right thing on a
> detached checkout. `git -C /srv/reportlog fetch --tags && git checkout
> <tag>` is the manual equivalent.

**`npm ci`, not `npm install`.** `ci` installs exactly what the lockfile says.
`--omit=dev` skips the test tooling, which a server does not need. Seven
production dependencies, so this is quick.

## 3.5 · Run the doctor

```
npm run doctor
```

**Run this now and again after every step.** It checks Node, the
configuration, the database, the migrations, the media tools, mail and object
storage — and, once they exist, the service, its timers, the proxy, the
updater and the anchor. For a missing media tool it prints the install
command for *your* distribution; for everything else, what to do.

**It installs nothing and changes no files.** Everything it suggests is
printed for you to read before you run it.

Right now it will say **`.env` is missing** and **mail is not set up**, and
list any media tools you do not have. It says nothing about the database
yet, because without `.env` it does not know which one to look at — that
check appears after [§3.7](#37--configure). That is all correct.

## 3.6 · Media tools, if you want attachments

Skip this entire step if you are not taking file uploads.

Five binaries, all needed for attachments: `ffmpeg`, `ffprobe`,
`heif-convert`, `pdftoppm`, `pdfinfo`. On Debian or Ubuntu:

```
sudo apt install -y ffmpeg libheif-examples poppler-utils
```

**Virus scanning is a sixth, and optional.** `clamdscan` comes from
`clamav-daemon`, and nothing uses it until you set `CLAMAV_ENABLED=true` in
`.env`. Switched on, it **fails closed**: if the scanner is missing or its
daemon is stopped, uploads wait unprocessed rather than going through
unscanned. The doctor checks for it only when it is switched on.

```
sudo apt install -y clamav-daemon    # then CLAMAV_ENABLED=true in .env
```

> **Four of the five come from a package whose name is not the binary's name**
> — so does `clamdscan` —
> and the names differ between distributions — `libheif-examples` on Debian,
> `libheif-tools` on Fedora and Alpine, `libheif` on Arch and macOS. This is
> exactly why `npm run doctor` exists: run it and it prints the correct
> command for the machine you are on.

Two distribution-specific catches the doctor will also warn you about:

- **Fedora and RHEL do not ship `ffmpeg` in their own repositories.** Enable
  RPM Fusion first or the install simply will not find it.
- **Alpine keeps `libheif-tools` in the community repository**, which is
  commented out in `/etc/apk/repositories` on some images.

## 3.7 · Configure

```
npm run configure
```

This writes `.env`. It asks only for things **a person can know** — the site's
address, the database, the mail and storage credentials — and **generates the
two encryption keys itself.**

It walks you through, in order: the site origin, the database URL, the port,
what the deployment calls itself, the mail transport and its credentials,
object storage (and whether to accept attachments from the start), the
timestamp authority for the daily anchor (accept the default), and an
address for staff mail. Mail, storage and the staff address can all be
skipped and filled in later.

Things worth knowing as you answer:

- **`SITE_ORIGIN` has no default and the app refuses to start without it.**
  Give the full public address with scheme: `https://reports.example.org`. A
  trailing slash is removed for you; a missing scheme, a path, or plain
  `http://` on anything but `localhost` is refused and asked again.
- **The port is for localhost only.** The app binds `127.0.0.1`, so it is not
  reachable from outside without the proxy. 5000 is the default; if you
  change it, use yours wherever this guide says 5000.
- **The deployment's name** appears on every page, in the browser tab, on the
  lock screen and in the mail it sends. The software stays called ReportLog and
  the footer says so — that is the ordinary arrangement for self-hosted AGPL
  software and keeps attribution where a reader can see it. Leave it blank to
  use ReportLog as the name too.
- **The S3 region** is filled in for you from a Hetzner endpoint (`fsn1`),
  and asked with no default otherwise.
- **"Accept attachments from the start?"** — answer **no** for now, which is
  the default. Run `npm run storage-smoke` first
  ([§2](#object-storage-only-if-you-want-attachments)), then set
  `ATTACHMENTS_ENABLED=true` or switch them on from the admin page.
- **The staff mail address** is `ADMIN_EMAIL`: where new entries on lists
  that email the admin, and the weekly feedback digest, are sent. It grants
  nothing. Blank is fine; fill it in later.
- **It writes `TRANSPARENCY_LOG_DIR`** for you, beside the checkout —
  `/srv/reportlog-transparency-log`. [§3.13](#313--leave-it-running) uses it.

**It refuses to overwrite an existing `.env`.** To check one you already have,
without changing anything:

```
npm run configure -- --check
```

That reports what is missing, including the case that matters most: **a
half-filled section, which looks configured in the file and behaves exactly as
unset.**

> **`npm run configure -- --force` replaces it, and it is the one dangerous
> flag in this guide.** It backs the old file up and then generates **new**
> encryption keys. Against a database that holds anything, that makes every
> encrypted field unreadable for good — the next section is about exactly
> these keys. On a deployment that has taken a report, edit `.env` by hand
> instead.

## 3.8 · Back up `.env` now

**Before you go any further.** This is the step people skip and cannot undo.

`npm run configure` generated two keys and wrote them into `.env`:

| | |
|---|---|
| `TIER_B_ENCRYPTION_KEY` | encrypts reporters' contact details, and wraps the per-file key of every attachment |
| `CONTACT_HMAC_KEY` | lets a reporter find their own reports without the server decrypting every record to look |

> **They are irreplaceable.** Lose either and the data behind it is unreadable
> **forever**, with the ciphertext sitting intact in every backup you own. They
> are never prompted for, never displayed, never echoed, and exist only in that
> one file.
>
> **A database backup without `.env` is a pile of ciphertext nobody can open —
> including you.**

They are generated rather than chosen on purpose: a prompt invites a memorable
answer, a paste into a chat window, or a value reused from the last install.

So, right now:

From **your own machine**, not the server — this pulls a copy across the
SSH connection you already use:

```
ssh root@203.0.113.10 cat /srv/reportlog/.env > reportlog-env-backup-$(date +%F)
chmod 600 reportlog-env-backup-*
```

If you turned root login off in [§0.4](#04--the-first-five-minutes-on-a-new-box),
make a copy your own user can read, fetch it, and delete it:

```
# on the server, as admin
sudo install -m 600 -o admin /srv/reportlog/.env ~/env-backup
# on your machine
scp admin@203.0.113.10:env-backup reportlog-env-backup-$(date +%F)
# on the server again
rm ~/env-backup
```

Then put that file somewhere you trust — a password
manager, an encrypted volume, a printed copy in a safe. Treat it like the only
copy of a private key, because that is what it is.

Check the permissions on the live one while you are here:

```
sudo chmod 600 /srv/reportlog/.env
sudo chown reportlog:reportlog /srv/reportlog/.env
```

## 3.9 · Build the schema

```
npm run migrate
```

This creates every table, index and trigger, and records which migrations have
run. It is safe to run again — already-applied migrations are skipped and it
says so.

If this fails, it is almost always the database URL. `npm run doctor` will tell
you whether it can connect.

> One migration refuses to run on an archive that holds reports, deliberately —
> it changes what a report *is*, so it is only safe on an empty database. You
> will never see that on a fresh install. If you ever do see it, stop and read
> the message.

## 3.10 · Set the curtain password

```
npm run set-curtain-password
```

**A fresh install comes up gated, with no password set — which means nothing
matches it and nobody gets in, including you.** That is why this is a step and
not an optional extra.

It asks for a password, twice, and refuses to finish without one. Minimum
eight characters. **It never generates one for you:** a password nobody chose
is a password nobody read carefully, and this one is the only thing standing in
front of the deployment until the rest of it exists.

> **The curtain is not authentication and is not a substitute for it.** It
> keeps an unfinished deployment off the open internet. The archive itself is
> protected by everything else — accounts, roles, encryption.

Keep this password. You type it in [§3.15](#315--finish-setup-in-the-browser),
and you hand it to whoever is going to own the deployment.

## 3.11 · Prove mail works

```
npm run mail-test -- you@example.org
```

Use an address you can actually read, and **wait for the mail to arrive**. Do
not move on because the command exited zero.

> **Prove mail before you hand the site to anybody.** Without it no reporter
> can confirm a report. With no mail set up at all, the sign-in and setup
> codes are printed to `journalctl -u reportlog` — enough for you to finish
> setup, and useless to the person you hand the site to. With mail set up
> and **failing**, the code goes nowhere and nobody can sign in at all.

If it does not arrive: check the spam folder first, then your provider's
dashboard for a rejection, then `npm run doctor`, which reports whether the
mail configuration is complete enough to try.

## 3.12 · First run, by hand

Before wiring up systemd, check it starts:

```
npm start
```

You should see it report that it is listening. In another terminal:

```
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:5000/api/health
```

(5000, or the port you chose in [§3.7](#37--configure).) `200` means it is
up. Press Ctrl-C to stop it, and move on.

If it exits immediately, read the message — the two that stop it are a
missing `SITE_ORIGIN` (which it refuses to start without, by design) and a
Node older than 22. **A database it cannot reach does not stop it:** it
starts, says it is listening, and logs connection errors — and
`/api/health` still answers `200`, because it proves the process and not the
database. So read the output even when it comes up; `npm run doctor` is what
proves the database.

## 3.13 · Leave it running

`npm start` stops when you close the terminal. A service and eight timers keep it
going, and one command installs and enables all of them:

```
sudo ./contrib/install-units.sh --dry-run     # print, change nothing
sudo ./contrib/install-units.sh
```

It is idempotent. Run it again after a release that adds a unit — and
**once on any box installed before 10 October 2026**, whose update unit still
runs the updater from inside the checkout; the Update button and the doctor
both refuse that and name this command.

If you chose a different user or path in [§3.1](#31--a-user-and-a-place-to-put-it),
say so here rather than editing the unit files:

```
sudo ./contrib/install-units.sh --dir /opt/reportlog --user rl
```

**What it does**, so the dry run reads as a list you recognise:

- copies the units into `/etc/systemd/system/` with the user, the paths and
  the Node it found written in — the files in the checkout stay as shipped;
- installs root's copy of the updater at
  `/usr/local/libexec/reportlog/update-apply.sh`, root-owned and outside the
  checkout, from the committed version only;
- makes the backup directory (`/var/backups/reportlog`, or `BACKUP_DIR`) and
  the transparency log's directory (`TRANSPARENCY_LOG_DIR`), owned by the
  service user — **without them the backup and anchor units cannot start**;
- writes `/etc/sudoers.d/reportlog-restart`, one line letting the service
  user restart the service and nothing else, checked by `visudo` first;
- enables the service and every timer.

> **There is no by-hand version of this any more, on purpose.** There used to
> be one, in this guide and in `contrib/README.md`, and both drifted: first
> **the anchor timer went missing from the list** — so a deployment that
> followed it exactly never anchored, and nothing noticed — and later the
> backup directory and the sudoers line did. Two copies of one procedure is
> how that happens. `--dry-run` prints every command it would run, which is
> the by-hand version, always current.
>
> It also refuses to proceed when Node is inside a home directory, rather than
> installing a unit that cannot start. See [§3.2](#32--node).

| Unit | What it does | Required? |
|---|---|---|
| `reportlog` | the app | **yes** |
| `reportlog-media-worker.timer` | processes uploads, every minute | **yes, if attachments are on** — without it an upload sits at "checking" forever |
| `reportlog-anchor.timer` | once a day, timestamps the chain with an outside authority and publishes it | **yes, if you want the thing this software is for** |
| `reportlog-anchor-watch.timer` | once a day, checks that the anchor above actually ran | **yes** — the anchor timer being *enabled* is not the same as the anchor *running*, and a run that fails every night looks identical to one that works |
| `reportlog-backup.timer` | once a day, takes a verified `pg_dump` and prunes old ones | **yes** — see [§5](#5--backups--read-this-before-you-take-a-real-report) |
| `reportlog-update.timer` | once a minute, applies an update an admin asked for in the Updates pane | no — without it the pane still shows what is available, and you update over SSH |
| `reportlog-notify-hourly.timer` | sends the hourly digest to whoever asked for one | **yes, once anybody subscribes** — they chose it in their own settings, and without this nothing is ever sent |
| `reportlog-notify-weekly.timer` | the same digest, with a week's window | **yes, once anybody subscribes** |
| `reportlog-sweep.timer` | deletes expired sign-in codes and sessions, and erases the personal half of expired list entries | **once a list collects anything, yes** — without it a stated retention period is not kept, and the daily address-hashing secrets are never destroyed |

**Check the timers are actually enabled.** `npm run doctor` does this for you.
It faults a missing service, anchor, anchor-watch or backup timer always; the
media-worker timer once attachments are on; a digest timer once somebody has
subscribed; and the sweep timer once a list holds entries. The direct
question is:

```
systemctl list-timers --all | grep reportlog
```

All eight timers should appear.

### The transparency log: a repository, a key and a checkout

The anchor timer is installed, and **it cannot publish anything yet.** Once a
day it has the list of every logbook's chain head timestamped, commits it into
a git checkout, and pushes it somewhere this server does not control. That
somewhere, and the checkout, are yours to make. Without them it still
timestamps, and the proof stays on the one machine it was meant to outlive.

**1. A repository somewhere else.** An empty repository with any git host —
GitHub, Codeberg, your own — under an account this server has no other
access to. Public, because the point is that anybody can check it. More
than one host, each under a different operator, is the design: a record one
company holds is a record one company can be made to remove.

**2. A deploy key.** Sign in as the owner and open **Admin → Operations → The
transparency log**, then **Make a deploy key**. The private half is written
to `/srv/reportlog/var/transparency-log/deploy_key`, owned by the service
user and never stored in the database; the panel shows the public half. Add
that to the repository as a deploy key **with write access**. On GitHub,
write cannot be switched on for an existing deploy key — remove it and add it
again.

**3. The checkout.** `install-units.sh` made the directory, empty, at
`TRANSPARENCY_LOG_DIR` (`/srv/reportlog-transparency-log`). Clone the
repository into it as the service user, with that key, and give the
checkout a name to commit as:

```
cd /srv/reportlog-transparency-log
K=/srv/reportlog/var/transparency-log
sudo -u reportlog env GIT_SSH_COMMAND="ssh -i $K/deploy_key -o IdentitiesOnly=yes \
  -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=$K/known_hosts" \
  git clone git@github.com:you/your-log.git .
sudo -u reportlog git config user.name  "reports.example.org anchor"
sudo -u reportlog git config user.email "anchor@reports.example.org"
```

Cloning an empty repository says so, and that is fine. The clone's remote is
`origin`, which is the name the anchor pushes to.

**4. List it in the panel.** In the transparency log pane, add a line —
a name such as `github` and the repository's SSH address — press **Test**
beside it, and check the branch it pushes (`main` unless you change it).
**The nightly push goes to the addresses listed there**, the same ones
**Test** tries, so a mirror is one more line in the pane and nothing in the
checkout. With the list empty, it pushes to the checkout's own `origin` —
the repository you cloned.

`TRANSPARENCY_LOG_REMOTES`, `TRANSPARENCY_LOG_DIR` and `TSA_URL` in `.env`
**override** the pane wherever they are set — they are how this was
configured before the pane existed. If you put the checkout somewhere else,
set it in `.env` and run `install-units.sh` again so the anchor unit is
allowed to write there; a directory set only in the pane is one the unit's
sandbox does not know about.

**5. Run it once and watch.**

```
sudo systemctl start reportlog-anchor.service
journalctl -u reportlog-anchor -n 30
```

It should end with `pushed to origin`. The repository now holds the day's
anchor.

### The anchor's sandbox

The shipped unit handles both of these; they are here so a failure reads as
what it is.

- `ReadWritePaths` names **two** directories — the app and the transparency
  log. If the second is missing or wrong the unit does not start, or the run
  dies on a read-only file system *after* it has already called the
  timestamp authority, so it costs a real request each time.
- `ProtectHome=read-only`, not `true`. A key made in the pane lives under the
  checkout and needs nothing from `/home`; a key you made by hand in a home
  directory's `.ssh` does, and with `ProtectHome=true` it is invisible and the
  push fails with `Permission denied (publickey)` — which reads as a rejected
  key and is a key that was never offered.

> **A systemd sandbox is where this kind of bug hides, and it is invisible when
> you test by hand.** `systemctl start reportlog-anchor.service` and read
> `journalctl -u reportlog-anchor`. Running `npm run anchor` in a shell proves
> nothing about the timer.

## 3.14 · A certificate and the proxy

**Certificate first.** `certbot` writes the HTTPS server block and the
redirect for you:

```
sudo apt install -y nginx certbot python3-certbot-nginx   # already there if you used install.sh
sudo certbot --nginx -d reports.example.org
```

If this fails, DNS is the usual reason — go back to
[§2](#2--what-you-need-before-you-start) and check `dig`.

**Then merge the proxy configuration into the block certbot just wrote.**
`contrib/nginx/reportlog.conf` is the template. **Edit certbot's file rather
than replacing it** — delete and rewrite it and the certificate wiring goes
with it.

You need the `root` and `index` lines, **all seven `location` blocks** — the
five that proxy to the app, `location /` (which sends every deep link such as
`/board` or `/r/EL-…` to `index.html`; without it they 404), and
`location = /sw.js` — plus `client_max_body_size`, **both includes**
(`csp.conf` and `cache.conf`, below) and `access_log off`. Replace
`reports.example.org`, `/srv/reportlog` and the port with yours.

### The split that matters

**nginx serves `public/` off disk, and everything the app answers has to be
proxied.** Miss a location block and nginx 404s the route before Node ever sees
it — which looks like the app being broken rather than the proxy.

Five paths must reach the app:

| | |
|---|---|
| `/api/` | everything the app does |
| `/docs` | this guide, rendered |
| `/styleguide` | the design reference |
| `/app` | the install-instructions page |
| `/manifest.webmanifest` | **the dangerous one — see below** |

> **The worse version of that mistake, which has actually happened.** When a
> path exists **both** as a file in `public/` **and** as a route in the app —
> `/manifest.webmanifest` is the example — a missing location block does **not**
> 404. nginx serves the file, successfully, with a `200`. Nothing looks broken
> at all; the deployment just goes on answering with a stale copy of something
> the app was supposed to build per deployment. The result is that every
> home-screen icon is labelled "ReportLog" instead of your deployment's name.
> It went three days undetected.
>
> The tell is in the headers, not the body. The app's answer has
> `Cache-Control: no-cache` and a weak `ETag` (`W/"…"`); a file off disk has
> neither — and that is what `npm run doctor` checks. The content type is a
> weaker tell, because what nginx sends for a file depends on the box's
> `mime.types`:
>
> ```
> curl -sI https://reports.example.org/manifest.webmanifest | grep -i -E 'cache-control|etag'
> ```

### The Content-Security-Policy is one file, included

In the server block, and again inside `location = /sw.js`:

```
include /srv/reportlog/contrib/nginx/csp.conf;
```

**Do not paste the policy string.** Including the file means a release that
changes the policy reaches your box with `git pull`; a pasted copy means a hand
edit on every release, and a box that quietly keeps serving the old one.

**Why it appears twice:** one `add_header` anywhere inside a `location` block
**replaces every header inherited from the server block** — that is nginx's
rule, not a quirk of this config. `location = /sw.js` sets its own
`Cache-Control`, so it loses the policy unless it carries its own copy. If you
add a header to any other location, include `csp.conf` there too.

### Scripts and styles: browsers ask before using an old copy

In the server block, under the `csp.conf` include:

```
include /srv/reportlog/contrib/nginx/cache.conf;
```

Without it nginx sends no caching instruction for the site's scripts, so a
browser guesses how long a copy is fresh — and after an update one browser
kept an old script beside new ones and showed a **white page** until its
cache was cleared. The file makes scripts, styles and the page itself
`no-cache`: kept, but checked with the server before use, which costs a quick
"not modified" and no download.

**From the release that added this file, the Update button reloads nginx**
after nginx's own test passes, so later changes to either included file arrive
with an update. `contrib/deploy.sh` reloads it too, but only when the account
running it has full sudo — run as the service user, whose sudo covers a
restart and nothing else, it says it cannot and leaves the reload to you
([§7.2](#72--over-ssh)).

### Test before you reload

```
sudo nginx -t && sudo systemctl reload nginx
```

**The `&&` matters.** A failed test must not reload.

> **Two ways an nginx edit goes wrong quietly.**
>
> **Never leave a backup in `sites-enabled/`.** nginx includes that directory
> with a bare `*` and no extension filter, so `mysite.bak` beside `mysite` is
> parsed as a second copy of the same server block. It fails as
> `duplicate listen options`, at a line number *inside the backup*, which reads
> like a broken config rather than a stray file. Keep backups where nginx does
> not look.
>
> **And it fails late, not now.** The running server keeps the config it already
> parsed, so everything looks fine until something reloads — a certificate
> renewal, weeks later, with nothing to connect it to your edit. Always finish
> an edit by testing it.
>
> **`cp -a` of a `sites-enabled` entry usually copies a symlink, not a file.**
> Those entries are conventionally links into `sites-available`, and `-a`
> preserves links — so your "backup" points at the very file you are about to
> change. It holds no content, and restoring from it does nothing while
> appearing to succeed. Use `cp -L`, or back up the target.

## 3.15 · Finish setup in the browser

Open `https://reports.example.org`. You should get a lock screen. Enter the
curtain password from [§3.10](#310--set-the-curtain-password).

The first-run wizard then runs, once, in eight screens:

1. **Who runs this deployment?** — the owner's email address. The account
   this mints is the **owner**, the one person who can appoint or remove an
   administrator. The seat cannot be granted to anybody; it moves only by a
   handover both parties agree to.
2. **Enter the code** — a one-time code sent to that address. This is where a
   broken mail setup stops you dead, which is why
   [§3.11](#311--prove-mail-works) exists. (With no mail set up at all, the
   code is in `journalctl -u reportlog`.)
3. **What is this archive called?** — required, with no default.
4. **What kind of archive is this?** — a starting point. Each one fills the
   settings in and makes a **draft logbook** for you to read and launch in
   [§6](#6--your-first-logbook--nothing-can-be-filed-until-you-make-one).
   **Skip** sets everything up by hand instead; nothing is lost either way.
5. **Does this deployment publish an archive?**
6. **Can people attach files to a report?**
7. **How should it look?** — palette and theme.
8. **The site password** — keep the curtain password, or set a new one.

Screens five and six arrive already set to what the software does if nobody
chooses, and say so; screen seven starts on the default look. You can read
them and pass through.

**Screen eight has no default and no skip, deliberately:** otherwise a
password the installer chose stays live in somebody else's deployment and
neither of them notices.

Every screen saves before the next is shown, so a tab closed halfway keeps what
was already answered.

**After the wizard, `/api/setup` refuses every change** — it still answers
whether setup is done, and nothing else. Everything it set stays editable in
**Admin**: the name and the look under **Site settings**, publishing and
attachments under **Reports**, the site password under **Operations → Site
access**, and the starting point's logbook under **Logbooks**.

### Handing it over

If you are installing this for somebody else, what you hand them is **the URL
and the curtain password**. They run the wizard themselves and become the
owner. That is the whole point of the split: the installer never has to hold
the owner's account.

---

# 4 · Checking it actually works

```
systemctl is-active reportlog
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:5000/api/health   # or your PORT
systemctl list-timers --all | grep reportlog
npm run doctor
```

**`npm run doctor` is the one that answers most of this now.** Besides Node,
the configuration, the database, the migrations, the media tools, mail and
storage, it asks the running deployment questions nothing in the repository
can answer:

- whether the live nginx config serves a Content-Security-Policy at all;
- **which of the five proxied paths the app actually answered**, and which
  nginx answered instead — including the one that fails with a `200`;
- whether the service and timers are enabled, and whether there is a recent
  backup;
- **whether the anchor actually ran** recently, not only whether its timer
  is enabled;
- whether the updater root runs is the root-owned copy outside the checkout,
  and only root can write it.

It still installs nothing and changes no files.

`/api/health` sits outside the curtain deliberately, so it answers `200` even
while the deployment is locked. It is the cleanest liveness check.

**Check the security policy is being served**, since the proxy is the easy
thing to get half-right:

```
for p in / /js/boot.js /sw.js /css/page.css /api/site-access/status; do
  printf '%-26s %s\n' "$p" \
    "$(curl -sI "https://reports.example.org$p" | grep -i '^content-security-policy')"
done
```

Every line should carry a policy. **If only the last one does, the header is
coming from the app and your nginx include is missing.**

Then, in a browser:

- The lock screen appears, and the password gets you past it.
- Your deployment's name — not "ReportLog" — is in the browser tab.
- You can sign in with a one-time code.
- Build a logbook under Admin, launch it, and file a test report through the
  public form. **Click the confirmation link in the email.** That path is only
  reached by a human clicking a link, and it has been broken in production for
  three days under green test suites for exactly that reason.
- If attachments are on, attach a photo to that test report and confirm it
  arrives. Nothing in the test suite proves an upload works end to end.

---

# 5 · Backups — read this before you take a real report

**There is a backup script and a daily timer** — `npm run backup` and
`reportlog-backup.timer` — and `npm run doctor` complains when the newest dump
goes stale. What is **not** automated, and cannot be, is getting a copy off
this machine and proving a restore works.

Five separate things need to survive, only one of them is covered by that
timer, and they are not interchangeable.

## 5.1 · `.env` — the one with no second copy

Covered in [§3.8](#38--back-up-env-now), and repeated here because it is the
one that cannot be recovered by any means. **Two irreplaceable encryption
keys.** A database backup without this file is ciphertext nobody can ever open.

Back it up **off the machine**, encrypted. Re-check after any change to it.

## 5.2 · The database — this is the archive

Everything is here: every report, every version, every hash, every chain link,
every moderation decision, every account.

**There is a script, and a timer that runs it daily:**

```
npm run backup                 take one now
npm run backup -- --check      report on what is there, take nothing
```

`reportlog-backup.timer` from [§3.13](#313--leave-it-running) runs it at
03:30, and `npm run doctor` faults a newest dump older than 48 hours — which
is the half that matters, because **a backup that quietly stopped looks
exactly like one that is working.**

Three things it does that a one-line `pg_dump` does not:

- **It writes to a temporary name and renames only after reading the dump
  back** with `pg_restore --list`. A dump interrupted half way — disk full,
  box rebooted — is a plausible-looking file of the wrong length, and the one
  moment nobody checks a backup is while taking it. Anything the directory
  lists has been read back at least once.
- **It prunes only files it wrote.** A backup directory is somewhere a person
  also puts things by hand, and a retention job that deleted whatever it found
  would eventually take one of those.
- **It refuses a `BACKUP_DIR` inside the checkout**, where git would offer to
  commit the archive and — under `public/` — nginx would serve it to anybody
  who guessed the name.

Settings: `BACKUP_DIR` (default `/var/backups/reportlog`), `BACKUP_KEEP`
(14), `BACKUP_MAX_AGE_HOURS` (48).

**Keep them off the box as well.** The timer protects you from the disk; it
does nothing about the building. Whatever you already use — rsync to another
host, a snapshot, Borg to cheap storage — point it at `BACKUP_DIR`.

**And check that a restore works.** An untested backup is a belief, not a
backup. This proves one into a scratch database beside the real one, without
touching the archive:

```
sudo -u postgres createdb reportlog_restore_test -O reportlog
sudo cat /var/backups/reportlog/reportlog-2026-10-02T03-30-12Z.dump \
  | sudo -u postgres pg_restore -d reportlog_restore_test
sudo -u postgres psql -d reportlog_restore_test -c 'SELECT count(*) FROM reports'
sudo -u postgres dropdb reportlog_restore_test
```

The `cat` is there because `postgres` cannot open a file in the backup
directory itself.

**Restoring for real.** The dumps are named for the moment they were taken —
`/var/backups/reportlog/reportlog-2026-10-02T03-30-12Z.dump` — and **only the
`reportlog` user can read them**: the directory is mode 700. So the restore
runs as that user, connecting with the address in `.env`, and never as
`postgres`, which cannot open the file. Into a new, empty database:

```
sudo systemctl stop reportlog
sudo -u postgres createdb reportlog -O reportlog
sudo -u reportlog sh -c 'pg_restore --clean --if-exists \
  -d "$(grep ^DATABASE_URL= /srv/reportlog/.env | cut -d= -f2-)" \
  /var/backups/reportlog/reportlog-2026-10-02T03-30-12Z.dump'
sudo systemctl start reportlog
```

`--clean --if-exists` makes the same command work over the live database
too — skip the `createdb` for that. **Admin → Operations → Backups** shows
this command with your own paths in it. Tables come back owned by
`reportlog`, as they were, because the dump records who owned them.

Measured on 15 October 2026, against a real dump: the restore as `reportlog`
brought back all 56 tables, and the app's role could write to them. The
version this guide used to print, run as `postgres`, could not open the file.

> **`npm run export-archive` is NOT a backup, and the script says so itself.**
> It writes the archive's *meaning* to JSON so it can cross a schema change. It
> **re-encodes**, and replaying it with `import-archive` **builds a new chain**
> — every hash is recomputed, so the result is a valid archive that is *not*
> the archive it came from. Every anchor you have already published names a
> head that then no longer exists, which from the outside is indistinguishable
> from tampering. That is why `chain-reset-marker.js` exists and must be run
> immediately afterwards.
>
> For getting your data back as it was, use `pg_dump`. Use the export only when
> you actually mean to rebuild the chain, and announce it when you do.

## 5.3 · Object storage, if attachments are on

The uploaded files live in your buckets, not on the box. The evidence bucket
holds originals **encrypted under per-file keys that are wrapped by
`TIER_B_ENCRYPTION_KEY`** — so a bucket backup is useless without `.env`, and
`.env` is useless for files without the bucket.

Whatever replication or versioning your storage provider offers, turn it on.

## 5.4 · The transparency log's deploy key

If you made it in the owner's pane ([§3.13](#313--leave-it-running)), it is a
file — `/srv/reportlog/var/transparency-log/deploy_key` — and, on purpose, it
is in neither the database nor `.env`, so **no backup above contains it.** A
database dump must not carry write access to the public log.

You do not need to back it up. If the box is lost, make a new key in the pane
and add it to every mirror as a deploy key with write access — and remove the
old one, which is now on a machine you no longer have.

## 5.5 · The transparency log

This one partly backs itself up, by design. It is an ordinary git repository
holding the daily timestamps, the published chain heads and the snapshots —
and it is meant to be **mirrored to several hosts under different operators**.

Add a mirror as one more line in the owner's transparency-log pane
([§3.13](#313--leave-it-running)), with the deploy key added to it.

A box configured before the pane existed may set `TRANSPARENCY_LOG_REMOTES`
in `.env` instead. That still wins where it is set, and it names remotes in
the checkout rather than addresses:

```
TRANSPARENCY_LOG_REMOTES=origin,codeberg
```

> **More than one remote is the point, not redundancy for its own sake.** A
> record only one company holds is a record one company can be compelled to
> remove — and the entire claim this software exists to support is that nobody,
> including you, can quietly alter or suppress the archive. Push it somewhere
> you do not control.

## 5.6 · What to do if you lose the box but keep the backups

In order:

1. A new server, and [§3](#3--step-by-step) up to and including the code
   ([§3.4](#34--get-the-code)) — **not** `npm run configure`.
2. Put your saved `.env` back at `/srv/reportlog/.env`, mode 600, owned by
   `reportlog`. Its keys are the only ones that open the archive.
3. Copy the dump onto the box and restore it, as in
   [§5.2](#52--the-database--this-is-the-archive).
4. **Then** `npm run migrate`. If the code is newer than the dump, it
   applies what the dump is missing; migrations only ever add, so this is
   safe, and on a dump from the same release it does nothing.
5. [§3.13](#313--leave-it-running) and [§3.14](#314--a-certificate-and-the-proxy)
   again — the service and timers, the transparency log's checkout and a new
   deploy key (§5.4), the certificate and the proxy — after re-pointing DNS.

The chain verifies as it did, because the rows and their hashes came back
byte for byte.

---

# 6 · Your first logbook — nothing can be filed until you make one

**A deployment with no logbook accepts no reports at all**, and that is
deliberate rather than an omission. Every report is filed through a logbook,
and a logbook is a questionnaire you build. There is no built-in form to fall
back on and no second route in. Until one logbook is launched, the submit page
has nothing to offer and the board is empty.

This is the part that is not sysadmin work. Take your time over it, because
one decision in it cannot be undone.

> **There is a second format: lists.** You will see the word **list** in the
> timer table above and in `npm run doctor`, so here is what it means.
>
> **A form is the question set. A logbook or a list is what happens to the
> answers.** Both have forms, built the same way from the same field types.
> The container is the whole decision, and it is one question: does this need
> to be permanent and verifiable?
>
> - **A logbook** seals every report, chains it, refuses to let anything be
>   altered or deleted afterwards, asks every reporter for an address and
>   their consent, and publishes nothing until a moderator approves it one by
>   one. That is this section.
> - **A list** seals nothing. It keeps an editable form, erases the personal
>   half of what it collects on a timer, is approved in bulk rather than one
>   at a time, and publishes counts rather than anything a person wrote. It is
>   for the things that do not need protecting from silent alteration — links
>   to published material, a tally of how a day went, a contact form.
>
> **Making one:** **Admin → Lists → Create a list.** It asks first whether
> what people send has to be permanent — if it does, that is a logbook, and
> it sends you there. Otherwise pick a starting point (the Tip List,
> check-ins or a contact form), a title and a web address; the form is then
> at `/list/<address>`. **A new list starts hidden**, so nobody sees it until
> you set it to *Team only* or *Listed*. A listed list that is taking entries
> gets a button on the front page.
>
> **Reviewing:** entries wait on the **Moderators** page, under *List
> entries*, and are approved or rejected a page at a time. Nothing anybody
> writes is ever published. If you tick **Publish counts**, the numbers for
> the questions you ticked *Countable* — how many were received, how many
> approved, and how many gave each answer — are readable at
> `/api/lists/<address>/counts`.
>
> **It needs email to keep its promise.** A form where people can write asks
> them for an address and emails them a link that deletes what they wrote.
> Without email working (see the email section), that link never arrives —
> the form tells them so, but set email up before you list one.
> **Without the site password.** While the site has a password, a list (or a
> logbook) can be set to work without it: for anybody with its link, or also
> linked from the password page. A logbook set that way is open for **filing
> only** — its board and everything else stay behind the password.
> Volunteering is a list now, set up this way on every box: the password page
> links it, and each application is emailed to `ADMIN_EMAIL`. A list can email
> its entries to another address instead; that address is sent a link and gets
> nothing until it is clicked.
>
> `LIST_PERSONAL_DAYS` in `.env` is how long the personal half is kept
> (default 90 days), and `LIST_KNOWN_HOSTS` names the sites a moderator will
> recognise, so links to anywhere else are marked for a closer look.
>
> **Why it is not a logbook with the guarantees turned off:** a hard rule with
> a switch in front of it is not a hard rule. Append-only, sealing and
> approval-before-publication are the things this archive rests on, and the
> failure nobody would notice is somebody flipping a switch on an existing
> logbook and losing one of them quietly.

## 6.1 · Create the draft

Sign in, then **Admin → Logbooks → Create a logbook**. It asks two things:

- **What is this logbook called?** Reporters see this. A place, a period, a
  subject — whatever tells somebody they are filing to the right one.
  "Munich, November 2026" is the shape.
- **Web address** — optional, and made from the title if you leave it. **It is
  sealed into every report filed here and can never be changed.** One chain
  per logbook, keyed on this. If the one you want is taken, a number is added
  rather than quietly joining the other logbook's chain. **A typo in it is
  fixed by deleting the draft** — **Delete this draft**, at the foot of the
  editor, for a logbook never launched — and making another. After launch
  the address is permanent; close the logbook instead.

**Start from one of the shipped question sets** rather than an empty form. The
dialog offers them, they arrive as a draft you can change freely, and they are
a better starting shape than a blank page:

| Starting point | Questions |
|---|---|
| Election incidents | 10 |
| Election day: how did it go? | 9 |
| Incident reports | 10 |
| Safety observations | 9 |
| Complaints about a practitioner | 12 |

You can also start from a logbook file — the `.json` a **Download as a logbook
file** gives you, which is how you move a question set between deployments. An
upload always arrives as a draft, never as a launched logbook.

## 6.2 · Ask your questions

**Add a question**, one at a time. The types are: short text, long text, date,
time of day, date and time, place, location on a map, choose one, choose any,
yes or no, number, email address, web address, evidence they have but are not
uploading, and photos, video or documents.

**Place** and **location on a map** are different questions. *Place* is a
list you write and the reporter may add to. *Location on a map* is chosen
from the places the site's maps can draw, and it is what a heat map counts
([`docs/map.md`](docs/map.md)).

For each one you also decide:

- **An answer is needed** — the form will not send without it.
- **Offer this as a filter** on the board, for the types that can be
  filtered — the box is greyed out for the rest. Nothing is filterable unless
  you say so: there is no built-in date or location filter, because where and
  when are question types here rather than fixed parts of a report.
- **Ask it only when** an earlier answer was a particular value, so a
  follow-up appears for the people it applies to and nobody else. The earlier
  question has to be one with fixed answers — yes or no, choose one, choose
  any, or evidence they have — and an upload question cannot be conditional.

Three things people get wrong at this point:

- **You do not have to ask for contact details, consent, or whether it may be
  published.** Every report carries those, whatever logbook it came through
  and however it was filed. Adding your own questions for them means asking
  twice and storing the second copy in the wrong place.
- **A written account is not built in.** If you want one — and most logbooks
  do — ask for it as a **long text** question. It is the logbook's question,
  not the software's.
- **Uploads are decided by asking.** A logbook takes files if it has a
  photos-video-documents question **and** the site has attachments switched
  on, which needs object storage
  ([§2](#object-storage-only-if-you-want-attachments)). There is no separate
  per-logbook switch to find; the question *is* the switch. Sizes and counts
  are under **What this logbook will accept**, and leaving a box empty uses
  the site's own number. **Freeze uploads on this logbook** stops new files
  arriving on one logbook without touching the rest.

## 6.3 · Read it as a reporter, before you launch

Fill the whole thing in as if you were a reporter. Not a skim — type the
answers. It is the only way to notice a question that reads clearly to the
person who wrote it and ambiguously to everybody else.

**A draft cannot be filled in.** It does not exist publicly at all, so there is
no submit page for it until it is launched — and **a report can never be
deleted**: the archive is append-only, by a database trigger, and a test
report filed into a launched logbook stays in its chain and in every anchor
for good. So do this somewhere that does not matter:

- **On a test box** — the best way. **Download as a logbook file** in the
  editor, upload it on a test deployment (it arrives as a draft there too),
  launch it there, and file into it as many times as you like.
- **Or here, knowingly** — launch, file one, and **reject** it in moderation
  so it is never published. It stays in the chain, counted, and that is the
  price.

## 6.4 · Launch it — and this is the one-way door

**Launch this logbook** is irreversible. Afterwards it may gain **a new
optional question** and nothing else: no rewording, no removing, no
reordering, and no promoting an optional question to required.

That is not caution for its own sake. **A report seals the questions it was
answered against** — the version the reporter was actually asked, not the one
at confirmation — so changing a launched form would mean reports in the same
logbook that cannot be read against one definition. The narrow opening for a
new optional question exists only because a key is written into the hashed
object exclusively when it applies.

So: read every question aloud, fill the form in once, and only then launch.

**When it runs.** A logbook can be given an **Opens** and a **Closes** time.
Launched with an opening time in the future it is *scheduled* — the state is
computed from the clock whenever somebody asks, not flipped by a timer, so it
survives the box being down over the boundary.

**Closing an intake is not retiring a record.** Reports already filed stay
published and stay verifiable.

**Launching puts it on the front page.** Every open logbook is a button
there, wearing the logbook's own title, the way a list is. The first button
is the accent — the page's one main action — and an administrator can
reorder them with the arrange control on the front page itself. A logbook
launched after the buttons were arranged is added at the end.

## 6.5 · Somebody to review what arrives

**Nothing is public until a moderator approves it.** There is no auto-publish
path and there must not be one. The owner and any administrator can review
too, so you are not locked out of your own queue — but a deployment that
expects reports should have somebody whose job that is.

**Access → Roles**: an email address, a role, **Apply**. Signing in is a
one-time code sent to that address, every time — which is the other reason
mail had to work before any of this.

The ceiling, so you know what you are handing over:

| Role | Can mint |
|---|---|
| Moderator | nobody |
| Access Manager | Moderators — **not** other Access Managers |
| Administrator | Moderators and Access Managers — **not** other Administrators |
| Owner | all of the above and Administrators; only the owner appoints or removes one. There is exactly one owner, and **the seat cannot be granted at all** |

The owner's seat moves only by the setup wizard, or by the two-party handover
under **Admin → Operations → Hand this deployment over**. The person offered
it accepts from a panel that appears on their own front page when they sign
in — they need no role to see it. It appears in no row of the granting table, so there is
no code path that produces a second owner.

A moderator may publish a report's text and withhold its photographs. Never
the reverse — consent is the ceiling and moderation is the floor.

## 6.6 · File one for real, through the whole path

With the logbook open and a moderator appointed, file a report yourself and
**follow the confirmation link in the email**.

That last part is the point. A path that only runs when somebody clicks a link
in an email is the path nothing reaches by accident: report confirmation was
broken in production for three days under three green test suites, because
none of them walked a confirmation link. Walk it once by hand on every
deployment.

Then you have a working archive, and the address is worth giving out.

---

# 7 · Upgrading

Two ways: from the admin page, or over SSH. The SSH one is the fallback and
the one that always works.

## 7.1 · From the admin page

**Admin → Operations → Updates** shows what this deployment is running, what
is on `stable`, and the release notes for every version in between. One
button installs it: the site takes a database backup, installs, migrates and
restarts, which takes about a minute and is a minute of downtime.

**It needs `reportlog-update.timer`** from [§3.13](#313--leave-it-running).
`install-units.sh` installs it at install time. `contrib/deploy.sh` installs
units again whenever it deploys a release that changed anything under
`contrib/systemd/` — **when the account running it has full sudo.** Run as
the `reportlog` user, as [§7.2](#72--over-ssh) shows, it cannot: its sudo
covers one restart and nothing else, so it says "Cannot sudo, so the units
were not installed" and prints the command to run. Run that command.

> **IF THE BUTTON DOES NOTHING ON A BOX THAT HAS BEEN RUNNING A WHILE**, it
> is because that timer was never installed, and one command finishes it:
>
> ```
> sudo /srv/reportlog/contrib/install-units.sh
> ```
>
> It is idempotent and safe at any time — it installs and enables every unit
> this deployment should have and changes nothing already right. **The
> Updates pane names that command on screen**, so you do not have to come
> back here for it.
>
> **How a box ends up in that state, because it was nobody's mistake.**
> `install-units.sh` runs once, at install. `deploy.sh` used to pull,
> migrate and restart and **install no units at all** — so a release that
> ADDED a timer gave an upgraded box the new code and not the new timer,
> silently. That is what happened to this very feature: its timer arrived in
> the release that added the pane, so every box upgraded over SSH got a
> button with nothing behind it. `deploy.sh` installs units now, before the
> restart, when it can sudo — and when it cannot, it says so and names the
> command, rather than leaving the drift silent.

> **THE APPLICATION IS NOT WHAT UPDATES IT, and that is deliberate.** A web
> page that could run `git pull` and restart a service would be a path from
> "somebody sent an HTTP request" to "code runs on the server", on a box
> holding people's identities. So the button only writes a file naming a
> commit. A root timer reads it, **fetches from a URL kept in the systemd
> unit rather than from the checkout**, refuses anything that is not the exact
> tip it just fetched, takes a backup, and only then applies it.
>
> The consequence worth knowing: an attacker who took over the whole
> application could cause this deployment to install **genuine upstream code**
> earlier than you meant. They could not make it install code of their own.
> `contrib/update-apply.sh` carries the reasoning in full.
>
> **That last sentence was not true until 10 October**, and the reason is
> worth keeping. The remote was pinned in the unit with care, but the unit ran
> the updater *out of the checkout* — a file the application owns and can
> write — as root, every minute. So the application could simply replace the
> program root runs, and a code-execution bug in the web app was root within a
> minute. **Root now runs a copy at `/usr/local/libexec/reportlog/`, owned by
> root and outside the checkout**, which `install-units.sh` puts there. The
> copy refuses to run from inside the checkout, or if anyone but root can
> write it. `npm run doctor` reports a box still on the old arrangement.
>
> **What it still trusts:** `install-units.sh` copies the updater from the
> checkout at the moment you run it. Run it on a checkout you trust — just
> after a deploy — and never on a box you suspect; reinstall that one from a
> fresh clone.

> **A release that changes the updater installs itself anyway.** Root's copy
> lives outside the checkout, so it cannot be replaced by the application —
> but it can replace itself, from the one commit it has just fetched from the
> address in its own unit file and checked against what that address is
> serving. It writes the new copy beside itself, root-owned, renames it over
> itself and runs it again. Nothing in that comes out of the checkout, so the
> rule above holds unchanged: an attacker holding the whole application still
> cannot choose what root runs.
>
> You do not have to do anything. If it ever renews and the new copy still
> disagrees — something on the box is rewriting it — it stops rather than
> looping, and says to update over SSH (§7.2) and then run:
>
> ```
> sudo /srv/reportlog/contrib/install-units.sh
> ```

> **A failed update does not roll itself back.** A half-applied migration plus
> an automatic revert is how an archive gets damaged. The pane shows what
> failed and the exact rollback command, and a person decides. The backup
> taken before it started is the way back.

Who pressed the button, and what it moved between, is kept in
`update_requests`, which is append-only like the archive itself.

## 7.2 · Over SSH

Every deploy after the first is one command, **run as the user that owns the
checkout**:

```
sudo -u reportlog bash -c 'cd /srv/reportlog && ./contrib/deploy.sh'
```

It refuses to run over uncommitted changes, fast-forwards only, installs from
the lockfile and migrates. Then it installs units if the release changed any,
restarts the service, reloads nginx after `nginx -t` passes, waits for
`/api/health` to answer, and runs `npm run doctor` — printing the rollback
command if the service does not come back.

**As `reportlog`, two of those steps are yours.** Its sudo covers the restart
and nothing else, so the unit install and the nginx reload say "Cannot sudo"
and print what to run instead:

```
sudo /srv/reportlog/contrib/install-units.sh          # if the release changed contrib/systemd/
sudo nginx -t && sudo systemctl reload nginx          # if it changed contrib/nginx/
```

**Read the release notes first.** A release that adds a proxied path needs a
one-time nginx edit on every existing box — `deploy.sh` deliberately never
edits nginx's configuration, because a deploy script that rewrites a web
server's config is a deploy script that can take a site down. It does warn,
on every run, when the live configuration does not include `csp.conf` or
`cache.conf`. Diff your live
config against `contrib/nginx/reportlog.conf` after any release that mentions a
new location block.

> **The first deploy is by hand.** `deploy.sh` cannot perform the deploy that
> installs `deploy.sh`. On a box checked out before `contrib/` existed, bash
> says `No such file or directory` — that is the file missing, not the box being
> broken. Pull once by hand and the script exists from then on.

> **The checkout being current is not the same as the deployment being
> current.** A checkout can reach a commit without going through `deploy.sh` —
> which is what runs the install, the migrations and the restart — so the
> service goes on running the previous code. "Already up to date" said of the
> *checkout* is easy to read as nothing to do.
>
> **Confirm a deploy by asking the running service, not the git log.** Call a
> route that only exists in the new release and see whether it answers.

**Take a backup before any upgrade that runs a migration** —
`sudo -u reportlog bash -c 'cd /srv/reportlog && npm run backup'`. Migrations
are additive by rule, but a backup you did not need costs nothing. (The
Update button takes one for you.)

---

# 8 · When something is wrong

**Start here, always:**

```
npm run doctor
systemctl status reportlog
journalctl -u reportlog -n 50 --no-pager
```

The app writes one line per request. **It deliberately logs no IP addresses, no
query strings and no request bodies** — sign-in codes, email addresses and the
curtain password all travel in those, and this is an archive whose promise is
that somebody can report something without being identified for it. If you need
more than it gives you, that is the trade being made on purpose.

| Symptom | Usual cause |
|---|---|
| Service will not start, `No such file or directory` | Node is not where the unit says. Run `install-units.sh` again, which writes the Node it finds. See [§3.2](#32--node). |
| Service exits immediately | `SITE_ORIGIN` unset — it refuses to start without one — or Node older than 22. An unreachable database does **not** stop it; it starts and logs connection errors. |
| `SASL` / password error running something by hand | `src/db.js` reads `DATABASE_URL` at import time. Anything run with `node -e` must load `dotenv/config` **before** importing anything that reaches the database. It reads like a permissions problem and is not. |
| Nobody can sign in, including you | Mail that is set up and failing: the code goes nowhere. With no mail set up at all, the code is in `journalctl -u reportlog`. [§3.11](#311--prove-mail-works) |
| Lock screen rejects every password | No curtain password is set, so nothing matches it. [§3.10](#310--set-the-curtain-password) |
| A route 404s but the site works | A missing nginx `location` block. [§3.14](#314--a-certificate-and-the-proxy) |
| Home-screen icon says "ReportLog" | `/manifest.webmanifest` is being served off disk. Same section — this one fails with a 200. |
| Uploads stick at "checking" forever | The media worker timer is not running. [§3.13](#313--leave-it-running) |
| An upload is refused | The type is off under **Admin → Reports**, or over a size cap, or uploads are frozen on that logbook. The doctor names missing media binaries. |
| Uploads wait forever with `CLAMAV_ENABLED=true` | The scanner is missing or `clamav-daemon` is stopped. Scanning fails closed, on purpose. The doctor checks for the binary. |
| The chain has never been anchored | The anchor timer was never enabled — `systemctl list-timers --all \| grep reportlog` — or the transparency log's checkout was never made. [§3.13](#313--leave-it-running) |
| Anchor unit will not start, or fails with `git` errors | `TRANSPARENCY_LOG_DIR` does not exist or is not a git checkout. Run `install-units.sh` again, then clone into it. [§3.13](#313--leave-it-running) |
| Anchor fails with `Permission denied (publickey)` | The deploy key lacks write access, or is not on that repository. A key made by hand in `~/.ssh` also needs `ProtectHome=read-only`, not `true`. |
| Anchor commits but `push to <name> FAILED` | That mirror refused the key, or the key lacks write access — press **Test** beside it in the transparency log pane, which says which. If `TRANSPARENCY_LOG_REMOTES` is set in `.env`, it names remotes in the checkout instead, and one of them is missing. |
| Anchor dies on a read-only filesystem | `ReadWritePaths` does not name the transparency-log directory — it was moved without running `install-units.sh` again. |
| nginx reload fails at a line number that makes no sense | A stray `.bak` in `sites-enabled/`. [§3.14](#314--a-certificate-and-the-proxy) |
| Half-configured and cannot see why | `npm run configure -- --check`. A half-filled section looks configured and behaves as unset. |
| Backups stopped and nothing said so | `npm run doctor` faults it now. `npm run backup -- --check` lists what is there; `journalctl -u reportlog-backup -n 30` says why the timer failed. |
| `npm run backup` refuses to start | `BACKUP_DIR` is inside the checkout, or `pg_dump`/`pg_restore` are missing — they come with the PostgreSQL **client** package. |
| A unit will not install | `sudo ./contrib/install-units.sh --dry-run` prints every command it would run. It refuses outright when Node is inside a home directory, because the unit it would write cannot start. |

**Security problems are reported privately through the repository's Security
tab, never as a public issue.** See `SECURITY.md`.

---

# 9 · Starting over on a test box

```
cd /srv/reportlog && sudo ./contrib/reset-to-fresh.sh
```

**This destroys the archive on that box** and puts it back to the state a
stranger's install starts in, so the wizard runs again. It never touches
`.env`. **Test deployments only.**

**Run it as root.** It stops the service before it drops the schema, and the
service user's sudo cannot do that. If the stop is refused, it changes
nothing and says so. It stops the media worker, anchor and sweep timers too,
and starts again exactly the ones it stopped.

Partway through **it asks for a new curtain password**, because the reset
leaves the site gated with none. Objects already in the storage buckets stay
there, with nothing pointing at them — harmless on a test box.

It makes you type the deployment's own `SITE_ORIGIN` to confirm, after printing
the real counts of what it is about to delete — the only confirmation that
cannot be given by reflex, and the one that catches the mistake that matters:
running it on the wrong box.

---

# 10 · What is deliberately not here

**No Dockerfile or compose file**, on purpose. Containers make the first ten
minutes easier — Postgres and the media binaries arrive already installed — and
they make the database one careless `docker compose down -v` away from deleted.
For an append-only archive whose whole value is that the record survives, that
is a bad trade to make the default. `npm run doctor` covers the same ground: it
tells you what is missing and how to install it, without putting a volume
between you and your data.

If you want to containerise it anyway, nothing in the app resists it.
**Bind-mount the Postgres data to a path you can see**, rather than a named
volume.

**No backup of anything but the database.** `.env` and the storage buckets
are yours, and deliberately so. See
[§5](#5--backups--read-this-before-you-take-a-real-report).

**No off-site copy.** The backup timer protects you from the disk, not from
the building. Point whatever you already use at `BACKUP_DIR`.

---

## Where to go next

| | |
|---|---|
| `README.md` | what the software is, and why it is built this way |
| `docs/reference.md` | **the whole of it** — every feature, constraint and invariant, in one document |
| `docs/logbooks.md` | building your own questionnaires |
| `contrib/README.md` | the proxy and service templates in detail |
| `CONTRIBUTING.md` | if you are going to change the code |
| `/docs` on a running deployment | this guide, rendered |
