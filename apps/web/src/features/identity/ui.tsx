/**
 * The few form pieces the identity screens share. Plain inputs with a label
 * each; errors in the serious colour, which is status, never a button.
 */
import { useId } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils.ts';
import { ApiRequestError } from '../../lib/api.ts';

export function TextField({
  label,
  hint,
  className,
  ...input
}: { label: string; hint?: string } & ComponentProps<'input'>) {
  const id = useId();
  const hintId = useId();
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <label htmlFor={id} className="font-semibold">
        {label}
      </label>
      {hint && (
        <p id={hintId} className="text-sm text-muted">
          {hint}
        </p>
      )}
      <input
        id={id}
        {...(hint ? { 'aria-describedby': hintId } : {})}
        className="rounded-card border border-line bg-surface px-3 py-2"
        {...input}
      />
    </div>
  );
}

/** A sentence from the server, or a plain one if it sent none. */
export function messageOf(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message;
  return 'Something went wrong. Try again.';
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p role="alert" className="font-semibold text-serious">
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

export function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-4 rounded-card border border-line bg-surface p-4 sm:p-6">
      <h2 className="font-display text-xl font-bold">{title}</h2>
      {children}
    </section>
  );
}
