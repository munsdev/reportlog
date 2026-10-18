---
name: Bug report
about: Something behaves differently from how it is documented or intended
labels: bug
---

**Do not use this for a security problem.** See `SECURITY.md` — those are reported
privately through the repository's Security tab, never as a public issue. If you are unsure whether
something is a security problem, treat it as one.

## What happened

## What you expected instead

## How to reproduce it

<!-- The smallest sequence you can find. If it only happens sometimes, say
     how often and what else was going on. -->

## Your deployment

- ReportLog version (the footer shows it, e.g. `v0.0.01`):
- Node version:
- PostgreSQL version:
- Anything unusual about the setup:

## Does it affect the archive?

Tick if any apply — these change how urgent this is:

- [ ] A report verifies differently than it did before
- [ ] Something was published that a moderator had not approved
- [ ] Tier B data (reporter identity or contact details) was readable
      without an `access_log` row
- [ ] A file's original bytes were reachable without a logged grant
- [ ] None of the above
