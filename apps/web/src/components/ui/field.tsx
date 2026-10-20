/**
 * A question's wiring: one label, one control, an optional hint and an
 * optional error, tied together by ids so a screen reader announces them as
 * one thing. Wrap them in `<Field>` and every piece finds the others:
 *
 *   <Field>
 *     <Label>Your email address</Label>
 *     <FieldDescription>We only use it to reach you about this report.</FieldDescription>
 *     <Input type="email" />
 *     <FieldError>{error}</FieldError>
 *   </Field>
 *
 * The control is marked invalid exactly when an error is showing, so the
 * words and the state can never disagree. An error is carried by words and a
 * mark, never by colour alone.
 */
import { createContext, useContext, useId, useLayoutEffect, useMemo, useState } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils.ts';

interface FieldContextValue {
  controlId: string;
  labelId: string;
  descriptionId: string;
  errorId: string;
  hasDescription: boolean;
  hasError: boolean;
  setHasDescription: (on: boolean) => void;
  setHasError: (on: boolean) => void;
}

const FieldContext = createContext<FieldContextValue | null>(null);

/** The surrounding field, or null outside one. */
export function useField(): FieldContextValue | null {
  return useContext(FieldContext);
}

/**
 * Controls inside this are not the surrounding Field's control. For a
 * question answered by more than one control (CountyPicker), each with its
 * own label: otherwise every control would take the Field's one id, and no
 * label could point at its own control.
 */
export function FieldReset({ children }: { children: ReactNode }) {
  return <FieldContext.Provider value={null}>{children}</FieldContext.Provider>;
}

export interface FieldControlProps {
  id?: string | undefined;
  'aria-describedby'?: string | undefined;
  'aria-invalid'?: ComponentProps<'input'>['aria-invalid'];
}

/**
 * The attributes a control takes from its field. A description or invalid
 * state the caller passed is kept. The id is always the field's, because the
 * label points at it; set it with `<Field controlId>`.
 */
export function useFieldControl(props: FieldControlProps): FieldControlProps {
  const field = useField();
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

export interface FieldProps extends ComponentProps<'div'> {
  /** The control's id, when something outside the field must point at it. */
  controlId?: string;
}

export function Field({ className, controlId, ...props }: FieldProps) {
  const generated = useId();
  const base = controlId ?? generated;
  const [hasDescription, setHasDescription] = useState(false);
  const [hasError, setHasError] = useState(false);
  const value = useMemo(
    () => ({
      controlId: controlId ?? `${base}-control`,
      labelId: `${base}-label`,
      descriptionId: `${base}-description`,
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
      <div className={cn('flex flex-col gap-1.5', className)} {...props} />
    </FieldContext.Provider>
  );
}

/** Help under the label. Read out after the label, before the answer. */
export function FieldDescription({ className, id, ...props }: ComponentProps<'p'>) {
  const field = useField();
  const setHas = field?.setHasDescription;
  useLayoutEffect(() => {
    if (!setHas) return;
    setHas(true);
    return () => {
      setHas(false);
    };
  }, [setHas]);
  return (
    <p
      id={id ?? field?.descriptionId}
      className={cn('max-w-prose text-sm text-ink-alt', className)}
      {...props}
    />
  );
}

export interface FieldErrorProps extends Omit<ComponentProps<'p'>, 'children'> {
  /** The sentence to show. Nothing is rendered when it is empty. */
  children?: ReactNode;
}

/**
 * What is wrong with the answer, in a sentence a person can act on. Renders
 * nothing when there is nothing wrong, and only then is the control valid.
 */
export function FieldError({ className, id, children, ...props }: FieldErrorProps) {
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
    <p
      id={id ?? field?.errorId}
      className={cn('flex gap-1.5 text-sm font-semibold text-serious', className)}
      {...props}
    >
      <span aria-hidden="true">!</span>
      <span>
        <span className="sr-only">Error:</span> {children}
      </span>
    </p>
  );
}
