/**
 * A question's wiring in the mock-up's markup: `.field` holding a `label`,
 * one control (`.input`, `.sel` or `.textarea`), an optional `.help` and an
 * optional `.error`, tied together by ids so a screen reader announces them
 * as one thing.
 *
 *   <Field>
 *     <Label>Your reason</Label>
 *     <FieldDescription>It goes on the record.</FieldDescription>
 *     <Textarea />
 *     <FieldError>{error}</FieldError>
 *   </Field>
 *
 * The control is marked `aria-invalid` exactly when an error is showing.
 * Use this where a form is built from several controls with state of their
 * own; `Field.tsx`'s `TextField`/`SelectField`/`AreaField` are the one-line
 * forms of the same markup.
 */
import { createContext, useContext, useId, useLayoutEffect, useMemo, useState } from 'react';
import type { ComponentProps, ReactNode } from 'react';

interface FieldContextValue {
  controlId: string;
  descriptionId: string;
  errorId: string;
  hasDescription: boolean;
  hasError: boolean;
  setHasDescription: (on: boolean) => void;
  setHasError: (on: boolean) => void;
}

const FieldContext = createContext<FieldContextValue | null>(null);

export function Field({
  controlId,
  className,
  ...props
}: ComponentProps<'div'> & { controlId?: string }) {
  const base = useId();
  const [hasDescription, setHasDescription] = useState(false);
  const [hasError, setHasError] = useState(false);
  const value = useMemo(
    () => ({
      controlId: controlId ?? `${base}-control`,
      descriptionId: `${base}-help`,
      errorId: `${base}-error`,
      hasDescription,
      hasError,
      setHasDescription,
      setHasError,
    }),
    [base, controlId, hasDescription, hasError],
  );
  return (
    <FieldContext.Provider value={value}>
      <div className={className ? `field ${className}` : 'field'} {...props} />
    </FieldContext.Provider>
  );
}

/** Controls inside this are not the surrounding field's control. */
export function FieldReset({ children }: { children: ReactNode }) {
  return <FieldContext.Provider value={null}>{children}</FieldContext.Provider>;
}

export function Label({
  htmlFor,
  optional = false,
  children,
  ...props
}: ComponentProps<'label'> & { optional?: boolean }) {
  const field = useContext(FieldContext);
  return (
    <label htmlFor={htmlFor ?? field?.controlId} {...props}>
      {children}
      {optional ? <span className="muted"> (optional)</span> : null}
    </label>
  );
}

/** Help under the label. Read out after the label, before the answer. */
export function FieldDescription({ id, ...props }: ComponentProps<'span'>) {
  const field = useContext(FieldContext);
  const setHas = field?.setHasDescription;
  useLayoutEffect(() => {
    if (!setHas) return;
    setHas(true);
    return () => {
      setHas(false);
    };
  }, [setHas]);
  return <span className="help" id={id ?? field?.descriptionId} {...props} />;
}

/** What is wrong, in a sentence. Draws nothing when there is nothing wrong. */
export function FieldError({ children, id }: { children?: ReactNode; id?: string }) {
  const field = useContext(FieldContext);
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
    <p className="error" role="alert" id={id ?? field?.errorId}>
      <span className="vh">Error: </span>
      {children}
    </p>
  );
}

function wired(
  props: {
    'aria-describedby'?: string | undefined;
    'aria-invalid'?: boolean | 'true' | 'false' | 'grammar' | 'spelling' | undefined;
  },
  field: FieldContextValue | null,
) {
  if (!field) return {};
  const describedBy = [
    props['aria-describedby'],
    field.hasDescription ? field.descriptionId : undefined,
    field.hasError ? field.errorId : undefined,
  ]
    .filter(Boolean)
    .join(' ');
  return {
    id: field.controlId,
    'aria-describedby': describedBy || undefined,
    'aria-invalid': props['aria-invalid'] ?? (field.hasError ? true : undefined),
  };
}

export function Input({ className, ...props }: ComponentProps<'input'>) {
  const field = useContext(FieldContext);
  return (
    <input
      className={className ? `input ${className}` : 'input'}
      {...props}
      {...wired(props, field)}
    />
  );
}

export function Select({ className, children, ...props }: ComponentProps<'select'>) {
  const field = useContext(FieldContext);
  return (
    <select className={className ? `sel ${className}` : 'sel'} {...props} {...wired(props, field)}>
      {children}
    </select>
  );
}

export function Textarea({ className, rows = 4, ...props }: ComponentProps<'textarea'>) {
  const field = useContext(FieldContext);
  return (
    <textarea
      rows={rows}
      className={className ? `textarea ${className}` : 'textarea'}
      {...props}
      {...wired(props, field)}
    />
  );
}
