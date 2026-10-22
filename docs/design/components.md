# REPORTLOG DESIGN

## C O M P O N E N T S

**Every building block, its variants, states, and what a screen reader hears**

21 October 2026 · `apps/web/src/components/ui/` · canvas board "Character sheet"

---

### 01

### R U L E S E V E R Y C O M P O N E N T K E E P S

**Read these before any single component**

**ONLY TOKENS**

No hex, rgb or named colour in a component. Colours come from the Tailwind names in `styles.css` (`paper`, `surface`, `ink`, `ink-alt`, `muted`, `deep`, `on-deep`, `action`, `brand`, `serious`, `confirmed` and their `on-` pairs), plus the three derived ones: `deeper`, `on-deep-muted`, `line-on-deep`. Type, shape and spacing come from the theme variables: `font-display`, `font-sans`, `font-label`, `font-mono`, `--rl-label-transform`, `--rl-label-tracking`, `--rl-h1-size`, `--rl-radius`, `--rl-radius-sm`, `--rl-border-main`, `--rl-shadow-offset`, `--rl-press`.

**COLOUR IS EXCLUSIVE**

Action colour on buttons and nothing else (the count of work waiting sits inside the Menu button, so it is on a button). Tab underlines and "you are here" markers use `brand` on light and `brand-on-deep` on deep. Confirmed teal and serious red on status only, never a button, never a link, never a "you are here" marker. A report nobody has assessed gets no colour.

**MEANING IS NEVER COLOUR ALONE**

Every chip, alert and state carries a word. A selected choice card has a tick and a heavier edge, not only a tint.

**TAP SIZE**

44px minimum height for anything pressable, at every width, as the rebuild already does (`min-h-11` on both button sizes). The old app's 36px small button does not come back.

**DISABLED AND FADED**

No opacity on anything with text. Axe measures contrast mid-transition, so a fading button fails. Disabled controls keep 4.5:1 text and show their state with a dashed edge and the word in the label or an adjacent sentence ("Save, nothing changed yet").

**MOTION**

Transitions only on transform and box-shadow (button press, menu open), 120ms. All of it off under `prefers-reduced-motion: reduce`.

**PRINT**

`print:` hides the header, menu, footer and every button. A report page prints as the report.

**SPACING**

One scale, in rem: 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6. Page gutter `max(1rem, env(safe-area-inset-left))` and the same on the right; restore `viewport-fit=cover` and `interactive-widget=resizes-content` in the viewport meta.

---

### 02

### T Y P E

**Five styles; the theme decides the faces**

| Style   | Face    | Size                     | Notes                                                                                      |
| ------- | ------- | ------------------------ | ------------------------------------------------------------------------------------------ |
| Eyebrow | label   | 12px                     | label case and tracking, `muted`. The site name above every page title, as the old app had |
| H1      | display | `--rl-h1-size` (fluid)   | weight `--rl-h1-weight`, display transform, line-height 1.08                               |
| H2      | display | clamp(1.5rem … 2.125rem) | line-height 1.15                                                                           |
| H3      | display | 1.25rem                  | card titles                                                                                |
| Lede    | sans    | 1.0625rem to 1.1875rem   | `ink-alt`, max 65ch                                                                        |
| Body    | sans    | `--rl-body-size`         | line-height 1.55                                                                           |
| Label   | label   | 13px                     | buttons, tabs, form labels, chips (11px)                                                   |
| Meta    | mono    | 13 to 14px               | references, timestamps, counts, hashes, the count line                                     |

**THE COUNT LINE**

A mono line under a list that states what the list holds: `31 reports · 7 waiting · 19 approved · 3 declined · 1 withdrawn`. It is `aria-live="polite"` and updates with the filters. Board and moderation queue both have one.

---

### 03

### B U T T O N

**`button.tsx`: primary, secondary, quiet; two sizes; always outlined**

**VARIANTS**

- Primary: `action` fill, `on-action` text. One per view, the thing the person came to do.
- Secondary: `surface` fill, `ink` text.
- Quiet: no fill, no outline, underlined label. For "Cancel", "Change", "Clear".

**SHAPE**

Label face, label case and tracking, 13 to 14px, weight 700. Outline `max(var(--rl-border-main), 1.5px)` in `ink` on primary and secondary, in every theme, because some palettes' action colour is too close to their page to be found by its fill (Flint gold on Flint grey is 1.7:1). Radius `--rl-radius-sm`. Shadow `--rl-shadow-offset` hard, in `ink`.

**SIZES**

`md` 44px. `lg` 52px, used full width on a phone for the page's main action. Full width is a prop (`block`), not a one-off class.

**STATES**

- Hover: background one step (`paper-alt` on secondary; primary unchanged) and the underline on quiet.
- Pressed: `translate(var(--rl-press), var(--rl-press))` and the shadow shortened by the same amount.
- Focus: the global 2px `ink` outline, offset 2px.
- Busy: label changes to the verb in progress ("Sending…"), `aria-busy="true"`, not disabled, ignores a second press.
- Disabled: dashed outline, `paper-alt` fill, `ink-alt` text, no shadow. Only when an adjacent sentence says why.

---

### 04

### C H I P , C O U N T , T A G

**Status in words, with colour as the second signal**

**CHIP** (new `chip.tsx`)

Label face, 11px, uppercase whatever the theme's label case, pill if the theme radius is 10px or more, else `--rl-radius-sm`. 24px high; inside a list row it sits in a 44px row. Tones:

- `confirmed`: `confirmed` fill, `on-confirmed` text. Only "Confirmed" or a moderator outcome.
- `serious`: `serious` fill, `on-serious`. Only "Serious" or an error state.
- `open`: no fill, 1.5px `ink-alt` edge, `ink-alt` text. Waiting, not assessed.
- `tag`: no fill, 1.5px `ink` edge. Neutral facts: "Single account", "Counts only", "Not public".

**COUNT** (new `count.tsx`)

Mono, 12px, pill, minimum 22px wide. `action` tone only inside the Menu button, for the total of work waiting for this person; `neutral` (`line-on-deep` fill on deep, `paper-alt` on light) everywhere else, including per-page counts inside the menu panel and on queue filter buttons. Always an `aria-label` sentence: "7 reports waiting for a moderator".

---

### 05

### P A N E L S

**`card.tsx` grows three variants and a heading that follows the theme**

**VARIANTS**

- `raised` (default): `surface`, `--rl-border-main` edge in `ink-alt`, theme shadow in `ink`. Holds a decision, a setting, a report.
- `quiet`: `paper-alt`, no edge, no shadow. Help, side information.
- `deep`: `deep` fill, `on-deep` text. Notices that must not be missed: the emergency notice on the filing landing, "Nothing is public until a moderator approves it".
- `plain`: no fill, top rule only. Sections of a long settings page.

**PANEL HEADING** (`<PanelHead>`), drawn by `data-panel-head` on `<html>`

- `plain`: H3 inside the padding.
- `title-bar`: a 24px strip across the top in `paper-alt` with 1px horizontal stripes in `line`, the title centred on a `paper-alt` block, mono. The old Mac window. Desk theme.
- `double-rule`: a 4px double rule in `ink` on top, title in label face. Broadsheet.
- `bar`: a `deep` strip with `on-deep` label text and a 6px `brand-on-deep` left edge. Broadcast.
- `rule`: title, then a 1px dashed `ink-alt` rule. Docket.
- `prompt`: title prefixed with `$ ` in `brand`, mono. Console.

The heading is decoration around a real `<h2>` or `<h3>`; its stripes and rules are `aria-hidden`.

**EMPTY STATE** (new `empty.tsx`)

2px dashed `ink-alt` box, 2.5rem padding, centred. A label-face title ("Nothing waiting") and one sentence of what happens next. Never a bare sentence on the page.

**PAGE TEXTURE**, drawn by `data-texture` on `<html>`

`ruled`: a 1px `line` rule every 28px on the page background only, never behind a panel. `grid`: 24px squares. `dots`: 20px dots. All off in print and under "Easier reading".

---

### 06

### F O R M S

**Bigger targets, the site's own controls everywhere**

**FIELD** (`field.tsx`)

Label above (label face), help under the label in `ink-alt`, control, then error. "Optional." after the label of an optional field (the rebuild's good change, kept). The error is `serious` text with an icon and a sentence, linked by `aria-describedby`, announced by the page's alert when the form is sent.

**INPUT, SELECT, TEXTAREA**

44px minimum, `surface`, 1.5px `ink-alt` edge (3:1), radius `--rl-radius-sm`, 16px text so phones do not zoom. Focus: 2px `ink` outline.

**CHOICE CARD** (replaces `RadioOption` and the checkbox row; `choice.tsx`)

A whole-card `<label>` wrapping a real radio or checkbox. 52px minimum, full width, 1px `ink-alt` edge. Title, optional one-line note under it. Chosen: 2px `ink` edge, `paper-alt` fill, a tick drawn in the control, the theme shadow. Keyboard: arrow keys move within a radio group as native radios do. Used on every filing card, the setup wizard, the logbook templates and the look screen. **No native browser-default radio, checkbox or file input appears anywhere.**

**FILE PICKER** (`file-drop.tsx`)

A secondary button "Choose files" over a hidden native input, the file list under it with name, size and a Remove quiet button, and the limits in one sentence. Drag and drop on desktop as an extra, never the only way.

---

### 07

### N A V I G A T I O N P I E C E S

**Specified in navigation.md; listed here so the inventory is complete**

`SiteHeader`, `MenuButton`, `MenuPanel` (desktop) and `MenuSheet` (phone), `AreaTabs`, `Wordmark`, `ProgressRule`. The skip link stays where it is, inline in `__root.tsx`.

---

### 08

### E D I T I N G S E T T I N G S

**One editor at a time, a Save bar that names what it saves**

**SETTING PANEL** (`setting-panel.tsx`)

Closed, it shows its title and a key-value list of the current values ("Accepting reports: Yes · Publishing: On"), with an Edit secondary button. Open, it shows the form. Only one panel is open on a page; opening another while one has changes asks first.

**SAVE BAR** (`save-bar.tsx`)

Fixed to the bottom of the viewport while a panel is open, `deep` fill: the sentence "Saving: Accepting reports" on the left, Cancel (quiet, on deep) and Save (primary) on the right. Sits above the phone keyboard using `visualViewport` (the old `--kb-inset`). Escape is Cancel, with the same unsaved-changes question. The page gets bottom padding equal to the bar so nothing hides under it.

**TOAST** (`toast.tsx`)

For a switch that applies at once ("Accepting reports is now off"). `role="status"`, bottom centre, above the Save bar, 5 seconds, a Dismiss button, paused while hovered or focused. Never for an error: errors are inline alerts that stay.

**LEAVING WITH CHANGES**

The rebuild's `UnsavedChangesGuard` stays and now names the open panel.

---

### 09

### O T H E R S

**Kept from the rebuild, restyled**

- `alert.tsx`: tones say themselves in words, as now. Info is `quiet`, warning is `deep`, error has a `serious` edge and icon. A success message is `quiet` with a tick and the word "Done", never teal (teal means a moderator confirmed something).
- `dialog.tsx`: scrim `deep` at 70%, panel `surface` with the theme edge and shadow, title in display face, actions right-aligned with the destructive one never primary-coloured.
- `KeyValueList` (new): two columns on desktop, stacked on a phone; keys in `ink-alt`, values in `ink`; mono for codes and counts.
- `Pagination`: Previous and Next as secondary buttons, "Page 2 of 7" in mono between them.
- `CheckRow`: kept as built.

---

### 10

### K N O W N L I M I T A T I O N S , P R E C I S E L Y

- The canvas "Character sheet" shows the Desk-era components in Flint and Signal only. The look library board shows them in every named look, at small size.
- Exact pixel values on the canvas are drawn by hand. Where the canvas and this file disagree, this file wins, and the difference is a bug in the canvas.
- Toast placement above the phone keyboard has not been tried on a real device.
- The `grid` and `dots` textures exist in the format but no built-in theme uses them yet.
