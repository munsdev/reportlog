/**
 * Where a heat map can be put, and that is the whole list.
 *
 * A FIXED SET OF PLACES THE INTERFACE ALREADY HAS, not a page builder. The
 * site is one document with panes in it (public/js/nav.js has the routes),
 * so "put this map on a page" means naming a pane that exists and a point
 * inside it that was built to receive one. An operator choosing from five
 * real slots gets a map that is laid out properly in every one of them;
 * an operator given a free-text position gets a map that overlaps the
 * figures on a phone and no way to find out until somebody tells them.
 *
 * ADDING A SLOT IS A LINE HERE AND A CONTAINER IN public/index.html, and
 * deliberately not a migration — `heat_maps.slot` carries no CHECK
 * constraint for exactly this reason. The route validates against this
 * list on the way in, so a stored slot is always one of these; a row that
 * somehow carries another is simply not placed, which leaves the map
 * reachable at its own address and breaks no page.
 *
 * `pane` and `sub` are which screen the slot is on, so a map is fetched
 * only when the screen holding it is opened — the module promises that
 * nothing of a map is requested until its view is, and a home-page map
 * loading because somebody opened the board would quietly break that.
 *
 * `container` is the element a slot renders into. It is in the DOM from the
 * first byte and empty, like `#home-lists` — the gate is frontend as well
 * as backend, so every pane exists before the password is given and the
 * lock screen is what stands in front of it.
 */

export const MAP_SLOTS = [
  {
    id: 'board_tab',
    label: 'Its own tab on the board',
    // Where the single map lived before there could be several. A map with
    // a tab of its own is the one somebody goes to look at deliberately.
    description: 'A tab beside Reports, Figures and Check. Best for a map '
      + 'somebody comes to the board to read.',
    container: 'map-slot-board-tab',
    pane: 'dash',
    sub: 'map',
  },
  {
    id: 'board_reports',
    label: 'Above the report board',
    description: 'At the top of the list of reports, so the map and the reports '
      + 'it summarises are on one screen. Clicking an area filters the list below it.',
    container: 'map-slot-board-reports',
    pane: 'dash',
    sub: 'reports',
  },
  {
    id: 'board_numbers',
    label: 'With the figures',
    description: 'Under the counts on the Figures view, where a reader is already '
      + 'looking at totals.',
    container: 'map-slot-board-numbers',
    pane: 'dash',
    sub: 'numbers',
  },
  {
    id: 'home',
    label: 'The home page',
    // The one slot in front of most readers, and the one to be careful
    // with: see the residual-disclosure note in docs/map.md.
    description: 'Below the buttons on the front page. The most visible slot there '
      + 'is, and the one to think hardest about before using.',
    container: 'map-slot-home',
    pane: 'home',
  },
  {
    id: 'about',
    label: 'The about page',
    description: 'In the About document, for a map that is context rather than news.',
    container: 'map-slot-about',
    pane: 'about',
  },
];

export const MAP_SLOT_IDS = MAP_SLOTS.map((s) => s.id);
export const DEFAULT_MAP_SLOT = 'board_tab';

export function isMapSlot(id) {
  return MAP_SLOT_IDS.includes(id);
}

export function mapSlot(id) {
  return MAP_SLOTS.find((s) => s.id === id) || null;
}
