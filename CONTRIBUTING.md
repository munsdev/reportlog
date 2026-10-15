# Contributing to ReportLog

Thank you for looking. This is a small project with an unusual constraint,
so this document is mostly about that constraint.

## The one thing to understand first

ReportLog makes a single promise: **a report, once filed, cannot be silently
altered or removed, including by the operator.** Every rule below is that
promise restated somewhere specific.

The most important consequence for a contributor is this:

> **A key is written into the hashed object ONLY when it applies.**

An absent key and a key set to `null` serialize differently under RFC 8785,
so making an optional field unconditional changes the fingerprint of every
report ever filed by every deployment. Code that looks untidy for this reason
is load-bearing. `src/reportCore.js`, `src/verify.js` and
`scripts/import-archive.js` all carry the rule in comments, and the test
suite asserts it. **If that test goes red, stop.**

`PULL_REQUEST_TEMPLATE.md` asks you to confirm your change does not alter
the hashed object. Please answer it honestly — "I am not sure" is one of the
options on purpose, and it is a much cheaper answer than a guess.

If the template does not appear automatically when you open a pull request,
that is a Forgejo path question rather than your mistake — the file is at the
repository root, and some versions want it under `.forgejo/`. Fill it in by
hand and tell us, so we can move it.

## Getting set up

You need Node, PostgreSQL, and a copy of `.env.example` filled in as `.env`.

```
git clone https://github.com/munsdev/reportlog.git
cd reportlog
npm install
cp .env.example .env      # then fill it in
npm run migrate
npm start
```

`src/db.js` reads `DATABASE_URL` at import time, so anything you run with
`node -e` must load `dotenv/config` before importing anything that pulls in
`db.js`. Otherwise you get a SASL error that reads like a permissions
problem and is not.

## Tests

**All three suites, before any pull request.** None of them covers another,
and this said "both suites" for as long as there have been three.

```
npm test
npm run test:db
cd tools/browser-tests && \
  CHROMIUM_PATH=$(ls -d /opt/pw-browsers/chromium-*/chrome-linux/chrome | head -1) \
  node run.js --base=http://localhost:3000
```

`npm run test:db` creates a throwaway database beside the one in
`DATABASE_URL`, migrates it, runs every database-backed selftest against it
and drops it at the end. The database you point it at is never written to.

**Its total is the sum of its scripts, not the last line it prints** — the
runner ends on the last script's count, and that number has been mistaken
for the total before.

**Sum both fields.** The obvious version of this greps `'^[0-9]* passed'`,
which also matches the first half of `24 passed, 1 failed` — so it reports a
clean-looking total over a real failure. That has happened:

```
npm run test:db 2>&1 | grep -o '^[0-9]* passed, [0-9]* failed' \
  | awk -F'[ ,]' '{p+=$1; f+=$4} END {print p" passed, "f" failed"}'
```

**And count the scripts, because a script that dies prints no count at all** —
not even `0 failed` — so the sum above simply comes out smaller and still says
zero failed. These two numbers must match:

```
npm run test:db 2>&1 | grep -c '^───── '
npm run test:db 2>&1 | grep -cE '^[0-9]+ passed, [0-9]+ failed'
```

The browser suite catches a class of bug the unit tests structurally cannot —
it drives a real browser against a running app. Playwright looks for an exact
browser build and will claim it is not installed when a different one is
present; point it at the real one with `CHROMIUM_PATH`.

## Using Claude Code on this project

Claude Code works well here and several parts of this codebase were written
with it. Two notes:

**Running it on your own machine needs nothing special.** Clone the repo,
run `claude` in it, and it uses your own git credentials like any other tool.

**Running it in a browser session** (claude.ai/code) clones from GitHub, so
this repository is reachable with nothing to configure. A cloud environment
has no source field of its own — the repository is chosen per session.

Read `CLAUDE.md` in the repository root either way — it is the short version
of this document, written for an assistant.

## Sign your commits off

We use the Developer Certificate of Origin rather than a contributor licence
agreement. Add a sign-off line to each commit:

```
git commit -s
```

That produces `Signed-off-by: Your Name <you@example.com>`, and means you
certify you wrote the change or have the right to submit it under this
project's licence. The full DCO text is at https://developercertificate.org/.

There is no copyright assignment. Your contribution stays yours, licensed
AGPL-3.0-or-later like everything else here.

## What makes a change easy to accept

- **It does not touch the hashed object.** If it must, say so plainly at the
  top of the pull request and expect a longer conversation.
- **Migrations are additive.** Nothing after `001_init.sql` may change how an
  existing report hashes.
- **One card asks one question.** Nothing on the card in front of somebody
  changes underneath them, and there is no auto-advance on selection. If an
  answer changes what gets asked, that happens on the next card.
- **Plain language in anything a user reads.** On the site, in emails, in the
  changelog. Not jargon, and not commit-message English.
- **It comes with the test that would have caught the bug.** A rule written
  in prose is not a check; this project has been bitten by that more than
  once.

## Governance

The maintainer, [@munsdev](https://github.com/munsdev), looks after this
project and makes the final call on what goes in. That is the whole of the governance model today, and it will be written down
properly if it ever needs to be more than that.

## Security

Do not open a public issue for a security problem. See `SECURITY.md`.
