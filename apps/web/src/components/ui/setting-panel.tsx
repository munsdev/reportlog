/**
 * A setting, closed or open. Closed, it shows its title, what it is set to
 * now ("Accepting reports: Yes"), and an Edit button: a settings page reads
 * as a list of answers before anybody opens anything. Open, it shows its
 * form, and the Save bar at the foot of the screen names what Save saves.
 *
 * ONE PANEL OPEN AT A TIME. Two open forms would leave one Save bar saving
 * one of them and nobody sure which. `SettingPanels` around the page keeps
 * track; opening another panel, cancelling, or pressing Escape while the
 * open one has changes asks first, naming it, rather than throwing the
 * changes away or keeping them in a form nobody is looking at.
 *
 *   <SettingPanels>
 *     <SettingPanel id="intake" title="Accepting reports"
 *       summary={[{ key: 'Accepting reports', value: 'Yes' }]}
 *       dirty={changed} onSave={save} onCancel={reset}>
 *       …the form…
 *     </SettingPanel>
 *   </SettingPanels>
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils.ts';
import { Button } from './button.tsx';
import { Card } from './card.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './dialog.tsx';
import { KeyValueList } from './key-value-list.tsx';
import type { KeyValue } from './key-value-list.tsx';
import { SaveBar } from './save-bar.tsx';

/** What the provider knows of the open panel. */
interface OpenPanel {
  id: string;
  title: string;
  dirty: boolean;
  cancel: () => void;
}

interface SettingPanelsValue {
  openId: string | null;
  /** Open this panel, asking first if the open one has changes. */
  open: (id: string) => void;
  /** Close the open panel, asking first if it has changes. */
  close: () => void;
  /** Close without asking: after a save, or once the person said discard. */
  closeNow: () => void;
  /** The open panel keeps this current. */
  report: (panel: OpenPanel) => void;
}

const SettingPanelsContext = createContext<SettingPanelsValue | null>(null);

export function useSettingPanels(): SettingPanelsValue {
  const value = useContext(SettingPanelsContext);
  if (!value) throw new Error('A SettingPanel needs <SettingPanels> around it.');
  return value;
}

export function SettingPanels({ children }: { children: ReactNode }) {
  const [openId, setOpenId] = useState<string | null>(null);
  // The question about unsaved changes, while it is asked: which panel's
  // changes, and what happens if the person leaves them: another panel
  // opens (its id) or none does (null).
  const [asking, setAsking] = useState<{ title: string; then: string | null } | null>(null);
  const current = useRef<OpenPanel | null>(null);

  const report = useCallback((panel: OpenPanel) => {
    current.current = panel;
  }, []);

  const closeNow = useCallback(() => {
    current.current = null;
    setOpenId(null);
  }, []);

  const open = useCallback((id: string) => {
    const now = current.current;
    if (now && now.id !== id && now.dirty) {
      setAsking({ title: now.title, then: id });
      return;
    }
    now?.cancel();
    current.current = null;
    setOpenId(id);
  }, []);

  const close = useCallback(() => {
    const now = current.current;
    if (now?.dirty) {
      setAsking({ title: now.title, then: null });
      return;
    }
    now?.cancel();
    current.current = null;
    setOpenId(null);
  }, []);

  const discard = () => {
    current.current?.cancel();
    current.current = null;
    setOpenId(asking?.then ?? null);
    setAsking(null);
  };

  const value = useMemo(
    () => ({ openId, open, close, closeNow, report }),
    [openId, open, close, closeNow, report],
  );

  const title = asking?.title ?? 'this setting';
  return (
    <SettingPanelsContext.Provider value={value}>
      {children}
      <Dialog
        open={asking !== null}
        onOpenChange={(on) => {
          if (!on) setAsking(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Leave your changes to {title}?</DialogTitle>
            <DialogDescription>
              They are not saved. If you leave them, {title} stays as it was.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={discard}>
              Leave them
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setAsking(null);
              }}
            >
              Keep editing
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingPanelsContext.Provider>
  );
}

export interface SettingPanelProps {
  id: string;
  title: string;
  /** What it is set to now, shown while it is closed. */
  summary: readonly KeyValue[];
  /** The form differs from what is saved. */
  dirty: boolean;
  /**
   * Save the form. Resolve `false` (or throw) to keep the panel open, when
   * the form shows its own error; anything else closes it.
   */
  onSave: () => unknown;
  /** Put the form back as it was saved. */
  onCancel: () => void;
  children: ReactNode;
  className?: string | undefined;
}

export function SettingPanel({
  id,
  title,
  summary,
  dirty,
  onSave,
  onCancel,
  children,
  className,
}: SettingPanelProps) {
  const panels = useSettingPanels();
  const isOpen = panels.openId === id;
  const [saving, setSaving] = useState(false);
  const { report } = panels;

  useEffect(() => {
    if (isOpen) report({ id, title, dirty, cancel: onCancel });
  }, [isOpen, report, id, title, dirty, onCancel]);

  const save = async () => {
    setSaving(true);
    try {
      const ok: unknown = await Promise.resolve(onSave());
      if (ok !== false) panels.closeNow();
    } catch {
      // The form shows its own error; the panel stays open on it.
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card
      heading={title}
      className={cn(isOpen && 'outline-2 outline-offset-2 outline-ink', className)}
    >
      {isOpen ? (
        <>
          {children}
          <SaveBar name={title} busy={saving} onSave={() => void save()} onCancel={panels.close} />
        </>
      ) : (
        <>
          <KeyValueList items={summary} />
          <div>
            <Button
              variant="secondary"
              aria-label={`Edit ${title}`}
              onClick={() => {
                panels.open(id);
              }}
            >
              Edit
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}
