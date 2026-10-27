/**
 * The mock-up's `choices` and `choice`: a native radio or checkbox hidden
 * inside a label, with a drawn `dot`. Same props as the old RadioGroup /
 * RadioOption / CheckOption so the screens only change their imports.
 */
import { createContext, useContext, useId } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import { useField, useFieldControl } from '@/components/ui/field.tsx';
import { cn } from '@/lib/utils.ts';

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
