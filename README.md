# ReportLog

A tamper-evident intake and record system for incident reports.

People file reports. Moderators review them. Nothing is published without
approval. And once a report is filed, **it cannot be silently altered or
removed — including by the operator running the archive.**

That last part is the whole point, and it is not a policy. Every report is
hashed into an append-only chain — one per logbook — and every chain's head is
timestamped daily by an outside authority and published to a public log. Anyone can re-derive any
report's fingerprint and check it themselves, without trusting the operator
and without using this software.

Nothing in ReportLog is about any particular subject. It was built for
election-incident reporting and generalized deliberately.

## Status

**Early. Not yet recommended for production use by anyone but its author.**

The software runs and is in real use, but the installer and the operator
documentation are still incomplete. The setup wizard is built: a fresh
install sets a curtain password, and whoever it is handed to mints their own
account through it — as the **owner**, the one person who can appoint or
remove an administrator. If you are here to evaluate it, read this
file and `docs/`; if you are here to run it, wait, or talk to us first.

`docs/` holds the architecture notes:

- [`docs/reference.md`](docs/reference.md) — **the whole of it.** What the
  software does and refuses to do, how every part works, the constraints, the
  schema, the limits, installing and operating it, and what is built, planned,
  parked or ruled out. Start here if you want one document.
- [`docs/logbooks.md`](docs/logbooks.md) — what a report is, logbooks as the
  only forms, the logbook file, templates, and one chain per logbook with the
  daily timestamp that covers them all.
- [`docs/attachments-architecture.md`](docs/attachments-architecture.md) —
  how photos, video and documents ride on a report without breaking the hash
  chain, why nothing is published as the file that was uploaded, and what the
  three buckets are each for.

## How it works, briefly

**The chain.** Every version of every report is a row that is never updated
and never deleted — enforced by a database trigger, not by convention. A
correction is a new row pointing at what it corrects. A withdrawal flips a
pointer. Each row carries a SHA-256 over its own canonicalized contents
(RFC 8785) and a second hash linking it to the row before it in the same
logbook. Every logbook is its own chain, so a fault in one never touches
another, and each can be downloaded and checked on its own with
`scripts/check-chain.js`.

**The anchor.** Once a day the list of every logbook's latest link is sent to
an RFC 3161 timestamp authority, and the token is published to a git
repository along with the list and a snapshot of everything published that
day. A logbook on that list stays on it and its count only grows, so a whole
logbook cannot quietly disappear. Mirror it to as many hosts as you
like. The point is that no single party — including the operator — can
quietly rewrite history, because the evidence of what history said is
somewhere they do not control.

**Two tiers.** What a report says is one thing. Who filed it is another, kept
encrypted, readable only by a moderator, and only with a written reason that
is logged and shown to the reporter.

**Who can do what.** Five roles, and each can hand out strictly less than
itself. The **owner** — one per deployment, minted by the setup wizard — is
the only one who can appoint or remove an **administrator**. An **Access
Manager** appoints **moderators** and cannot appoint another Access Manager;
that ceiling is why one grant never becomes every grant. The owner's own
seat cannot be granted at all: it moves only by a handover both people have
to agree to, so a deployment cannot be handed to an address nobody reads.
Every change is written to an append-only trail in the same transaction as
the change itself.

**Your own questions.** Every report is filed through a **logbook**: a
questionnaire an operator builds — your questions, in your order, from thirteen
field types. There is no built-in form. Where and when are field types you
add, not fixed parts of a report, so a logbook can have two of each or none;
and nothing is filterable on the board unless you marked it so. What every
report is asked regardless is an address to reach the reporter, their
consent, and whether it may be published. Launching a logbook fixes its
questions: afterwards it can gain a new optional question and nothing else,
because a question that could be reworded later would leave every answer to
it meaning something nobody can check. A logbook can be downloaded as a plain
JSON file and a new one started from one; the starting points the setup
wizard offers are such files, and each arrives as a draft to look over and
launch.

**Files.** Uploads are never published as themselves. Images are stripped
segment by segment; video, audio and HEIC are decoded and re-encoded; PDFs
are rendered to page images and never served to anyone but a moderator. The
original is kept encrypted under a per-file key, and destroying that one key
erases exactly one file while leaving its fingerprint — and every proof over
it — intact.

## Installing

**[`INSTALL.md`](INSTALL.md) is the guide.** It is written for somebody who
has not run a production server before, and it covers the prerequisites, the
database, the proxy and the certificate, the service files, backups, upgrading
and what to do when a step fails. On a running deployment the same guide is at
`/docs`.

On Debian or Ubuntu, `sudo ./install.sh` does every mechanical step and then
stops where a person is needed — `--dry-run` prints each command without
running it. The sequence by hand, for anyone who has done this before:

```
git clone --branch stable https://github.com/munsdev/reportlog.git
cd reportlog
npm ci --omit=dev
npm run doctor                 # run after every step; installs nothing
npm run configure              # writes .env, generates the two keys
npm run migrate
npm run set-curtain-password
npm run mail-test -- you@example.org
npm start
```

Then the service files and the proxy from `contrib/`, and open the site to run
the six-screen setup wizard.

Four things in there are worth knowing before you start, because each one has
cost somebody real time:

- **`npm run configure` generates two encryption keys and they are
  irreplaceable.** Lose either and the data behind it is unreadable forever,
  with the ciphertext intact in every backup. They are never prompted for,
  never displayed, and exist only in `.env` — so back that file up, off the
  machine, before you go further.
- **Mail is not optional.** Without it no reporter can confirm a report, and
  the one-time sign-in code reaches nobody's inbox — with no mail set up it is
  printed to the service log, which is enough to finish setup and nothing
  more; with mail set up and failing it is lost. Prove it with `mail-test`
  before you hand the site to anyone.
- **The site is gated on a fresh install and the gate comes up with no password
  set**, which means nothing matches it and nobody gets in — not even you. That
  is why `set-curtain-password` is a step and not an optional extra. That gate
  is not authentication and is not a substitute for it: it keeps an unfinished
  deployment off the open internet, and the archive is protected by everything
  else.
- **Backups are a daily timer and a script** — `npm run backup`, which reads
  each dump back before trusting it — and `npm run doctor` complains when the
  newest one goes stale. Getting a copy *off* the machine is still yours.
  `INSTALL.md` §5 says what has to survive and why `export-archive` is not a
  backup.

**A deployment carries its own name.** `npm run configure` asks for it, an
administrator can change it later, and it appears on every page, in the browser
tab, on the lock screen and in the mail the site sends. The software stays
called ReportLog and the footer says so — the ordinary arrangement for
self-hosted AGPL software, and it keeps attribution where a reader can see it.

**Then hand over the URL and the curtain password.** Whoever you hand them to
runs the wizard and becomes the **owner** — the one account that can appoint or
remove an administrator, and a seat that cannot be granted to anybody. The
installer never has to hold it.

**The imprint and the privacy policy are yours to write**, in Settings, in
your own words. Both pages say plainly that this deployment has not published
one until you save something, because publishing a placeholder that reads
like a legal notice would be worse than publishing nothing. The editor opens
on a labelled outline of what many jurisdictions ask for; it is an outline
and not legal advice, nothing in it is checked for you, and what your
jurisdiction requires of those pages is yours to establish.

A single-command installer is in progress and is not here yet.

## Licence

AGPL-3.0-or-later. See `LICENSE`.

The network clause is the reason for this licence rather than a permissive
one: if you run a modified ReportLog as a service, the people filing reports
into it are entitled to the source of the thing they are trusting.

## Contributing

See `CONTRIBUTING.md`, and please read the part about the hashed object
before writing any code.

Security problems are reported privately through this repository's
**Security** tab, never as a public issue. See `SECURITY.md`.

## A note on the history

This repository begins at one commit. The software has a longer history than
that, in a private repository, which was not carried over — it contained
deployment configuration, real report data and secrets, and disentangling it
would have been slower and less trustworthy than starting clean.
