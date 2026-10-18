# Building a screen — the Client-First layer

**See it first: `/styleguide` on any running deployment** (or
`/styleguide.html` straight off disk). Every colour, size and component on
one page, with the class names that made each one, and a bar at the top that
changes the palette and the theme so you can watch the whole thing follow.

`public/client-first.css` is the vocabulary screens are assembled from. It
is written to Finsweet's Client-First naming conventions, the ones the
Relume component library is built on, so a layout copied out of Relume lands
here with its class names already meaning something.

It holds no design decisions of its own. Every colour in it is a palette
token and every shape is a theme token, so an operator's chosen look reaches
a screen built out of these classes exactly as it reaches one built the old
way. `scripts/selftest.js` asserts both.

## The shape of every screen

Four classes, in this order, always:

```html
<div class="page-wrapper">
  <main class="main-wrapper">

    <section class="section_intro">
      <div class="padding-global">
        <div class="container-large">
          <div class="padding-section-medium">
            …
          </div>
        </div>
      </div>
    </section>

  </main>
</div>
```

- **`padding-global`** is the gutter down both sides. It is set in one
  place, so two screens cannot disagree about where the page starts. It
  carries the safe-area inset, so nothing sits under a phone's notch.
- **`container-small | medium | large`** is the measure. `container-large`
  is the **theme's** width — width belongs to the theme and each theme states
  its own — and the two narrower ones are for a column inside that.
- **`padding-section-small | medium | large`** is the air above and below a
  band. They shrink on a phone without anybody writing a breakpoint.
- **`section_<name>`** names what the band holds: `section_intro`,
  `section_board`. That name is what makes a long page readable in the
  markup.

## The classes

| Kind | Looks like | For |
|---|---|---|
| Structure | `page-wrapper`, `padding-global`, `container-large` | The page |
| Section | `section_board` | One band of a page |
| Component | `card_component`, `card_header`, `card_body` | A thing you could lift out whole |
| Variant | `is-raised`, `is-secondary`, `is-2col` | A combo class, always second |
| Type | `heading-style-h2`, `text-size-small`, `text-weight-bold` | How something reads |
| Colour | `text-color-muted`, `text-color-serious` | What a piece of text is *for* |
| Space | `margin-bottom margin-small`, `spacer-medium` | Gaps |
| Utility | `hide`, `align-center`, `max-width-medium` | One decided value |

Two rules keep it readable:

1. A class either says **what something is** (`report-card_component`) or
   applies **one decided value** (`text-size-small`). Never "this particular
   box on this particular screen".
2. A variant is a **second** class on the same element, never a new
   component: `class="button is-secondary"`.

### Spacing takes two classes

A direction and a size:

```html
<div class="margin-bottom margin-small">
```

The direction class zeroes the three sides you did not name, so the pair can
only ever set the edge you asked for. That is why those zeroes are
`!important` — they have to beat the size class, which sets all four.

### Type says how, the tag says what

`heading-style-h2` sets how something looks. The `<h2>` in the markup says
what it is. They are separate on purpose: a screen often needs an `h2` that
reads quietly, and the wrong fix is to make it an `h4` and break the outline
a screen reader announces.

## What not to do

- **Never type a colour.** Not a hex, not `red`. If the colour you want is
  not a token, it belongs in the palette. Every palette is in
  `public/tokens.css`; add the token to all of them, then check it on
  `/styleguide`, which draws each one from the stylesheet rather than from a
  list somebody maintains.
- **Never type a radius, a font family or a page width.** Those are the
  theme's, and a theme that could be overridden here would stop being a
  finished opinion.
- **Never add a value between two steps of a scale.** A gap of `1.25rem`
  where the scale offers `1rem` and `1.5rem` is a value somebody typed by
  eye, and the next one will be `1.3rem`. If a step is genuinely missing,
  add it to the scale at the top of the file so everything can use it.
- **Never style a bare element.** Every selector in the file is a class,
  which is the only reason it was safe to load before a single screen used
  it. The one fenced exception is prose inside `.text-rich-text`.
- **Never remove a focus outline.** Make it legible instead. The layer draws
  one on every control it defines.

## The three stylesheets

| File | What it decides |
|---|---|
| `public/tokens.css` | Every palette and every theme. Colour, type, borders, shadows, radii, width. |
| the files in `public/css/` | This app's own components, by subject. |
| `public/client-first.css` | Structure, spacing, the type scale, a few components. No colour, no shape. |

They load in that order, which is load-bearing twice over: the layer reads
tokens the look declares, and a utility class has to win over a component's
own rule — that is what a utility class is for, and it is Client-First's own
ordering.

The middle one used to be a `<style>` block inside `public/index.html`. It is
six files now, each a contiguous slice of that block in the order it was in,
so the cascade is unchanged — which also means **a rule moved between them can
change a screen**. `docs/frontend-files.md` says which file holds what.

`tokens.css` used to be inside the page. It moved out when a second and
third surface needed it — the layer and the style guide — because a second
copy of a colour is how two surfaces end up disagreeing about it.

**A surface that loads the layer needs its own element reset.** The layer
deliberately styles no bare element, so something has to say what an
unclassed paragraph or heading does, or the browser's default margins land
on top of the spacing the layer sets. `public/css/page.css` has one for the
app, and `public/styleguide.html` carries its own.

It is precached by the service worker alongside the page. **Bump `CACHE` in
`public/sw.js` when you change it**, or a reader with the app installed
keeps the old one.

## Converting a screen

One screen at a time, and the old rules stay untouched until the screen that
used them is gone. A half-converted screen is fine; a half-converted
stylesheet is not.

1. Rebuild the screen's markup on the four structure classes.
2. Replace its own rules with layer classes, one box at a time.
3. Delete the rules in `public/css/` that nothing uses any more — check
   first, since several screens share a class.
4. Run the three suites. The browser suite finds things by class name, so a
   renamed box shows up there.
5. **Look at it.** In a browser, at phone width and desktop, in a light
   palette and a dark one. The suites cannot see a screen that is merely
   ugly, and `axe-core` is a floor rather than a ceiling.

### Which screen to take first

**Take one the browser suite already walks.** `site.test.js` runs `axe-core`
over `/`, `/submit`, `/board`, `/verify`, `/about`, `/how`, `/standards`,
`/standards/evidence`, `/login`, `/impressum` and `/privacy`, so a conversion
that breaks the structure of any of those fails rather than merely looking
wrong. **`pane-mine` is covered by nothing** — if you convert that one, write
the test first.

**`pane-login` was the first, and is done** (29 September). What it taught,
for the next one:

- **The app's `.wrap` already is the gutter.** A pane sits inside it, so it
  takes `container-small` and `padding-section-small` and leaves out
  `page-wrapper`, `main-wrapper` and `padding-global`; adding them doubles the
  side padding. The four-class shape is for a page that owns its own shell.
- **`hidden` replaced `style="display:none"`**, and `session.js` sets
  `.hidden` instead of `.style.display`. That is the pattern for the other
  eighteen. It works because nothing in the layer sets `display` on a panel;
  a component that does would beat the attribute, so check before reusing it.
- **The error line became `form_error` with `is-shown` and `role="alert"`**,
  so a screen reader says it.
- **Nothing was deleted from `public/css/`**, as predicted: `.panel`, `.f`,
  `.lab`, `.hint`, `.go` and `.err` are all still used elsewhere.
- **It has its own browser test**, `tools/browser-tests/login.test.js`, because
  the suites walked the page but never clicked through the two steps.

The rest of this paragraph is why it was chosen. Twenty-eight lines, two panels, two
fields, three buttons and an error line: it exercises `.panel`, `.f`, `.lab`,
`.hint`, `.go` and `.err` — the vocabulary almost every other screen is built
from — without touching the reporting form or the board. Convert it, and the
next five screens are mostly recognition.

**`/how`, `/standards`, `/volunteer`, `/impressum` and `/privacy` are done** (29
September), in `tools/browser-tests/prose-screens.test.js`. They are prose, so
they use `text-rich-text` inside the same `container-small` shell as login.
Three things they taught: `.text-rich-text` now gives a heading air above it and
styles inline `<code>`; its paragraph gap had been losing to its own `margin:0`
resets, so consecutive paragraphs sat flush until this; and a card that
JavaScript writes into (`volunteer`'s confirmation) takes `text-rich-text` on
the card itself, because the `<h4>` arrives as a string with no class.
`.prose` and `.ab-card` stay: About, the moderator screens and the board still
use them. Leave `pane-about` (70 lines) and the reporting form until the
pattern is boring.

### What "done" looks like, and what it does not

**Done is: the screen is built from layer classes, it looks the same or
better, and the rules it used are either gone or still needed by another
screen.** Checking that second half is the step people skip — `grep` the class
name across `public/index.html` before deleting its rule.

**`public/css/panels.css` will not shrink on the first conversion, or
probably the second.** It is 233 lines of screens that were written last, and
its rules are shared. Do not read a first conversion that deletes nothing as
having failed: the deletions arrive once a class has no remaining user, which
is the third or fourth screen. The grab-bag dissolves by subtraction, late.

### Where the conversion stands

**Done on 29 September, across every screen, in the markup and in the strings
the scripts write:** the heading block; `.button` (was `.go`, `.btn2`);
`form_field-wrapper`, `form_label`, `form_help`, `form_input`, `form_select`,
`form_textarea` (was `.f`, `.lab`, `.hint` and the bare form-control
selectors); `panel_component` (was `.panel`); `form_error` (was `.err`);
`choice_item` (was `.ch`); `modal_overlay`, `modal_component`, `modal_field`,
`modal_actions`, `modal_title`; `tabs_menu`, `tabs_button`; `filter_bar`,
`search_bar`, `empty_component`; and `text-size-small text-color-muted` for what
`.sub` was. `panels.css` no longer exists; it was cut into six files by subject.

**What is left is not primitives.** It is this app's own components: the
report card and its pills, the reporter's card form, the setup wizard, the About
document, the site chrome, the stat boxes, the print sheets. The layer has no
equivalent and should not, and Client-First expects a custom component to keep
its own class. They are still in `public/css/`, by subject.

**Two aliases exist because scripts say them in hundreds of places.**
`.form_error.on` shows an error (the layer's own is `.is-shown`), and
`.modal_overlay.on` opens a modal. Changing either is a change to every script.

**How it was checked.** `tools/browser-tests/visual/shoot.mjs` screenshots
every screen and `visual/compare.mjs` compares two runs; the conversion was
done a stage at a time with a comparison after each.

### The inline styles are gone

The 44 inline `style` attributes were all removed on 29 September, in one sweep
rather than screen by screen, and `style-src 'self'` is on
(`docs/frontend-files.md` says how and what to do instead). So **a screen you
convert must not bring one back**: `npm test` fails on a `style=` in any page or
script string. Hide with the `hidden` attribute and set `.hidden`, never
`.style.display`, on anything the markup starts hidden; use a layer class for
anything static; and for a computed value set the property through the CSSOM.
