/**
 * One choice from a few, shown all at once. Radix's group: the arrow keys
 * move between options and Tab leaves the group, the way a radio group is
 * expected to behave. Choosing an option never moves anybody on by itself.
 *
 *   <Field>
 *     <Label>May we publish it?</Label>
 *     <RadioGroup value={v} onValueChange={setV}>
 *       <RadioOption value="yes" label="Yes" />
 *       <RadioOption value="no" label="No" />
 *     </RadioGroup>
 *     <FieldError>{error}</FieldError>
 *   </Field>
 *
 * Inside a field the group is named by the field's label.
 */
import { RadioGroup as RadioGroupPrimitive } from 'radix-ui';
import { useId } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils.ts';
import { useField, useFieldControl } from './field.tsx';
import { Label } from './label.tsx';

export function RadioGroup({
  className,
  ...props
}: ComponentProps<typeof RadioGroupPrimitive.Root>) {
  const field = useField();
  const wired = useFieldControl(props);
  return (
    <RadioGroupPrimitive.Root
      className={cn('flex flex-col gap-3', className)}
      {...props}
      {...wired}
      aria-labelledby={props['aria-labelledby'] ?? (field ? field.labelId : undefined)}
    />
  );
}

export function RadioGroupItem({
  className,
  ...props
}: ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      className={cn(
        'flex size-6 shrink-0 items-center justify-center rounded-full border-2 border-ink-alt bg-surface disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <RadioGroupPrimitive.Indicator className="size-3 rounded-full bg-ink" />
    </RadioGroupPrimitive.Item>
  );
}

export interface RadioOptionProps extends Omit<
  ComponentProps<typeof RadioGroupPrimitive.Item>,
  'children'
> {
  label: ReactNode;
  /** A line of help under the option's words. */
  hint?: ReactNode;
}

/** An option with its words beside it, so the words are the click target too. */
export function RadioOption({ label, hint, id, className, ...props }: RadioOptionProps) {
  const own = useId();
  const itemId = id ?? own;
  const hintId = `${itemId}-hint`;
  return (
    <div className={cn('flex items-start gap-3', className)}>
      <RadioGroupItem id={itemId} aria-describedby={hint ? hintId : undefined} {...props} />
      <div className="flex flex-col">
        <Label htmlFor={itemId} className="font-normal">
          {label}
        </Label>
        {hint ? (
          <span id={hintId} className="text-sm text-ink-alt">
            {hint}
          </span>
        ) : null}
      </div>
    </div>
  );
}
