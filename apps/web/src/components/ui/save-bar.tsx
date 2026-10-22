/**
 * The Save bar: while a setting is being edited, a bar fixed to the bottom
 * of the screen says what Save will save ("Saving: Accepting reports") and
 * offers Cancel and Save, wherever the person has scrolled to.
 *
 * It sits above a phone's on-screen keyboard rather than under it, read
 * from `visualViewport` (the keyboard shrinks the visual viewport and not
 * the layout one). Escape is Cancel. It renders a spacer of its own height
 * in the page, so the last field can always be scrolled clear of it, and
 * publishes that height as `--rl-savebar-height` on <html> so a toast can
 * sit above it.
 */
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils.ts';
import { Button } from './button.tsx';

export interface SaveBarProps {
  /** What is being saved, named as the panel names it. */
  name: ReactNode;
  onSave: () => void;
  onCancel: () => void;
  /** Saving now: Save says so and ignores a second press. */
  busy?: boolean | undefined;
  saveLabel?: ReactNode;
  /** The words before the name. A bar for a whole page in edit mode says what is being edited instead. */
  lead?: ReactNode;
  className?: string | undefined;
}

/** How far the on-screen keyboard reaches up the screen, or 0 without one. */
function keyboardInset(): number {
  const vv = typeof window === 'undefined' ? undefined : window.visualViewport;
  if (!vv) return 0;
  return Math.max(0, window.innerHeight - (vv.height + vv.offsetTop));
}

export function SaveBar({
  name,
  onSave,
  onCancel,
  busy = false,
  saveLabel = 'Save',
  lead = 'Saving: ',
  className,
}: SaveBarProps) {
  const bar = useRef<HTMLDivElement>(null);
  const [inset, setInset] = useState(keyboardInset);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      setInset(keyboardInset());
    };
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);

  useEffect(() => {
    const el = bar.current;
    if (!el) return;
    const measure = () => {
      setHeight(el.offsetHeight);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    return () => {
      watch.disconnect();
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    // Measured values, published as variables rather than inline styles, so
    // the bar, its spacer and a toast all read the same numbers.
    root.style.setProperty('--rl-savebar-height', `${String(height + inset)}px`);
    root.style.setProperty('--rl-savebar-bar', `${String(height)}px`);
    root.style.setProperty('--rl-kb-inset', `${String(inset)}px`);
    return () => {
      for (const v of ['--rl-savebar-height', '--rl-savebar-bar', '--rl-kb-inset'])
        root.style.removeProperty(v);
    };
  }, [height, inset]);

  // Escape anywhere on the page cancels, unless it was pressed inside a
  // dialog on top of the bar (the question about unsaved changes, say):
  // that Escape closes the dialog, and must not ask the question again.
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
    <>
      <div aria-hidden="true" className="h-(--rl-savebar-bar,0px) print:hidden" />
      <div
        ref={bar}
        role="region"
        aria-label="Save changes"
        className={cn(
          'fixed inset-x-0 bottom-(--rl-kb-inset,0px) z-30 border-t-[6px] border-brand-on-deep bg-deep text-on-deep print:hidden',
          className,
        )}
      >
        <div className="mx-auto flex max-w-page flex-wrap items-center justify-between gap-x-4 gap-y-2 px-[max(1rem,env(safe-area-inset-left))] py-3">
          <p className="min-w-0">
            {lead ? <span className="label-face text-xs text-on-deep-muted">{lead}</span> : null}
            <span className="font-semibold">{name}</span>
          </p>
          <div className="flex items-center gap-2">
            <Button variant="quiet" className="text-on-deep" onClick={onCancel}>
              Cancel
            </Button>
            <Button busy={busy} busyLabel="Saving…" onClick={onSave}>
              {saveLabel}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
