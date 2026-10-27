import type { ReactNode } from 'react';

/** The mock-up's `.note` strip; `warn` is the amber one. */
export function Note({ warn = false, children }: { warn?: boolean; children?: ReactNode }) {
  return (
    <div className={warn ? 'note warn' : 'note'} role={warn ? undefined : 'status'}>
      {children}
    </div>
  );
}
