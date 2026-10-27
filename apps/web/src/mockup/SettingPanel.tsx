/**
 * The mock-up's closed settings panel (`panel closed`: heading, a `dl` of the
 * current values, a Change button) which opens into its fields with a
 * `savebar`. One panel is open at a time; leaving unsaved changes asks.
 * Same props as components/ui/setting-panel.tsx so screens only change imports.
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
import { Btn } from './Btn.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './Dialog.tsx';
import { Dl } from './DlList.tsx';
import type { DlItem } from './DlList.tsx';
import { Panel } from './PanelBox.tsx';
import { SaveBar } from './SaveBarStrip.tsx';

interface OpenPanel {
  id: string;
  title: string;
  dirty: boolean;
  cancel: () => void;
}

interface SettingPanelsValue {
  openId: string | null;
  open: (id: string) => void;
  close: () => void;
  closeNow: () => void;
  report: (panel: OpenPanel) => void;
}

const Context = createContext<SettingPanelsValue | null>(null);

export function useSettingPanels(): SettingPanelsValue {
  const value = useContext(Context);
  if (!value) throw new Error('A SettingPanel needs <SettingPanels> around it.');
  return value;
}

export function SettingPanels({ children }: { children: ReactNode }) {
  const [openId, setOpenId] = useState<string | null>(null);
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
    <Context.Provider value={value}>
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
            <Btn sm flat  onClick={discard}>
              Leave them
            </Btn>
            <Btn look="ghost" sm flat
              
              onClick={() => {
                setAsking(null);
              }}
            >
              Keep editing
            </Btn>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Context.Provider>
  );
}

export interface SettingPanelProps {
  id: string;
  title: string;
  summary: readonly DlItem[];
  dirty: boolean;
  onSave: () => unknown;
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
      // The panel's own mutation says what went wrong; it stays open.
    } finally {
      setSaving(false);
    }
  };

  if (isOpen) {
    return (
      <>
        <Panel heading={title} className={className}>
          {children}
        </Panel>
        <SaveBar name={title} busy={saving} onSave={() => void save()} onCancel={panels.close} />
      </>
    );
  }
  return (
    <Panel heading={title} closed {...(className ? { className } : {})}>
      <Dl items={summary} />
      <div className="acts">
        <Btn sm flat
          
          aria-label={`Edit ${title}`}
          onClick={() => {
            panels.open(id);
          }}
        >
          Change
        </Btn>
      </div>
    </Panel>
  );
}
