/**
 * The few form controls the builder needs, in the mock-up's look
 * (src/mockup/): `field`, `input`, `textarea`, `sel`, `panel`, `note`. Kept
 * as the builder's own small API so its screens did not have to change to
 * get the look. Every control has a visible label tied to it, and help is
 * read out with it.
 */
import type { ComponentProps, ReactNode } from 'react';
import { useId } from 'react';
import { CheckOption } from '@/mockup/ChoicesWired.tsx';
import { Note } from '@/mockup/NoteBox.tsx';
import { Panel as MockPanel } from '@/mockup/PanelBox.tsx';
import { cn } from '@/lib/utils.ts';

interface FieldProps {
  label: string;
  help?: string | undefined;
  children: (props: { id: string; 'aria-describedby'?: string }) => ReactNode;
}

/** A label, the control, and help under it, wired together. */
export function Field({ label, help, children }: FieldProps) {
  const id = useId();
  const helpId = `${id}-help`;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children(help ? { id, 'aria-describedby': helpId } : { id })}
      {help && (
        <span id={helpId} className="help">
          {help}
        </span>
      )}
    </div>
  );
}

export function TextInput({ className, ...props }: ComponentProps<'input'>) {
  return <input type="text" className={cn('input', className)} {...props} />;
}

export function TextArea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={cn('textarea', className)} {...props} />;
}

export function Select({ className, ...props }: ComponentProps<'select'>) {
  return <select className={cn('sel', className)} {...props} />;
}

/** A yes/no as a choice card, with an optional line of why. */
export function Check({
  label,
  help,
  checked,
  disabled,
  onCheckedChange,
}: {
  label: string;
  help?: string | undefined;
  checked: boolean;
  disabled?: boolean | undefined;
  onCheckedChange: (on: boolean) => void;
}) {
  return (
    <CheckOption
      label={label}
      hint={help}
      checked={checked}
      disabled={disabled}
      onCheckedChange={(on) => {
        onCheckedChange(on === true);
      }}
    />
  );
}

/** A refusal from the server, said where the control is. */
export function Problem({ error }: { error: Error | null }) {
  if (!error) return null;
  return <Note tone="serious" title={error.message} />;
}

export function Panel({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <MockPanel heading={title} {...(className ? { className } : {})}>
      {children}
    </MockPanel>
  );
}
