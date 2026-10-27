import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link } from '@tanstack/react-router';

export type BtnKind = 'ink' | 'go' | 'ghost' | 'bad' | '';

/** The mock-up's small flat button (staff.py `btn`): `btn sm flat` plus a kind. */
export function Btn({
  kind = '',
  className,
  type = 'button',
  children,
  ...rest
}: { kind?: BtnKind; children?: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const cls = `btn sm flat ${kind}`.trim();
  return (
    <button {...rest} type={type} className={className ? `${cls} ${className}` : cls}>
      {children}
    </button>
  );
}

/** The same button as a link. */
export function BtnLink({
  kind = '',
  to,
  children,
}: {
  kind?: BtnKind;
  to: string;
  children?: ReactNode;
}) {
  return (
    <Link to={to} className={`btn sm flat ${kind}`.trim()}>
      {children}
    </Link>
  );
}
