import { useId } from 'react';
import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';

/** The mock-up's `.field`: label, one control, optional help. `children` is a custom control. */
function LabelledField({
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
    <LabelledField label={label} id={id} help={help}>
      <input className="input" {...rest} id={id} />
    </LabelledField>
  );
}

export function AreaField({
  label,
  help,
  ...rest
}: { label: ReactNode; help?: ReactNode } & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId();
  return (
    <LabelledField label={label} id={id} help={help}>
      <textarea className="textarea" {...rest} id={id} />
    </LabelledField>
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
    <LabelledField label={label} id={id} help={help}>
      <select className="sel" {...rest} id={id}>
        {children}
      </select>
    </LabelledField>
  );
}
