# ReportLog

A tamper-evident intake and record system for incident reports. Every report
is fingerprinted and chained to the one before it, so any later change shows,
and anybody can check a report without trusting the server that holds it.

> **This branch is a rebuild in progress.** The working application it
> replaces is in [`legacy/`](legacy/README.md) for reference. See
> [`docs/workstreams.md`](docs/workstreams.md) for what is being built and in
> what order.

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

## Licence

[AGPL-3.0-or-later](LICENSE).
