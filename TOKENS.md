# U1 looks: tokens and components for the shell workers

Branch `claude/ft-u1-looks`. Everything below is in the tree now; names are
stable. Nothing here is a hex value: use these, never a colour or size of
your own. `apps/web/src/styles.css` (token section at the top) is the source.

## Colour roles (unchanged names, set by the palette)

`--rl-background`, `--rl-background-alt`, `--rl-background-deep`,
`--rl-background-deeper`, `--rl-surface`, `--rl-border`, `--rl-text`,
`--rl-text-alt`, `--rl-text-muted`, `--rl-text-on-deep`,
`--rl-text-on-deep-muted`, `--rl-border-on-deep`, `--rl-action`,
`--rl-on-action`, `--rl-brand`, `--rl-brand-on-deep`, `--rl-serious`,
`--rl-confirmed` (+ `on-` pairs). Tailwind: `bg-paper`, `bg-paper-alt`,
`bg-deep`, `bg-deeper`, `bg-surface`, `text-ink`, `text-ink-alt`,
`text-muted`, `text-on-deep`, `text-on-deep-muted`, `bg-action`,
`text-on-action`, `text-brand`, `text-brand-on-deep`, `border-line`,
`border-line-on-deep`.

Note for porting the mock-up: its `--rl-border-main` is a COLOUR; in the code
`--rl-border-main` is the line WIDTH (px). The mock's colour is `--rl-text`
(on light) / `--rl-text-on-deep` (on deep). Its `--rl-line` is
`--rl-border-main`. Its `--rl-shadow-color` is `--rl-text`.

## New theme variables (format 2, `look/pack.ts` displayLines())

| Variable                         | Meaning                                             | Mock-up name      |
| -------------------------------- | --------------------------------------------------- | ----------------- |
| `--rl-display-lh`                | big headline line height (unitless)                 | `--d-lh`          |
| `--rl-headline-stretch`          | h2/h3 width axis, `%`                               | `--h-stretch`     |
| `--rl-headline-weight`           | h2/h3 weight                                        | `--h-weight`      |
| `--rl-fit-min`, `--rl-fit-max`   | front-page headline fit range, px (unitless number) | `--fit-min/max`   |
| `--rl-band-min`, `--rl-band-max` | section band headline fit range                     | `--band-min/max`  |
| `--rl-radius-btn`                | button corner (falls back to `--rl-radius-sm`)      | `--rl-radius-btn` |
| `--rl-btn-transform`             | button text case (falls back to the label case)     | `--btn-case`      |

Already there and used by the headline: `--rl-font-display`,
`--rl-h1-weight`, `--rl-display-stretch`, `--rl-display-transform`,
`--rl-h1-tracking`, `--rl-radius`, `--rl-radius-sm`, `--rl-border-main`,
`--rl-shadow-offset`, `--rl-press`, `--rl-page-max`.

Theme attributes set on `<html>` (by `applyLook`, and on a preview frame by
`paintFrame`): `data-second` = `outline|muted|solid|action` (second headline
line), `data-tag` = `bar|rule|plain` (tagline), plus the existing
`data-panel-head`, `data-texture`, `data-width`, `data-columns`,
`data-scale`, `data-surface`; and new `data-zones` = `alternate|single`,
`data-motion` = `on|off`.

## Zones: `components/ui/zone.tsx`

```tsx
<Zone tone="deep">             // the palette's deep ground; everything inside re-points
<Zone tone="page" whenSingle="deep" ruled>   // light band; stays dark when "One ground"
<Zone tone="page" raised>      // a LIGHT CARD on a dark zone (hard edge + shadow)
```

Props: `tone: 'deep'|'page'`, `whenSingle?: 'deep'|'page'`, `ruled?: boolean`
(rule above, in the text colour), `raised?: boolean`, `as?: ElementType`,
`zones?` (preview override), plus div props. Reads the owner's choice from
the site. Inside a zone use ordinary `bg-paper text-ink bg-surface`: the
roles are re-pointed, no class of your own. CSS: `[data-zone='deep']`,
`[data-zone='page']`; the page's own colours are kept in `--rl-page-*`.
`<Zone tone="deep">` as the whole `<main>` makes a "loud" near-black page.
`zoneTone()` is exported and pure.

## Headline: `components/ui/fit-headline.tsx`

```tsx
<FitHeadline lines={['Report what', { text: 'you saw', two: true }]} />
<FitHeadline as="h2" band maxSize={72} lines={['Section']} className="..." />
```

Props: `lines: (string | {text: ReactNode; two?: boolean})[]` (one entry per
typed line break), `as?: ElementType` (default `h1`), `band?: boolean`
(smaller range), `maxSize?: number` (px), `className?`, `id?`. Re-fits on
resize, font load, Easier reading, palette/theme change. Class `rl-display`.
Tagline under it: `<p className="rl-tagline">…</p>` (bar / rule / plain by
theme). Fit arithmetic: `features/looks/fit.ts` (`decideFit`).

## Header background: `features/looks/header-background/`

```tsx
import { MotifHost, HeaderBackground, HeaderBackgroundEditor } from '@/features/looks/header-background';
<MotifHost slot="hero" className="py-16">…headline, buttons…</MotifHost>
<MotifHost slot="band" n={2}>…</MotifHost>      // a section band
<MotifHost slot="cover">…</MotifHost>           // ruled lines only
```

`slot: 'hero'|'band'|'cover'` (only `hero` shows the picture), `n?` (which
header on the page, so two draw different stars), `options?`/`kit?` (preview
override), `className`. It reads the site's `look.options` and `look.kits`;
it is its own stacking context (`.rl-motif-host`), `aria-hidden`, pointer
events none, hidden under Easier reading, still under reduced motion or
"Still". Never put one behind form questions or report text. Put it inside a
`<Zone>`; it draws in that zone's text colour. "Edit header background" on a
front page block: render `<HeaderBackgroundEditor header onChange kit
onPickImage onRemoveImage />` or link to the Look screen.

## Look options on the site payload

`getSite().look` (a `PaintedLook`) now also carries `second`, `tag`,
`options: { zones, motion, header }` and `kits: string[]` (header kits of
installed packs). `getSiteEditor()` carries `look_options` (whole).
Routes (owner only): `PUT /api/admin/site/look-options`,
`PUT|DELETE /api/admin/site/header-image`; `GET /api/site/header-image/:file`
serves the picture (behind the site password, this origin only).

## Default look

`DEFAULT_LOOK` is now `workstation` palette + `workstation` theme (old-school
workstation, typewriter headings, title-bar panels). New sites only: a site
that already stores a look keeps it.
