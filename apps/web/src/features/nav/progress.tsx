/**
 * THE PROGRESS RULE: on a filing card, the header's 6px bottom rule becomes
 * the progress track (docs/design/navigation.md, section 01).
 *
 * The page that knows how far somebody is (the filing form) says so with
 * `useHeaderProgress(percent)`; the header draws it. `null` is "no progress
 * to show" (the intro card, every other page), and the rule is the plain
 * brand rule again. It never shows a number: the page keeps its own
 * `role="progressbar"`, visually hidden, for screen readers, so this one is
 * decoration and is hidden from them.
 */
import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils.ts';

interface Progress {
  percent: number | null;
  set: (percent: number | null) => void;
}

const ProgressContext = createContext<Progress>({ percent: null, set: () => undefined });

export function HeaderProgressProvider({ children }: { children: ReactNode }) {
  const [percent, set] = useState<number | null>(null);
  return <ProgressContext.Provider value={{ percent, set }}>{children}</ProgressContext.Provider>;
}

/** Show `percent` (0 to 100) in the header's rule while this page is on screen; `null` hides it. */
export function useHeaderProgress(percent: number | null): void {
  const { set } = useContext(ProgressContext);
  useEffect(() => {
    set(percent === null ? null : Math.min(100, Math.max(0, percent)));
  }, [percent, set]);
  // Leaving the page puts the plain rule back.
  useEffect(
    () => () => {
      set(null);
    },
    [set],
  );
}

/** The same, as an element, for a page that decides it after an early return. */
export function HeaderProgress({ percent }: { percent: number | null }) {
  useHeaderProgress(percent);
  return null;
}

export function useProgressPercent(): number | null {
  return useContext(ProgressContext).percent;
}

/** The header's bottom rule: the brand rule, or the progress track over a hairline. */
export function ProgressRule({ percent }: { percent: number | null }) {
  return (
    <div
      aria-hidden="true"
      data-progress={percent === null ? undefined : String(percent)}
      className={cn('h-1.5 w-full', percent === null ? 'bg-brand-on-deep' : 'bg-line-on-deep')}
    >
      {percent === null ? null : (
        // A width, which is a number and not a look (test/ui/client-first).
        // It jumps rather than slides: motion is only ever a press or the
        // menu opening (components.md, section 01).
        <div className="h-full bg-brand-on-deep" style={{ width: `${String(percent)}%` }} />
      )}
    </div>
  );
}
