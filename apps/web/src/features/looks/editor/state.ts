/** Whether the look editor (LookEditor.tsx) is open, shared by the corner Edit menu and the Look screen. */
import { useSyncExternalStore } from 'react';

let open = false;
const listeners = new Set<() => void>();

export function setLookEditorOpen(next: boolean): void {
  open = next;
  document.body.classList.toggle('rl-look-editing', next);
  for (const l of listeners) l();
}

export function useLookEditorOpen(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => open,
    () => false,
  );
}
