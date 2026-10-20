# ReportLog

A tamper-evident intake and record system for incident reports. Every report
is fingerprinted and chained to the one before it, so any later change shows,
and anybody can check a report without trusting the server that holds it.

> **This branch is the rebuild.** It matches the application it replaces
> ([`docs/parity.md`](docs/parity.md)). The old code was removed after parity;
> commit `3793861` is the last one that still has it, in `legacy/`.

## What is here

| Path                 | What                                                                            |
| -------------------- | ------------------------------------------------------------------------------- |
| `apps/api`           | The server: Fastify and PostgreSQL. Node runs it directly, with no build step   |
| `apps/web`           | The website: React, TypeScript, Tailwind, built with Vite                       |
| `packages/seal`      | What a report's fingerprint is made of, and how to check one. Runs in a browser |
| `packages/fields`    | Question types and how answers are normalized                                   |
| `packages/access`    | Who may grant which role                                                        |
| `packages/contracts` | Every request the website and server exchange                                   |
| `docs/`              | [Architecture](docs/architecture.md) and [workstreams](docs/workstreams.md)     |

## Running it

You need Node 22.18 or newer, pnpm 10, and PostgreSQL 16.

```sh
pnpm install
cp .env.example .env            # point DATABASE_URL at an empty database
pnpm --filter @reportlog/api db:migrate
pnpm --filter @reportlog/api db:seed     # optional: a demo logbook and two reports
pnpm dev                        # API on http://localhost:3000, website on http://localhost:5173
```

## Checking it

```sh
pnpm check                      # formatting, lint, types, import boundaries, unit tests
pnpm test:db                    # database tests, on a throwaway database
pnpm --filter @reportlog/web e2e  # browser tests
```

All three must pass before anything merges. CI runs them on every pull
request.

## Versions and releases

The version is `"version"` in the root `package.json`, and
[`CHANGELOG.md`](CHANGELOG.md) says what each release changed, in plain
language for the people who use and run a site. Every page's footer shows the
version (and, on a server, the commit it was deployed from), and
`sudo reportlog updates` on a server shows the notes of every release between
the one it runs and the newest.

While changes are being made, their notes go under `## Unreleased` at the top
of the changelog, written for a person using the site, not as commit
messages. To cut a release:

1. Pick the number. While the version starts with `0.`, raise the middle
   number for a release that adds something or migrates the database, and the
   last for one that only fixes things.
2. In one commit, named `Release vX.Y.Z`: rename `## Unreleased` to
   `## vX.Y.Z — D Month YYYY` (today's date), put a new empty
   `## Unreleased` above it, and set `"version"` in the root `package.json`
   to `X.Y.Z`. `apps/api/test/unit/release.test.ts` fails if the two
   disagree.
3. Merge it into `main` with all three suites green.
4. Tag that commit on `main` and push the tag:

   ```sh
   git tag -a vX.Y.Z -m "ReportLog vX.Y.Z"
   git push origin vX.Y.Z
   ```

5. Servers see it the next morning (or at once with `sudo reportlog updates`)
   and install it with `sudo reportlog deploy vX.Y.Z`.

A release is never changed once tagged. A mistake in one is fixed by the next.

## Licence

[AGPL-3.0-or-later](LICENSE).
