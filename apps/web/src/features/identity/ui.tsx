/**
 * The few form pieces the identity screens share, in the shared components'
 * look (components/ui/): a field's label in the label face, the same field
 * edge, the theme's panel. Errors in the serious colour, which is status,
 * never a button.
 */
import { useId } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import { Card } from '@/components/ui/card.tsx';
import { controlClass } from '@/components/ui/input.tsx';
import { cn } from '@/lib/utils.ts';
import { ApiRequestError } from '../../lib/api.ts';

/**
 * A code typed from an email or an app: mono, large and letter-spaced, set
 * in the middle, so six digits read as one thing and a mistyped one shows.
 */
export const codeInputClass = 'text-center font-mono text-2xl tracking-[0.3em]';

export function TextField({
  label,
  hint,
  className,
  inputClassName,
  ...input
}: { label: string; hint?: string; inputClassName?: string } & ComponentProps<'input'>) {
  const id = useId();
  const hintId = useId();
  // The caller's own description (an error sentence, say) is kept beside the hint.
  const describedBy =
    [hint ? hintId : undefined, input['aria-describedby']].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="label-face text-xs text-ink">
        {label}
      </label>
      {hint && (
        <p id={hintId} className="text-sm text-ink-alt">
          {hint}
        </p>
      )}
      <input
        id={id}
        {...input}
        aria-describedby={describedBy}
        className={cn(controlClass, inputClassName)}
      />
    </div>
  );
}

/** A sentence from the server, or a plain one if it sent none. */
export function messageOf(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message;
  return 'Something went wrong. Try again.';
}

export function ErrorText({ error, id }: { error: unknown; id?: string }) {
  if (!error) return null;
  return (
    <p {...(id ? { id } : {})} role="alert" className="font-semibold text-serious">
      {messageOf(error)}
    </p>
  );
}

export function Done({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="font-semibold">
      {children}
    </p>
  );
}

/** A panel with the theme's heading. */
export function Panel({
  title,
  level = 2,
  children,
}: {
  title: string;
  /** 3 when the panel sits under a section heading of its own. */
  level?: 2 | 3;
  children: ReactNode;
}) {
  return (
    <Card heading={title} headingLevel={level}>
      {children}
    </Card>
  );
}

/** A section of a page: a heading, then its panels. */
export function Section({
  title,
  lede,
  children,
}: {
  title: string;
  lede?: ReactNode;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4">
      <h2 id={id} className="font-display text-2xl font-bold">
        {title}
      </h2>
      {lede ? <p className="max-w-prose text-ink-alt">{lede}</p> : null}
      {children}
    </section>
  );
}
