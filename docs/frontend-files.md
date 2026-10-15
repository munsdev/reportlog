# The frontend, file by file

`public/index.html` was 10,455 lines: the markup, a 1,374-line `<style>`
block, and a 6,540-line `<script>` holding every screen. It is 2,567 lines of
markup now, and the rest is real files the browser loads.

**There is no build step and there must not be one.** Nothing here is
compiled, bundled or minified. What is in the file is what the browser runs,
which is why you can read a stack trace and land on the line that threw.

## Why the markup did not move

Every pane is in the DOM from the first byte. That is not a performance
choice — while the site is gated, the lock screen is the only thing between a
visitor and the site's writing, and a pane fetched on demand would be a pane
the gate has to be trusted to never fetch. So the markup stays in one file,
and only the rules and the code came out.

## The stylesheets

They load in this order and the order is load-bearing:

| File | What it decides |
|---|---|
| `public/fonts/fonts.css` | The typefaces, served from this server rather than Google. |
| `public/tokens.css` | **The look.** Every palette and every theme. |
| `public/css/page.css` | The shell: the element reset, the nav bar, the panes, a panel's rhythm, the controls, the focus rings. |
| `public/css/form.css` | The reporter's card form, through the receipt. |
| `public/css/reports.css` | A report as it is drawn: its answers, the card, the modals, attachments, prose. |
| `public/css/pages.css` | The About document's components, the home page, the footer, and print. |
| `public/css/gate.css` | The lock screen and the setup wizard. |
| `public/css/directory.css` | The Alliance directory. |
| `public/css/issues.css` | The bug tracker's issue card. |
| `public/css/shell.css` | The site chrome: the menu, the brand, the progress rule, the corner cluster, edit mode. |
| `public/css/changelog.css` | The changelog. |
| `public/css/numbers.css` | The numbers view: stat boxes, provenance pills, filter counts. |
| `public/css/map.css` | The map view: the two planes, the territory tiles, the legend and the readout. |
| `public/css/standards.css` | Standards, and the volunteer form's groups. |
| `public/client-first.css` | **The layer.** Structure, spacing, the type scale. Loaded last so a utility class beats a component's own rule. |

The ones in the middle are **one contiguous slice each of the block they came
out of, in the order they were in**. That is the whole reason the split was
safe to do: no rule moved past any other rule, so the cascade is what it was.

**Moving a rule between them can change what a screen looks like.** If two
rules of equal specificity set the same property, the later one wins, and
"later" now means "in a file linked further down". Add rules to the file whose
subject they are; do not reorder.

`panels.css` was a grab-bag and is gone: on 29 September it was cut into the six
files above at the seams between its subjects, **in the same order**, so the
cascade is what it was. What is left in each is a real component of this
app (a report card, the site chrome, a stat box) with no equivalent in the
layer; those keep their own classes, which is what Client-First expects of a
custom component.

## The modules

Twenty-two ES modules, listed in `public/index.html` in the order they were
written, all `type="module"`. (`public/js/` also holds two plain scripts that
belong to the other pages — see the policy section below.)

| File | ~lines | Holds |
|---|---|---|
| `answers.js` | 144 | A report's answers as a person reads them, and `esc`. |
| `nav.js` | 426 | The tab bar, accepting an invitation, the Alliance directory, page titles, the progress rule, `showPane`. |
| `routes.js` | 337 | Verification, the standards tabs, volunteering, confirmation links, a permalink, the router. |
| `session.js` | 307 | Who is signed in, the nav menu, signing in with a code, the shared reason modals. |
| `attachments.js` | 380 | Uploading, the public gallery, a moderator's review of it. |
| `form.js` | 212 | Submitting, and the card machinery. |
| `form-logbook.js` | 757 | The spine every report is asked, a logbook's own questions, the review card. |
| `board.js` | 369 | The public board, the filter popovers, printing under § 1746. |
| `map.js` | 615 | The map view: two planes, the territory tiles, the readout. Loads Leaflet and the outlines on first open. |
| `mine.js` | 281 | My Reports: own submissions, erasure, corrections, notifications, the moderator modals. |
| `moderate.js` | 269 | By the numbers, and the moderator queue. |
| `admin-look.js` | 470 | Starting points, site copy, the look and its preview, the staff portal, sub-navigation. |
| `admin-settings.js` | 387 | Recruiting, accepting reports, the imprint, the name, publishing, attachment settings. |
| `logbook-builder.js` | 374 | Building a logbook, and launching it. |
| `admin-lists.js` | 400 | The Admin page's Lists tab: making a list, its switches, its questions, its counts. |
| `list-review.js` | 170 | Approving list entries in bulk, on the Moderators page. |
| `list-form.js` | 390 | A list's form at /list/:slug, one question per card, and the front-page buttons. |
| `roles.js` | 434 | Roles, organizations, oversight, the owner's seat. |
| `directory.js` | 168 | Invitations, and the Alliance listing. |
| `feedback.js` | 441 | The feedback tracker, edit mode, the development badge, the issues list. |
| `contents.js` | 306 | The contents strips: About's, and the guide's. |
| `gate.js` | 181 | The password gate, the legal text, the intake switch, and `checkSiteAccess`. |
| `identity.js` | 151 | The deployment's own look and its own name. |
| `setup.js` | 462 | First-run setup, and lifting the curtain. |
| `boot.js` | 11 | One line: `checkSiteAccess()`. |
| `sw-register.js` | 20 | Registering the service worker. |
| `boot-guard.js` | 90 | Imports nothing, so it runs when the app's modules cannot link: refetches and reloads once, then says so rather than leave a white page. |

### They are listed, not reached through one entry point

`index.html` names all twenty-nine. It could have named `boot.js` alone and
let the imports pull the rest in, and that would have been wrong twice: a
module whose only job is to wire up a listener would never be reached, and
the browser would discover the files one waterfall at a time instead of
fetching them all at once.

### What the closure used to do, and what does it now

The old code was one `(function(){ … })()`, so its 336 names were private and
invisible. Names were never on `window` and must not start being: **the
escaping helper `esc` is the one that matters.** Every one of the 135 places
this app writes somebody else's words into the DOM goes through it, and a
global `esc` is a function that page-level code could replace with `s => s`.
In a module it has no name from outside.

Two things are deliberately on `window`, and the suite fails on a third:

- `window.STEPS` — the browser suite counts the form's cards with it.
- `window.howtocLabel`.

### Reading a module's imports

Each file states at the top what it needs from the others, which is the map
the closure never had. `nav.js` importing a render function from eleven other
modules is not a smell — it is `showPane` dispatching to every screen, said
out loud for the first time.

The import graph **has cycles**, because the real thing does: a screen calls
the router and the router shows screens. That is legal and works, because
nothing reads an imported value while its own module is still being
evaluated — the only code that runs at load time wires up listeners. Keep it
that way: **do not read an imported variable at the top level of a module.**
Call a function that reads it instead.

### Mutable state lives where it is written

A module cannot assign to a binding it imported. Where one file owned a
variable another file set, the declaration moved to the file that sets it:
`currentUser` to `session.js`, `reviewReturn` to `form-logbook.js`,
`SITE_TITLE` and `SOFTWARE_NAME` to `identity.js`, beside the `applyBrand`
that replaces them. The report count kept its home and gained
`setReportCount`, because the number belongs to the nav bar and the board is
what counts it.

## The Content-Security-Policy

This is the security half of the split, and the reason no inline script
survived it — not the eight lines registering the service worker, and not the
scripts on the other four pages either.

nginx serves `public/` off disk, so most pages are never rendered per request
and a nonce is not available to them. While any script was inline, every
policy a deployment could set had to allow `'unsafe-inline'`, which is most
of the way to no policy at all — and this app writes other people's words
into the DOM in over a hundred places.

```
script-src 'self'; object-src 'none'; base-uri 'self';
form-action 'self'; frame-ancestors 'none'
```

Set twice, in `server.js` and in `contrib/nginx/csp.conf` (included by `reportlog.conf`), because in
production nginx answers for `public/` and the app never sees those requests.
`npm test` reads both and fails if they disagree. **Inside an nginx
`location`, one `add_header` replaces every header inherited from the server
block** — so `= /sw.js`, which sets its own `Cache-Control`, carries its own
copy of the policy, and the suite checks there are at least two.

**What is deliberately not in it.** There is no `default-src`, so images,
media and fetches are unrestricted. Uploads go browser-to-bucket and
attachments come back from that bucket, whose origin is a per-deployment
setting: a directive naming it cannot be written once and shipped, and one
guessed here would break somebody else's installation in a way no test here
would catch. The four directives beside `script-src` cost nothing and were
each checked against the markup first — there is no `<object>`, no `<base>`,
no iframe and no cross-origin form anywhere in `public/`.

### The style half is `style-src 'self'`

No `'unsafe-inline'`. An injected `<style>` block, a stylesheet from another
origin, and an inline `style` attribute in markup are all refused. It took two
steps. First, four inline `<style>` blocks moved into files (`api.html`,
`app.html`, `docs.html`, `styleguide.html`, each now a `*-page.css`). Then, on
29 September, the **44 inline `style` attributes** went: the static ones became
classes (`btn2 solid`, `minh-60`, `link-muted`, `tone-*` for the pills a script
colours), eighteen `display:none` became the `hidden` attribute with the
JavaScript changed to set `.hidden`, and the three a script must compute (a
swatch's colour, an upload's width) are set through the CSSOM after rendering.

**The CSSOM is the way through.** The policy governs a `style=""` in markup and
`setAttribute('style', ...)`; it does not govern `el.style.width = '40%'`. So a
script that needs a computed value writes a `data-*` attribute into its string
and sets the property afterwards; see `attachments.js` and `admin-look.js`.

**Two things `npm test` now asserts, and one thing it cannot.** No page, module
or script string carries a `style` attribute. An element the markup hides with
`hidden` is never "shown" by `getElementById('x').style.display = ''`, which
would do nothing and throw nothing. What it cannot see is a `style=` assembled
from pieces; the browser suite fails the run if the policy refuses anything on
any page it loads, which is the check for that.
