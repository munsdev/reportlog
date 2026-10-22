# Interface redesign, stage 1 · The look system: status

- **Branch:** `ccr-f0849029-ebgrpd`, from `design/interface-handoff` at `dfcf775`.
- **State:** built; not merged. Stage 1 of six in `docs/design/README.md`.
- **Scope:** stage 1 as the design states it: the look pack ported, the built-in pack generating
  the stylesheet, the new theme variables and derived colours, the nine font families bundled, Red
  Hat Mono retired, `panelHead` and `texture` sent and set on `<html>`, and the migration that keeps
  existing sites on Flint and Signal. No screen was redesigned.

## What was built

### The pack, in `packages/contracts/src/look/`

- `pack.ts` is `docs/design/looks/look-pack.mjs` ported to TypeScript: `check()`, `toCss()`,
  `derived()`, `contrast()`, the ranges and the pairs. `check()` takes `unknown` and reads every
  field through small narrowing helpers, so a look.json whose `palettes` is a number is refused
  with a sentence rather than thrown on. The sentences are the reference's, word for word.
- `core.ts` reads `reportlog-core.look.json` (JSON import, as `packages/fields` does its
  gazetteer) into `PALETTES`, `THEMES`, `LOOKS`, `DEFAULT_LOOK` (Desk), `LEGACY_LOOK` (Flint and
  Signal) and `RETIRED_IDS` (`migration.json`). The two JSON files are copies of the ones in
  `docs/design/looks/`; a web test fails if they differ.
- `Look` in `site.ts` is now two ids checked against a pattern rather than a `z.enum`, as the
  design asks, so packs can add ids without a deploy. `Site.look` is a `PaintedLook`, which adds
  `panel_head` and `texture`.

### The stylesheet

- `apps/web/src/looks.gen.css` is `toCss(CORE_PACK, (id, f) => './' + f, { root: true })`,
  written by `pnpm --filter @reportlog/web looks:css` and imported by `styles.css`. It is
  generated rather than built on the fly so it can be read; `test/ui/look.test.ts` fails when it is
  stale, and also runs the reference `look-pack.mjs` against the port and requires the same answer
  and the same CSS.
- `styles.css` keeps only what no pack states: the three derived colours (`--rl-text-on-deep-muted`,
  `--rl-background-deeper`, `--rl-border-on-deep`, the same mixes `derived()` measures) and the
  Tailwind names. New names: `deeper`, `line-on-deep`, `font-label`, and `text-title` for the
  fluid page title. The body text size is the theme's, set on `body` rather than `html` so a larger
  size does not also stretch every rem of spacing.
- Page titles (`<h1 className="font-display text-3xl ...">`, 16 of them, the `Page` component's
  among them) use `text-title`. The filing card's `text-2xl` heading is a question, not a page
  title, and is unchanged.

### Fonts

24 WOFF2 files, 1.1 MB in all, the exact files the pack names. Provenance, licences and what was
done to each are in `apps/web/src/fonts/README.md`. In short: IBM Plex is shipped as IBM published
it, because Plex is a Reserved Font Name and the OFL forbids a modified version keeping it; the
others are instanced from Google Fonts' variable sources and subset to Latin and Latin Extended.

### The server

- `resolveLook()` reads a retired id as its replacement; `validateLook()` accepts one and saves the
  replacement (an old settings tab keeps working). `paintedLook()` adds the theme's layout.
- Migration `20261022045623_look_library.sql`: column defaults become `platinum` and `desk`, and an
  installation with no owner that still has `flint`/`signal` moves to Desk. One with an owner keeps
  what it stores. Types were regenerated and did not change.
- **Decision 60, the part stage 1 needs.** `GET /api/site-access/status` now always carries `look`,
  and the gate paints it. Without this, moving `:root` to Desk would have changed every existing
  site's lock screen and doors to Desk for a first-time visitor. What decision 60 also names, a
  pack's stylesheet address on that call, waits for stage 6, when there are packs.

## Checks

The three suites, on a baseline worktree at `dfcf775` and then on this branch. `pnpm check` needs
`NODE_OPTIONS=--max-old-space-size=8192` in this container: eslint runs out of heap at the
default, on the baseline too.

| Suite          | Baseline `dfcf775`     | This branch            |
| -------------- | ---------------------- | ---------------------- |
| `pnpm check`   | green                  | green                  |
| `pnpm test:db` | 1367 in 90 files       | 1373 in 90 files       |
| browser        | 1045 passed, 5 skipped | 1045 passed, 5 skipped |

New tests: `packages/contracts/test/look-pack.test.ts` (the built-in pack passes; each refusal in
`docs/design/checks.md` §01 with its sentence; the stylesheet); `apps/web/test/ui/look.test.ts`
rewritten around the pack; the migration's two cases and the retired-id read and write in
`apps/api/test/db/site.test.ts`; the look on the status call in `q1-decisions.test.ts` and on the
lock screen in `lock-screen.test.tsx`.

## Not done, and why

- **The axe run in every look** (`checks.md` §03) is for the screens; it belongs with stages 3 to
  5, when there is something new to check. The existing axe checks still run, in the default look,
  which is now Desk.
- **Easier reading** and **pack installing** are stage 6.
- **Nobody has looked at it on a phone.** The suites prove the CSS is what the pack says; they do
  not prove Desk reads well on the screens that exist today, which were drawn for Flint and Signal.

## For the owner

- A site that chose one of the old palettes or themes changes look: each maps to its nearest new
  one by `migration.json` (Harbour, Dusk, Graphite and Slate all become Darkroom, for example). A
  site on Flint with Signal, or that never chose, does not change.
