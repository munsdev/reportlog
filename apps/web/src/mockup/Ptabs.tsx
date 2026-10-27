import { Link } from '@tanstack/react-router';
import type { LinkProps } from '@tanstack/react-router';

export interface PtabsTab {
  to: NonNullable<LinkProps['to']>;
  label: string;
  current: boolean;
}

/**
 * The mock-up's `.ptabs`: a staff page's own sections as a row of links under
 * its head, the one you are on marked `aria-current="page"`. Links with
 * addresses, so Back works and each can be bookmarked.
 */
export function Ptabs({ label = 'Sections', tabs }: { label?: string; tabs: readonly PtabsTab[] }) {
  return (
    <nav className="ptabs" aria-label={label}>
      {tabs.map((t) => (
        <Link
          key={t.to}
          to={t.to}
          activeOptions={{ exact: true, includeSearch: false }}
          activeProps={{}}
          aria-current={t.current ? 'page' : undefined}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
