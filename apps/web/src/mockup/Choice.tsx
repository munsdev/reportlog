import { createContext, useContext, useId } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import { useField, useFieldControl } from './Field.tsx';
import { cn } from '@/lib/utils.ts';

/** The mock-up's list of answer tiles (site.css `.choices`). */
export function Choices({ className, ...props }: ComponentProps<'div'>) {
  return <div {...props} className={cn('choices', className)} />;
}

/**
 * One answer tile: a radio, or with `multi` a tick box, drawn as the
 * mock-up's `.choice` with its `.dot`. The input is a real one, so a keyboard
 * and a screen reader get what they always did.
 */
export function Choice({
  multi = false,
  children,
  ...input
}: Omit<ComponentProps<'input'>, 'type' | 'children'> & {
  multi?: boolean;
  children: ReactNode;
}) {
  return (
    <label className={cn('choice', multi && 'multi')}>
      <input {...input} type={multi ? 'checkbox' : 'radio'} />
      <span className="dot" aria-hidden="true" />
      {children}
    </label>
  );
}

/*
 * The wired form: a native radio or checkbox hidden inside a label, with a
 * drawn `dot`, taking its ids from the surrounding Field.
 */
interface GroupValue {
  name: string;
  value: string | undefined;
  disabled: boolean;
  onValueChange: (v: string) => void;
}
const Group = createContext<GroupValue | null>(null);

export function RadioGroup({
  className,
  value,
  defaultValue,
  onValueChange,
  name,
  disabled = false,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  orientation: _orientation,
  children,
  ...props
}: Omit<ComponentProps<'div'>, 'onChange' | 'defaultValue'> & {
  orientation?: 'horizontal' | 'vertical' | undefined;
  value?: string | undefined;
  defaultValue?: string | undefined;
  onValueChange?: ((v: string) => void) | undefined;
  name?: string | undefined;
  disabled?: boolean | undefined;
}) {
  const own = useId();
  const field = useField();
  const wired = useFieldControl(props);
  // Controlled by the screen in every use here; a default is for completeness.
  const shown = value ?? defaultValue;
  return (
    <Group.Provider
      value={{
        name: name ?? own,
        value: shown,
        disabled,
        onValueChange: (v) => onValueChange?.(v),
      }}
    >
      <div
        role="radiogroup"
        className={cn('choices', className)}
        aria-labelledby={props['aria-labelledby'] ?? (field ? field.labelId : undefined)}
        {...props}
        aria-describedby={wired['aria-describedby'] ?? props['aria-describedby']}
      >
        {children}
      </div>
    </Group.Provider>
  );
}

function Words({ label, hint }: { label: ReactNode; hint?: ReactNode }) {
  if (!hint) return <>{label}</>;
  return (
    <span style={{ display: 'grid', gap: 2 }}>
      <span>{label}</span>
      <span className="help" style={{ fontWeight: 400 }}>
        {hint}
      </span>
    </span>
  );
}

export function RadioOption({
  label,
  hint,
  id,
  value,
  disabled,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  id?: string | undefined;
  value: string;
  disabled?: boolean | undefined;
  className?: string | undefined;
}) {
  const g = useContext(Group);
  const own = useId();
  if (!g) throw new Error('A RadioOption needs a RadioGroup around it.');
  return (
    <label className={cn('choice', className)} htmlFor={id ?? own}>
      <input
        type="radio"
        id={id ?? own}
        name={g.name}
        value={value}
        checked={g.value === value}
        disabled={disabled ?? g.disabled}
        onChange={() => {
          g.onValueChange(value);
        }}
      />
      <span className="dot" aria-hidden="true" />
      <Words label={label} hint={hint} />
    </label>
  );
}

export function CheckOption({
  label,
  hint,
  className,
  checked,
  defaultChecked,
  onCheckedChange,
  disabled,
  id,
  name,
  'aria-describedby': describedBy,
}: {
  label: ReactNode;
  hint?: ReactNode;
  className?: string | undefined;
  checked?: boolean | undefined;
  defaultChecked?: boolean | undefined;
  onCheckedChange?: ((on: boolean | 'indeterminate') => void) | undefined;
  disabled?: boolean | undefined;
  id?: string | undefined;
  name?: string | undefined;
  'aria-describedby'?: string | undefined;
}) {
  const own = useId();
  const wired = useFieldControl({ id, 'aria-describedby': describedBy });
  const controlId = wired.id ?? id ?? own;
  return (
    <label className={cn('choice multi', className)} htmlFor={controlId}>
      <input
        type="checkbox"
        id={controlId}
        name={name}
        {...(checked === undefined ? { defaultChecked } : { checked })}
        disabled={disabled}
        aria-describedby={wired['aria-describedby']}
        onChange={(e) => {
          onCheckedChange?.(e.target.checked);
        }}
      />
      <span className="dot" aria-hidden="true" />
      <Words label={label} hint={hint} />
    </label>
  );
}
