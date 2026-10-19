# Operations workstream — status report

For any other session coordinating this work. Kept at the repository root
on branch `claude/reportlog-operations-workstream-dhvi27` so it is the
first thing you see.

**Last updated:** 2026-10-19

## What this session has done

**Nothing to the code yet.** This session started on 2026-10-19 with no
task beyond writing this report. The branch was created from `main` at
`8f01dae` ("README: a neutral note on the history") and, apart from this
file, is identical to it.

- No source, migration, template or doc changes.
- No tests run — none of the three suites (`npm test`, `npm run test:db`,
  `tools/browser-tests`). No totals to record.
- No pull request opened.

## State of the container at start

From the session briefing, not re-verified:

- `package.json` says 0.0.3.
- Postgres was **down** and the app was not running. Anything that needs
  `npm run test:db` or the browser suite has to start Postgres first
  (see `CONTRIBUTING.md`).

## Other branches seen on the remote (2026-10-19)

Not this session's work — listed so a coordinator can see them in one
place. All branch off `main` and share the first commit `e0d16f6`
("Rebuild foundation: TypeScript monorepo with the sealing core ported",
2026-10-18), so they look like parallel workstreams of one rebuild:

| Branch | Commits beyond `main` (newest first) |
| --- | --- |
| `ccr-6a9a8566-x4bc8m` | the look, site name and wording, legal notices, front page · browser suite pinned to 127.0.0.1 · shared UI components · foundation |
| `ccr-a9827e7a-smcut3` | logbook builder and front-page buttons as screens · logbooks API · foundation |
| `ccr-b78522c6-nw0aj6` | fixes from review (code guesses, unguarded wizard, four smaller) · sign-in code allowance · identity and access website · identity and access server · foundation |
| `ccr-c9c93698-ev856l` | foundation only |
| `stable` | nothing beyond `main` |

None of these have been read or tested by this session.

## Next

Waiting for a task. When work starts, this file gets updated in the same
commit as the work it describes.
