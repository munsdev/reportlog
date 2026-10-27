import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

/** The mock-up's `.back` link above a page. */
export function Back({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link className="back" to={to}>
      ← {children}
    </Link>
  );
}
