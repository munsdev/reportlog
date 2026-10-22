/** How the tracker's dates and statuses read on screen. */
import {
  FEEDBACK_SEVERITY_LABELS,
  FEEDBACK_STATUS_LABELS,
  FEEDBACK_TYPE_LABELS,
  OPEN_FEEDBACK_STATUSES,
} from '@reportlog/contracts';
import type { FeedbackIssue, FeedbackStatus } from '@reportlog/contracts';
import { Chip } from '../../components/ui/chip.tsx';
import { STAFF_AREAS, entryAt } from '../staff-nav/entries.ts';

export const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

const OPEN: readonly FeedbackStatus[] = OPEN_FEEDBACK_STATUSES;

/** An issue's status as a chip: `open` while somebody still owes it something, `tag` after. */
export function StatusChip({ status }: { status: FeedbackStatus }) {
  return (
    <Chip tone={OPEN.includes(status) ? 'open' : 'tag'}>{FEEDBACK_STATUS_LABELS[status]}</Chip>
  );
}

/**
 * The screen a piece of feedback came from, by the menu's name for it
 * ("Site settings", "Queue"), from the router's id for the screen. Null when
 * it is not a staff page the menu names; the caller shows the id itself.
 */
export function pageNameFor(routeId: string): string | null {
  const path = routeId.replace(/\/\([^)]*\)/g, '').replace(/\/+$/, '') || '/';
  const entry = entryAt(path);
  if (!entry) return null;
  if (entry.label !== 'Overview') return entry.label;
  return STAFF_AREAS.find((a) => a.pages.includes(entry))?.label ?? entry.label;
}

/** One line under an issue's title: what it is, how bad, where it stands, who filed it. */
export function IssueLine({ issue, author }: { issue: FeedbackIssue; author?: string }) {
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-alt">
      <span className="font-mono text-ink">#{issue.id}</span>
      <StatusChip status={issue.status} />
      <span>
        {FEEDBACK_TYPE_LABELS[issue.type]} · {FEEDBACK_SEVERITY_LABELS[issue.severity]} ·{' '}
        {issue.mine ? 'you' : (author ?? issue.author)} · {when(issue.created_at)}
        {issue.comment_count
          ? ` · ${String(issue.comment_count)} comment${issue.comment_count === 1 ? '' : 's'}`
          : ''}
      </span>
    </p>
  );
}
