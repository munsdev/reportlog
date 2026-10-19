/**
 * One slot of the operator's page wording, where the design put it.
 *
 * Plain text with the operator's own line breaks, never HTML: it is
 * somebody else's writing arriving from a database. An optional slot nobody
 * wrote is '' and draws nothing at all. On a door the site's wording is not
 * asked for (see useSite), so this draws nothing there either.
 */
import type { CopyKey } from '@reportlog/contracts';
import { cn } from '@/lib/utils.ts';
import { useSite } from './site.tsx';

export function CopyText({ slot, className }: { slot: CopyKey; className?: string }) {
  const text = useSite().data?.copy[slot];
  if (!text) return null;
  return (
    <p data-copy={slot} className={cn('max-w-prose whitespace-pre-wrap', className)}>
      {text}
    </p>
  );
}
