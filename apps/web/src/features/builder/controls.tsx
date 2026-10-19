/**
 * The few form controls the builder needs, kept here rather than in
 * components/ui/ (which the site workstream owns) until shared ones exist.
 * Every control has a visible label tied to it, and help is read out with it.
 */
import type { ComponentProps, ReactNode } from 'react';
import { useId } from 'react';
import { cn } from '@/lib/utils.ts';

const box = 'w-full rounded-card border border-line bg-surface px-3 py-2';

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
      <label htmlFor={id} className="font-semibold">
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
  return <select className={cn(box, className)} {...props} />;
}

/** A checkbox with its words beside it, and an optional line of why. */
export function Check({
  label,
  help,
  ...props
}: Omit<ComponentProps<'input'>, 'type'> & { label: string; help?: string | undefined }) {
  const id = useId();
  return (
    <div className="flex items-start gap-2">
      <input id={id} type="checkbox" className="mt-1 size-4" {...props} />
      <div>
        <label htmlFor={id} className="font-semibold">
          {label}
        </label>
        {help && <p className="text-sm text-muted">{help}</p>}
      </div>
    </div>
  );
}

/** A refusal from the server, said where the control is. */
export function Problem({ error }: { error: Error | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="rounded-card border-l-4 border-serious bg-surface p-3">
      {error.message}
    </p>
  );
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
    <section
      aria-label={title}
      className={cn('space-y-4 rounded-card border border-line bg-surface p-4', className)}
    >
      <h2 className="font-display text-xl font-bold">{title}</h2>
      {children}
    </section>
  );
}
