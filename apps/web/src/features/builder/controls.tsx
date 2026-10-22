/**
 * The few form controls the builder needs, in the shared components' look
 * (components/ui/): the same field edge, the same panel with the theme's
 * heading, the same serious alert. Kept as the builder's own small API so
 * its screens did not have to change to get the look.
 * Every control has a visible label tied to it, and help is read out with it.
 */
import type { ComponentProps, ReactNode } from 'react';
import { useId } from 'react';
import { Alert } from '@/components/ui/alert.tsx';
import { Card } from '@/components/ui/card.tsx';
import { CheckOption } from '@/components/ui/choice.tsx';
import { controlClass } from '@/components/ui/input.tsx';
import { cn } from '@/lib/utils.ts';

const box = controlClass;

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
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="label-face text-xs">
        {label}
      </label>
      {children(help ? { id, 'aria-describedby': helpId } : { id })}
      {help && (
        <p id={helpId} className="text-sm text-muted">
          {help}
        </p>
      )}
    </div>
  );
}

export function TextInput({ className, ...props }: ComponentProps<'input'>) {
  return <input type="text" className={cn(box, className)} {...props} />;
}

export function TextArea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={cn(box, 'min-h-24', className)} {...props} />;
}

export function Select({ className, ...props }: ComponentProps<'select'>) {
  return <select className={cn(box, 'pr-8', className)} {...props} />;
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
  return <Alert tone="serious" title={error.message} />;
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
    <Card heading={title} className={className}>
      {children}
    </Card>
  );
}
