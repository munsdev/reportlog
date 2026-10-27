# FT-U1 · Looks: palettes, themes, packs, header background, headline fitting

Branch `claude/ft-u1-looks`, from the integration branch. Names for the shell
workers: see "Tokens and components" below (the same text was in
`TOKENS.md` in the worktree).

## What was built

**Look pack format 2** (`packages/contracts/src/look/pack.ts`). Extends format
1; nothing replaced. `FORMAT = 2`, `READS = [1, 2]`. A format 1 pack still
passes and paints byte for byte as before (the suite proves it against the
reference implementation in `docs/design/looks`). `check()` refuses a format 1
pack that uses a format 2 field, with a sentence ("... needs a pack in format 2. Set "format" to 2."). New, all optional:

- theme `display`: line height, section-heading width and weight, headline fit
  range and band fit range (px), second line (`outline|muted|solid|action`),
  tag (`bar|rule|plain`), button case, button radius;
- pack `shapes` (id to `{v, d}`: viewBox and path data, path characters only,
  150 KB each, 8 a pack), `elements` (`ruled|stars|stripes|shape`, shape
  height, style, drift depth, 12 a pack), `credit`.
  Header kits are served as `/api/looks/<pack>/<sha256-of-content>.json`
  (computed from the stored manifest; no migration for packs), listed on the
  site payload as `look.kits`. Replacing a pack gives the kit a new address.

**Core pack** gains `display` blocks on every theme (values from the mock-up's
themes where they match; button case and radius kept equal to what existing
themes already did, so no existing look changes), the `ruled` element, a new
theme `compact-poster` ("Poster, tempered"), and the new default.

**Default look: Workstation** (palette `workstation` + theme `workstation`).
Platinum-grey page, charcoal deep bars, workstation blue action, amber on
charcoal; Courier Prime headings (typewriter), IBM Plex Sans body, Plex Mono
labels, title-bar panels, hard 3 px shadow, small radii. `DEFAULT_LOOK` for
new sites only. All pairs measured with `contrast()` (test), including the
status colours lifted on the deep ground in every light palette.

**Zones** (`components/ui/zone.tsx`, `[data-zone]` in `styles.css`):
`deep` re-points the page roles at the palette's deep roles; `page` restores
them (a light card on a dark ground). Owner's "One ground" via `whenSingle`.

**Headline fitting** (`components/ui/fit-headline.tsx`, `features/looks/fit.ts`):
the mock-up's algorithm with the DOM taken out; re-fits on width change, font
load, Easier reading and palette/theme change; typed line breaks kept; wraps
to two rows when one line would be small.

**Header background engine and editor**
(`features/looks/header-background/`): scene as data (`scene.ts`), React
renderer with parallax (`HeaderBackground.tsx`, `MotifHost`), editor in the
mock-up's order and words, 1600 px JPEG downscale (`image.ts`), kit loading
(`kits.ts`). Element switches, filled/outline for big shapes, image behind /
inside a shape / taped print, elements on top or image only, colour / mono /
darkened, strength, focus, fade (side, bottom, spotlight, none) with strength,
per-element drift (engine and stored option; no UI, the mock-up has none),
motion off under reduced motion, "Still", and Easier reading.

**Server**: migration `20261027015200_look_options.sql` adds one nullable
`site_settings.look_options jsonb`. Owner-only routes `PUT
/api/admin/site/look-options`, `PUT|DELETE /api/admin/site/header-image`;
`GET /api/site/header-image/:file` (behind the site password, this origin).
The image goes through the same re-encoding pipeline as organization logos
(EXIF stripped), kept in the renditions bucket as `headers/<random>.jpg`,
deleted through the deletion queue when replaced or removed. Only the stored
file is served; `image.file` in a save must equal the uploaded one. The lock
screen and doors get no options or kits.

**Look screen** (`routes/(staff)/settings/look.tsx`): new panels Header
background, Motion, Section grounds, and a Save button, owner only (others see
the current state in words). The preview frames draw the draft header
background (a hero sample was added to `PreviewPage`). The look switcher
exists only here; nothing on a public page.

**Civic pack**: `/home/user/reportlog-ops/docs/build/packs/civic/` (`look.json`,
`build.sh`, `civic-poster-1.0.0.zip`, `README.md`), left uncommitted. Pack id
`civic-poster`, look id `civic-poster`, palettes `civic-night`, `civic-navy`,
`civic-old-glory`, theme `poster`, elements `stars`, `stripes`, `liberty`,
`usa`. README says how to install and which settings match the mock-up.

## Tokens and components (for U2, U3, U4)

Colour roles unchanged. NOTE: the mock-up's `--rl-border-main` is a colour; in
the code it is the line WIDTH. Mock colour = `--rl-text`/`--rl-text-on-deep`.

| Variable                                        | Meaning                                            |
| ----------------------------------------------- | -------------------------------------------------- |
| `--rl-display-lh`                               | big headline line height                           |
| `--rl-headline-stretch`, `--rl-headline-weight` | h2/h3                                              |
| `--rl-fit-min/-max`, `--rl-band-min/-max`       | fit ranges, px (unitless)                          |
| `--rl-radius-btn`, `--rl-btn-transform`         | button corner and case (`.button-face` reads them) |

Attributes on `<html>`: `data-second`, `data-tag`, `data-zones`,
`data-motion`, plus the existing layout ones.
`<Zone tone="deep|page" whenSingle? ruled? raised? as? zones?>`.
`<FitHeadline lines={[string | {text, two?}]} as? band? maxSize? className? id?>`
and `<p className="rl-tagline">`. `<MotifHost slot="hero|band|cover" n? options?
kit? className>` / `<HeaderBackground>` / `<HeaderBackgroundEditor header
onChange kit onPickImage onRemoveImage imageMessage busy>`.
`getSite().look` carries `second, tag, options{zones,motion,header}, kits`;
`getSiteEditor()` carries `look_options`.

## Decisions taken

- **New default without touching a column default.** A migration may not
  change a column default or update rows, so a new database's settings row
  still holds Newsdesk. The setup wizard's look step starts from
  `DEFAULT_LOOK` when the stored pair is the previous default
  (`PREVIOUS_DEFAULT_LOOK`) and saves what is chosen. Existing sites are
  untouched. Gap: a new site that skips the wizard's look step stays Newsdesk.
- **Existing themes keep their buttons.** The mock-up's Signal has pill
  buttons and Desk uppercase; core themes here keep what the app already
  drew. The Poster theme in the Civic pack has the mock-up's values.
- **Per-element depth** is in the engine and the stored options, not in the
  editor (the mock-up's editor has no control for it).
- **Zones on dark palettes**: a "page" zone on a dark palette is the palette's
  dark page, so alternate is dark/darker there.
- `MotifHost slot="hero"` was wrapped around the front page's headline block
  (`features/home/FrontPage.tsx`, U2's area, minimal) so the header
  background shows on the existing front page and the browser test can prove
  it. U2 will replace this with its own front page.
- The setup wizard (`features/identity/SetupWizard.tsx`), `site.tsx`,
  `LookPreview.tsx`, `looks.ts` and `test/site-fixture.ts` got small edits.

## Wording that differs from the mock-up

None known. The mock-up's Look page lists "Installed look packs" as demo text;
the real list and upload are the existing `LookPacks` panel.

## Not done

- No UI for per-element depth.
- Palette/theme selects on the mock-up's Look page are the existing chooser,
  not restyled.
- The header image editor on the front page block ("Edit header background")
  is the same component; wiring it into the block editor is U2's.
- The Civic pack is not committed (the integrator commits it).
