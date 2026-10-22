# REPORTLOG DESIGN

## T H E L O O K S Y S T E M

**Palettes, themes, named looks, and look packs an operator can add without a deploy**

21 October 2026 · for the build in `apps/web` and `apps/api`

---

### 01

### W H A T C H A N G E S , A N D W H A T D O E S N O T

**The two axes stay**

**KEPT**

A palette owns every colour. A theme owns type, shape and width and sets no colour. Any palette works with any theme. The look is applied by `data-palette` and `data-theme` on `<html>`. Nothing computes a colour at run time. Serious is always a red, confirmed always a teal. Dark mode is a palette the operator picks, never `prefers-color-scheme`.

**CHANGED**

- The 18 palettes and 6 themes are replaced by 17 palettes and 10 themes, defined in `reportlog-core.look.json`.
- A third, optional layer: named **looks**, a palette and a theme offered together by name ("Newsdesk", "Civic"). An operator can still pick any palette with any theme.
- Palettes, themes and looks become **data**. The built-in set is a look pack like any other, so an uploaded pack and the shipped one pass the same check.
- Themes gain settings the redesign needs: label font, label case and tracking, body size, fluid heading size, press depth, panel heading style, page texture.
- Red Hat Mono is retired. IBM Plex Mono is the mono face.

**THE DEFAULT**

The ReportLog default is the look **Newsdesk** (palette Newsdesk, theme Newsdesk): an old-school newspaper with a terminal on the desk. Big Newsreader headlines, IBM Plex Mono for labels, references and dates, rules between sections instead of boxes, one wide column, large type. It replaced Desk as the default on 22 October 2026 (migration `20261022155312_newsdesk_default.sql`, which moves only an installation with no owner yet). No installation is special in the code: a voting site is one that picks the look **Civic** (Flint with Signal).

---

### 02

### T H E F I L E S I N T H I S F O L D E R

**Data, a reference implementation, and its output**

| File                       | What it is                                                                      |
| -------------------------- | ------------------------------------------------------------------------------- |
| `reportlog-core.look.json` | The built-in pack: 9 font families, 18 palettes, 11 themes, 17 looks            |
| `look-pack.mjs`            | Reference `check()` and `toCss()`. No dependencies. Port it; do not reinvent it |
| `looks.css`                | What `toCss()` writes for the built-in pack, for comparison                     |
| `migration.json`           | Old palette and theme ids to new ones                                           |

`node look-pack.mjs check reportlog-core.look.json` prints `OK: 18 palettes, 11 themes, 17 looks.`

---

### 03

### T H E P A C K F O R M A T

**One `look.json`, plus `fonts/*.woff2`, in a zip**

**TOP LEVEL**

`format` (1), `id`, `label`, `version` (like 1.2.3), `author`, then any of `fonts`, `palettes`, `themes`, `looks`. Ids are lower-case letters, digits and hyphens, 2 to 40 characters, unique across every installed pack. A pack never says whether it is built in: that is the caller's to say (`check(..., { builtIn })`), and a `builtIn` key in an uploaded pack is refused.

**FONTS**

`{ family, licence, files: [{ file: "fonts/X-400.woff2", weight, style, stretch? }] }`. A family name is letters, digits and spaces only; weight is one or two numbers from 100 to 900; style is normal or italic; stretch one or two numbers from 62 to 125. Nothing that reaches the stylesheet can hold a quote, a brace or a URL. WOFF2 only, checked by its first four bytes. At most 1 MB a file, 10 MB and 120 files a pack. A theme may name a family from its own pack or any installed one.

**PALETTES**

`{ id, label, description, dark, colors: { the 17 roles } }`. Three more are derived and never stated: `text-on-deep-muted` (82% mix, as today), `background-deeper` (the open menu: deep mixed 70% with black) and `border-on-deep` (hairlines on the deep surface).

**THEMES**

```
type:  heading { family, stretch?, weight, case, tracking }  tracking -0.05 to 0.05 em
       body    { family, stretch?, size }          size 15 to 20 px
       label   { family, stretch?, case, tracking } buttons, tabs, eyebrows, form labels
       mono    { family }
       h1      { min, max }                         rem, phone to desktop, written as clamp()
shape: radius, radiusSmall, border, shadow, press   px
panelHead  plain | title-bar | double-rule | bar | rule | prompt
texture    none | ruled | grid | dots
width      narrow | regular | wide | full          optional (see below)
pageMax    640 to 1280                             px, optional: the older way to give a width
columns    single | split                          optional, default split
scale      standard | large                        optional, default standard
surface    outlined | filled | ruled               optional, default outlined
```

`panelHead`, `texture`, `width`, `columns`, `scale` and `surface` choose between layouts the app already has; they are sent with the look in `GET /api/site` (and with the lock screen's status) and set as `data-panel-head`, `data-texture`, `data-width`, `data-columns`, `data-scale` and `data-surface` on `<html>`. A pack picks one of each; it cannot describe a new one.

**THE LAYOUT FIELDS** (added 22 October 2026, so every one is optional and a pack written before them still passes; an absent one means what every page did before)

- `width`: how wide the page runs. `narrow` 760px, `regular` 1000px, `wide` 1200px, `full` edge to edge less a margin that grows from nothing on a phone to 4rem on a large screen. A theme states `width` or `pageMax` (or both, and then `width` decides). A theme with only `pageMax` keeps that exact width; its `data-width` is the nearest name.
- `columns`: whether a page's two-part regions (marked `.layout-split` in the app: the board's cards, the guides' contents beside the guide, the settings panels) sit side by side on a desktop (`split`) or stack in one wide column (`single`). A phone is always one column.
- `scale`: `large` makes titles (×1.2), the lede (×1.12) and body text (+1px) bigger, puts more room between a page's sections, and makes buttons and fields taller. The theme's own fluid title is what grows.
- `surface`: how a raised panel is drawn. `outlined` is an edge and the theme's hard shadow. `filled` is a soft panel with no edge and a gentle shadow, so a page reads as a few surfaces rather than boxes in boxes. `ruled` is a rule across the top and nothing else, like a newspaper section; with `panelHead: double-rule` the rule is double.

Rounding reaches every part: panels and dialogs take `radius`; buttons, fields, choices and toasts take `radiusSmall`; chips and counts take a pill radius written by `toCss()` (square when `radiusSmall` is 0, fully round when `radius` is 12 or more, otherwise `radiusSmall`). A stylesheet an installed pack was given before the pill existed falls back to `radiusSmall`.

**THE BUILT-IN THEMES**

| Theme      | width   | columns | scale    | surface  | corners     |
| ---------- | ------- | ------- | -------- | -------- | ----------- |
| Newsdesk   | wide    | single  | large    | ruled    | 4 / 3, soft |
| Desk       | regular | split   | standard | outlined | 2 / 2       |
| Signal     | wide    | single  | large    | filled   | 16 / 10     |
| Broadsheet | wide    | single  | large    | outlined | square      |
| Broadcast  | wide    | split   | standard | filled   | square      |
| Docket     | narrow  | split   | standard | outlined | square      |
| Notebook   | regular | split   | standard | outlined | 4 / 3       |
| Trailhead  | wide    | split   | large    | filled   | 16 / 10     |
| Firm       | full    | split   | standard | filled   | 8 / 6       |
| Console    | narrow  | split   | standard | outlined | square      |
| Commons    | regular | single  | large    | filled   | 18 / 12     |

**LOOKS**

`{ id, label, palette, theme }`. Only the built-in pack may carry `default: true`.

**WHAT A PACK CAN NEVER CONTAIN**

CSS, JavaScript, SVG, images, URLs, or any file other than `look.json` and `fonts/*.woff2`. The server writes the stylesheet from checked values. This is how the no-third-party rule survives operators adding looks: there is no field a URL could go in.

---

### 04

### T H E C H E C K

**Every pack, built-in or uploaded, passes `check()` or is refused whole**

**COLOUR**

Every pair in `TEXT_PAIRS` at 4.5:1, 7:1 for a palette whose id starts `contrast`. Control edges at 3:1. Serious red (hue 340 to 20, saturation over 0.3, so a grey cannot pass as red), confirmed teal (hue 140 to 200, saturation over 0.15). `dark` must match the page. These are the app's existing rules in `test/ui/look.test.ts`, plus the pairs the redesign adds: brand on light, and text on the open menu.

**SHAPE AND TYPE**

Every number inside its range (`RANGES`), every choice inside its list (`ENUMS`), every font family provided. A theme that contains a colour is refused.

**FILES**

Only `look.json` and `fonts/*.woff2`; WOFF2 by magic bytes; size limits. Paths are checked before anything is unpacked: no `..`, no absolute paths, no links.

**THE ANSWER**

A list of sentences, each naming the palette or theme and the pair or value. Nothing is installed unless the list is empty. The same sentences appear on the upload screen and the command line.

---

### 05

### I N S T A L L I N G A P A C K

**Two ways in, one installer**

**ON THE LOOK SCREEN**

Settings › Look › "Add looks from a file". Owner and administrators. Takes a `.zip`. Shows the check's answer before anything is saved; on success, lists what the pack adds and offers "Install". Needs a step-up (decision 50), because it changes every public page.

**ON THE SERVER**

`pnpm --filter @reportlog/api look:add path/to/pack.zip`, and `look:list`, `look:remove <id>`. Same installer, same check, same messages.

**WHERE IT LIVES**

A new table `look_packs` (id, version, manifest jsonb, css text, installed_at, installed_by) and the font bytes in `look_pack_files` (pack_id, path, sha256, bytes). A new migration file; nothing existing is edited.

**HOW IT IS SERVED**

`GET /api/looks/<pack>/<sha256>.css` and `/api/looks/<pack>/<sha256>.woff2`, cached forever because the name changes when the content does; `toCss()` is called with a `fontUrl` that returns those hashed names. Caddy already sends `/api/*` to the app, so the Caddyfile does not change. The page links the stylesheet of every installed pack after the built-in one.

**ON A DOOR AND THE LOCK SCREEN**

Those pages never call `GET /api/site`, so they would not learn which pack stylesheet to load, and a site wearing a pack look would show the default there. The door-safe call that already answers on a door returns the pack stylesheet's address alongside the form, and `IN_FRONT` gains `GET /api/looks/*`. The lock screen stays plain unless the owner approves the decision 3 reversal in `screens/public.md`.

**THE BUILT-IN PACK**

Built into `styles.css` at build time by the same `toCss()`, called with `fontUrl = (id, f) => './' + f` so the fonts are the bundled files in `apps/web/src/fonts` (Vite rewrites the paths), and with the default look's blocks also written as `:root`. It never depends on the database, so a site with no packs, or a broken one, still has a complete look.

**UPDATING AND REMOVING**

A pack with the same id and a higher version replaces the old one. A pack whose palette, theme or look is in use cannot be removed until the site picks another; the screen says which. Installing, replacing and removing are each recorded with who did it.

**THE CONTRACT**

`Look` in `packages/contracts/src/site.ts` stops being a fixed `z.enum`: `palette` and `theme` become ids checked by the server against the built-in pack plus installed packs. `resolveLook()` keeps its rule: a name with no CSS falls back to the default rather than painting nothing.

**WHAT REPLACES `PALETTES` AND `THEMES`**

The two arrays become the built-in pack's lists, generated from `reportlog-core.look.json` into `packages/contracts` at build time (ids, labels, descriptions, `dark`, and the `background` and `deep` literals). The web manifest reads `background` and `deep` from whichever pack holds the site's palette, built-in or installed, so a phone's status bar follows a pack look too. `test/ui/look.test.ts` is rewritten around `check()`: offered and painted still agree in both directions, now for the built-in pack's JSON and `styles.css`.

---

### 06

### T H E M I G R A T I O N

**Every stored choice keeps a look**

Old ids are mapped on read by `resolveLook()` (and written back the next time the look is saved), using `migration.json`. Flint and Midnight keep their names and values exactly. Signal keeps its name; its values gain the new settings with its current look unchanged.

**AN EXISTING SITE THAT NEVER CHOSE A LOOK**

Today the default is Flint with Signal, and a site that never saved a look is wearing it by default. When the default becomes Desk, that site would change overnight, a voting site included. A site may also have saved only one axis (`validateLook` allows a palette without a theme), and the missing one would switch to Platinum or Desk. So the migration that ships this change writes `flint` into a missing palette and `signal` into a missing theme, for any installation that has an owner. A brand-new installation, with no owner yet, gets Desk. This is a new migration file and a data change, not a schema change.

**WHAT CHANGES FOR A SITE ON SIGNAL**

Signal keeps today's corners, shadow, border and width. Two things change on purpose: page titles are fluid (2rem to 3rem) instead of a fixed 1.875rem, and the mono face is IBM Plex Mono instead of Red Hat Mono.

**22 OCTOBER 2026: SIGNAL GROWS UP, NEWSDESK BECOMES THE DEFAULT**

The owner asked for real variance between themes rather than one narrow column with a 2px difference. Signal is now wide, one column, large and filled, with round corners (16 / 10), so a site on Signal does change: on purpose, because the narrow look was the complaint. The default became Newsdesk; an installation with an owner keeps what it stores. The named looks once called after a deployment are now **Civic** (`civic`, Flint with Signal) and **Civic at night** (`civic-night`, Midnight with Signal). Only palette and theme ids are ever stored, never a named look's id, so nothing maps the old look ids.

---

### 07

### E A S I E R R E A D I N G

**A switch for the reader, not the operator**

In the menu and the footer: "Easier reading". It sets, for this browser only, the High contrast palette (or High contrast dark, when the site's palette is dark) and the Commons theme: 7:1 colour, Atkinson Hyperlegible, 18px text. Stored in `localStorage` under `rl-easy`, wrapped in try/catch, and applied before first paint by the same code that applies the remembered look. It never changes what anyone else sees.

---

### 08

### K N O W N L I M I T A T I O N S , P R E C I S E L Y

- The font licences are stated from what is known of each family. Each file has to be checked against its actual licence when it is downloaded and bundled.
- `look-pack.mjs` checks fonts by magic bytes and size only. It does not parse the font. A malformed WOFF2 reaches the browser, which refuses it and falls back.
- Phosphor's action green sits near the confirmed teal. Confirmed chips always carry the word, so meaning never rests on colour, but the two are closer than in any other palette.
- Flint's gold on its own page is 1.7:1. A button is found by its outline, which every theme draws in the text colour (components spec, Button). A pack palette with a pale action relies on the same rule.
- Fluid headings are computed between 390px and 1280px wide. Outside that range they stop at the theme's minimum and maximum.
- Uploading needs a zip reader on the server. Which library is not decided; it must refuse paths outside the pack before writing anything.
