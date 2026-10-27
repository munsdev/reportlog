import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { Btn } from './Btn.tsx';

/**
 * The mock-up's `.savebar`: "Changes to X are not saved." with Save and
 * Cancel, sticky at the foot of the screen while a panel is open. Escape is
 * Cancel, unless it was pressed inside a dialog on top of the bar (the
 * question about unsaved changes), which that Escape closes instead.
 */
export function SaveBar({
  what,
  onSave,
  onCancel,
  busy = false,
  saveLabel = 'Save',
}: {
  what: ReactNode;
  onSave: () => void;
  onCancel: () => void;
  busy?: boolean;
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
      <span>Changes to {what} are not saved.</span>
      <div className="acts">
        <Btn kind="go" disabled={busy} onClick={onSave}>
          {busy ? 'Saving…' : saveLabel}
        </Btn>
        <Btn kind="ghost" onClick={onCancel}>
          Cancel
        </Btn>
      </div>
    </div>
  );
}
