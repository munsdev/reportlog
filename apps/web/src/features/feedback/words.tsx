/** How the tracker's dates and statuses read on screen. */
import {
  FEEDBACK_SEVERITY_LABELS,
  FEEDBACK_STATUS_LABELS,
  FEEDBACK_TYPE_LABELS,
  OPEN_FEEDBACK_STATUSES,
} from '@reportlog/contracts';
import type { FeedbackIssue, FeedbackStatus } from '@reportlog/contracts';
import { Chip } from '../../mockup/Chip.tsx';
import { entryAt } from '../staff-nav/entries.ts';

export const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

const OPEN: readonly FeedbackStatus[] = OPEN_FEEDBACK_STATUSES;

/** An issue's status as a chip: plain while somebody still owes it something, muted after. */
export function StatusChip({ status }: { status: FeedbackStatus }) {
  return <Chip kind={OPEN.includes(status) ? '' : 'off'}>{FEEDBACK_STATUS_LABELS[status]}</Chip>;
}

/**
 * The screen a piece of feedback came from, by the menu's name for it
 * ("Site settings", "Queue"), from the router's id for the screen. Null when
 * it is not a staff page the menu names; the caller shows the id itself.
 */
export function pageNameFor(routeId: string): string | null {
  const path = routeId.replace(/\/\([^)]*\)/g, '').replace(/\/+$/, '') || '/';
  const entry = entryAt(path);
  // The settings overview has a route but no menu entry any more.
  if (!entry) return path === '/settings' ? 'Site settings' : null;
  return entry.label;
}

/** The facts under an issue's title: who filed it, when, what kind, how bad. */
export function IssueLine({ issue, author }: { issue: FeedbackIssue; author?: string }) {
  return (
    <p className="m">
      {issue.mine ? 'you' : (author ?? issue.author)} · {when(issue.created_at)} ·{' '}
      {FEEDBACK_TYPE_LABELS[issue.type]} · {FEEDBACK_SEVERITY_LABELS[issue.severity]}
      {issue.comment_count
        ? ` · ${String(issue.comment_count)} comment${issue.comment_count === 1 ? '' : 's'}`
        : ''}
    </p>
  );
}
