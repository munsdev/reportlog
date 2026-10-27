import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils.ts';

/** The mock-up's labelled field (site.css `.field`): label, control, then help. */
export function Field({
  label,
  labelId,
  htmlFor,
  help,
  helpId,
  helpMono = false,
  children,
}: {
  label?: ReactNode;
  /** Names a group of answer tiles (no single box to point a label at). */
  labelId?: string | undefined;
  htmlFor?: string | undefined;
  help?: ReactNode;
  helpId?: string | undefined;
  helpMono?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="field">
      {label ? (
        htmlFor ? (
          <label htmlFor={htmlFor}>{label}</label>
        ) : (
          <span className="lbl" id={labelId}>
            {label}
          </span>
        )
      ) : null}
      {children}
      {help ? (
        <span id={helpId} className={cn('help', helpMono && 'mono')}>
          {help}
        </span>
      ) : null}
    </div>
  );
}

/** The mock-up's text box, select and text area (site.css `.input`, `.sel`, `.textarea`). */
export function TextInput({ className, ...props }: ComponentProps<'input'>) {
  return <input {...props} className={cn('input', className)} />;
}

export function SelectBox({ className, ...props }: ComponentProps<'select'>) {
  return <select {...props} className={cn('sel', className)} />;
}

export function TextArea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea {...props} className={cn('textarea', className)} />;
}

/** The mock-up's single tick box (site.css `.check`). */
export function CheckBox({
  children,
  ...input
}: Omit<ComponentProps<'input'>, 'type' | 'children'> & { children: ReactNode }) {
  return (
    <label className="check">
      <input {...input} type="checkbox" /> {children}
    </label>
  );
}
