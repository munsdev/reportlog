/**
 * Something for the corner dock: the stack of pills in the bottom right
 * corner (index.html, site.css .fab-dock). A page puts its pill in the
 * dock's slot, so it lines up with Look and the development notice instead
 * of covering them. The dock is in the page shell, not drawn by React, so
 * the slot is there from the first render.
 */
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

export function DockSlot({
  slot,
  children,
}: {
  slot: 'fab-notice' | 'fab-social' | 'fab-edit';
  children: ReactNode;
}) {
  const el = typeof document === 'undefined' ? null : document.getElementById(slot);
  return el ? createPortal(children, el) : null;
}
