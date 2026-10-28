/**
 * A look the page wears for now, without saving it: what the look editor is
 * trying on, or what a preview frame was handed by the page that holds it.
 * SiteLook and SiteLookScript prefer it to the site's saved look while it is
 * set, and nothing about it is remembered.
 *
 * A PREVIEW FRAME is the site itself, loaded in an <iframe> named
 * PREVIEW_FRAME by the page beside it (LivePreview.tsx). It hears the look to
 * wear by a message from that page, same origin only, and hides the corner
 * buttons, which belong to the page around it.
 */
import type { LookOptions } from '@reportlog/contracts';
import { useSyncExternalStore } from 'react';

export interface LookDraft {
  palette: string;
  theme: string;
  options?: LookOptions | undefined;
}

export const PREVIEW_FRAME = 'rl-look-preview';
export const inPreviewFrame = typeof window !== 'undefined' && window.name === PREVIEW_FRAME;

let current: LookDraft | null = null;
const listeners = new Set<() => void>();

export function setLookOverride(next: LookDraft | null): void {
  current = next;
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useLookOverride(): LookDraft | null {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
}

/** What a page tells its preview frame, and the frame's word that it is listening. */
export interface LookMessage {
  type: 'rl-look';
  look: LookDraft;
}

if (inPreviewFrame) {
  document.documentElement.classList.add('rl-preview');
  window.addEventListener('message', (e: MessageEvent<unknown>) => {
    if (e.origin !== window.location.origin) return;
    const d = e.data as Partial<LookMessage> | null;
    if (d?.type === 'rl-look' && d.look) setLookOverride(d.look);
  });
  window.parent.postMessage({ type: 'rl-look-ready' }, window.location.origin);
}
