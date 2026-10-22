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
 * Inside a field the group is named by the field's label. Each option is a
 * choice card: the whole card chooses, and the chosen one says so with a
 * tick and a heavier edge, not only a tint.
 */
import { RadioGroup as RadioGroupPrimitive } from 'radix-ui';
import { useId } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils.ts';
import { useField, useFieldControl } from './field.tsx';
import { ChoiceWords, Tick, choiceCardClass, choiceMarkClass } from './choice.tsx';

export function RadioGroup({
  className,
  ...props
}: ComponentProps<typeof RadioGroupPrimitive.Root>) {
  const field = useField();
  const wired = useFieldControl(props);
  return (
    <RadioGroupPrimitive.Root
      className={cn('flex flex-col gap-2.5', className)}
      {...props}
      {...wired}
      aria-labelledby={props['aria-labelledby'] ?? (field ? field.labelId : undefined)}
    />
  );
}

/** The bare round mark. Prefer `RadioOption`, which is the whole card. */
export function RadioGroupItem({
  className,
  ...props
}: ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item className={cn(choiceMarkClass, 'rounded-full', className)} {...props}>
      <RadioGroupPrimitive.Indicator className="flex">
        <Tick />
      </RadioGroupPrimitive.Indicator>
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

/**
 * An option as a choice card (choice.tsx): the whole card is the click
 * target, the option is named by its words and described by its hint.
 */
export function RadioOption({ label, hint, id, className, ...props }: RadioOptionProps) {
  const own = useId();
  const itemId = id ?? own;
  const titleId = `${itemId}-title`;
  const hintId = `${itemId}-hint`;
  return (
    <label htmlFor={itemId} className={cn(choiceCardClass, className)}>
      <RadioGroupItem
        id={itemId}
        aria-labelledby={titleId}
        aria-describedby={hint ? hintId : undefined}
        {...props}
      />
      <ChoiceWords titleId={titleId} noteId={hintId} title={label} note={hint} />
    </label>
  );
}
