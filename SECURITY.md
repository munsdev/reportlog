# Reporting a security problem

**Do not open a public issue for a security problem.** Report it privately
through GitHub instead: the **Security** tab of this repository, then
**Report a vulnerability** (https://github.com/munsdev/reportlog/security/advisories/new).
Only the maintainers can see it.

You will get an acknowledgement within three days. If you do not, assume the
report did not arrive and try again — silence here is a failure on our side,
not a decision.

## What matters most

ReportLog exists to make one claim: **a report, once filed, cannot be
silently altered or removed, including by the operator.** Anything that
breaks that claim is the most serious kind of bug this project can have,
whether or not it is exploitable by an outsider. That includes:

- any path that edits or deletes a row in `reports`, `reports_restricted`,
  `attachments` or `chain_anchors`
- anything that changes how an existing report hashes
- a way to read Tier B data — reporter identity and contact details —
  without writing an `access_log` row
- a way past the site password gate, or a way to reach an admin function
  without the role for it
- a way to publish material a moderator has not approved
- a way to obtain an uploaded file's original bytes without a logged grant

Report those even if you are not sure they are exploitable. A theoretical
break in the chain is still a break in the claim.

## What we will do

We will confirm the problem, tell you what we found, and agree a disclosure
timeline with you. If a fix invalidates something already published — a
proof, an anchor, a snapshot — we will publish that fact alongside it rather
than quietly reissuing anything. The transparency log is never rewritten,
including to correct it.

## Scope

Anything in this repository. Deployments run by other people are their own
responsibility; if you find a problem on a live site, tell its operator, and
tell us as well if the cause looks like it is in this software.

## Things that are deliberate

Some things that look like findings are decisions, and are documented as
such:

- **Published renditions are stored unencrypted.** They are, by definition,
  material a moderator cleared for the public.
- **The site password is hashed with a single SHA-256, unsalted.** It is a
  shared, low-value, rate-limited password for keeping a deployment off the
  open internet before launch — not a user credential. It is not a
  replacement for authentication and is not treated as one.
- **Test files contain fake keys**, including AWS's own published example
  secret key. They are test vectors.
- **Optional keys are written into the hashed object only when they apply.**
  Code that looks untidy for this reason is load-bearing. See
  `src/reportCore.js`.

If you think one of these decisions is wrong, that is a conversation worth
having — open an issue for it rather than a security report.
