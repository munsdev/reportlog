import { Link } from '@tanstack/react-router';
import type { LinkProps } from '@tanstack/react-router';

export interface PTab {
  to: NonNullable<LinkProps['to']>;
  label: string;
  current: boolean;
}

/** The mock-up's `ptabs`: links under a page head, the current one marked `aria-current`. */
export function PTabs({ label, tabs }: { label: string; tabs: readonly PTab[] }) {
  return (
    <nav className="ptabs" aria-label={label}>
      {tabs.map((t) => (
        <Link key={t.to} to={t.to} {...(t.current ? { 'aria-current': 'page' as const } : {})}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
