/**
 * A toast: one short sentence that a switch has taken effect ("Accepting
 * reports is now off"), at the bottom of the screen, above the Save bar.
 *
 * NEVER FOR AN ERROR. A toast goes away by itself, and an error that goes
 * away by itself is one somebody missed; errors are alerts that stay on the
 * page until they are dealt with.
 *
 * It stays five seconds, longer while the pointer is over it or focus is in
 * it (so somebody reading it, or reaching for Dismiss, is not raced), and
 * Dismiss closes it at once. The live region is on the page from the start,
 * empty, because a screen reader only announces changes to a region it
 * already knows about.
 *
 *   const toast = useToast();
 *   toast.show('Accepting reports is now off.');
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
import { Button } from './button.tsx';

export const TOAST_MS = 5000;

interface ToastValue {
  show: (message: string) => void;
}

const ToastContext = createContext<ToastValue | null>(null);

export function useToast(): ToastValue {
  const value = useContext(ToastContext);
  if (!value) throw new Error('useToast needs <ToastProvider> around the page.');
  return value;
}

interface Shown {
  message: string;
  /** A new id for the same words, so saying them twice restarts the clock. */
  id: number;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState<Shown | null>(null);
  const next = useRef(0);
  const show = useCallback((message: string) => {
    next.current += 1;
    setShown({ message, id: next.current });
  }, []);
  const value = useMemo(() => ({ show }), [show]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        role="status"
        className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--rl-savebar-height,0px)+1rem)] z-40 flex justify-center px-4 print:hidden"
      >
        {shown ? (
          <Toast
            key={shown.id}
            message={shown.message}
            onDone={() => {
              setShown(null);
            }}
          />
        ) : null}
      </div>
    </ToastContext.Provider>
  );
}

function Toast({ message, onDone }: { message: string; onDone: () => void }) {
  const left = useRef(TOAST_MS);
  const started = useRef(0);
  const [held, setHeld] = useState({ hover: false, focus: false });
  const paused = held.hover || held.focus;

  // Count down only while nobody is holding it; on hold, keep what is left.
  useEffect(() => {
    if (paused) return;
    started.current = Date.now();
    const timer = setTimeout(onDone, left.current);
    return () => {
      clearTimeout(timer);
      left.current = Math.max(0, left.current - (Date.now() - started.current));
    };
  }, [paused, onDone]);

  return (
    // The hover and focus handlers only hold the timer; the Dismiss button
    // inside is how anybody, with any input, acts on the toast.
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div
      className="pointer-events-auto flex max-w-full items-center gap-4 rounded-control bg-deep py-2.5 pr-3 pl-4.5 text-on-deep shadow-raised"
      onMouseEnter={() => {
        setHeld((h) => ({ ...h, hover: true }));
      }}
      onMouseLeave={() => {
        setHeld((h) => ({ ...h, hover: false }));
      }}
      onFocus={() => {
        setHeld((h) => ({ ...h, focus: true }));
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setHeld((h) => ({ ...h, focus: false }));
      }}
    >
      <p className="min-w-0">{message}</p>
      <Button variant="quiet" className="shrink-0 text-on-deep" onClick={onDone}>
        Dismiss
      </Button>
    </div>
  );
}
