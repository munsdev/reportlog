/**
 * The frame around every filing card, for a logbook (FilingForm) and a list
 * (ListForm) alike (docs/design/screens/filing.md §02).
 *
 *   step label  "Question 3" (or the card's own: "Optional", "Review"), in the
 *               mock-up's .step face
 *   heading     the question, as the page's one <h1>. It takes focus on every card change, because the page
 *               does not reload between questions and nothing else would
 *               tell a screen reader the content changed
 *   help        under the question, in the muted colour
 *   the control
 *   the error   a sentence with a mark, `role="alert"`
 *   the bar     Back and Next, fixed to the bottom of the screen so a thumb
 *               finds them without scrolling past a long list, and above
 *               the on-screen keyboard
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
import { Btn } from '@/mockup/Btn.tsx';
import { plainSiteName, useSite } from '@/components/ui/site.tsx';

// ── the progress rule ───────────────────────────────────────────────────

let progress: number | null = null;
let question: number | null = null;
const listeners = new Set<() => void>();

/** Which question is on screen (1 for the first), or null; read by the card's step label. */
export function setFilingQuestion(n: number | null): void {
  if (n === question) return;
  question = n;
  for (const l of listeners) l();
}

function useFilingQuestion(): number | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => question,
    () => null,
  );
}

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
 * the form goes, and draws the progress bar at the top of the card (mock-up
 * .progress). The bar is the page's `role="progressbar"`; it shows no
 * numbers, and the card's step label says "Question 3", never "3 of 8".
 */
export function FilingProgress({
  value,
  question: n = null,
}: {
  value: number | null;
  /** Which question this is, for the card's step label. */
  question?: number | null;
}) {
  useEffect(() => {
    setFilingProgress(value);
  }, [value]);
  useEffect(() => {
    setFilingQuestion(n);
  }, [n]);
  useEffect(
    () => () => {
      setFilingProgress(null);
      setFilingQuestion(null);
    },
    [],
  );
  if (value === null) return null;
  const percent = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div
      className="progress"
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Progress"
    >
      <span style={{ width: `${String(percent)}%` }} />
    </div>
  );
}

// ── the tab title ───────────────────────────────────────────────────────

/**
 * "How did you vote, or try to vote? (question 2) · Our Town Votes": the
 * question, which one it is, and the site. No total: it falls as you answer
 * and reads as a trap. On a door the site's name is not asked for, and the
 * software's stands in.
 */
export function useCardTitle(title: string, place?: { n: number; of: number } | null) {
  const site = plainSiteName(useSite().data);
  const where = place ? ` (question ${String(place.n)})` : '';
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
  /** The logbook's or list's title: shown where no step label applies. */
  eyebrow: ReactNode;
  /** The card's step label ("Review"), instead of "Question n". */
  stepLabel?: ReactNode;
  heading: ReactNode;
  /** Changes when the card does: the heading takes focus again. */
  focusKey: string;
  headingId?: string | undefined;
  /** Says "optional" after the question's number. */
  optional?: boolean | undefined;
  /**
   * What kind of card this is, said in place of the question's number when it
   * is not an ordinary one: "Optional", "Asked because you wrote something".
   */
  step?: string | undefined;
  /** Said after the question's number: "asked because of an earlier answer". */
  note?: string | undefined;
  /**
   * The question is a group of answer tiles: the heading is the legend of a
   * fieldset, as in the mock-up, and names the group.
   */
  grouped?: boolean | undefined;
  /** Help under the question. Give it an id if the control points at it. */
  help?: ReactNode;
  /** The sentence that says what is wrong, or nothing. */
  error?: string | null | undefined;
  errorId?: string | undefined;
  children?: ReactNode;
}

/**
 * One card's content, drawn inside the mock-up's `.qcard` form (the step
 * label, the heading as the page's one <h1>, its help, the control, and the
 * error). The progress bar and the bar with Back and Next are the form's.
 */
export function CardFrame({
  eyebrow,
  stepLabel,
  heading,
  focusKey,
  headingId,
  optional = false,
  step,
  note,
  grouped = false,
  help,
  error,
  errorId,
  children,
}: CardFrameProps) {
  const ref = useRef<HTMLHeadingElement>(null);
  const n = useFilingQuestion();
  const base = stepLabel ?? (n === null ? eyebrow : `Question ${String(n)}`);
  const tail = note ?? (optional ? 'optional' : null);
  useEffect(() => {
    ref.current?.focus();
    // jsdom has no layout to scroll; a browser goes back to the top.
    if (typeof window.scrollTo === 'function') window.scrollTo(0, 0);
  }, [focusKey]);
  const title = (
    <h1 ref={ref} id={headingId} tabIndex={-1} className="outline-none">
      {heading}
    </h1>
  );
  return (
    <>
      <span className="step">
        {step ?? base}
        {step || !tail ? null : ` · ${tail}`}
      </span>
      {grouped ? (
        <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 14 }}>
          <legend>{title}</legend>
          {help}
          {children}
        </fieldset>
      ) : (
        <>
          {title}
          {help}
          {children}
        </>
      )}
      {/* Keyed by its words, so a different problem is announced and focused anew. */}
      {error ? (
        <CardError key={error} id={errorId} focus>
          {error}
        </CardError>
      ) : null}
    </>
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
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focus) ref.current?.focus();
  }, [focus]);
  return (
    <div
      ref={ref}
      id={id}
      role="alert"
      tabIndex={focus ? -1 : undefined}
      className="note warn outline-none"
    >
      <span aria-hidden="true">
        <b>!</b>
      </span>
      <span>
        <span className="sr-only">Error:</span> {children}
      </span>
    </div>
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
 * viewport and not the layout one), so the bar sits above the keyboard.
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
  /** The primary: Start, Next, Send. Never disabled. */
  primary: ReactNode;
  onPrimary?: (() => void) | undefined;
  /** A submit button for the form around the card, rather than a click. */
  submit?: boolean | undefined;
  /** The action colour (Send) instead of the dark fill (Next). */
  go?: boolean | undefined;
  busy?: boolean | undefined;
  busyLabel?: ReactNode;
  /** A line above the buttons: the door's status, a send refused. */
  above?: ReactNode;
}

/**
 * The mock-up's bottom bar: Back at the left, the primary at the right,
 * fixed to the bottom of the screen (the form leaves room for it). A message
 * for above the buttons sits in the card, just before the bar, so a long one
 * cannot cover the answers.
 */
export function CardBar({
  onBack,
  primary,
  onPrimary,
  submit = false,
  go = false,
  busy = false,
  busyLabel,
  above,
}: CardBarProps) {
  useKeyboardInset();
  return (
    <>
      {above}
      <div
        className="bottom-bar"
        data-card-bar=""
        style={{ bottom: 'var(--rl-card-bar-inset, 0px)' }}
      >
        <div className="in">
          {onBack ? (
            <Btn look="ghost" onClick={onBack}>
              Back
            </Btn>
          ) : (
            <span />
          )}
          <Btn
            look={go ? 'go' : 'ink'}
            type={submit ? 'submit' : 'button'}
            busy={busy}
            busyLabel={busyLabel}
            {...(submit ? {} : { onClick: onPrimary })}
          >
            {primary}
          </Btn>
        </div>
      </div>
    </>
  );
}
