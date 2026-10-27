import { useId } from 'react';
import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';

/** The mock-up's `.field`: label, one control, optional help. `children` is a custom control. */
export function Field({
  label,
  help,
  id,
  children,
}: {
  label: ReactNode;
  help?: ReactNode;
  id: string;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {help ? <span className="help">{help}</span> : null}
    </div>
  );
}

export function TextField({
  label,
  help,
  ...rest
}: { label: ReactNode; help?: ReactNode } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <Field label={label} id={id} help={help}>
      <input className="input" {...rest} id={id} />
    </Field>
  );
}

export function AreaField({
  label,
  help,
  ...rest
}: { label: ReactNode; help?: ReactNode } & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId();
  return (
    <Field label={label} id={id} help={help}>
      <textarea className="textarea" {...rest} id={id} />
    </Field>
  );
}

export function SelectField({
  label,
  help,
  children,
  ...rest
}: { label: ReactNode; help?: ReactNode } & SelectHTMLAttributes<HTMLSelectElement>) {
  const id = useId();
  return (
    <Field label={label} id={id} help={help}>
      <select className="sel" {...rest} id={id}>
        {children}
      </select>
    </Field>
  );
}
