import type { ReactNode } from 'react';

/**
 * `<div class="wrap two-col">`: the page, then `<aside class="aside">` with
 * its cards. The mock-up gives it 30 to 34px of padding under the band.
 */
export function TwoCol({
  aside,
  asideLabel = 'Related',
  pad = 34,
  children,
}: {
  aside?: ReactNode;
  asideLabel?: string;
  pad?: number;
  children: ReactNode;
}) {
  return (
    <div className="wrap two-col" style={{ paddingTop: pad }}>
      {children}
      {aside ? (
        <aside className="aside" aria-label={asideLabel}>
          {aside}
        </aside>
      ) : null}
    </div>
  );
}

/** `<div class="card [plain]">` with its h3: a side card. */
export function Card({
  title,
  plain = false,
  className,
  children,
}: {
  title: string;
  plain?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const cls = ['card', plain ? 'plain' : '', className ?? ''].filter(Boolean).join(' ');
  return (
    <div className={cls}>
      <h3>{title}</h3>
      {children}
    </div>
  );
}
