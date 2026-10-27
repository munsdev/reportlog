import type { InputHTMLAttributes, ReactNode } from 'react';

/** The mock-up's `.choices` list of radio or check rows. */
export function Choices({ children }: { children: ReactNode }) {
  return <div className="choices">{children}</div>;
}

/** One `.choice` (radio) or `.choice.multi` (check box). */
export function Choice({
  multi = false,
  children,
  ...rest
}: { multi?: boolean; children: ReactNode } & Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  return (
    <label className={multi ? 'choice multi' : 'choice'}>
      <input type={multi ? 'checkbox' : 'radio'} {...rest} />
      <span className="dot" aria-hidden="true"></span>
      {children}
    </label>
  );
}

/** The plain `.check` line used by "I understand this cannot be undone". */
export function Check({
  children,
  ...rest
}: { children: ReactNode } & Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  return (
    <label className="check">
      <input type="checkbox" {...rest} /> {children}
    </label>
  );
}
