/**
 * The Easier reading switch: "Easier reading: Off". For everybody, signed in
 * or not; it changes this browser only (easyReading.ts says how).
 *
 * Built to sit in the menu panel's third row, the phone sheet, and the
 * footer (docs/design/navigation.md); those belong to the navigation, which
 * places it. `onDeep` is for the menu, whose ground is the deep surface.
 *
 * A real switch (role="switch", aria-checked) named "Easier reading"; the
 * visible "On" or "Off" repeats the state for the eye and is hidden from a
 * screen reader, which already hears it from aria-checked.
 */
import { useSyncExternalStore } from 'react';
import { cn } from '@/lib/utils.ts';
import { easyReadingOn, onEasyReadingChange, setEasyReading } from './easyReading.ts';

/** Whether Easier reading is on in this browser, kept current. */
export function useEasyReading(): boolean {
  return useSyncExternalStore(onEasyReadingChange, easyReadingOn, () => false);
}

export interface EasyReadingSwitchProps {
  /** On the deep surface (the menu): the colours measured against it. */
  onDeep?: boolean | undefined;
  className?: string | undefined;
}

export function EasyReadingSwitch({ onDeep = false, className }: EasyReadingSwitchProps) {
  const on = useEasyReading();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => {
        setEasyReading(!on);
      }}
      className={cn(
        'inline-flex min-h-11 items-center gap-2 rounded-control px-2 text-left underline-offset-4 hover:underline',
        'focus-visible:outline-2 focus-visible:outline-offset-2',
        onDeep
          ? 'text-on-deep focus-visible:outline-on-deep'
          : 'text-ink focus-visible:outline-ink',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'relative inline-block h-5 w-9 shrink-0 rounded-full border-2',
          onDeep ? 'border-on-deep' : 'border-ink',
          on && (onDeep ? 'bg-on-deep' : 'bg-ink'),
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 size-3 rounded-full transition-[left] duration-[120ms] motion-reduce:transition-none',
            on ? 'left-[1.125rem]' : 'left-0.5',
            on ? (onDeep ? 'bg-deep' : 'bg-paper') : onDeep ? 'bg-on-deep' : 'bg-ink',
          )}
        />
      </span>
      <span>
        Easier reading<span aria-hidden="true">: {on ? 'On' : 'Off'}</span>
      </span>
    </button>
  );
}
