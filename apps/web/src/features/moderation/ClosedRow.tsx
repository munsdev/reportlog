/**
 * A closed row on the report under moderation: its title, one line of what
 * is set, and one button naming what it does (Edit, Link, Clear, Ask, Look…).
 *
 * It is the setting panel (components/ui/setting-panel.tsx) with its own
 * button words, and it shares that panel's rule through `SettingPanels`:
 * ONE ROW OPEN AT A TIME, and opening another with something unsaved asks
 * first, so a moderator cannot leave two half-written. An open row saves
 * through the Save bar, which names it. A row with no `onSave` (asking for
 * evidence, whose dialogs record their own acts) opens with a Close instead.
 */
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Button } from '../../components/ui/button.tsx';
import { Card } from '../../components/ui/card.tsx';
import { SaveBar } from '../../components/ui/save-bar.tsx';
import { useSettingPanels } from '../../components/ui/setting-panel.tsx';

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

  return (
    <Card variant="plain" heading={title} className={isOpen ? 'pb-2' : undefined}>
      {isOpen ? (
        <>
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
            <div>
              <Button variant="secondary" aria-label={`Close ${title}`} onClick={panels.close}>
                Close
              </Button>
            </div>
          )}
        </>
      ) : (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">{summary}</div>
          {/* Named by the visible word first, then the row, as the setting panel's Edit is. */}
          <Button
            variant="secondary"
            aria-label={`${action} ${title}`}
            onClick={() => {
              panels.open(id);
            }}
          >
            {action}
          </Button>
        </div>
      )}
    </Card>
  );
}

function noop() {
  // A row with nothing to put back.
}
