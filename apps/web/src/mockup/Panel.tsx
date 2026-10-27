import { messageOf } from '../features/identity/ui.tsx';
import type { ReactNode } from 'react';

/** The mock-up's `.panel` section: a heading and its words ("quiet", "deep", "danger" variants). */
export function Panel({
  title,
  variant,
  children,
}: {
  title?: ReactNode;
  variant?: 'quiet' | 'deep' | 'danger';
  children: ReactNode;
}) {
  return (
    <section className={variant ? `panel ${variant}` : 'panel'}>
      {title ? <h2>{title}</h2> : null}
      {children}
    </section>
  );
}

/** The mock-up's `.note`: a short boxed statement. `warn` is a problem, said in words. */
export function Note({
  title,
  warn = false,
  children,
}: {
  title?: ReactNode;
  warn?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className={warn ? 'note warn' : 'note'} role={warn ? 'alert' : 'status'}>
      <span>
        {title ? <b>{title} </b> : null}
        {children}
      </span>
    </div>
  );
}

/** A failure from a call, as a boxed sentence a person can read. */
export function ErrorNote({ error, title }: { error: unknown; title?: ReactNode }) {
  if (!error) return null;
  return (
    <Note warn title={title}>
      {messageOf(error)}
    </Note>
  );
}

/** A one-line wait, in the narrow column. */
export function Waiting({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="muted">
      {children}
    </p>
  );
}
