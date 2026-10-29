/**
 * A closed row on the report under moderation, as the mock-up draws it
 * (`closed()` in staff.py): a `.panel.closed` with its title, one line of
 * what is set, and one button naming what it does (Edit, Link, Clear, Ask,
 * Look…). Open, it is the same panel holding its form, with the mock-up's
 * `.savebar` naming what Save saves.
 *
 * It shares the setting panels' rule through `SettingPanels`: ONE ROW OPEN AT
 * A TIME, and opening another with something unsaved asks first, so a
 * moderator cannot leave two half-written. A row with no `onSave` (asking for
 * evidence, whose dialogs record their own acts) opens with a Close instead.
 */
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useSettingPanels } from '../../mockup/SettingPanel.tsx';
import { Btn } from '../../mockup/Btn.tsx';
import { SaveBar } from '../../mockup/SaveBar.tsx';

export interface ClosedRowProps {
  id: string;
  title: string;
  /** What is set now, shown while it is closed. */
  summary: ReactNode;
  /** The button's word: "Edit", "Link", "Look…". */
  action: string;
  dirty?: boolean;
  /** Resolve `false` (or throw) to stay open on the form's own error. */
  onSave?: () => unknown;
  /** Put the form back as it was. */
  onCancel?: () => void;
  saveLabel?: string;
  children: ReactNode;
}

export function ClosedRow({
  id,
  title,
  summary,
  action,
  dirty = false,
  onSave,
  onCancel,
  saveLabel,
  children,
}: ClosedRowProps) {
  const panels = useSettingPanels();
  const isOpen = panels.openId === id;
  const [saving, setSaving] = useState(false);
  const { report } = panels;
  const cancel = onCancel ?? noop;

  useEffect(() => {
    if (isOpen) report({ id, title, dirty, cancel });
  }, [isOpen, report, id, title, dirty, cancel]);

  const save = async () => {
    if (!onSave) return;
    setSaving(true);
    try {
      const ok: unknown = await Promise.resolve(onSave());
      if (ok !== false) panels.closeNow();
    } catch {
      // The form shows its own error; the row stays open on it.
    } finally {
      setSaving(false);
    }
  };

  if (isOpen) {
    return (
      <section className="panel" id={id} aria-label={title}>
        <h2>{title}</h2>
        {children}
        {onSave ? (
          <SaveBar
            name={title}
            busy={saving}
            saveLabel={saveLabel}
            onSave={() => void save()}
            onCancel={panels.close}
          />
        ) : (
          <div className="acts">
            <Btn sm flat aria-label={`Close ${title}`} onClick={panels.close}>
              Close
            </Btn>
          </div>
        )}
      </section>
    );
  }
  return (
    // Named, so each row is a region a screen reader can jump to.
    <section className="panel closed" id={id} aria-label={title}>
      <div className="closed-head">
        <h2>{title}</h2>
      </div>
      {summary}
      <div className="acts">
        <Btn
          sm
          flat
          onClick={() => {
            panels.open(id);
          }}
        >
          {action}
        </Btn>
      </div>
    </section>
  );
}

function noop() {
  // A row with nothing to put back.
}
