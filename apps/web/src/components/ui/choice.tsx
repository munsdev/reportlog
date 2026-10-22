/**
 * The choice card: a whole card that is one option, for one choice from a
 * few (inside a RadioGroup, as `RadioOption`) or a yes/no to tick
 * (`CheckOption`). The site's own control everywhere: no browser-default
 * radio or checkbox appears on any page.
 *
 * The card is a <label> wrapping a real control (Radix's radio or checkbox,
 * so the arrow keys move within a group and Space ticks), so a tap anywhere
 * on it chooses. The control is named by the title alone and described by
 * the note, rather than by everything inside the label, so a screen reader
 * hears "Yes, radio button, Without your name" and not one run-on sentence.
 *
 * Chosen is said three ways and never by colour alone: a heavier edge, a
 * filled mark with a tick in it, and the theme's shadow.
 */
import { Checkbox as CheckboxPrimitive } from 'radix-ui';
import { useId } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils.ts';
import { useFieldControl } from './field.tsx';

/**
 * The card around a control. Its look follows the control's state. Written
 * out in full rather than built from a constant: Tailwind generates only the
 * class names it can find spelled out in the source.
 */
export const choiceCardClass = cn(
  'flex min-h-14 w-full cursor-pointer items-center gap-3.5 rounded-control border border-ink-alt bg-surface px-4 py-2.5 text-ink',
  'has-[[data-state=checked]]:border-2 has-[[data-state=checked]]:border-ink has-[[data-state=checked]]:bg-paper-alt has-[[data-state=checked]]:px-[0.9375rem] has-[[data-state=checked]]:py-[0.5625rem] has-[[data-state=checked]]:shadow-raised',
  // Focus is drawn on the card, which is what the person is looking at,
  // rather than on the small mark inside it.
  'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ink',
  'has-[:disabled]:cursor-not-allowed has-[:disabled]:border-dashed has-[:disabled]:bg-paper-alt has-[:disabled]:text-ink-alt',
  'has-[[aria-invalid=true]]:border-serious',
);

/** The round or square mark, filled with a tick when chosen. */
export const choiceMarkClass =
  'peer flex size-[1.375rem] shrink-0 items-center justify-center border-2 border-ink bg-surface text-surface outline-none data-[state=checked]:bg-ink';

export function Tick() {
  return (
    <svg viewBox="0 0 12 12" className="size-3" aria-hidden="true" focusable="false">
      <path
        d="M2 6.5 5 9.5 10 2.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="square"
      />
    </svg>
  );
}

/** The title and note inside a card, with the ids the control points at. */
export function ChoiceWords({
  titleId,
  noteId,
  title,
  note,
}: {
  titleId: string;
  noteId: string;
  title: ReactNode;
  note?: ReactNode;
}) {
  return (
    <span className="flex min-w-0 flex-col">
      <span id={titleId} className="leading-snug font-bold">
        {title}
      </span>
      {note ? (
        <span id={noteId} className="text-sm text-ink-alt">
          {note}
        </span>
      ) : null}
    </span>
  );
}

export interface CheckOptionProps extends Omit<
  ComponentProps<typeof CheckboxPrimitive.Root>,
  'children' | 'title'
> {
  label: ReactNode;
  /** A line of help under the words. */
  hint?: ReactNode;
}

/**
 * A yes/no to tick, as a card. Inside a `<Field>` it takes the field's id,
 * description and error, as the bare Checkbox does.
 */
export function CheckOption({ label, hint, className, ...props }: CheckOptionProps) {
  const own = useId();
  const titleId = `${own}-title`;
  const noteId = `${own}-note`;
  const wired = useFieldControl(props);
  // Inside a Field the field's ids already include the caller's; outside one
  // the caller's must be kept on their own.
  const describedBy = [
    hint ? noteId : undefined,
    wired['aria-describedby'] ?? props['aria-describedby'],
  ]
    .filter(Boolean)
    .join(' ');
  const controlId = wired.id ?? props.id ?? `${own}-control`;
  return (
    <label htmlFor={controlId} className={cn(choiceCardClass, className)}>
      <CheckboxPrimitive.Root
        className={cn(choiceMarkClass, 'rounded-[3px]')}
        {...props}
        {...wired}
        id={controlId}
        aria-labelledby={titleId}
        aria-describedby={describedBy || undefined}
      >
        <CheckboxPrimitive.Indicator className="flex">
          <Tick />
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
      <ChoiceWords titleId={titleId} noteId={noteId} title={label} note={hint} />
    </label>
  );
}
