import type { ReactNode } from 'react';
import { messageOf } from '../features/identity/ui.tsx';

/**
 * The mock-up's `.panel` (staff.py `panel`): a titled box. `kind` (or its older
 * name `variant`) is deep, quiet, danger or closed.
 */
export function Panel({
  title,
  sub,
  kind,
  variant,
  id,
  as: Tag = 'section',
  head,
  children,
}: {
  title?: ReactNode;
  sub?: ReactNode;
  kind?: 'deep' | 'quiet' | 'danger' | 'closed';
  variant?: 'deep' | 'quiet' | 'danger';
  id?: string;
  as?: 'section' | 'article';
  /** Something at the right of the title (a status chip): the mock-up's `.closed-head`. */
  head?: ReactNode;
  children?: ReactNode;
}) {
  const k = kind ?? variant;
  return (
    <Tag className={k ? `panel ${k}` : 'panel'} {...(id ? { id } : {})}>
      {head ? (
        <div className="closed-head">
          {title ? <h2>{title}</h2> : null}
          {head}
        </div>
      ) : title ? (
        <h2>{title}</h2>
      ) : null}
      {sub ? <p className="sub">{sub}</p> : null}
      {children}
    </Tag>
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
