/**
 * The mock-up's form pieces: `field` (label, control, `help`, `error`) and
 * the controls `input`, `textarea`, `sel`. They share the id wiring of
 * components/ui/field.tsx (useField / useFieldControl), so a Label inside a
 * Field is tied to its control and help is read out with it.
 */
import { Label as LabelPrimitive } from 'radix-ui';
import { useLayoutEffect } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import { Field as WiredField, useField, useFieldControl } from '@/components/ui/field.tsx';
import { cn } from '@/lib/utils.ts';

export function Field({ className, ...props }: ComponentProps<typeof WiredField>) {
  return <WiredField className={cn('field', className)} {...props} />;
}

export function Label({
  className,
  htmlFor,
  id,
  optional = false,
  children,
  ...props
}: ComponentProps<typeof LabelPrimitive.Root> & { optional?: boolean }) {
  const field = useField();
  const own = htmlFor === undefined && field !== null;
  return (
    <LabelPrimitive.Root
      htmlFor={own ? field.controlId : htmlFor}
      id={id ?? (own ? field.labelId : undefined)}
      className={className}
      {...props}
    >
      {children}
      {optional ? ' (optional)' : null}
    </LabelPrimitive.Root>
  );
}

export function FieldDescription({ className, id, ...props }: ComponentProps<'span'>) {
  const field = useField();
  const setHas = field?.setHasDescription;
  useLayoutEffect(() => {
    if (!setHas) return;
    setHas(true);
    return () => {
      setHas(false);
    };
  }, [setHas]);
  return <span id={id ?? field?.descriptionId} className={cn('help', className)} {...props} />;
}

export function FieldError({
  className,
  id,
  children,
  ...props
}: Omit<ComponentProps<'p'>, 'children'> & { children?: ReactNode }) {
  const field = useField();
  const showing =
    children !== undefined && children !== null && children !== false && children !== '';
  const setHas = field?.setHasError;
  useLayoutEffect(() => {
    if (!setHas || !showing) return;
    setHas(true);
    return () => {
      setHas(false);
    };
  }, [setHas, showing]);
  if (!showing) return null;
  return (
    <p id={id ?? field?.errorId} className={cn('error', className)} {...props}>
      <span className="vh">Error: </span>
      {children}
    </p>
  );
}

export function Input({ className, type = 'text', ...props }: ComponentProps<'input'>) {
  const wired = useFieldControl(props);
  return <input type={type} className={cn('input', className)} {...props} {...wired} />;
}

export function Textarea({ className, rows = 5, ...props }: ComponentProps<'textarea'>) {
  const wired = useFieldControl(props);
  return <textarea rows={rows} className={cn('textarea', className)} {...props} {...wired} />;
}

export function Select({ className, children, ...props }: ComponentProps<'select'>) {
  const wired = useFieldControl(props);
  return (
    <select className={cn('sel', className)} {...props} {...wired}>
      {children}
    </select>
  );
}
