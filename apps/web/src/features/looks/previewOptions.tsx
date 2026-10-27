/**
 * The header background being edited, offered to the Look screen's preview
 * frames so they draw the draft rather than what the site shows now. The
 * frames are separate documents drawn through a portal, and a portal keeps
 * React context, so the draft reaches them without a prop through every
 * layer. Absent (no provider), a frame draws the site's own.
 */
import type { LookOptions } from '@reportlog/contracts';
import { createContext, useContext } from 'react';
import type { Kit } from './header-background/scene.ts';

export interface PreviewOptionsValue {
  options: LookOptions;
  kit: Kit;
}

export const PreviewOptionsContext = createContext<PreviewOptionsValue | null>(null);

export function usePreviewOptions(): PreviewOptionsValue | null {
  return useContext(PreviewOptionsContext);
}
