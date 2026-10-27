import type { ReactNode } from 'react';

/** The mock-up's `.note` that says a change was saved (the "Saved." strip). */
export function Saved({ children }: { children: ReactNode }) {
  return (
    <div className="note" role="status">
      {children}
    </div>
  );
}
