/**
 * ══ EASIER READING GOES HERE ══
 *
 * The place the "Easier reading" switch is drawn: at the end of the menu's
 * "You" row, for everybody signed in or not, and at the end of the footer
 * (docs/design/navigation.md, sections 02 and 06; the switch itself is the
 * look system's, docs/design/looks/README.md section 07).
 *
 * Stage 6 builds the switch. Wiring it in is this one file: render it here,
 * and both places get it. Until then it draws only a hidden marker, so
 * neither place offers a switch that does nothing. `where` lets the switch fit each
 * surface (the menu is deep; the footer is the page's own ground).
 */
export function EasierReadingSlot({ where }: { where: 'menu' | 'footer' }) {
  // An empty, hidden marker: nothing to see or hear yet, and the spot is
  // findable in the page (`[data-easier-reading]`) when the switch arrives.
  return <span hidden data-easier-reading={where} />;
}
