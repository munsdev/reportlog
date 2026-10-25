/**
 * A text field. Its border is the darker text colour rather than the
 * hairline colour, because a field's edge has to reach 3:1 against the page
 * to be found at all (WCAG 1.4.11), and the hairline does not. Text is 16px
 * whatever the theme, because a phone zooms into anything smaller. Disabled
 * shows as a dashed edge, never faded: faded text fails its contrast.
 *
 * A DATE OR TIME FIELD CARRIES ITS OWN CALENDAR (or clock). An iPhone draws
 * an empty date field as a blank box, with no icon and no placeholder, so
 * nothing says a calendar is one tap away; Chrome's own icon is a small
 * target at the far edge. So the mark is ours, the same on every phone, and
 * a tap anywhere on the field opens the browser's own picker
 * (`showPicker`). The picker itself stays the browser's: it is the one the
 * person already knows, and it honours the field's min and max.
 */
import type { ComponentProps, MouseEvent } from 'react';
import { cn } from '@/lib/utils.ts';
import { useFieldControl } from './field.tsx';

export const controlClass =
  'control-face min-h-11 w-full rounded-control border-[1.5px] border-ink-alt bg-surface px-3.5 py-2 font-sans text-base text-ink placeholder:text-muted disabled:cursor-not-allowed disabled:border-dashed disabled:bg-paper-alt disabled:text-ink-alt aria-invalid:border-2 aria-invalid:border-serious';

const PICKED: Record<string, 'calendar' | 'clock'> = {
  date: 'calendar',
  'datetime-local': 'calendar',
  month: 'calendar',
  week: 'calendar',
  time: 'clock',
};

/** Open the browser's picker, where it can; where it cannot, the tap still focuses the field. */
export function openPicker(input: HTMLInputElement): void {
  if (input.disabled || input.readOnly || typeof input.showPicker !== 'function') return;
  try {
    input.showPicker();
  } catch {
    // Refused (no user gesture, or a frame that may not): typing still works.
  }
}

export function Input({ className, type = 'text', onClick, ...props }: ComponentProps<'input'>) {
  const wired = useFieldControl(props);
  const mark = PICKED[type];
  if (!mark) {
    return (
      <input
        type={type}
        className={cn(controlClass, className)}
        onClick={onClick}
        {...props}
        {...wired}
      />
    );
  }
  return (
    <span className="relative block w-full">
      <input
        type={type}
        className={cn(controlClass, 'picker-face pr-11', className)}
        onClick={(e: MouseEvent<HTMLInputElement>) => {
          onClick?.(e);
          if (!e.defaultPrevented) openPicker(e.currentTarget);
        }}
        {...props}
        {...wired}
      />
      <PickerMark mark={mark} />
    </span>
  );
}

function PickerMark({ mark }: { mark: 'calendar' | 'clock' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      data-picker-mark={mark}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="pointer-events-none absolute top-1/2 right-3.5 size-5 -translate-y-1/2 text-ink-alt"
    >
      {mark === 'calendar' ? (
        <>
          <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
          <path d="M3.5 10h17M8 3v4M16 3v4" />
        </>
      ) : (
        <>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 7.5V12l3 2" />
        </>
      )}
    </svg>
  );
}
