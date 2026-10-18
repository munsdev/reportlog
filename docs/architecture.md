# Architecture

What the rebuild is made of, and why each choice was made. The _why_ matters
more than the _what_: most of these choices exist to keep one of the
archive's promises.

## The promise

ReportLog is a tamper-evident archive. Every report is canonicalized with
RFC 8785, hashed with SHA-256, and chained to the report before it in its
logbook. Once a day the heads of every chain are timestamped by an outside
authority and published to a public repository. Anybody holding a report, or a
downloaded chain file, can check it without trusting the server.

Everything below serves that.

## Packages

| Package                | What it is                                                                                                                      | Why it is separate                                                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `@reportlog/fields`    | Question types, answer normalizing, conditions, the place gazetteer                                                             | A list uses the same answers and must never be able to reach the sealing code                                                    |
| `@reportlog/seal`      | The sealed object, hashes, chain links, form definitions, the publication card's digest, chain file checking, the anchor's list | The one place the fingerprint is defined. Pure and browser-safe, so a reader's browser runs the same code the server sealed with |
| `@reportlog/access`    | The role ceiling and rank                                                                                                       | Every granting path asks one table                                                                                               |
| `@reportlog/contracts` | zod schemas for every request and response                                                                                      | The server validates with them and the website is typed by them, so a shape change on one side breaks the build of the other     |

Shared packages are consumed as TypeScript source (`exports` points at
`src/index.ts`). Vite bundles them for the website. Node runs them directly
on the server through its built-in type stripping, so **the server has no
build step**. That keeps the old code's good property: a stack trace points
at the line that threw. This is why the TypeScript settings include
`erasableSyntaxOnly` and imports carry `.ts` extensions.

## The server

- **Fastify 5.** Every route is registered against a contract
  (`apps/api/src/http/route.ts`). Fastify validates the request with the
  contract's zod schemas and serializes the response through its response
  schema, so a field the contract does not declare is stripped rather than
  leaked.
- **PostgreSQL, with Kysely and plain-SQL migrations.** The archive's
  guarantees live in the database as triggers and constraints, and those are
  SQL. So migrations are SQL, and the TypeScript types are _generated from
  the migrated database_ (`pnpm db:types`) rather than written beside it. CI
  fails if the generated types are stale. We chose Kysely over an ORM
  because queries here are deliberate and visible, and a query builder that
  types them is enough.
- **Migrations are timestamped** so parallel branches never collide. They are
  checksummed, and the runner refuses to start if an applied file has
  changed.
- **Configuration is read once**, validated with zod, and nothing else reads
  `process.env`. Nothing connects to a database at import time.
- **Errors leave in one shape**, `{ error: { code, message } }`, and the
  message is a sentence a person can read.
- **Logs never carry an IP address or a full URL.** The request serializer
  writes the route pattern instead.
- **Strict security headers.** The site loads nothing from anywhere else, so
  the content security policy is `default-src 'self'`.

### What the database enforces itself

The old application enforced most of its rules in JavaScript. The rebuild
also enforces the critical ones in the database, so a forgotten check in
some future code path is an error rather than a corrupted archive:

- `reports`, `logbook_forms`, `attachments`, `report_attachments`,
  `consent_texts` and the anchor tables are append-only.
- Every new report must link to the current head of its own logbook (or its
  genesis), in a launched logbook. The link hash itself is a CHECK.
- A form version's hash is checked against its own text.
- `answers` is NULL or a non-empty object, never `{}`.
- A publication answer must reference card wording the server recorded.
- A logbook's slug never changes; a launched logbook is never unlaunched or
  deleted; its questions never change after launch except by adding an
  optional one.

The content hash itself cannot be checked in SQL, because RFC 8785 lives in
the application. The verifier and the chain file checker cover it.

## The website

- **Vite + React 19 + TypeScript.** A single-page app served as static
  files. There is no server rendering: it would add a second runtime and
  hosting assumptions, and fight the password gate.
- **TanStack Router** (file-based, typed routes and params) and **TanStack
  Query** (server state). Every API call goes through `call(contract, …)` in
  `src/lib/api.ts`, which validates the response too.
- **Tailwind v4 with tokens as CSS variables**, so an operator's palette
  reaches every screen at runtime by changing variables on `:root`.
- **shadcn/ui conventions** for components: Radix primitives for behaviour
  and accessibility, copied into `src/components/ui/` and owned by this
  repository rather than hidden in a dependency.
- **Fonts are bundled.** No request leaves the site's own origin.
- **Verification runs in the reader's browser as well as on the server.**
  The verify page recomputes the fingerprint from the bytes it shows, with
  the same `@reportlog/seal` code.

## Boundaries

`.dependency-cruiser.cjs` turns structural promises into build failures:
shared packages import no Node built-ins; `fields` can never reach `seal`;
lists can never reach the chain, even transitively; the seal and chain code
can never reach revocable permissions; packages never import apps; the
website never imports the server; and any import the checker cannot resolve
is itself an error, because an unresolved import is one no rule can see.
Each rule was checked by planting a violation and watching it fail.

## Where the rebuild deliberately differs from the old code

The sealing code reproduces the old code's fingerprints byte for byte (the
legacy vector tests). These are the exceptions, each a bug fix, and each
listed in the test that would otherwise flag it:

| Old behaviour                                                                            | New behaviour                       | Why                                                                                |
| ---------------------------------------------------------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------- |
| A blank number answer was sealed as `0`                                                  | Not answered                        | `Number('')` is 0. Not answering is not zero                                       |
| An unparseable time ("noon") was sealed as typed                                         | Not answered                        | A time question seals a time or nothing                                            |
| An incomplete third-party block was silently dropped                                     | The filing is refused               | Dropping it sealed a coordinator's filing as first-hand                            |
| The attestation time was sealed in whatever form the client sent                         | Sealed as UTC ISO with milliseconds | The verifier rebuilds it from a timestamp column and must get the same string back |
| A text question with a maximum length of 0 fell back to the default by accident (`\|\|`) | Falls back on purpose, written out  | The behaviour is unchanged; it is now stated                                       |

## Choices still open

- **File storage provider.** S3-compatible and in the EU. Code against the
  S3 API.
- **Bundle size.** The website's main bundle is about 128 kB gzipped, mostly
  React, the router and zod. Worth revisiting (`zod/mini`, splitting the
  contracts) once real screens exist.
- **Container image versus systemd** on the Hetzner server: the operations
  workstream decides.
- **GitHub Actions are pinned by major version**, not commit hash. Pin them
  by hash before the first production deploy.
