# REPORTLOG DESIGN

## C H E C K S

**What must pass before the redesign ships, and which suite proves it**

21 October 2026 · in addition to `pnpm check`, `pnpm test:db` and the browser suite as they stand

---

### 01

### T H E L O O K

**Unit tests, `apps/web/test/ui/look.test.ts`**

**COLOUR**

Every palette in the built-in pack passes the ported `check()`: the existing pairs, the added pairs (brand on light, text on the open menu), edges at 3:1, serious red, confirmed teal, the dark flag. The two `contrast` palettes at 7:1.

**THEMES**

No theme block names a colour. Every font family a theme names is bundled. Every number inside its range.

**GENERATED CSS**

`styles.css`'s palette, theme and font blocks equal `toCss(reportlog-core, (id, f) => './' + f, { root: true })` exactly, so nobody edits them by hand. The default look's blocks are also `:root`.

**MIGRATION**

Every id in `migration.json` resolves to a built-in palette or theme. A stored old id paints the mapped one. A site with an owner and no stored look paints Flint and Signal after the migration; a fresh install paints Desk.

**PACKS**

The deliberately bad pack in the test fixtures is refused with each of these sentences: a stylesheet in the zip, a fake WOFF2, a duplicate id, text under 4.5:1, a blue "serious", an unknown font, a radius out of range, a non-built-in default. A good pack installs, appears in the picker, and its stylesheet and fonts are served from this site only.

---

### 02

### N A V I G A T I O N

**Browser suite, at 390x844 and 1280x800**

- The header is one row at 320, 390, 768 and 1280 wide, and the document never scrolls sideways.
- Menu opens and closes by click, Enter, Space and Escape; focus moves in on open, stays inside, and returns to the Menu button on close.
- For each role (signed out, reporter, moderator, administrator, access manager, owner, journalist, organization coordinator, tester), every staff route in `entries.ts` the role may open is reachable from the menu in at most two activations on a desktop and three on a phone (Menu, the area, the page), and no route it may not open is shown.
- Sign out is reachable by keyboard and by tap at 390 wide for every signed-in role. (This is the bug that started the redesign.)
- `/maps` is reachable from the menu for an administrator.
- The current page is marked with `aria-current="page"` in the menu and in its area tabs.
- The Menu button's count matches the queue's waiting count and is announced in words.
- On a filing door, the header shows no Menu button and makes no call outside `FILING_CALLS`.

---

### 03

### S C R E E N S

**Browser suite, every screen in `screens/`**

**AXE IN EVERY LOOK**

The axe check runs on the front page, the board, a report, verify, a filing card, the review card, sign in, the queue, one report under moderation, settings overview and Look, once for each of the 16 named looks, plus High contrast dark with Commons (the Easier reading pair on a dark site, the one palette no named look uses), set by `data-palette` and `data-theme` in the test, not by saving. Animations are disabled for the run so nothing is measured mid-fade.

**AGAINST THE PICTURES**

For each file in `mockups/`, the matching route with matching demo data is captured at the same size and looked at beside it. A difference in structure or order is a bug in one of them; a difference in exact pixels is not.

**FILING**

- No card advances on its own. Next on an unanswered required card shows the error and moves focus to it.
- Back from any card returns to the previous card with its answer kept; browser Back does the same.
- A question whose "only if" does not hold is never sent, not even as an empty value (the absent-key rule).
- The county list follows the state on the same card, and changing the state clears the county.
- Every choice is a choice card: no native radio or checkbox is visible anywhere on the site.

**MODERATION**

- Deciding in the queue and deciding on the report page record the same decision row.
- Bulk decline sends no email (decision 51) and asks for one reason from the fixed list.
- Opening "Who filed it" asks for a written reason and writes an `access_log` row; closing without a reason writes nothing and shows nothing.

**SETTINGS**

- Only one setting panel is open at a time; opening a second with changes in the first asks first.
- The Save bar names what it saves, sits above the phone keyboard, and Escape cancels.
- On Look, choosing a look changes the two previews and nothing else on the site until "Apply to the site"; "Back to what the site shows" restores the previews.
- Applying a look asks for no step-up, as today. Installing, replacing or removing a pack asks for the step-up when it has expired.

**EASIER READING**

Turning it on paints the High contrast palette and Commons theme for this browser only, survives a reload, does nothing for another browser, and the page still renders when `localStorage` throws.

---

### 04

### W H A T S T A Y S T R U E

**The existing guards, run again**

`apps/web/e2e/verify.spec.ts` (no other host requested) on every new public page; the seal vector tests untouched and green; the boundary check green; no new `any`.

---

### 05

### K N O W N L I M I T A T I O N S , P R E C I S E L Y

- Axe in 17 pairs on 11 screens is 187 runs. If that is too slow for every push, run it nightly and on release, and run Desk and ElectionLog on every push.
- "Looked at beside it" is a person's check, or a model's with a screenshot. It is not a pixel diff on purpose: the mock-ups use fallback fonts.
- The role list in 02 is the roles that exist today. A new role needs a line there.
