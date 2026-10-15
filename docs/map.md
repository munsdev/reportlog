# Heat maps

Where published reports came from. As many as an operator wants, each off
until they turn it on.

## There is more than one, and that is what the settings are for

A heat map is a row in `heat_maps` (migration 049): its own threshold, its
own logbooks, its own views, its own place on the site, its own address at
`/board/map/<slug>`. The first version was one site-wide map reading four
settings on `site_settings`, and that was wrong about where the settings
belong rather than about how many maps there should be.

**One map answers one question.** An archive collecting two kinds of thing
wants "where were the polling-place problems" and "where were the workplace
ones" side by side, at different thresholds, fed by different logbooks. A
single map with a reader-facing logbook switch is not the same feature: the
threshold and the outcome question are the operator's, and a reader who
could change them could undo the only thing the threshold is for.

**An operator makes them under Admin → Maps.** `src/heatMaps.js` is what
they may ask for; `src/mapData.js` is what a reader may see, and it
re-applies the three publication gates and the threshold from scratch on
every read. That split is why a mistake in the panel cannot become a
disclosure — the worst a wrong setting does is publish less than was meant.

**Which question places a report is the logbook's, not the map's.**
`logbook_fields.map_location` marks it, at most one per logbook, enforced by
a partial unique index: a logbook can ask where twice — where it happened
and where you live are different questions — but an aggregate that found
both would have to guess which one a report's area is. The flags sit beside
`filterable` rather than in `settings`, which is what lets a LAUNCHED
logbook be put on a map: neither is in the sealed form definition, so
marking one rehashes nothing. In `settings` it would have changed the form
hash every report of that logbook was sealed against.

## A list can feed one too

Migration 051. A map's feeds are two columns: `logbook_ids`, and
`list_ids`.

**Empty means the opposite thing in each, and that is deliberate.** Empty
`logbook_ids` means every launched logbook, which is what a deployment with
one kind of report wants. Empty `list_ids` means NO lists. Giving lists the
logbook rule would have opted every map that already existed into counting
entries the moment the migration ran — changing what a published map shows
on behalf of an operator who never chose it, and who may not know the lists
are being counted. Same reasoning as the front page's buttons: a thing made
later is added deliberately, never retroactively assumed.

**The gate is `review_state = 'approved'`.** Migration 046's own comment on
that column is "may this be counted". A list is approved in bulk rather than
one entry at a time — that is the format's defining trade — but it IS
approved, and there is no auto-count path any more than there is an
auto-publish path for a report.

**It reads `answers` and never `erasable_answers`,** and `location` is in
`IMPERSONAL_KINDS` so a place code lands in the durable half. The reason is
the one `src/lists/fields.js` already gave for `place` being personal and a
`choice_one` not: prose names streets, and one code from a closed
vocabulary does not. A location answer is the second of those — the
vocabulary comes from the map's own outlines, so the finest thing it can say
is the finest thing a map can draw. What protects a thin area is the
THRESHOLD, which sends an area under it with no count at all; erasing the
code would protect nobody it protects and would make a published count
quietly shrink months later with nothing saying why.

**AN ENTRY IS STILL NOT A REPORT.** It is a second query with its own gate,
not a `UNION` with the reports one, because the two have different gates and
carry different columns and must stay legible as two things. What they share
is the tally, which was only ever counts. The aggregate also sends a `unit`
— "published reports", "approved entries", or "published reports and
entries" — so the page never calls an entry a report.

**No outcome view from a list.** There is no `map_outcome` on `list_fields`
and that is not an omission. The Outcome view colours by a judgement a
moderator made about one entry; a list is approved in bulk, so no such
judgement exists. A column here would invite a view whose colour means
nothing.

**The outcome denominator is `assessed`, not `n`.** Only rows from the
outcome logbook can carry a stance. The page divided by every row in the
area, so on a map fed by more than the outcome logbook every other row
dragged the colour toward neutral — wrong before lists existed, and
impossible to miss once a list is one of the feeds. An area with nothing
assessed is unshaded rather than placed at zero, which is "evenly split" and
a different claim.

## The question that feeds it

**`location`, not `place`.** `place` seals whatever somebody typed, and
"Phoenix", "phoenix az" and "Phoenix, Arizona" are three answers about one
place that no care downstream turns into a count. `location` seals a code
from a fixed list — `US-AZ`, `DE` — so an area is countable and rolling a
state up to its country is a prefix.

**The list is the map's own outline data**, derived by
`tools/build-gazetteer.mjs` from `public/geo/maps.json`. Either direction of
drift is silent: a code a form can seal but no map can draw puts reports in
a place that never appears, and a code a map can draw but no form can seal
is an area that reads as "nothing happened there". Deriving one from the
other makes both impossible, and `npm test` notices if somebody stops.

**A code is never removed from the gazetteer.** A sealed answer holds it
forever, so everything tolerates a code it cannot name and shows the code
itself.

## A map is a widget, so it can be on a page more than once

`src/mapSlots.js` is the list of places a map can go — five, each a point
the interface actually has, not a page builder. `public/index.html` holds
ONE map as a `<template>`, cloned per map, and everything inside it is
addressed by `data-map="..."` rather than by id.

**That is not tidiness.** Every part used to be an id, which is exactly as
many maps as a document can have — and worse than a limit, because the
second map's code would have found the FIRST map's legend and painted the
wrong one with nothing in the console. `map.css` uses classes for the same
reason, and writes the canvas height as `.map-stage .map-canvas` so it does
not depend on loading after `leaflet.css` to win.

**Leaflet and the outlines are shared.** Two maps on a page cost one
download between them, and a map is fetched only when the screen holding it
is opened — a front-page map must not load because somebody opened the
board, which is why a slot carries which pane and tab it is on.

## Two planes, because they answer two questions

The **US plane** is the contiguous 48 and DC in an Albers projection,
filling the panel so the states are as large and as tappable as they can
be. **Alaska, Hawaii and the five territories are tiles beneath it**, not
insets on it.

That last part took three attempts and the reason is worth keeping. On
one canvas those seven compete with Texas for room, so whatever they get
is too small — the Northern Marianas are a hundred-kilometre chain of
twenty-kilometre islands and cannot be drawn in a cell that also has to
leave the lower 48 legible. Moving them off the canvas made the states
about 55% bigger: California went from 154 plane units across to 240, DC
from 2.8 to 4.4, Rhode Island from 11 to 17 — which is the difference
between tappable and not. And a tile is not pretending to be geography,
so "that is not where it is" does not apply to it; it is a list of places
that happens to carry shapes.

Three tiles show a principal island — St. Croix, Saipan and Tutuila —
because the full island group renders as a scatter of specks at that
size. **The counts are for the whole territory** and the panel says so.

**FIVE OF THE SEVEN TILES ARE DRAWN FROM SUPPLIED OUTLINES**, in
`tools/data/territories/`, rather than from the national boundary file.
That file is simplified for drawing a whole country; its idea of a
twenty-kilometre island is a handful of points, and a tile is the one place
a twenty-kilometre island is the entire picture. Alaska and Hawaii are
still projected from it, because at their size it has the detail.

**A SUPPLIED FILE IS CHECKED BEFORE IT IS USED**, against the same island
out of the national file projected azimuthally. It compares THE PRINCIPAL
ISLAND, not the whole group, and the distinction is the point: two files
disagreeing about whether a rock three hundred kilometres away belongs to
the territory is an inventory difference, while the question worth asking
is whether the outline is that island's shape or a sheared version of it.
Five percent of slack, because two surveys at a thousandfold difference in
detail do not agree to the digit — a coastline has no single true length.
Shear is tens of percent.

American Samoa's outline includes an island the national file leaves out,
roughly three hundred and fifty kilometres north of the rest, which is why
the principal-island rule matters as much as ever: it decides the framing,
and taking one island makes a disagreement about the others moot.

**THE SUPPLIED BOXES ARE PADDED AND NOT EVENLY**, so each tile's viewBox is
recomputed tight to what it actually draws. Left alone, American Samoa drew
in the corner of its tile with most of the square empty — which reads as a
small island rather than as a wrong box.

**EACH PROJECTED TILE USES PARALLELS TAKEN FROM ITS OWN LATITUDE, and
until 13 October it did not.** It used `geoAlbers()` with the rotation
overridden, which keeps Albers's parallels — 29.5°N and 45.5°N — and its
centre near 38.7°N, because those are the numbers that draw the United
States. Guam is at 13°N and American Samoa at 14°S. A conic projection read
twenty-five to fifty degrees from its parallels shears what it draws, so
those tiles were not the islands' shapes at all. Alaska and Hawaii were the
least wrong and looked fine, which is how it survived.

> **AND THIS FILE CARRIED A NUMBER THAT CAME OUT OF THE FAULT.** It said
> Tutuila is "about six to one, which is simply the shape of the island".
> It is not: the island's bounding box is about two to one, and six was
> what the wrong projection drew. A measurement taken off a broken tool
> reads exactly like a fact about the world. Every tile's ratio is now
> checked against the same shape under an azimuthal equal-area projection
> centred on it, which is the local truth, and they agree to two decimal
> places.

The **world plane** is Equal Earth with every country in its true place.
Equal-area on purpose: a common alternative gives northern countries
several times the visual weight their counts deserve, and when the
shading *is* the data, a map that exaggerates it is worse than no map.

## No tiles, and no network

There is no tile layer and there is not going to be one. A tile request
tells a third party which states the readers of an incident archive are
looking at; every deployment would make it on behalf of an operator who
never chose it; and the policy deliberately names no outside origin. The
outlines are projected at build time by `tools/build-geo.mjs` and served
from this origin. Open the page with the network unplugged and the map
still draws.

Leaflet and the outlines are about 600 KB between them and are **loaded
on the first open of the view**, never with the shell. Nothing of this
view is requested while the site is gated.

## The threshold

A single report in a thinly covered place can identify the person who
filed it. An area is shaded only at `k` or more published reports;
the default is 3 and **the floor of 2 is a CHECK constraint in the
database**, not only a route's opinion. A threshold of 1 is not a low
threshold — it is the feature switched off while still claiming to be on,
and it would publish "one report came from here" for every thin area at
once. It is checked in the panel, by the constraint, and clamped again in
the aggregate: the only setting on that panel whose wrong value is a
disclosure rather than a broken page.

**It is per map.** The same archive drawn at 3 and at 10 is two maps, and
the cache is keyed by slug so one is never served the other's answer.

**An area under the threshold is sent without its count.** This is the
point of the mechanism, and getting it wrong is easy: a payload carrying
"Wyoming: 1" and a page that politely declines to draw it has still
published the number, in a network tab. A suppressed area travels as a
bare code. Same care one level up — with exactly one suppressed area the
subtotal *is* its count, so the server sends `reports: null`.

What a reader can learn about a suppressed area is that it holds between
one and `k − 1` reports. That is the intended disclosure.

**One residual leak, stated rather than hidden:** an area crossing the
threshold between two readings tells a daily watcher that a report
arrived there. At `k = 3` that is the third report's area. It is small,
it is the price of the feature, and an operator in a small jurisdiction
should know it before switching the map on.

## The colours

Three scales, declared once in `tokens.css` as a fourth meaning-set after
gold, teal and crimson — the same in every palette, because a scale that
varied with the operator's palette would make two deployments' maps
incomparable.

The map borrows none of the existing three: gold is the action you came
to take, teal means a moderator confirmed this, crimson means serious.
An area wearing one of those would be saying something the map does not.

**The outcome scale is diverging AND monotonic in lightness**, and that
is the part not to undo. A symmetric diverging ramp is dark at both ends,
so when hue collapses the ends collapse onto each other: simulated,
green-to-red *inverts* the polarity for a deuteranope — the most positive
area renders darker than the most negative, which is not a degraded map
but a wrong one. Lightness carries the axis for everyone and hue carries
it as well for those who see it. The cost is that the middle step does
not look neutral, so the legend labels it "evenly split".

## What the reader controls, and what they do not

The reader gets two switches: what the colour shows, and which map. The
threshold, which views are offered and which question supplies the
outcome are the operator's and arrive in the payload. There is no
reader-facing control for any of them — a reader who could lower the
threshold could undo the only thing it is for.

**A link can carry those two switches and nothing else.**
`?map=<slug>&plane=world&view=outcome&area=US-AZ` opens a named map the way
a reader could have opened it by clicking. `map=` says which map the rest
apply to, which is what keeps it unambiguous when there are several on a
page. There is deliberately no `threshold=`, and `area=` naming a
SUPPRESSED area selects nothing — a URL is the one input a reader controls
completely, and selecting such an area would draw a readout for a place
whose count was deliberately not sent.

**Clicking an area hands the board a filter, as a real address.** The
aggregate carries `filter_key`: the one answer key every logbook feeding
this map seals its place under, or null where they disagree. Null means no
link rather than a wrong one — a filter on `where` would silently drop
every report from a logbook that called it `location`. `/board` reads the
filters it already offers out of its own URL, so the link is shareable and
can reach no state a reader could not reach from the filter panel.

## Severity is its own view, never a weighting

Weighting the outcome by severity was considered and rejected. The
arithmetic is five lines; the cost is that the hover readout stops
explaining the colour, and that one channel ends up carrying both the
reporter's sealed answer and a moderator's mutable judgement with nothing
saying which half is which. As its own view it costs less and stays
explicable.

## Traps, each of which cost real time

- **Never write a Leaflet path's whole `class` attribute.** Leaflet puts
  `leaflet-interactive` on it and that class is what makes a shape
  clickable at all. `classList` only.
- **`map.setView()` before adding any layer.** Leaflet queues every
  `addLayer` behind `whenReady` and a map is not ready without a centre
  and a zoom; without it the layers sit in the queue and the shading
  paints onto nothing.
- **`maxBounds` applies to `fitBounds` too**, and `getBoundsZoom` clamps
  to the *current* `minZoom`, which for `CRS.Simple` defaults to 0. Clear
  the cap, drop the floor, measure, set the floor, fit, put the cap back
  — and on an animated fit put it back on `moveend`, or `panInsideBounds`
  cancels the animation.
- **A step class must out-specify the base class.** `.map-area.map-s3`,
  never `.map-s3` alone, or every area renders empty while carrying the
  right class.
- **`touch-action` on the map container.** An id selector beats
  `.leaflet-container`'s own `touch-action: none`, the browser takes the
  gesture, and on a phone there is no drag and no pinch on the one thing
  that needs them.
- **Leaflet's z-indexes outrank the site bar** — panes 400–700, control
  corners 1000. The map gets its own stacking context (`position:
  relative; z-index: 0`) so every z-index inside it is measured against
  the map. A bigger number on the bar is a race nobody wins.
- **`L.circleMarker` renders as a `<path>`, not a `<circle>`.** A test
  looking for circles finds nothing and reports a clean zero.
- **Nothing inside a map may be found by id.** There can be several on a
  page. An id lookup from the second map's code finds the first map's
  element and paints the wrong one, silently — `data-map="..."` inside that
  map's own root, always. `npm test` asserts both halves: no ids on the
  map's parts in the markup, and no `byId('map-…')` in the module.
- **`touch-action` still has no rule in `map.css`, and must not get one.**
  A selector that beat `.leaflet-container`'s own `touch-action: none` would
  hand the gesture to the browser, and on a phone there would be no drag and
  no pinch on the one thing that needs them. This used to read as a note
  about id specificity; the ids are gone and the warning is not.
