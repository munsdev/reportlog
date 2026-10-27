import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

/**
 * The mock-up's one-question card (`.qcard`): eyebrow, progress bar, step
 * label, the question, the control, and the fixed bottom bar. Used by the
 * lists' forms (tips-1.html ... volunteer-6.html).
 */
export function QCard({
  headingId,
  onSubmit,
  children,
}: {
  headingId: string;
  onSubmit: () => void;
  children: ReactNode;
}) {
  return (
    <div data-bleed>
      <div className="wrap">
        <form
          className="qcard"
          noValidate
          aria-labelledby={headingId}
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
        >
          {children}
        </form>
      </div>
    </div>
  );
}

export function QProgress({ percent }: { percent: number }) {
  const p = Math.round(Math.min(100, Math.max(0, percent)));
  return (
    <div
      className="progress"
      role="progressbar"
      aria-valuenow={p}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Progress"
    >
      <span style={{ width: `${String(p)}%` }} />
    </div>
  );
}

/** The question: takes focus when `focusKey` changes, as the page does not reload between cards. */
export function QHeading({
  id,
  focusKey,
  children,
}: {
  id: string;
  focusKey: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    ref.current?.focus();
    if (typeof window.scrollTo === 'function') window.scrollTo(0, 0);
  }, [focusKey]);
  return (
    <h1 id={id} ref={ref} tabIndex={-1} style={{ outline: 'none' }}>
      {children}
    </h1>
  );
}

/** A sentence saying what is wrong, with a mark; takes focus when it appears. */
export function QError({ id, children }: { id?: string | undefined; children: ReactNode }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <p ref={ref} id={id} role="alert" tabIndex={-1} className="error" style={{ outline: 'none' }}>
      <span aria-hidden="true">! </span>
      <span className="vh">Error: </span>
      {children}
    </p>
  );
}

/** The fixed bar: Back on the left, the primary on the right. Never disabled. */
export function QBar({
  onBack,
  primary,
  go = false,
  busy = false,
  busyLabel,
  above,
}: {
  onBack?: (() => void) | undefined;
  primary: ReactNode;
  go?: boolean;
  busy?: boolean;
  busyLabel?: ReactNode;
  above?: ReactNode;
}) {
  return (
    <div className="bottom-bar">
      {above ? (
        <div className="in" style={{ display: 'block', paddingBottom: 8 }}>
          {above}
        </div>
      ) : null}
      <div className="in">
        {onBack ? (
          <button className="btn ghost" type="button" onClick={onBack}>
            Back
          </button>
        ) : (
          <span />
        )}
        <button
          className={`btn ${go ? 'go' : 'ink'}`}
          type="submit"
          aria-disabled={busy || undefined}
        >
          {busy && busyLabel ? busyLabel : primary}
        </button>
      </div>
    </div>
  );
}

/** One option of a radio group (`.choice`) or a tick box (`.choice.multi`). */
export function Choice({
  type = 'radio',
  name,
  checked,
  onChange,
  children,
  id,
}: {
  type?: 'radio' | 'checkbox';
  name?: string;
  checked: boolean;
  onChange: (on: boolean) => void;
  children: ReactNode;
  id?: string;
}) {
  return (
    <label className={type === 'checkbox' ? 'choice multi' : 'choice'}>
      <input
        id={id}
        type={type}
        name={name}
        checked={checked}
        onChange={(e) => {
          onChange(e.target.checked);
        }}
      />
      <span className="dot" aria-hidden="true" />
      {children}
    </label>
  );
}

/** A label, its control and an optional help line (`.field`). */
export function Field({
  label,
  htmlFor,
  optional = false,
  help,
  children,
}: {
  label: ReactNode;
  htmlFor?: string;
  optional?: boolean;
  help?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>
        {label}
        {optional ? (
          <>
            {' '}
            <span className="muted">(optional)</span>
          </>
        ) : null}
      </label>
      {children}
      {help ? <span className="help">{help}</span> : null}
    </div>
  );
}
