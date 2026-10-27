import type { ReactNode } from 'react';

/** The mock-up's `.empty` block. */
export function Empty({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children ? <p className="muted">{children}</p> : null}
    </div>
  );
}
