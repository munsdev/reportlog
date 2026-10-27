import type { ReactNode } from 'react';

/** The mock-up's `.error` line under a field. Draws nothing when there is no message. */
export function Err({ id, children }: { id?: string; children?: ReactNode }) {
  if (!children) return null;
  return (
    <p className="error" role="alert" {...(id ? { id } : {})}>
      {children}
    </p>
  );
}

/** A problem a call returned, as the mock-up's amber `.note.warn`. */
export function Problem({ title, children }: { title?: ReactNode; children?: ReactNode }) {
  return (
    <div className="note warn" role="alert">
      <span>
        {title ? <b>{title} </b> : null}
        {children}
      </span>
    </div>
  );
}
