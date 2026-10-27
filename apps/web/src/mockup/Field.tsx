/**
 * The mock-up's form pieces: `.field` holding a label, one control (`.input`,
 * `.sel` or `.textarea`), an optional `.help` and an optional `.error`.
 *
 * Two ways to use a field:
 *
 *   <Field label="Your reason" htmlFor="why" help="It goes on the record.">
 *     <Input id="why" />
 *   </Field>
 *
 * (the label, help and control are named by the caller; `labelId` names a
 * group of answer tiles that has no single box to point a label at), or, where
 * a form is built from several controls with state of their own, wired by ids
 * so a screen reader announces the pieces as one thing:
 *
 *   <Field>
 *     <Label>Your reason</Label>
 *     <FieldDescription>It goes on the record.</FieldDescription>
 *     <Textarea />
 *     <FieldError>{error}</FieldError>
 *   </Field>
 *
 * In the second form the control is marked `aria-invalid` exactly when an
 * error is showing, so the words and the state can never disagree.
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

/** The surrounding wired field, or null outside one. */
export function useField(): FieldContextValue | null {
  return useContext(FieldContext);
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

/**
 * Controls inside this are not the surrounding Field's control. For a
 * question answered by more than one control, each with its own label:
 * otherwise every control would take the Field's one id.
 */
export function FieldReset({ children }: { children: ReactNode }) {
  return <FieldContext.Provider value={null}>{children}</FieldContext.Provider>;
}

export function Field({
  label,
  labelId,
  htmlFor,
  help,
  helpId,
  helpMono = false,
  controlId,
  className,
  children,
  ...props
}: Omit<ComponentProps<'div'>, 'children'> & {
  /** Named by the caller: a label, then the control, then help. */
  label?: ReactNode;
  labelId?: string | undefined;
  htmlFor?: string | undefined;
  help?: ReactNode;
  helpId?: string | undefined;
  helpMono?: boolean;
  /** The control's id, when something outside the field must point at it. */
  controlId?: string;
  children?: ReactNode;
}) {
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
  const named = label !== undefined || help !== undefined;
  return (
    <FieldContext.Provider value={named ? null : value}>
      <div className={cn('field', className)} {...props}>
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
    </FieldContext.Provider>
  );
}

export function Label({
  htmlFor,
  id,
  optional = false,
  children,
  ...props
}: ComponentProps<'label'> & { optional?: boolean }) {
  const field = useField();
  return (
    <label htmlFor={htmlFor ?? field?.controlId} id={id ?? field?.labelId} {...props}>
      {children}
      {optional ? <span className="muted"> (optional)</span> : null}
    </label>
  );
}

/** Help under the label. Read out after the label, before the answer. */
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
  return <span className={cn('help', className)} id={id ?? field?.descriptionId} {...props} />;
}

/** What is wrong, in a sentence. Draws nothing when there is nothing wrong. */
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
    <p className={cn('error', className)} role="alert" id={id ?? field?.errorId} {...props}>
      <span className="vh">Error: </span>
      {children}
    </p>
  );
}

/** The mock-up's text box, select and text area (site.css `.input`, `.sel`, `.textarea`). */
export function Input({ className, type = 'text', ...props }: ComponentProps<'input'>) {
  const wired = useFieldControl(props);
  return <input type={type} className={cn('input', className)} {...props} {...wired} />;
}

export function Select({ className, children, ...props }: ComponentProps<'select'>) {
  const wired = useFieldControl(props);
  return (
    <select className={cn('sel', className)} {...props} {...wired}>
      {children}
    </select>
  );
}

export function Textarea({ className, rows = 4, ...props }: ComponentProps<'textarea'>) {
  const wired = useFieldControl(props);
  return <textarea rows={rows} className={cn('textarea', className)} {...props} {...wired} />;
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

/** A label, one text box and its help, as one line of JSX. */
export function TextField({
  label,
  help,
  ...rest
}: { label: ReactNode; help?: ReactNode } & ComponentProps<'input'>) {
  const id = useId();
  return (
    <Field label={label} htmlFor={id} help={help}>
      <Input {...rest} id={id} />
    </Field>
  );
}

export function AreaField({
  label,
  help,
  ...rest
}: { label: ReactNode; help?: ReactNode } & ComponentProps<'textarea'>) {
  const id = useId();
  return (
    <Field label={label} htmlFor={id} help={help}>
      <Textarea {...rest} id={id} />
    </Field>
  );
}

export function SelectField({
  label,
  help,
  children,
  ...rest
}: { label: ReactNode; help?: ReactNode } & ComponentProps<'select'>) {
  const id = useId();
  return (
    <Field label={label} htmlFor={id} help={help}>
      <Select {...rest} id={id}>
        {children}
      </Select>
    </Field>
  );
}
