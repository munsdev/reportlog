# Browser tests

The checks that need a real browser and a real database: that a focused
control is actually visible, that choosing an answer does not move the page
under you, that a screen reader is told when an error appears, that the
progress rule never runs backwards.

`npm test` at the repo root covers the pure logic — hashing, validation,
taxonomy. It cannot cover any of the above, because none of it exists until a
browser lays the page out.

## Running them

Start the app:

    PORT=3000 npm start

Then, from this folder:

    npm install
    CHROMIUM_PATH=$(ls -d /opt/pw-browsers/chromium-*/chrome-linux/chrome | head -1) \
      npm test -- --base=http://localhost:3000

**`CHROMIUM_PATH` is not optional wherever Playwright's own browser is not
installed**, which includes every development container this project has
run in. Without it the suite does not fail — it DIES, with Playwright's
"Executable doesn't exist / run npx playwright install" banner, which names
nothing to do with these tests and reads like the suite is broken. The
invocation above is the one to use; it finds whichever build is installed
rather than naming one that will be wrong after the next image.

If a browser really is installed where Playwright looks for it, the
variable can be dropped and `npm test -- --base=...` is enough.

Exits non-zero if anything fails, so the result can be trusted rather than
read.

**The deployment has to be unlocked and already set up**, or the first suite
dies on `[data-nav="submit"]` not being visible and reads like a broken suite
rather than a missing prerequisite. On a freshly migrated database it is
neither: the curtain is up, and with no owner yet the setup wizard covers the
page. These suites mock the API; they do not drive the wizard to get past it.

    UPDATE site_settings SET access_enabled = false, setup_completed_at = now()
      WHERE id = true;

A development database only. That takes the password off the whole
deployment, which is the one thing a real one must never do.

## What is covered

- **form.test.js** — one question per screen, choosing never advancing or
  rearranging, ticks rather than colour alone, announced errors, focus
  following the card, the future-date cap, the timing qualifiers, provenance
  appearing only for a secondhand account, the category checkboxes taking any
  number, the review listing everything, the Change links, and a real
  submission. Plus axe-core on every card.
- **nav.test.js** — the bar fitting on one row from 320px up, the site name
  going home, the progress rule filling forwards only across a branch that
  adds a question, staying in view scrolled down a long card, reverting on
  the way out, and the Submit buttons that replaced the one in the bar.
- **site.test.js** — everything that is not the form itself, and the
  biggest of the three. axe-core across every public page; the border and
  divider contrast sweep; anchors landing below the sticky bars rather than
  behind them; About as one document with its contents strip, its section
  numbers and its separators keeping their own spacing; the guide at
  `/how`; the standards tabs, each admitting it is empty; the Get involved
  form and its three spam measures; the password gate, including arriving
  at the one open page and pressing Back; and the public API with its
  widget, checked against a host page whose styles are deliberately
  hostile.

Several of these exist because something shipped broken and looked fine:
the changelog tab that was `hidden` and still rendered, the dividers that
lost their margin to a more specific rule, the Back button that walked
straight past the password. Each of those passed every check that existed
at the time.

## Two things worth knowing

**Google is blocked at the browser.** The site loads its typefaces from
Google Fonts; on a machine that cannot reach them every page waits out a
timeout and the run takes twenty minutes instead of two. None of these tests
measure type, so the requests are refused outright.

**axe-core is a floor, not a ceiling.** It does not judge whether a focus
ring is *visible*, which is how the Back and Next buttons went two releases
with no ring at all while every automated check passed. Look at the thing.
