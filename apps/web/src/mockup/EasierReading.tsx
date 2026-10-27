/**
 * "Easier reading" as the mock-up draws it: a plain button carrying
 * `data-easy`, pressed or not. The behaviour is the app's own (a setting of
 * this browser, features/easy-reading/easyReading.ts), which repaints the
 * site in the High contrast look. The mock-up's page script also marks
 * <html class="easy"> (larger type, no decoration), so this keeps that class
 * in step, and writes the label the way the script does so the two never
 * disagree about the text.
 */
import { useEffect, useLayoutEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import { setEasyReading } from '@/features/easy-reading/easyReading.ts';
import { useEasyReading } from '@/features/easy-reading/EasyReadingSwitch.tsx';

/** Keeps <html class="easy"> in step with the setting. Renders nothing. */
export function EasyClass() {
  const on = useEasyReading();
  useEffect(() => {
    document.documentElement.classList.toggle('easy', on);
  }, [on]);
  return null;
}

export function EasierReadingButton({
  className,
  style,
}: {
  className?: string;
  style?: CSSProperties;
}) {
  const on = useEasyReading();
  const ref = useRef<HTMLButtonElement>(null);
  // The label is text the page script rewrites after every page, so it is
  // set the same way here rather than as a child React would then lose.
  useLayoutEffect(() => {
    if (ref.current) ref.current.textContent = on ? 'Easier reading: on' : 'Easier reading';
  }, [on]);
  return (
    <button
      ref={ref}
      type="button"
      data-easy
      aria-pressed={on}
      onClick={() => {
        setEasyReading(!on);
      }}
      {...(className ? { className } : {})}
      {...(style ? { style } : {})}
    />
  );
}
