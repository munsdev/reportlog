import type { ReactNode } from 'react';

/** The mock-up's `.dlg` dialog box, with its buttons in `.acts`. */
export function Dlg({
  title,
  buttons,
  children,
}: {
  title: string;
  buttons: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="dlg" role="dialog" aria-label={title}>
      <h3>{title}</h3>
      {children}
      <div className="acts">{buttons}</div>
    </div>
  );
}
