/**
 * What "Edit this page" does on the page being read, if anything: a page
 * that can be edited registers it while it is drawn (the front page does),
 * and the corner Edit menu offers it (EditDock.tsx).
 */
import { useEffect, useSyncExternalStore } from 'react';

let action: (() => void) | null = null;
const listeners = new Set<() => void>();

function set(next: (() => void) | null) {
  action = next;
  for (const l of listeners) l();
}

export function useRegisterPageEdit(edit: (() => void) | null): void {
  useEffect(() => {
    set(edit);
    return () => {
      set(null);
    };
  }, [edit]);
}

export function usePageEdit(): (() => void) | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => action,
    () => null,
  );
}
