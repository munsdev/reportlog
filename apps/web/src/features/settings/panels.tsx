/**
 * The settings pattern (settings-and-admin.md §02), as the screens use it:
 *
 *   SettingsFrame   around a page of panels: one panel open at a time, and
 *                   somewhere for a switch's toast to appear.
 *   GuardedPanel    a SettingPanel that also tells the settings area's
 *                   leave-the-page warning about its unsaved changes, by
 *                   the panel's own name ("You have changes to Publishing…").
 *   LinkPanel       a panel whose setting has a page of its own: what is
 *                   set, and a Change link where the others have Edit.
 *
 * A switch that applies at once is not a form and has no Save; each screen
 * draws its own, as a panel with choice cards and one button, answered by a
 * toast.
 */
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { Btn } from '@/mockup/Btn.tsx';
import { Panel } from '@/mockup/Panel.tsx';
import { Dl, type DlItem } from '@/mockup/Dl.tsx';
import { SettingPanel, SettingPanels, useSettingPanels } from '@/mockup/SettingPanel.tsx';
import type { SettingPanelProps } from '@/mockup/SettingPanel.tsx';
import { ToastProvider } from '@/components/ui/toast.tsx';
import { useUnsavedChanges } from '../../routes/(staff)/settings/-editor.tsx';

export function SettingsFrame({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <SettingPanels>{children}</SettingPanels>
    </ToastProvider>
  );
}

/** A setting panel whose unsaved changes are named if somebody leaves the page. */
export function GuardedPanel(props: SettingPanelProps) {
  const { openId } = useSettingPanels();
  useUnsavedChanges(props.title, openId === props.id && props.dirty);
  return <SettingPanel {...props} />;
}

export interface LinkPanelProps {
  title: string;
  summary: readonly DlItem[];
  /** A route in this app. */
  to: string;
  linkLabel?: string;
  children?: ReactNode;
  className?: string;
}

export function LinkPanel({
  title,
  summary,
  to,
  linkLabel = 'Change',
  children,
  className,
}: LinkPanelProps) {
  return (
    <Panel title={title} kind="closed" {...(className ? { className } : {})}>
      {children}
      <Dl items={summary} />
      <div className="acts">
        <Btn sm flat asChild >
          <Link to={to} aria-label={`${linkLabel} ${title}`}>
            {linkLabel}
          </Link>
        </Btn>
      </div>
    </Panel>
  );
}
