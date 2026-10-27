import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { Btn } from './Btn.tsx';

/**
 * The mock-up's `savebar`: a sticky strip saying what is unsaved, with Save
 * and Cancel. Escape cancels, unless a dialog has it.
 */
export function SaveBar({
  name,
  onSave,
  onCancel,
  busy = false,
  saveLabel = 'Save',
}: {
  name: ReactNode;
  onSave: () => void;
  onCancel: () => void;
  busy?: boolean | undefined;
  saveLabel?: ReactNode;
}) {
  const cancel = useRef(onCancel);
  useEffect(() => {
    cancel.current = onCancel;
  }, [onCancel]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest('[role="dialog"], [role="alertdialog"]')) return;
      cancel.current();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, []);
  return (
    <div className="savebar" role="region" aria-label="Unsaved changes">
      <span>Changes to {name} are not saved.</span>
      <div className="acts">
        <Btn sm flat look="go" busy={busy} busyLabel="Saving…" onClick={onSave}>
          {saveLabel}
        </Btn>
        <Btn sm flat look="ghost" onClick={onCancel}>
          Cancel
        </Btn>
      </div>
    </div>
  );
}
