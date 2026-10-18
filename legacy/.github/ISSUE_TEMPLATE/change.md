---
name: Proposal
about: A change to how ReportLog works, before writing the code for it
labels: proposal
---

## What problem this solves

<!-- Describe the problem, not the solution you have in mind. If the
     problem is "an operator cannot do X", say who the operator is and what
     they were trying to do. -->

## What you propose

## Does it touch the hashed object?

If it adds, removes or renames anything in the object hashed in
`src/reportCore.js`, say so here. That does not make a proposal unwelcome —
it makes it a longer conversation, and one worth having before code exists
rather than after.

## Does it touch one of the invariants?

`CLAUDE.md` lists them. Append-only reports, the optional-key rule, no
auto-publish, the role ceiling, the transparency log never being rewritten,
one card asking one question. Say plainly if this proposal changes any of
them, including if you think the change is right.
