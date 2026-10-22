/**
 * The Menu button: a real <button>, "Menu" and three bars, or "Close" and a
 * cross while the menu is open. 44px tall, in the label face, on the right
 * of the bar at every width, where a thumb reaches it.
 *
 * THE COUNT is the reports waiting for a moderator, for the people the
 * queue admits: the same number the queue shows, said in words. It is the
 * one place a count wears the action colour, because it is part of a button
 * (components.md, section 01). The other waiting totals (list review, tip
 * links, feedback) are beside their own pages inside the menu.
 */
import type { Ref } from 'react';
import { Count } from '@/components/ui/count.tsx';
import { cn } from '@/lib/utils.ts';
import { waitingWords } from './waiting.ts';

export const MENU_ID = 'site-menu';

export function MenuButton({
  open,
  onToggle,
  reportsWaiting,
  ref,
}: {
  open: boolean;
  onToggle: () => void;
  /** Reports waiting for a moderator, when this person may know it. */
  reportsWaiting?: number | undefined;
  ref?: Ref<HTMLButtonElement>;
}) {
  const count = !open && reportsWaiting ? reportsWaiting : 0;
  return (
    <button
      ref={ref}
      type="button"
      aria-expanded={open}
      aria-controls={MENU_ID}
      onClick={onToggle}
      className={cn(
        '-mr-3 inline-flex min-h-11 shrink-0 items-center gap-2.5 rounded-control px-3 label-face text-sm text-on-deep hover:bg-deeper focus-visible:outline-on-deep',
        open && 'bg-deeper',
      )}
    >
      {count ? (
        <Count tone="action" value={count} label={`${waitingWords('reports', count)}. `} />
      ) : null}
      {open ? 'Close' : 'Menu'}
      {open ? (
        <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
          <path d="M2 2l14 14M16 2L2 16" stroke="currentColor" strokeWidth="2" />
        </svg>
      ) : (
        <svg width="20" height="14" viewBox="0 0 20 14" aria-hidden="true" focusable="false">
          <path d="M0 1h20M0 7h20M0 13h20" stroke="currentColor" strokeWidth="2" />
        </svg>
      )}
    </button>
  );
}
