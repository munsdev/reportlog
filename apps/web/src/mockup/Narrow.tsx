import { useEffect } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { plainSiteName, useSite } from '../components/ui/site.tsx';

/**
 * The mock-up's single narrow column on a light page: `.wrap` with the page's
 * own top padding, max width and grid gap (tips-sent, t-erase, setup, ...).
 * The root carries `data-bleed` so the public frame steps aside.
 */
export function Narrow({
  children,
  top = 28,
  max = 720,
  gap = 18,
  inner = false,
}: {
  children: ReactNode;
  top?: number;
  max?: number;
  gap?: number;
  /** tips-sent: the grid sits in a div inside `.wrap`, not on it. */
  inner?: boolean;
}) {
  const grid: CSSProperties = {
    display: 'grid',
    gap: `${String(gap)}px`,
    maxWidth: `${String(max)}px`,
  };
  return (
    <div data-bleed>
      {inner ? (
        <div className="wrap" style={{ paddingTop: `${String(top)}px` }}>
          <div style={grid}>{children}</div>
        </div>
      ) : (
        <div className="wrap" style={{ paddingTop: `${String(top)}px`, ...grid }}>
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * A page reached from an emailed link (mock-up t-*.html): eyebrow, the one
 * `h-page` heading, then the page's own parts.
 */
export function TokenPage({
  eyebrow,
  title,
  children,
}: {
  /** Left out, it is the site's name, as on every mock-up token page. */
  eyebrow?: ReactNode;
  title: ReactNode;
  children?: ReactNode;
}) {
  const site = plainSiteName(useSite().data);
  useEffect(() => {
    if (typeof title === 'string') document.title = `${title} · ${site}`;
  }, [title, site]);
  return (
    <Narrow>
      <span className="eyebrow">{eyebrow ?? site}</span>
      <h1 className="h-page" id="h1">
        {title}
      </h1>
      {children}
    </Narrow>
  );
}
