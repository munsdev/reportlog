# Interface redesign, stage 6 · Look packs and Easier reading: status

- **Branch:** `worktree-agent-aa1563bea2c09424f`, from `ccr-f0849029-ebgrpd` at `18e8c55` (thread E
  of five, built beside threads A to D).
- **State:** built; not merged. Stage 6 of six in `docs/design/README.md`.
- **Scope:** `docs/design/looks/README.md` sections 03 to 07 and `docs/design/checks.md` section 01
  PACKS and section 03 EASIER READING: the pack tables, one installer behind the upload route and
  the command, serving pack files under `/api/looks/`, the upload component, and the Easier
  reading switch and its logic. The Look screen itself, the menu and the footer belong to other
  threads; what they must wire in is at the end.

## What was built

### The server, in `apps/api/src/looks/` (new)

- **`zip.ts`, the zip reader.** Written here rather than taken from a library (see the decisions
  below). It reads the central directory first and refuses the whole archive, before one byte is
  inflated, for: `..`, `.` or empty path parts, a leading `/`, a backslash, a drive letter, a
  control character or anything outside printable ASCII in a name; a symbolic link or any entry
  that is not a file or a folder; the same name twice; encryption; ZIP64; a split archive; a
  method other than stored or deflate; more entries, or more declared bytes, than a pack may hold;
  and entries whose data overlap. Only then does it inflate, with Node's zlib, into memory, each
  file stopped at the size it declared (`maxOutputLength`), and checked against its CRC and its
  local header. Nothing is ever written to disk, by it or by anything after it.
- **`shape.ts`.** What `check()` leaves to its caller: only the fields the format names, and
  labels, descriptions, the author and `dark` of the right type. Without it a pack whose palette
  said `"dark": 0` (which `check()` reads as false) would install and then make `/api/site` fail
  its own response schema on every page.
- **`packs.ts`, the one installer.** `inspectPack` (read, never write): the zip reader, then
  `check()` against the built-in pack plus every other installed pack, then `shapeProblems`, then
  what only this site can say: the built-in pack's id, a missing version, a replacement that is
  not a higher version, a palette or theme id that a site may still have stored from before the
  look library (`migration.json`), a font family that is built in or comes with another pack (two
  `@font-face` sets for one family would let a pack restyle other looks), and a replacement that
  drops something still needed. `installPack` and `removePack` run in one transaction under an
  advisory lock and write `role_audit` (axis `site`, action `change`, "installed the look pack
  tideline 1.0.0", "replaced … with …", "removed …") with the signed-in address, or
  `the server (look command)` from the command line. "Still needed" means: the site wears one of
  its palettes or themes, another pack's theme uses one of its fonts, or another pack's look names
  one of its palettes or themes. The stylesheet is `toCss()` with
  `fontUrl = /api/looks/<pack>/<sha256>.woff2`, stored with its own hash.
- **`routes.ts`.** `GET /api/looks/:pack/:file` serves `<sha256>.css` or `<sha256>.woff2`, by
  hash only, `cache-control: public, max-age=31536000, immutable`; anything else is a 404. The
  admin scope is `roleGuard(['admin'])` (the owner satisfies it): `GET /api/admin/looks`,
  `POST /api/admin/looks/check`, and in a nested scope with `stepUpGuard()`,
  `POST /api/admin/looks` (install or replace) and `DELETE /api/admin/looks/:id`.
- **`command.ts`, `cli.ts`.** `pnpm --filter @reportlog/api look:add <pack.zip>`, `look:list`,
  `look:remove <id>`. Same installer, same sentences. A relative path is read from where the
  person was (`INIT_CWD`), not from `apps/api`, where pnpm runs the script.

### The migration, `20261022080605_look_packs.sql`

`look_packs` (id, version, manifest jsonb, css, css_sha256, installed_at, installed_by) and
`look_pack_files` (pack_id, path, sha256, bytes), as the spec names them plus `css_sha256`. The
database holds its own rules too: id and path shapes, 1 MB a font, a WOFF2's first four bytes,
`reportlog-core` never stored, and a trigger refusing to delete a pack, or to replace it with one
that drops, a palette or theme `site_settings` is wearing. Types regenerated against a fresh
database (`rl_thread_e_types`, made and dropped for it).

### The look, wherever the server sends it

- `resolveLook`, `paintedLook`, `validateLook` and `buildManifest` (`site/look.ts`,
  `site/manifest.ts`) take a catalogue, the built-in pack plus the installed ones
  (`lookCatalogue(db)`), defaulting to the built-in pack alone. A stored id from a removed pack
  still falls back to the default rather than painting nothing.
- `PaintedLook` gains two optional fields, always sent by the server: `dark` (so Easier reading
  can pick High contrast dark for a palette from a pack) and `stylesheets` (every installed pack's
  stylesheet address). Both `GET /api/site` and the password-status call carry them, which is
  decision 60's "that pack's stylesheet address" for the lock screen and the doors.
- `IN_FRONT` gains `GET /api/looks/:pack/:file`.
- The web manifest takes `background_color` and `theme_color` from whichever pack holds the
  site's palette.
- Setting the look accepts installed ids.

### The website

- **`features/looks/`**: `AddLookPack` (choose a .zip with `FileDrop`; the check's sentences
  grouped by palette or theme, nothing installed; or what the pack adds, its looks as cards, and
  Install, which asks for the step-up through the API client), `InstalledLookPacks` (the built-in
  pack, each installed pack with version, who and when, why it cannot be removed today, and
  Remove), `lookPacksQuery`, and `stylesheets.ts`, which links the pack stylesheets last in
  `<head>` and refuses any address not shaped `/api/looks/<pack>/<sha256>.css`.
- **`features/easy-reading/`**: `easyReading.ts` (`rl-easy`, every storage call in try/catch with
  an in-memory fallback, the `storage` event so other tabs of the same browser follow) and
  `EasyReadingSwitch` (`role="switch"`, named "Easier reading", showing "Easier reading: Off").
- **`components/ui/site.tsx`, touched minimally:** `applyLook` now paints through `easyLook()`
  and links the pack stylesheets, and remembers the site's own look (never the Easier reading
  one), with its stylesheets, so both happen before the first paint. `repaintLook()` is new and
  runs when Easier reading is switched. A look the page makes itself (the setup wizard's) names no
  stylesheets and leaves the linked ones alone.

## Decisions taken while building, for the owner to see

- **The zip reader is our own, about 200 lines on Node's zlib, with no dependency.** The
  candidates were `yauzl` (maintained, refuses `..` and absolute names by default, but streams
  through callbacks and leaves symlinks, duplicate names and overlapping entries to the caller)
  and `fflate` (fast, but `unzipSync` inflates everything and leaves path checks to the caller).
  A look pack needs a small, fixed subset of zip, and needs more refused than either refuses by
  default; every refusal here has its own test (`test/unit/look-zip.test.ts`, 32 cases).
- **Who did it goes in `role_audit`** (axis `site`, as the site password's changes do), not a new
  table: it is already append-only, and it is where the people who grant access read who changed
  what. `look_packs.installed_by` keeps only the latest installer.
- **The zip travels as base64 in JSON**, not as a raw body as logos do, so the step-up retry in
  `lib/api.ts` covers it with no second upload path. A third more on the wire, on a 10 MB limit.
- **Every installed pack's stylesheet is sent, on `/api/site` and in front of the password**, not
  only the one the site wears: the Look screen's previews need every pack's blocks, and a pack's
  colours and fonts are not what the password protects.
- **Stricter than `check()`:** unknown fields anywhere in look.json are refused, a family that is
  already provided is refused, a retired built-in id is refused, a version is required, and a
  replacement must have a higher one.
- **No colour samples before install.** The upload card lists looks in words; a component may not
  paint a colour of its own (`test/ui/client-first.test.ts`), and before installing there is no
  stylesheet to paint one with. After installing, the Look screen shows the looks through the
  pack's stylesheet.
- **Templates still take built-in looks only.** `site/templates.ts` calls `validateLook` without
  the catalogue: a shipped template that named a pack's palette would depend on a pack being
  installed. One line to change if the owner wants it.
- **`/api/looks/*` answers GET only in front of the password.** Fastify's automatic HEAD route is
  not named in `IN_FRONT`, so it stays behind it.

## Checks

Not the full suites: threads share this container, so the browser suite could not run, and the
others were run file by file as the brief asked.

| What                                                                                                                                  | Result                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `tsc` for contracts, api, web (e2e included)                                                                                          | clean                                                               |
| eslint and prettier on every changed file                                                                                             | clean                                                               |
| `pnpm boundaries`                                                                                                                     | no errors; the one existing orphan warning (`public/boot-guard.js`) |
| api unit, whole project                                                                                                               | 501 passed, 21 skipped (one run); see below                         |
| web unit, whole project                                                                                                               | 397 passed                                                          |
| contracts unit                                                                                                                        | 23 passed                                                           |
| db: look-packs, second-factor, q1-decisions, site, doors, setup, setup-wizard, deploy-templates, migrate, deploy-schema-drift, guards | all passed (look-packs 32)                                          |

New tests: `apps/api/test/unit/look-zip.test.ts` (32), `look-shape.test.ts` (6),
`apps/api/test/db/look-packs.test.ts` (32), two entries in `LISTED` in `second-factor.test.ts`
(installing or replacing, removing), `apps/web/test/easy-reading.test.tsx` (12),
`apps/web/test/look-packs.test.tsx` (13). Two existing assertions on the exact painted look
(`q1-decisions.test.ts`, `site.test.ts`) now include `dark` and `stylesheets`.

A second api unit run, under heavy load from the other threads (load average 13), timed out in
`deploy-install.test.ts` and `deploy-bugsink.test.ts`, which shell out to a sandbox and were not
touched here; the first run passed them.

The bad pack (`apps/api/test/fixtures/looks/bad/`) is refused with each sentence `checks.md`
names: a stylesheet in the zip, a fake WOFF2, a duplicate id, text under 4.5:1, a blue "serious",
an unknown font, a radius out of range, a non-built-in default; through the check route, the
install route and the command. The good pack (`…/good/`) installs, is offered, paints, is served
from this site only and in front of the password, is replaced only upward, and is removed only
once nothing needs it.

**Written, not run:** `apps/web/e2e/look-packs.spec.ts` (a pack's palette painted through its
stylesheet, every pack request on this host, the files' hashed names and caching, the remembered
look bringing the stylesheet back before the site answers) and `apps/web/e2e/easy-reading.spec.ts`
(on, survives a reload, another browser untouched, High contrast dark on a dark site, the page
renders when localStorage throws). The second needs the switch in the footer first.

## For the lead to wire in

- **Look screen (thread D):** at its foot, in a `SettingPanel` for the owner and administrators,
  `<AddLookPack onInstalled={(pack, replaced) => toast(…)} />` then `<InstalledLookPacks />`, both
  from `@/features/looks/`. Both take no other props. The picker should offer installed looks
  too: `useQuery(lookPacksQuery)` from `@/features/looks/queries.ts` gives each pack's `looks`,
  `palettes` (with `dark`) and `themes`; their stylesheets are already linked on every page, so
  `data-palette` on a preview frame paints them.
- **Menu row 3, the phone sheet (thread A):** `<EasyReadingSwitch onDeep />`; **footer:**
  `<EasyReadingSwitch />`, from `@/features/easy-reading/EasyReadingSwitch.tsx`. Each instance
  follows the others. The e2e spec looks for it inside `contentinfo`.
- After merge: regenerate `schema.gen.ts` if another thread added a migration; run all three
  suites. `access.spec.ts` lists the calls a door page makes; if a pack is installed while it
  runs, `GET /api/looks/:pack/:file` would appear there. `look-packs.spec.ts` removes its packs in
  `afterAll`, and the identity project runs after the desktop and phone ones, so it should not.

## Not done

- No screen places the upload component or the switch yet (other threads' files).
- Nobody has opened the upload component or the switch in a browser; the unit tests render them
  in jsdom only.
- Fonts are checked by their first four bytes only, as the spec says; a malformed WOFF2 reaches
  the browser, which refuses it.

## Something to know about the container

The shared Postgres was down when this started (a stale socket, no server process). It was
started again as the `postgres` user with the same command `.claude/hooks/session-start.sh` uses.
