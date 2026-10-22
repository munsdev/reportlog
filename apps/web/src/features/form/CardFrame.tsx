/**
 * The frame around every filing card, for a logbook (FilingForm) and a list
 * (ListForm) alike (docs/design/screens/filing.md §02).
 *
 *   eyebrow     the logbook's or list's title, in the label face
 *   heading     the question, as the page's one <h1>, set in the section
 *               size. It takes focus on every card change, because the page
 *               does not reload between questions and nothing else would
 *               tell a screen reader the content changed
 *   help        under the question, in the second text colour
 *   the control
 *   the error   a sentence with a mark, `role="alert"`
 *   the bar     Back and Next. Fixed to the bottom of a phone's screen, so a
 *               thumb finds them without scrolling past a long list, and
 *               above the on-screen keyboard; under the control on a desktop
 *
 * NEXT IS NEVER DISABLED. Pressing it on a card that needs an answer keeps
 * the person on the card and says why; a dead button says nothing.
 *
 * THE PROGRESS RULE. How far through the form somebody is, as a share of the
 * cards still possible, is published here (`useFilingProgress`) for the
 * site header to draw as its bottom rule (navigation.md, Progress rule). The
 * page keeps a visually hidden progressbar for screen readers. No numbers
 * are shown: a total that falls as you answer reads as a trap.
 */
import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { Eyebrow } from '@/components/ui/type.tsx';
import { plainSiteName, useSite } from '@/components/ui/site.tsx';
import { cn } from '@/lib/utils.ts';

// ── the progress rule ───────────────────────────────────────────────────

let progress: number | null = null;
const listeners = new Set<() => void>();

/**
 * How far through the form the person is, from 0 to 1, or null when no
 * filing card is on screen (the opening card, any other page). Also set on
 * <html> as `data-filing-progress` and `--rl-filing-progress`, so a header
 * drawn without React state can follow it in CSS.
 */
export function setFilingProgress(value: number | null): void {
  const next = value === null ? null : Math.min(1, Math.max(0, value));
  if (next === progress) return;
  progress = next;
  const root = typeof document === 'undefined' ? null : document.documentElement;
  if (root) {
    if (next === null) {
      root.removeAttribute('data-filing-progress');
      root.style.removeProperty('--rl-filing-progress');
    } else {
      root.setAttribute('data-filing-progress', '');
      root.style.setProperty('--rl-filing-progress', String(next));
    }
  }
  for (const l of listeners) l();
}

/** For the site header: the share of the form done, or null for no rule. */
export function useFilingProgress(): number | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => progress,
    () => null,
  );
}

/**
 * Publishes the progress while a card is on screen and takes it away when
 * the form goes, and draws the hidden progressbar a screen reader reads.
 */
export function FilingProgress({ value }: { value: number | null }) {
  useEffect(() => {
    setFilingProgress(value);
  }, [value]);
  useEffect(
    () => () => {
      setFilingProgress(null);
    },
    [],
  );
  if (value === null) return null;
  const percent = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div
      role="progressbar"
      aria-label="How far through the form"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className="sr-only"
    />
  );
}

// ── the tab title ───────────────────────────────────────────────────────

/**
 * "How did you vote, or try to vote? (2 of 8) · ElectionLog": the question,
 * where it is among the cards still possible, and the site. On a door the
 * site's name is not asked for, and the software's stands in.
 */
export function useCardTitle(title: string, place?: { n: number; of: number } | null) {
  const site = plainSiteName(useSite().data);
  const where = place ? ` (${String(place.n)} of ${String(Math.max(place.n, place.of))})` : '';
  useEffect(() => {
    document.title = `${title}${where} · ${site}`;
  }, [title, where, site]);
}

/**
 * Focus this element once, when it first appears: a receipt's heading, an
 * alert that says why Send did nothing. Not on every render, or focus would
 * be pulled back to it while somebody is doing something else.
 */
export function useFocusOnMount<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return ref;
}

// ── the card ────────────────────────────────────────────────────────────

export interface CardFrameProps {
  /** The logbook's or list's title. */
  eyebrow: ReactNode;
  heading: ReactNode;
  /** Changes when the card does: the heading takes focus again. */
  focusKey: string;
  headingId?: string | undefined;
  /** "Optional." after the question. */
  optional?: boolean | undefined;
  /** Help under the question. Give it an id if the control points at it. */
  help?: ReactNode;
  /** The sentence that says what is wrong, or nothing. */
  error?: string | null | undefined;
  errorId?: string | undefined;
  children?: ReactNode;
}

export function CardFrame({
  eyebrow,
  heading,
  focusKey,
  headingId,
  optional = false,
  help,
  error,
  errorId,
  children,
}: CardFrameProps) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    ref.current?.focus();
    // jsdom has no layout to scroll; a browser goes back to the top.
    if (typeof window.scrollTo === 'function') window.scrollTo(0, 0);
  }, [focusKey]);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Eyebrow>{eyebrow}</Eyebrow>
        <h1
          ref={ref}
          id={headingId}
          tabIndex={-1}
          className="font-display text-section font-bold outline-none"
        >
          {heading}
        </h1>
        {optional ? <p className="text-sm text-ink-alt">Optional.</p> : null}
        {help}
      </div>
      {children}
      {/* Keyed by its words, so a different problem is announced and focused anew. */}
      {error ? (
        <CardError key={error} id={errorId} focus>
          {error}
        </CardError>
      ) : null}
    </div>
  );
}

/** The error under a control: a mark and a sentence, never colour alone. */
export function CardError({
  id,
  focus = false,
  children,
}: {
  id?: string | undefined;
  /** Take focus when it appears: the card's own error, after Next was pressed. */
  focus?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (focus) ref.current?.focus();
  }, [focus]);
  return (
    <p
      ref={ref}
      id={id}
      role="alert"
      tabIndex={focus ? -1 : undefined}
      className="flex gap-1.5 text-sm font-semibold text-serious outline-none"
    >
      <span aria-hidden="true">!</span>
      <span>
        <span className="sr-only">Error:</span> {children}
      </span>
    </p>
  );
}

// ── the bar ─────────────────────────────────────────────────────────────

/** How far the on-screen keyboard reaches up the screen, or 0 without one. */
function keyboardInset(): number {
  const vv = typeof window === 'undefined' ? undefined : window.visualViewport;
  if (!vv) return 0;
  return Math.max(0, window.innerHeight - (vv.height + vv.offsetTop));
}

/**
 * Keeps `--rl-card-bar-inset` on <html> at the keyboard's height while a bar
 * is on screen, read from `visualViewport` (the keyboard shrinks the visual
 * viewport and not the layout one), as the Save bar does. A variable rather
 * than an inline style: no component carries a style of its own.
 */
function useKeyboardInset(): void {
  useEffect(() => {
    const root = document.documentElement;
    const vv = window.visualViewport;
    const update = () => {
      root.style.setProperty('--rl-card-bar-inset', `${String(keyboardInset())}px`);
    };
    update();
    vv?.addEventListener('resize', update);
    vv?.addEventListener('scroll', update);
    return () => {
      vv?.removeEventListener('resize', update);
      vv?.removeEventListener('scroll', update);
      root.style.removeProperty('--rl-card-bar-inset');
    };
  }, []);
}

export interface CardBarProps {
  /** Left out on a card with nowhere to go back to. */
  onBack?: (() => void) | undefined;
  /** The primary: Start, Next, Send report. Never disabled. */
  primary: ReactNode;
  onPrimary?: (() => void) | undefined;
  /** A submit button for the form around the card, rather than a click. */
  submit?: boolean | undefined;
  busy?: boolean | undefined;
  busyLabel?: ReactNode;
  /** A line above the buttons: the door's status, a send refused. */
  above?: ReactNode;
}

/**
 * Back takes a third and the primary two thirds on a phone, fixed to the
 * bottom of the screen with a spacer of its height in the page, so the last
 * choice on a long list can always be scrolled clear of it. On a desktop
 * they sit under the card, the primary on the right.
 */
export function CardBar({
  onBack,
  primary,
  onPrimary,
  submit = false,
  busy = false,
  busyLabel,
  above,
}: CardBarProps) {
  useKeyboardInset();
  return (
    <>
      <div aria-hidden="true" className="h-36 sm:hidden" />
      <div
        data-card-bar=""
        className={cn(
          'fixed inset-x-0 bottom-(--rl-card-bar-inset,0px) z-30 flex flex-col gap-3 border-t-(length:--rl-border-main) border-ink-alt bg-surface p-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))] print:hidden',
          'sm:static sm:z-auto sm:border-t-0 sm:bg-transparent sm:p-0 sm:pt-2',
        )}
      >
        {above}
        <div className="flex gap-3 sm:justify-between">
          {onBack ? (
            <Button
              type="button"
              variant="secondary"
              size="lg"
              className="basis-1/3 sm:basis-auto"
              onClick={onBack}
            >
              Back
            </Button>
          ) : (
            <span className="hidden sm:block" />
          )}
          <Button
            type={submit ? 'submit' : 'button'}
            size="lg"
            className={cn('grow sm:grow-0', onBack ? 'basis-2/3 sm:basis-auto' : 'basis-full')}
            busy={busy}
            busyLabel={busyLabel}
            onClick={onPrimary}
          >
            {primary}
          </Button>
        </div>
      </div>
    </>
  );
}
