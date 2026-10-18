/** What the builder says about a logbook, in plain words. */
import type { LogbookSummary } from '@reportlog/contracts';

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function stateWords(l: LogbookSummary): string {
  switch (l.state) {
    case 'draft':
      return 'Draft: still being written, and not visible to anybody.';
    case 'scheduled':
      return `Launched, opening ${l.opens_at ? when(l.opens_at) : 'soon'}.`;
    case 'open':
      return `Open, and taking reports${l.closes_at ? ` until ${when(l.closes_at)}` : ''}.`;
    case 'closed':
      return 'Closed. Reports already filed stay as they are, and stay checkable.';
  }
}

export const stateLabel: Record<LogbookSummary['state'], string> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  open: 'Open',
  closed: 'Closed',
};

/** For a datetime-local input: local time, minutes, no zone. */
export function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(v: string): string | null {
  return v ? new Date(v).toISOString() : null;
}
