import type { ComponentProps, ReactNode } from 'react';
import { messageOf } from '../features/identity/ui.tsx';
import { cn } from '@/lib/utils.ts';

/**
 * The mock-up's note (site.css `.note`): `lock` is dashed, `warn` has the
 * serious edge and says it to a screen reader (`tone` is the older spelling:
 * serious and warning are `warn`, done and note are plain). A plain note is a
 * status unless the caller says otherwise. A title is the bold lead-in.
 */
export function Note({
  title,
  lock = false,
  warn = false,
  tone,
  role,
  className,
  children,
  ...props
}: Omit<ComponentProps<'div'>, 'title'> & {
  title?: ReactNode;
  lock?: boolean;
  warn?: boolean;
  tone?: 'note' | 'warning' | 'serious' | 'done' | null | undefined;
}) {
  const bad = warn || tone === 'serious' || tone === 'warning';
  return (
    <div
      role={role ?? (bad ? 'alert' : 'status')}
      className={cn('note', lock && 'lock', bad && 'warn', className)}
      {...props}
    >
      <span>
        {title ? <b>{title} </b> : null}
        {children}
      </span>
    </div>
  );
}

/** A failure from a call, as a boxed sentence a person can read. */
export function ErrorNote({ error, title }: { error: unknown; title?: ReactNode }) {
  if (!error) return null;
  return (
    <Note warn title={title}>
      {messageOf(error)}
    </Note>
  );
}

/** A one-line wait, in the narrow column. */
export function Waiting({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="muted">
      {children}
    </p>
  );
}
